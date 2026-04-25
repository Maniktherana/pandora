//! Listening-port detection for tracked sessions.
//!
//! Listening-port detection for tracked sessions.
//!
//! Why shell out to `lsof` and `ps` rather than a Rust crate:
//!   * `netstat2-rs` and similar pure-Rust crates need root on macOS to read
//!     the per-process socket table. lsof gets us the same information
//!     without elevated privileges.
//!   * `sysinfo` walks `/proc` (or its macOS equivalent) on every refresh,
//!     which is roughly 10× more syscalls than a single targeted `lsof
//!     -p pid1,pid2,…`. We poll every 3 s; the difference adds up.
//!   * `lsof` and `ps` are part of the OS install on macOS and behave
//!     identically when invoked over SSH, which simplifies the future
//!     remote-workspace story.
//!
//! Scan policy:
//!   * 3 s poll interval (`SCAN_INTERVAL`).
//!   * 500 ms hint-triggered re-scan when a tracked session prints something
//!     that looks like "Listening on port 4321".
//!   * 5 s hard timeout on each lsof/ps call.
//!   * Ignores ports 22, 80, 443, 5432, 3306, 6379, 27017 (SSH + common
//!     databases the user almost certainly didn't just spin up).
//!
//! State machine:
//!   `register_session` adds a (session_id, root_pid) pair to the watch set.
//!   The scan loop walks each root's process tree via `ps`, collects all
//!   PIDs into one set, runs a single `lsof -p …` over the union, and
//!   re-attributes each detected port back to the session whose tree
//!   contained the PID. `unregister_session` removes the entry and any
//!   ports previously attributed to it.

use regex::Regex;
use std::collections::{HashMap, HashSet};
use std::process::Stdio;
use std::sync::{Arc, LazyLock};
use std::time::Duration;
use tokio::process::Command;
use tokio::sync::{mpsc, Mutex};

use super::types::DetectedPort;

const SCAN_INTERVAL: Duration = Duration::from_secs(3);
const HINT_SCAN_DELAY: Duration = Duration::from_millis(500);
const EXEC_TIMEOUT: Duration = Duration::from_secs(5);

/// Common ports we never want to surface, even if a tracked descendant
/// happens to hold one.
static IGNORED_PORTS: &[u16] = &[22, 80, 443, 5432, 3306, 6379, 27017];

/// Regex extractors for "looks like the user just started a server" hints
/// in stdout/stderr.
static PORT_HINT_PATTERNS: LazyLock<[Regex; 4]> = LazyLock::new(|| {
    [
        Regex::new(r"(?i)listening\s+on\s+(?:port\s+)?(\d+)").unwrap(),
        Regex::new(
            r"(?i)server\s+(?:started|running)\s+(?:on|at)\s+(?:https?://)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0)?:?(\d+)",
        )
        .unwrap(),
        Regex::new(
            r"(?i)ready\s+on\s+(?:https?://)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0)?:?(\d+)",
        )
        .unwrap(),
        Regex::new(r":(\d{4,5})\s*$").unwrap(),
    ]
});

/// After this many seconds of output from a session, stop running the
/// port-hint regex on its chunks. Servers print "Listening on..." within
/// the first few seconds; after that the regex is pure overhead.
const HINT_WINDOW_SECS: u64 = 60;

#[derive(Debug, Clone)]
struct TrackedSession {
    pid: u32,
    first_output_at: Option<std::time::Instant>,
}

#[derive(Debug, Default)]
struct State {
    /// session_id → root pid
    sessions: HashMap<String, TrackedSession>,
    /// `"<session_id>:<port>"` → port record. Two sessions exposing the same
    /// port on different sub-processes get two distinct rows.
    ports: HashMap<String, DetectedPort>,
}

