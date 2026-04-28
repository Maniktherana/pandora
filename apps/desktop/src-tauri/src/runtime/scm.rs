//! Per-runtime SCM service.
//!
//! Owns the worktree path, current target branch, and a watcher task that
//! monitors the worktree for changes and emits debounced `ScmSnapshot` events.
//! All git I/O runs on the blocking pool. Mutations emit a fresh `ScmSnapshot`
//! after completion so the renderer stays in sync without polling.
//!
//! The service is cloneable (cheap Arc clone). Drop or call `close()` to stop
//! the watcher task cleanly.

use std::path::Path;
use std::process::Command;
use std::sync::Arc;
use std::time::Duration;

use notify::{Event, RecursiveMode, Watcher};
use tokio::sync::{oneshot, watch, Mutex};

use crate::database::AppDatabase;

use super::process_manager::RuntimeEmitter;
use super::types::{ScmEntry, ScmLineStatsSummary, ScmSnapshot};

const WATCHER_DEBOUNCE: Duration = Duration::from_millis(350);

// ---------------------------------------------------------------------------
// Public service
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct ScmService {
    inner: Arc<Mutex<ScmInner>>,
    runtime_id: String,
    worktree_path: String,
    db: Arc<AppDatabase>,
    emitter: Arc<dyn RuntimeEmitter>,
    /// Sending on this channel signals the watcher task to stop.
    shutdown_tx: Arc<Mutex<Option<oneshot::Sender<()>>>>,
    watcher_ready: watch::Receiver<bool>,
}

struct ScmInner {
    target_branch: Option<String>,
}

impl ScmService {
    /// Open the SCM service for `worktree_path`. Loads persisted target branch
    /// from `runtime_metadata` and starts the filesystem watcher task.
    pub fn open(
        db: Arc<AppDatabase>,
        runtime_id: String,
        worktree_path: String,
        emitter: Arc<dyn RuntimeEmitter>,
    ) -> Self {
        let target_branch = db
            .get_runtime_metadata(&runtime_id, "scm.target_branch")
            .filter(|s| !s.is_empty());

        let inner = Arc::new(Mutex::new(ScmInner { target_branch }));

        let (shutdown_tx, shutdown_rx) = oneshot::channel();
        let (ready_tx, ready_rx) = watch::channel(false);

        let svc = Self {
            inner: Arc::clone(&inner),
            runtime_id: runtime_id.clone(),
            worktree_path: worktree_path.clone(),
            db,
            emitter: Arc::clone(&emitter),
            shutdown_tx: Arc::new(Mutex::new(Some(shutdown_tx))),
            watcher_ready: ready_rx,
        };

        let svc_for_task = svc.clone();
        tokio::spawn(async move {
            svc_for_task.run_watcher_task(shutdown_rx, ready_tx).await;
        });

        svc
    }

    /// Stop the watcher task. Called when the runtime closes.
    pub async fn close(&self) {
        if let Some(tx) = self.shutdown_tx.lock().await.take() {
            let _ = tx.send(());
        }
    }

    // ---- Subscription / refresh -------------------------------------------

    /// Subscribe: optionally set the target branch, then emit a snapshot.
    pub async fn subscribe(&self, target_branch: Option<String>) {
        self.wait_for_watcher_ready().await;
        if let Some(branch) = target_branch {
            self.apply_target_branch(Some(branch)).await;
        }
        self.refresh_and_emit().await;
    }

    pub async fn refresh(&self) {
        self.emitter.scm_refreshing().await;
        self.refresh_and_emit().await;
    }

    // ---- Mutations ---------------------------------------------------------

    pub async fn stage(&self, paths: Vec<String>) {
        let wt = self.worktree_path.clone();
        let op_id = new_op_id();
        self.emitter.scm_operation_started(op_id).await;
        self.run_void_op(move || crate::git::git_add_paths(&wt, &paths))
            .await;
    }

    pub async fn stage_all(&self) {
        let wt = self.worktree_path.clone();
        let op_id = new_op_id();
        self.emitter.scm_operation_started(op_id).await;
        self.run_void_op(move || crate::git::git_add_all(&wt)).await;
    }

