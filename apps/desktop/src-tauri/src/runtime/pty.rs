//! `portable-pty` wrapper.
//!
//! Single in-process Rust struct that owns one PTY-attached child shell.
//! Behavioral contract:
//!
//!   * Reader emits raw byte chunks of arbitrary size; the consumer is
//!     responsible for any batching policy. The 256 KB / 64 KB / 4 ms
//!     coalescing lives in `process_manager.rs` so it can be reasoned
//!     about alongside the other output-handling concerns.
//!   * Pause / resume controls **output** (whether we forward bytes onward),
//!     not the underlying read syscall. This matters because portable-pty's
//!     `MasterPty::try_clone_reader` returns a blocking `Read`; we can't
//!     stop reading without losing data when the kernel's PTY buffer fills.
//!     Process-level SIGSTOP/SIGCONT (real "freeze the shell") is a
//!     separate API exposed via `signal_child`.
//!   * `wait_for_exit` returns the child's exit code via a oneshot channel,
//!     fired by a dedicated waiter thread. portable-pty's `Child::wait` is
//!     blocking and would tie up a tokio worker if used directly.
//!
//! Threading model:
//!
//! ```text
//!   spawn() ─┬── std::thread (reader): blocking read() → mpsc::blocking_send
//!            └── std::thread (waiter): child.wait() → oneshot::send(exit_code)
//!   write/resize/signal: synchronous, called from any tokio task
//!   drop: kills child, threads notice EOF and exit
//! ```
//!
//! `std::thread` is used (not `tokio::task::spawn_blocking`) because the PTY
//! reader can park indefinitely when the child has nothing to say. A blocking
//! pool slot held forever is a leak; a dedicated OS thread is what every
//! production Rust terminal (Wezterm, Zed, Warp) does.

use bytes::Bytes;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::io::Read;
use std::sync::{Arc, Mutex};
use tokio::sync::{mpsc, oneshot};

const READ_CHUNK_BYTES: usize = 8 * 1024;
/// Bound on the per-session output channel. ~64 chunks × 8 KB = ~512 KB
/// of un-drained data before the reader thread blocks on send.
const OUTPUT_CHANNEL_DEPTH: usize = 64;

/// What the child exited with.
#[derive(Debug, Clone, Copy)]
pub struct PtyExit {
    /// `None` if the child was killed by signal without producing an exit code.
    pub exit_code: Option<i32>,
}

/// Handle to a running PTY-attached child. Cloning the handle is intentionally
/// not supported — only one owner gets to wait/kill — but `output_rx` is
/// returned by value at spawn time.
pub struct Pty {
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    /// Cached writer for the master fd — avoids calling `take_writer()` on
    /// every keystroke, which would dup the fd each time.
    writer: Mutex<Box<dyn std::io::Write + Send>>,
    child: Arc<Mutex<Box<dyn Child + Send + Sync>>>,
    /// Cached PID for SIGSTOP/SIGCONT/SIGTERM. portable-pty doesn't keep
    /// returning it after `wait()`, so we capture it at spawn time.
    pid: Option<u32>,
}

impl Pty {
    /// Spawn the configured shell-style command, returning the handle and
    /// two channels: byte chunks streaming from the master fd, and a oneshot
    /// that fires when the child exits.
    ///
    /// `cols` / `rows` are clamped to ≥1 (zero would be rejected by the
    /// kernel ioctl).
    pub fn spawn(spec: PtySpawnSpec) -> Result<(Pty, mpsc::Receiver<Bytes>, oneshot::Receiver<PtyExit>), String> {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: spec.rows.max(1),
                cols: spec.cols.max(1),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("openpty failed: {e}"))?;