/// Public handle. Cheap to clone (`Arc` around the inner state). Drop the
/// last clone (and any `JoinHandle`) to stop scanning.
#[derive(Clone)]
pub struct PortManager {
    state: Arc<Mutex<State>>,
    on_change: mpsc::Sender<Vec<DetectedPort>>,
    /// Hint-debounce sender. Each `check_output_for_hint` shove just nudges
    /// the loop; duplicates are coalesced in the receiver.
    hint_tx: mpsc::Sender<()>,
}

impl PortManager {
    /// Spawn the background scan loop. Returns a `(PortManager, ports_rx)`
    /// pair plus the join handle of the scan task; drop the handle to stop.
    pub fn spawn() -> (Self, mpsc::Receiver<Vec<DetectedPort>>, tokio::task::JoinHandle<()>) {
        let (on_change_tx, on_change_rx) = mpsc::channel::<Vec<DetectedPort>>(32);
        let (hint_tx, hint_rx) = mpsc::channel::<()>(16);
        let pm = Self {
            state: Arc::new(Mutex::new(State::default())),
            on_change: on_change_tx,
            hint_tx,
        };

        let runner = pm.clone();
        let join = tokio::spawn(async move { runner.run(hint_rx).await });
        (pm, on_change_rx, join)
    }

    /// Add a session to the watch set. The PID must be the immediate child
    /// (the shell); descendants are discovered via `ps` on each scan.
    pub async fn register_session(&self, session_id: &str, pid: u32) {
        let mut s = self.state.lock().await;
        s.sessions.insert(
            session_id.to_string(),
            TrackedSession { pid, first_output_at: None },
        );
    }

    /// Remove a session and any ports currently attributed to it. Emits one
    /// change event if any ports were removed.
    pub async fn unregister_session(&self, session_id: &str) {
        let removed_ports = {
            let mut s = self.state.lock().await;
            s.sessions.remove(session_id);
            let before = s.ports.len();
            s.ports.retain(|_, p| p.session_id != session_id);
            before != s.ports.len()
        };
        if removed_ports {
            self.emit_change().await;
        }
    }

    /// Run the four hint regexes against a chunk of session output. If any
    /// matches with a sane port number, schedule a fast-follow scan in
    /// `HINT_SCAN_DELAY`.
    pub async fn check_output_for_hint(&self, chunk: &[u8], session_id: &str) {
        if chunk.len() < 8 {
            return;
        }
        {
            let mut s = self.state.lock().await;
            let Some(tracked) = s.sessions.get_mut(session_id) else {
                return;
            };
            let now = std::time::Instant::now();
            let first = *tracked.first_output_at.get_or_insert(now);
            if now.duration_since(first).as_secs() > HINT_WINDOW_SECS {
                return;
            }
        }
        let text = String::from_utf8_lossy(chunk);
        for pattern in PORT_HINT_PATTERNS.iter() {
            if let Some(caps) = pattern.captures(&text) {
                if let Some(m) = caps.get(1) {
                    if let Ok(port) = m.as_str().parse::<u16>() {
                        if (1..=65535).contains(&port) {
                            let _ = self.hint_tx.try_send(());
                            return;
                        }
                    }
                }
            }
        }
    }

    /// Snapshot of currently-detected ports. Used for the initial
    /// `ports_snapshot` event when a renderer connects.
    pub async fn list_ports(&self) -> Vec<DetectedPort> {
        let s = self.state.lock().await;
        s.ports.values().cloned().collect()
    }

    async fn emit_change(&self) {
        let snapshot = self.list_ports().await;
        let _ = self.on_change.send(snapshot).await;
    }

    /// Internal: the scan loop. Wakes on either the 3 s tick or a hint pulse.
    async fn run(self, mut hint_rx: mpsc::Receiver<()>) {
        let mut interval = tokio::time::interval(SCAN_INTERVAL);
        // Skip the immediate fire so we don't scan with an empty session set.
        interval.tick().await;
        loop {
            tokio::select! {
                _ = interval.tick() => self.scan_once().await,
                got = hint_rx.recv() => {
                    if got.is_none() { break; }
                    // Drain any further hints that arrived while we were
                    // waiting, then debounce briefly so a burst of "Listening
                    // on" lines triggers exactly one extra scan.
                    while hint_rx.try_recv().is_ok() {}
                    tokio::time::sleep(HINT_SCAN_DELAY).await;
                    self.scan_once().await;
                }
            }
        }
    }