    pub async fn unstage(&self, paths: Vec<String>) {
        let wt = self.worktree_path.clone();
        let op_id = new_op_id();
        self.emitter.scm_operation_started(op_id).await;
        self.run_void_op(move || crate::git::git_restore_staged_paths(&wt, &paths))
            .await;
    }

    pub async fn unstage_all(&self) {
        let wt = self.worktree_path.clone();
        let op_id = new_op_id();
        self.emitter.scm_operation_started(op_id).await;
        self.run_void_op(move || crate::git::git_restore_staged_all(&wt))
            .await;
    }

    pub async fn discard_tracked(&self, paths: Vec<String>) {
        let wt = self.worktree_path.clone();
        let op_id = new_op_id();
        self.emitter.scm_operation_started(op_id).await;
        self.run_void_op(move || {
            for path in &paths {
                crate::git::git_restore_worktree_path(&wt, path)?;
            }
            Ok(())
        })
        .await;
    }

    pub async fn discard_untracked(&self, paths: Vec<String>) {
        let wt = self.worktree_path.clone();
        let op_id = new_op_id();
        self.emitter.scm_operation_started(op_id).await;
        self.run_void_op(move || {
            for path in &paths {
                crate::git::git_clean_untracked_path(&wt, path)?;
            }
            Ok(())
        })
        .await;
    }

    pub async fn commit(&self, message: String, push: bool) {
        let wt = self.worktree_path.clone();
        let op_id = new_op_id();
        self.emitter.scm_operation_started(op_id).await;
        self.run_void_op(move || {
            crate::git::git_commit_message(&wt, &message)?;
            if push {
                crate::git::git_push(&wt)?;
            }
            Ok(())
        })
        .await;
    }

    pub async fn push(&self) {
        let wt = self.worktree_path.clone();
        let op_id = new_op_id();
        self.emitter.scm_operation_started(op_id).await;
        self.run_void_op(move || crate::git::git_push(&wt).map(|_| ()))
            .await;
    }

    pub async fn fetch(&self) {
        let wt = self.worktree_path.clone();
        let op_id = new_op_id();
        self.emitter.scm_operation_started(op_id).await;
        self.run_void_op(move || crate::git::git_fetch(&wt).map(|_| ()))
            .await;
    }

    pub async fn pull(&self) {
        let wt = self.worktree_path.clone();
        let op_id = new_op_id();
        self.emitter.scm_operation_started(op_id).await;
        self.run_void_op(move || crate::git::git_pull(&wt).map(|_| ()))
            .await;
    }

    pub async fn set_target_branch(&self, branch: Option<String>) {
        let normalized = branch
            .map(|b| b.trim().trim_start_matches("origin/").to_string())
            .filter(|b| !b.is_empty() && b != "origin");
        self.apply_target_branch(normalized).await;
        self.refresh_and_emit().await;
    }

    // ---- Internal helpers -------------------------------------------------

    async fn apply_target_branch(&self, branch: Option<String>) {
        let value = branch.as_deref().unwrap_or("");
        if let Err(err) = self
            .db
            .set_runtime_metadata(&self.runtime_id, "scm.target_branch", value)
        {
            tracing::warn!(runtime_id = %self.runtime_id, %err, "persist scm.target_branch failed");
        }
        self.inner.lock().await.target_branch = branch;
    }

    /// Run a blocking void git operation, then emit a fresh snapshot.
    async fn run_void_op<F>(&self, f: F)
    where
        F: FnOnce() -> Result<(), String> + Send + 'static,
    {
        let result: Result<(), String> = tokio::task::spawn_blocking(f)
            .await
            .map_err(|e| e.to_string())
            .and_then(|r| r);
        match result {
            Ok(()) => self.refresh_and_emit().await,
            Err(err) => self.emitter.scm_error(err).await,
        }
    }