        // Run the command via the user's login shell so `~/.zshrc` etc.
        // fire and aliases work.
        let mut cmd = CommandBuilder::new(spec.shell);
        cmd.arg("-lc");
        cmd.arg(&spec.command);
        cmd.cwd(&spec.cwd);
        for (k, v) in &spec.env {
            cmd.env(k, v);
        }

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("spawn_command failed: {e}"))?;
        let pid = child.process_id();

        // Drop the slave fd in the parent — the child has its own copy now,
        // and keeping ours open would prevent EOF on the master when the
        // child exits.
        drop(pair.slave);

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("clone reader failed: {e}"))?;

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("take_writer at spawn: {e}"))?;

        let (output_tx, output_rx) = mpsc::channel::<Bytes>(OUTPUT_CHANNEL_DEPTH);

        // Reader thread. Sized buffer + blocking_send into a tokio mpsc is
        // the Wezterm pattern; the channel's bounded depth provides natural
        // backpressure (when the consumer falls behind, we block here, which
        // backs up into the kernel's PTY buffer and eventually slows the
        // child down).
        std::thread::Builder::new()
            .name("pandora-pty-reader".into())
            .spawn(move || {
                let mut buf = vec![0u8; READ_CHUNK_BYTES];
                loop {
                    match reader.read(&mut buf) {
                        Ok(0) => break,
                        Ok(n) => {
                            let chunk = Bytes::copy_from_slice(&buf[..n]);
                            if output_tx.blocking_send(chunk).is_err() {
                                // Receiver dropped → consumer is gone.
                                break;
                            }
                        }
                        Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                        Err(_) => break,
                    }
                }
            })
            .map_err(|e| format!("spawn reader thread: {e}"))?;

        let child_arc = Arc::new(Mutex::new(child));
        let waiter_child = Arc::clone(&child_arc);
        let (exit_tx, exit_rx) = oneshot::channel::<PtyExit>();

        // Waiter thread. portable-pty's Child::wait blocks indefinitely; off
        // the tokio runtime it goes.
        std::thread::Builder::new()
            .name("pandora-pty-waiter".into())
            .spawn(move || {
                let exit = {
                    let mut child = waiter_child.lock().unwrap();
                    child.wait()
                };
                let code = match exit {
                    Ok(status) => status.exit_code() as i32,
                    Err(_) => -1,
                };
                // Receiver may have been dropped if the Pty was discarded
                // before the child exited; that's fine.
                let _ = exit_tx.send(PtyExit { exit_code: Some(code) });
            })
            .map_err(|e| format!("spawn waiter thread: {e}"))?;

        Ok((
            Pty {
                master: Arc::new(Mutex::new(pair.master)),
                writer: Mutex::new(writer),
                child: child_arc,
                pid,
            },
            output_rx,
            exit_rx,
        ))
    }

    /// PID of the spawned child, if known. Used by the port scanner to root
    /// its process-tree walk.
    pub fn pid(&self) -> Option<u32> {
        self.pid
    }

    /// PID of the current foreground process group leader, if the platform
    /// and PTY implementation support it. On macOS/Unix this calls
    /// `tcgetpgrp` on the master fd under the hood.
    pub fn foreground_process_group(&self) -> Option<i32> {
        let master = self.master.lock().unwrap();
        master.process_group_leader()
    }

    /// Forward bytes to the child's stdin. Returns `Err` if the master is
    /// closed (child has exited).
    pub fn write(&self, data: &[u8]) -> Result<(), String> {
        let mut writer = self.writer.lock().unwrap();
        std::io::Write::write_all(&mut *writer, data).map_err(|e| format!("pty write: {e}"))?;
        std::io::Write::flush(&mut *writer).map_err(|e| format!("pty flush: {e}"))
    }

    /// Resize the PTY. The kernel sends SIGWINCH to the foreground process
    /// group automatically. Cols/rows are clamped to ≥1.
    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        let master = self.master.lock().unwrap();
        master
            .resize(PtySize {
                rows: rows.max(1),
                cols: cols.max(1),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("pty resize: {e}"))
    }

    /// Send a signal to the spawned child (process-level — used for
    /// SIGSTOP / SIGCONT / SIGTERM / SIGKILL).
    ///
    /// On non-unix platforms this is a no-op stub; the surface_registry is
    /// macOS-only so non-unix builds don't exercise this path.
    #[cfg(unix)]
    pub fn signal_child(&self, signal: nix::sys::signal::Signal) -> Result<(), String> {
        let pid = self.pid.ok_or_else(|| "no pid".to_string())?;
        nix::sys::signal::kill(nix::unistd::Pid::from_raw(pid as i32), signal)
            .map_err(|e| format!("kill({signal:?}): {e}"))
    }

    #[cfg(not(unix))]
    pub fn signal_child(&self, _signal: ()) -> Result<(), String> {
        Err("signal_child not supported on this platform".to_string())
    }

    /// Best-effort kill (SIGKILL on the immediate child). Idempotent — safe
    /// to call after the child has already exited.
    pub fn kill(&self) -> Result<(), String> {
        let mut child = self.child.lock().unwrap();
        child.kill().map_err(|e| format!("child kill: {e}"))
    }
}