    async fn scan_once(&self) {
        let session_pids: Vec<(String, u32)> = {
            let s = self.state.lock().await;
            s.sessions
                .iter()
                .map(|(id, t)| (id.clone(), t.pid))
                .collect()
        };
        if session_pids.is_empty() {
            return;
        }

        // Walk one process tree per session, then union the PIDs. The map
        // gets us back from a discovered PID to the session that owns it.
        let mut pid_to_session: HashMap<u32, String> = HashMap::new();
        // ps once, then partition — one shell-out instead of N.
        let tree = match list_process_tree().await {
            Some(t) => t,
            None => HashMap::new(),
        };
        for (sid, root_pid) in &session_pids {
            for descendant in collect_descendants(*root_pid, &tree) {
                pid_to_session.insert(descendant, sid.clone());
            }
        }

        if pid_to_session.is_empty() {
            // All tracked sessions exited between the last register and now.
            let cleared = {
                let mut s = self.state.lock().await;
                if s.ports.is_empty() {
                    false
                } else {
                    s.ports.clear();
                    true
                }
            };
            if cleared {
                self.emit_change().await;
            }
            return;
        }

        let pids: Vec<u32> = pid_to_session.keys().copied().collect();
        let scanned = scan_listening_ports(&pids).await;

        // Build the next snapshot, preserving `detected_at` for unchanged
        // entries so the UI's "started 12s ago" timer doesn't reset every scan.
        let now_ms = chrono::Utc::now().timestamp_millis();
        let mut next: HashMap<String, DetectedPort> = HashMap::new();
        for sp in scanned {
            let Some(sid) = pid_to_session.get(&sp.pid) else { continue };
            let key = format!("{}:{}", sid, sp.port);
            let detected_at = {
                let s = self.state.lock().await;
                s.ports.get(&key).map(|p| p.detected_at).unwrap_or(now_ms)
            };
            next.insert(
                key,
                DetectedPort {
                    port: sp.port as i64,
                    pid: sp.pid as i64,
                    process_name: sp.process_name,
                    session_id: sid.clone(),
                    address: sp.address,
                    detected_at,
                },
            );
        }

        // Diff before swapping so we don't re-emit on identical scans.
        let changed = {
            let s = self.state.lock().await;
            if s.ports.len() != next.len() {
                true
            } else {
                s.ports.iter().any(|(k, prev)| {
                    next.get(k)
                        .map(|n| n.pid != prev.pid || n.process_name != prev.process_name)
                        .unwrap_or(true)
                })
            }
        };

        if changed {
            {
                let mut s = self.state.lock().await;
                s.ports = next;
            }
            self.emit_change().await;
        }
    }
}

// ---------------------------------------------------------------------------
// External-command helpers. Kept module-local; not used outside of scan_once.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
struct ScannedPort {
    port: u16,
    pid: u32,
    process_name: String,
    address: String,
}

/// Run `ps -o pid=,ppid= -ax` once and return `parent → [child, …]`.
async fn list_process_tree() -> Option<HashMap<u32, Vec<u32>>> {
    let output = run_command("ps", &["-o", "pid=,ppid=", "-ax"]).await?;
    let mut tree: HashMap<u32, Vec<u32>> = HashMap::new();
    for line in output.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 2 {
            continue;
        }
        let (Ok(pid), Ok(ppid)) = (parts[0].parse::<u32>(), parts[1].parse::<u32>()) else {
            continue;
        };
        tree.entry(ppid).or_default().push(pid);
    }
    Some(tree)
}