    async fn refresh_and_emit(&self) {
        let target_branch = self.inner.lock().await.target_branch.clone();
        let wt = self.worktree_path.clone();
        let snapshot_result: Result<ScmSnapshot, String> =
            tokio::task::spawn_blocking(move || compute_snapshot(&wt, target_branch))
                .await
                .map_err(|e| e.to_string())
                .and_then(|r| r);
        match snapshot_result {
            Ok(snapshot) => self.emitter.scm_snapshot(snapshot).await,
            Err(err) => {
                tracing::warn!(runtime_id = %self.runtime_id, %err, "scm snapshot failed");
                self.emitter.scm_error(err).await;
            }
        }
    }

    async fn wait_for_watcher_ready(&self) {
        let mut ready = self.watcher_ready.clone();
        if *ready.borrow() {
            return;
        }
        let _ = tokio::time::timeout(Duration::from_secs(1), ready.changed()).await;
    }

    async fn run_watcher_task(
        &self,
        shutdown_rx: oneshot::Receiver<()>,
        ready_tx: watch::Sender<bool>,
    ) {
        let (fs_tx, fs_rx) = tokio::sync::mpsc::channel::<()>(1);
        let watcher_tx = fs_tx;
        let watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
            if let Ok(event) = res {
                if is_relevant_scm_event(&event) {
                    let _ = watcher_tx.try_send(());
                }
            }
        });

        let mut watcher = match watcher {
            Ok(watcher) => watcher,
            Err(err) => {
                tracing::warn!(runtime_id = %self.runtime_id, %err, "scm watcher init failed");
                self.emitter
                    .scm_error(format!("SCM watcher init failed: {err}"))
                    .await;
                let _ = ready_tx.send(true);
                return;
            }
        };

        if let Err(err) = watcher.watch(Path::new(&self.worktree_path), RecursiveMode::Recursive) {
            tracing::warn!(runtime_id = %self.runtime_id, %err, "scm watcher watch failed");
            self.emitter
                .scm_error(format!("SCM watcher watch failed: {err}"))
                .await;
            let _ = ready_tx.send(true);
            return;
        }

        let _ = ready_tx.send(true);
        self.run_watcher_loop(shutdown_rx, fs_rx, watcher).await;
    }

    /// Event loop driven by `fs_rx`.  The watcher is already registered by
    /// `run_watcher_task` before readiness is signaled.
    async fn run_watcher_loop(
        &self,
        shutdown_rx: oneshot::Receiver<()>,
        mut rx: tokio::sync::mpsc::Receiver<()>,
        watcher: notify::RecommendedWatcher,
    ) {
        // Keep the OS watch registered for the entire event-loop lifetime.
        let watcher_guard = watcher;
        let mut shutdown = std::pin::pin!(shutdown_rx);

        loop {
            tokio::select! {
                _ = &mut shutdown => {
                    tracing::debug!(runtime_id = %self.runtime_id, "scm watcher shutting down");
                    break;
                }
                Some(()) = rx.recv() => {
                    // Debounce: drain further events within the window.
                    let deadline = tokio::time::Instant::now() + WATCHER_DEBOUNCE;
                    loop {
                        let remaining = deadline
                            .saturating_duration_since(tokio::time::Instant::now());
                        if remaining.is_zero() {
                            break;
                        }
                        match tokio::time::timeout(remaining, rx.recv()).await {
                            Ok(Some(())) => continue,
                            _ => break,
                        }
                    }
                    self.refresh_and_emit().await;
                }
            }
        }
        drop(watcher_guard);
    }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

fn new_op_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn is_relevant_scm_event(event: &notify::Event) -> bool {
    use notify::event::{AccessKind, AccessMode};
    use notify::EventKind;
    if !matches!(
        event.kind,
        EventKind::Create(_)
            | EventKind::Modify(_)
            | EventKind::Remove(_)
            | EventKind::Access(AccessKind::Close(AccessMode::Write | AccessMode::Any))
    ) {
        return false;
    }
    event.paths.iter().any(|p| {
        let s = p.to_string_lossy();
        if let Some(pos) = s.find("/.git/") {
            let after = &s[pos + 6..];
            // Track index (stage changes), HEAD/refs (branch switch, commit),
            // merge/cherry-pick heads (conflict state).
            after == "index"
                || after == "HEAD"
                || after.starts_with("refs/")
                || after == "MERGE_HEAD"
                || after == "ORIG_HEAD"
                || after == "CHERRY_PICK_HEAD"
        } else {
            // Any worktree file change is relevant.
            !s.contains("/.git")
        }
    })
}