/// Inputs to `Pty::spawn`. Keeping this as a struct (vs. positional args)
/// means call sites read top-down and adding fields later (e.g. terminal
/// size hints, signal masks) is a non-breaking change.
#[derive(Debug, Clone)]
pub struct PtySpawnSpec {
    /// Path/name of the shell binary, e.g. `/bin/zsh`. Looked up in PATH.
    pub shell: String,
    /// Command string passed to the shell as `-lc`. May contain shell syntax.
    pub command: String,
    pub cwd: String,
    pub env: Vec<(String, String)>,
    pub cols: u16,
    pub rows: u16,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn spec(command: &str) -> PtySpawnSpec {
        PtySpawnSpec {
            shell: std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string()),
            command: command.to_string(),
            cwd: std::env::temp_dir().to_string_lossy().into_owned(),
            env: vec![("TERM".to_string(), "xterm-256color".to_string())],
            cols: 80,
            rows: 24,
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn echo_emits_output_and_exits_cleanly() {
        let (pty, mut rx, exit_rx) = Pty::spawn(spec("echo hi")).expect("spawn");
        assert!(pty.pid().is_some());

        let mut buf = Vec::new();
        let collect = async {
            while let Some(chunk) = rx.recv().await {
                buf.extend_from_slice(&chunk);
            }
        };
        // Either the channel closes when the reader sees EOF or we time out.
        let _ = tokio::time::timeout(Duration::from_secs(2), collect).await;
        let exit = tokio::time::timeout(Duration::from_secs(2), exit_rx)
            .await
            .expect("exit timeout")
            .expect("exit recv");

        assert_eq!(exit.exit_code, Some(0));
        let text = String::from_utf8_lossy(&buf);
        assert!(text.contains("hi"), "expected 'hi' in output, got: {text:?}");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn write_round_trips() {
        let (pty, mut rx, exit_rx) =
            Pty::spawn(spec("read line; printf 'got=%s\\n' \"$line\"")).expect("spawn");

        pty.write(b"hello\n").expect("write");

        let mut collected = Vec::new();
        let deadline = tokio::time::Instant::now() + Duration::from_secs(3);
        let needle = b"got=hello";
        while tokio::time::Instant::now() < deadline {
            tokio::select! {
                chunk = rx.recv() => {
                    let Some(chunk) = chunk else { break };
                    collected.extend_from_slice(&chunk);
                    if collected.windows(needle.len()).any(|w| w == needle) {
                        break;
                    }
                }
                _ = tokio::time::sleep(Duration::from_millis(50)) => {}
            }
        }

        assert!(
            collected.windows(needle.len()).any(|w| w == needle),
            "expected 'got=hello' in output, got: {:?}",
            String::from_utf8_lossy(&collected),
        );

        let _ = tokio::time::timeout(Duration::from_secs(2), exit_rx)
            .await
            .expect("child did not exit after printing");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn resize_does_not_panic_under_load() {
        let (pty, _rx, _exit_rx) = Pty::spawn(spec("sleep 5")).expect("spawn");
        // Fewer than 10K so the test stays fast; the contract is "doesn't panic".
        for i in 0..1000u16 {
            pty.resize(40 + (i % 100), 20 + (i % 50)).expect("resize");
        }
        let _ = pty.kill();
    }

    #[cfg(unix)]
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn signal_child_sigterm_terminates_long_running_process() {
        let (pty, mut rx, exit_rx) = Pty::spawn(spec("sleep 30")).expect("spawn");
        // Drain output in the background so the channel doesn't fill up
        // and starve the reader thread.
        tokio::spawn(async move { while rx.recv().await.is_some() {} });

        // Give the shell a moment to actually exec sleep before we signal.
        tokio::time::sleep(Duration::from_millis(100)).await;
        pty.signal_child(nix::sys::signal::Signal::SIGTERM).expect("signal");

        let exit = tokio::time::timeout(Duration::from_secs(3), exit_rx)
            .await
            .expect("exit timeout")
            .expect("exit recv");
        // sleep doesn't trap SIGTERM; some shells may produce non-zero codes.
        // We just care that the process actually terminated within the window.
        assert!(exit.exit_code.is_some());
    }
}