/// BFS over `tree` rooted at `root`, returning every PID reachable
/// (including `root` itself even if it isn't a key).
fn collect_descendants(root: u32, tree: &HashMap<u32, Vec<u32>>) -> HashSet<u32> {
    let mut out = HashSet::new();
    let mut queue = vec![root];
    out.insert(root);
    while let Some(p) = queue.pop() {
        if let Some(children) = tree.get(&p) {
            for c in children {
                if out.insert(*c) {
                    queue.push(*c);
                }
            }
        }
    }
    out
}

async fn scan_listening_ports(pids: &[u32]) -> Vec<ScannedPort> {
    if pids.is_empty() {
        return Vec::new();
    }
    let pid_arg = pids
        .iter()
        .map(|p| p.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let pid_set: HashSet<u32> = pids.iter().copied().collect();

    let stdout = match run_command(
        "lsof",
        &["-p", &pid_arg, "-iTCP", "-sTCP:LISTEN", "-P", "-n"],
    )
    .await
    {
        Some(s) => s,
        None => return Vec::new(),
    };

    // De-dupe by port number — a child that holds the same listener twice
    // (rare but possible with SO_REUSEPORT) shouldn't double-count.
    let mut seen: HashMap<u16, ScannedPort> = HashMap::new();
    for line in stdout.lines().skip(1) {
        if let Some(parsed) = parse_lsof_line(line, &pid_set) {
            seen.entry(parsed.port).or_insert(parsed);
        }
    }
    seen.into_values().collect()
}

/// Parse one `lsof` row. `lsof -P -n` produces lines like:
///   `node    12345 user 23u IPv4 0x… 0t0 TCP *:5173 (LISTEN)`
/// Bash-style whitespace splitting; the NAME column is index 8.
fn parse_lsof_line(line: &str, pid_set: &HashSet<u32>) -> Option<ScannedPort> {
    let cols: Vec<&str> = line.split_whitespace().collect();
    if cols.len() < 9 {
        return None;
    }
    let process_name = cols[0];
    let pid: u32 = cols[1].parse().ok()?;
    if !pid_set.contains(&pid) {
        return None;
    }
    let name = cols[8];
    let (raw_addr, port_str) = parse_address(name)?;
    let port: u16 = port_str.parse().ok()?;
    if !(1..=65535).contains(&port) {
        return None;
    }
    if IGNORED_PORTS.contains(&port) {
        return None;
    }
    Some(ScannedPort {
        port,
        pid,
        process_name: process_name.to_string(),
        address: if raw_addr == "*" { "0.0.0.0".into() } else { raw_addr.into() },
    })
}

/// Split lsof's NAME column into `(address, port)`. Handles bracketed IPv6
/// (`[::1]:8080`), bare IPv4 (`127.0.0.1:8080`), and the wildcard (`*:8080`).
fn parse_address(name: &str) -> Option<(&str, &str)> {
    if let Some(rest) = name.strip_prefix('[') {
        let close = rest.find(']')?;
        let addr = &rest[..close];
        let after = &rest[close + 1..];
        let port = after.strip_prefix(':')?;
        Some((addr, port))
    } else {
        let colon = name.rfind(':')?;
        Some((&name[..colon], &name[colon + 1..]))
    }
}

/// `tokio::process::Command::output` with a 5 s timeout. Returns `None` on
/// any failure (timeout, non-zero exit, missing binary) — the caller treats
/// that as "no data this round" and tries again at the next scan interval.
async fn run_command(program: &str, args: &[&str]) -> Option<String> {
    let mut cmd = Command::new(program);
    cmd.args(args);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::null());
    cmd.stdin(Stdio::null());
    let child = cmd.spawn().ok()?;
    let output = tokio::time::timeout(EXEC_TIMEOUT, child.wait_with_output())
        .await
        .ok()?
        .ok()?;
    // lsof returns nonzero when nothing matches; we still want stdout.
    Some(String::from_utf8_lossy(&output.stdout).into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_lsof_v4() {
        let line = "node      12345 user   23u  IPv4 0x1  0t0  TCP 127.0.0.1:5173 (LISTEN)";
        let mut pids = HashSet::new();
        pids.insert(12345);
        let parsed = parse_lsof_line(line, &pids).expect("parse");
        assert_eq!(parsed.port, 5173);
        assert_eq!(parsed.address, "127.0.0.1");
        assert_eq!(parsed.process_name, "node");
        assert_eq!(parsed.pid, 12345);
    }

    #[test]
    fn parses_lsof_v6_brackets() {
        let line = "node      12345 user   23u  IPv6 0x1  0t0  TCP [::1]:8080 (LISTEN)";
        let mut pids = HashSet::new();
        pids.insert(12345);
        let parsed = parse_lsof_line(line, &pids).expect("parse");
        assert_eq!(parsed.port, 8080);
        assert_eq!(parsed.address, "::1");
    }

    #[test]
    fn parses_lsof_wildcard_to_0_0_0_0() {
        let line = "node      12345 user   23u  IPv4 0x1  0t0  TCP *:3000 (LISTEN)";
        let mut pids = HashSet::new();
        pids.insert(12345);
        let parsed = parse_lsof_line(line, &pids).expect("parse");
        assert_eq!(parsed.address, "0.0.0.0");
        assert_eq!(parsed.port, 3000);
    }

    #[test]
    fn skips_ignored_ports() {
        let mut pids = HashSet::new();
        pids.insert(12345);
        for port in IGNORED_PORTS {
            let line = format!(
                "sshd      12345 user   3u  IPv4 0x1  0t0  TCP *:{port} (LISTEN)"
            );
            assert!(parse_lsof_line(&line, &pids).is_none(), "{port} should be skipped");
        }
    }

    #[test]
    fn skips_pids_outside_set() {
        let line = "node      99999 user   23u  IPv4 0x1  0t0  TCP *:5173 (LISTEN)";
        let mut pids = HashSet::new();
        pids.insert(12345);
        assert!(parse_lsof_line(line, &pids).is_none());
    }

    #[test]
    fn skips_short_lines() {
        let mut pids = HashSet::new();
        pids.insert(1);
        assert!(parse_lsof_line("only a few words here", &pids).is_none());
    }

    #[test]
    fn collect_descendants_walks_tree() {
        let mut tree: HashMap<u32, Vec<u32>> = HashMap::new();
        tree.insert(100, vec![101, 102]);
        tree.insert(101, vec![201]);
        tree.insert(102, vec![]);
        tree.insert(201, vec![301]);

        let d = collect_descendants(100, &tree);
        assert!(d.contains(&100));
        assert!(d.contains(&101));
        assert!(d.contains(&102));
        assert!(d.contains(&201));
        assert!(d.contains(&301));
        assert_eq!(d.len(), 5);
    }

    #[test]
    fn collect_descendants_handles_leaf_with_no_children() {
        let tree: HashMap<u32, Vec<u32>> = HashMap::new();
        let d = collect_descendants(7, &tree);
        assert_eq!(d.len(), 1);
        assert!(d.contains(&7));
    }

    #[test]
    fn hint_regex_matches_listening_on_port() {
        let pat = &PORT_HINT_PATTERNS[0];
        assert!(pat.is_match("Listening on port 4321"));
        assert!(pat.is_match("Now listening on 8080"));
    }

    #[test]
    fn hint_regex_matches_server_started_on_localhost() {
        let pat = &PORT_HINT_PATTERNS[1];
        assert!(pat.is_match("Server started on http://localhost:3000"));
    }

    #[test]
    fn hint_regex_matches_ready_on() {
        let pat = &PORT_HINT_PATTERNS[2];
        assert!(pat.is_match("Ready on http://0.0.0.0:5173"));
    }
}