fn compute_snapshot(
    worktree_path: &str,
    target_branch: Option<String>,
) -> Result<ScmSnapshot, String> {
    let branch = crate::git::current_branch(worktree_path).unwrap_or_else(|_| "HEAD".to_string());
    let upstream = get_upstream(worktree_path, &branch);
    let (ahead, behind) = upstream
        .as_deref()
        .map(|u| get_ahead_behind(worktree_path, u))
        .unwrap_or((0, 0));

    // Both `git_status` and line-stat collection return real errors when git is
    // unavailable or the workspace is not a repository.  Propagate them so
    // `refresh_and_emit` can emit `ScmError` instead of an empty snapshot.
    let git_entries = crate::git::git_status(worktree_path)?;
    let (staged_stats_by_path, unstaged_stats_by_path) =
        crate::git::git_line_stats_by_path(worktree_path)?;

    // Split into staged (has index changes vs HEAD) and unstaged (worktree
    // differs from index, or untracked).
    let mut staged: Vec<ScmEntry> = Vec::new();
    let mut unstaged: Vec<ScmEntry> = Vec::new();
    for e in git_entries {
        let has_staged = e.staged_kind.as_deref().map(|k| k != " ").unwrap_or(false);
        let has_unstaged = e.untracked
            || e.worktree_kind
                .as_deref()
                .map(|k| k != " ")
                .unwrap_or(false);
        let entry = ScmEntry {
            path: e.path,
            orig_path: e.orig_path,
            staged_kind: e.staged_kind,
            worktree_kind: e.worktree_kind,
            untracked: e.untracked,
            line_stats: ScmLineStatsSummary::default(),
        };
        if has_staged {
            let mut staged_entry = entry.clone();
            if let Some(stats) = staged_stats_by_path.get(&staged_entry.path) {
                staged_entry.line_stats = ScmLineStatsSummary {
                    added: stats.added,
                    removed: stats.removed,
                };
            }
            staged.push(staged_entry);
        }
        if has_unstaged {
            let mut unstaged_entry = entry;
            if let Some(stats) = unstaged_stats_by_path.get(&unstaged_entry.path) {
                unstaged_entry.line_stats = ScmLineStatsSummary {
                    added: stats.added,
                    removed: stats.removed,
                };
            }
            unstaged.push(unstaged_entry);
        }
    }

    let mut line_stats = ScmLineStatsSummary::default();
    for stats in staged_stats_by_path
        .values()
        .chain(unstaged_stats_by_path.values())
    {
        line_stats.added += stats.added;
        line_stats.removed += stats.removed;
    }

    Ok(ScmSnapshot {
        branch,
        upstream,
        ahead,
        behind,
        target_branch,
        staged,
        unstaged,
        line_stats,
    })
}

fn get_ahead_behind(worktree_path: &str, upstream: &str) -> (u64, u64) {
    let ahead = count_revlist(worktree_path, &format!("{upstream}..HEAD"));
    let behind = count_revlist(worktree_path, &format!("HEAD..{upstream}"));
    (ahead, behind)
}

fn count_revlist(worktree_path: &str, range: &str) -> u64 {
    Command::new("git")
        .args(["-C", worktree_path, "rev-list", "--count", range])
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                String::from_utf8_lossy(&o.stdout)
                    .trim()
                    .parse::<u64>()
                    .ok()
            } else {
                None
            }
        })
        .unwrap_or(0)
}

fn get_upstream(worktree_path: &str, branch: &str) -> Option<String> {
    let upstream_spec = format!("{branch}@{{u}}");
    let out = Command::new("git")
        .args([
            "-C",
            worktree_path,
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            &upstream_spec,
        ])
        .output()
        .ok()?;
    if out.status.success() {
        let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !s.is_empty() {
            Some(s)
        } else {
            None
        }
    } else {
        None
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::AppDatabase;
    use crate::runtime::process_manager::RuntimeEmitter;
    use crate::runtime::types::{DetectedPort, ScmSnapshot, SessionState, SlotState};
    use async_trait::async_trait;
    use bytes::Bytes;
    use std::sync::Mutex as StdMutex;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[derive(Default)]
    struct Captured {
        snapshots: Vec<ScmSnapshot>,
        errors: Vec<String>,
    }

    #[derive(Clone, Default)]
    struct CapturingEmitter(Arc<StdMutex<Captured>>);

    #[async_trait]
    impl RuntimeEmitter for CapturingEmitter {
        async fn session_state_changed(&self, _: SessionState) {}
        async fn output_chunk(&self, _: &str, _: Bytes) {}
        async fn ports_changed(&self, _: Vec<DetectedPort>) {}
        async fn slot_snapshot(&self, _: Vec<SlotState>) {}
        async fn session_snapshot(&self, _: Vec<SessionState>) {}
        async fn scm_snapshot(&self, snapshot: ScmSnapshot) {
            self.0.lock().unwrap().snapshots.push(snapshot);
        }
        async fn scm_error(&self, message: String) {
            self.0.lock().unwrap().errors.push(message);
        }
    }

    fn temp_db(prefix: &str) -> (std::path::PathBuf, Arc<AppDatabase>) {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let home = std::env::current_dir()
            .unwrap_or_else(|_| std::env::temp_dir())
            .join("target")
            .join("pandora-scm-tests")
            .join(format!("{prefix}-{nanos}"));
        std::fs::create_dir_all(&home).unwrap();
        let workspace = home.join("workspace");
        std::fs::create_dir_all(&workspace).unwrap();
        let db = Arc::new(AppDatabase::open(home.to_str().unwrap()).unwrap());
        (workspace, db)
    }

    fn init_git(dir: &std::path::Path) {
        let run = |args: &[&str]| {
            std::process::Command::new("git")
                .args(args)
                .current_dir(dir)
                .output()
                .unwrap();
        };
        run(&["init"]);
        run(&["config", "user.email", "test@test.com"]);
        run(&["config", "user.name", "Test"]);
        std::fs::write(dir.join("readme.md"), "hello").unwrap();
        run(&["add", "."]);
        run(&["commit", "-m", "init"]);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn subscribe_emits_snapshot_for_git_repo() {
        let (workspace, db) = temp_db("subscribe");
        init_git(&workspace);
        let emitter = CapturingEmitter::default();
        let arc: Arc<dyn RuntimeEmitter> = Arc::new(emitter.clone());
        let svc = ScmService::open(
            Arc::clone(&db),
            "rt-test".into(),
            workspace.to_str().unwrap().to_string(),
            arc,
        );
        svc.subscribe(None).await;
        let snaps = emitter.0.lock().unwrap().snapshots.len();
        assert!(snaps >= 1, "expected at least one snapshot");
        svc.close().await;
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn set_target_branch_persists_and_includes_in_snapshot() {
        let (workspace, db) = temp_db("target");
        init_git(&workspace);
        let emitter = CapturingEmitter::default();
        let arc: Arc<dyn RuntimeEmitter> = Arc::new(emitter.clone());
        let svc = ScmService::open(
            Arc::clone(&db),
            "rt-target".into(),
            workspace.to_str().unwrap().to_string(),
            arc,
        );
        svc.set_target_branch(Some("main".to_string())).await;
        let snaps = emitter.0.lock().unwrap().snapshots.clone();
        assert!(!snaps.is_empty());
        assert_eq!(snaps.last().unwrap().target_branch.as_deref(), Some("main"));
        let stored = db.get_runtime_metadata("rt-target", "scm.target_branch");
        assert_eq!(stored.as_deref(), Some("main"));
        svc.close().await;
    }
}
