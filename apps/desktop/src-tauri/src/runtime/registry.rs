//! Per-workspace `Runtime` + global `RuntimeRegistry`.
//!
//! A `Runtime` is a small struct that owns:
//!
//!   * a runtime identifier (used to scope DB rows in `slot_definitions` /
//!     `session_definitions` / `runtime_metadata`)
//!   * the cwd that empty `cwd` fields fall back to
//!   * a `ProcessManager` (which owns the live PTYs)
//!
//! The `RuntimeRegistry` is the tauri-state-friendly handle: it caches one
//! `Runtime` per `runtime_id` so re-opening a workspace window reuses the
//! same set of PTYs rather than tearing them down and respawning.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::database::AppDatabase;

use super::editor_io::EditorIoService;
use super::file_tree::FileTreeService;
use super::process_manager::{ProcessManager, RuntimeEmitter};
use super::scm::ScmService;
use super::seed::ensure_seed;

#[derive(Clone)]
pub struct Runtime {
    #[allow(dead_code)]
    pub id: String,
    #[allow(dead_code)]
    pub default_cwd: String,
    pub process_manager: ProcessManager,
    pub file_tree: FileTreeService,
    pub scm: ScmService,
    pub editor_io: EditorIoService,
}

impl Runtime {
    /// `workspace_root` is the file-system root the file tree is rooted at
    /// (the worktree path for workspace runtimes, the git root for project
    /// runtimes). `default_cwd` is the cwd for spawned sessions.
    pub fn open(
        db: Arc<AppDatabase>,
        runtime_id: &str,
        workspace_root: &str,
        default_cwd: &str,
        emitter: Arc<dyn RuntimeEmitter>,
    ) -> Result<Self, String> {
        ensure_seed(db.as_ref(), runtime_id, default_cwd)?;
        let slots = db.list_slot_definitions(runtime_id);
        let sessions = db.list_session_definitions(runtime_id);
        let pm = ProcessManager::new(
            slots,
            sessions,
            Arc::clone(&emitter),
            default_cwd.to_string(),
            runtime_id.to_string(),
        );
        let file_tree =
            FileTreeService::open(runtime_id.to_string(), workspace_root, Arc::clone(&emitter))?;
        let scm = ScmService::open(
            Arc::clone(&db),
            runtime_id.to_string(),
            workspace_root.to_string(),
            Arc::clone(&emitter),
        );
        let editor_io =
            EditorIoService::open(runtime_id.to_string(), workspace_root, Arc::clone(&emitter))?;
        Ok(Self {
            id: runtime_id.to_string(),
            default_cwd: default_cwd.to_string(),
            process_manager: pm,
            file_tree,
            scm,
            editor_io,
        })
    }
}

/// Global cache of `Runtime`s, keyed by runtime ID. Cheap to clone.
#[derive(Clone, Default)]
pub struct RuntimeRegistry {
    inner: Arc<Mutex<HashMap<String, Runtime>>>,
}

impl RuntimeRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Get the runtime with this ID, or build it on first access. The
    /// `factory` is only invoked on miss; callers don't pay the DB-open
    /// cost on the hot path.
    ///
    /// Returns `(runtime, was_new)`. `was_new` is `true` only on the call
    /// that actually constructed the runtime — callers gate one-shot work
    /// (autostart, initial seeding) on it so reopening a workspace window
    /// doesn't re-spawn already-running sessions.
    ///
    /// Why a factory rather than `(db, default_cwd, emitter)` parameters:
    /// the registry is tauri-state-friendly (no DB handle in scope) and
    /// the emitter is workspace-window specific, so the call site is the
    /// only place with the right lifetimes wired up.
    pub async fn get_or_create<F>(
        &self,
        runtime_id: &str,
        factory: F,
    ) -> Result<(Runtime, bool), String>
    where
        F: FnOnce() -> Result<Runtime, String>,
    {
        let mut inner = self.inner.lock().await;
        if let Some(existing) = inner.get(runtime_id) {
            return Ok((existing.clone(), false));
        }
        let runtime = factory()?;
        inner.insert(runtime_id.to_string(), runtime.clone());
        Ok((runtime, true))
    }

    pub async fn get(&self, runtime_id: &str) -> Option<Runtime> {
        let inner = self.inner.lock().await;
        inner.get(runtime_id).cloned()
    }

    /// Drop a runtime from the cache. Sessions are torn down before
    /// removal so PTYs don't leak. Returns `true` if a runtime was actually
    /// removed.
    pub async fn close(&self, runtime_id: &str) -> bool {
        let runtime = {
            let mut inner = self.inner.lock().await;
            inner.remove(runtime_id)
        };
        match runtime {
            Some(rt) => {
                rt.process_manager.close_all_sessions().await;
                rt.scm.close().await;
                rt.editor_io.close().await;
                true
            }
            None => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime::process_manager::RuntimeEmitter;
    use crate::runtime::types::{DetectedPort, SessionState};
    use async_trait::async_trait;
    use bytes::Bytes;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[derive(Clone, Default)]
    struct NullEmitter;

    #[async_trait]
    impl RuntimeEmitter for NullEmitter {
        async fn session_state_changed(&self, _: SessionState) {}
        async fn output_chunk(&self, _: &str, _: Bytes) {}
        async fn ports_changed(&self, _: Vec<DetectedPort>) {}
    }

    fn temp_home(prefix: &str) -> String {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("pandora-registry-{prefix}-{nanos}"));
        std::fs::create_dir_all(&dir).unwrap();
        dir.to_string_lossy().into_owned()
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn second_get_or_create_returns_cached_instance() {
        let home = temp_home("cache");
        let db = Arc::new(AppDatabase::open(&home).expect("open"));
        let emitter: Arc<dyn RuntimeEmitter> = Arc::new(NullEmitter);
        let registry = RuntimeRegistry::new();

        let db1 = Arc::clone(&db);
        let em1 = Arc::clone(&emitter);
        let factory = || Runtime::open(Arc::clone(&db1), "rt1", "/tmp", "/tmp", Arc::clone(&em1));
        let (first, was_new_first) = registry.get_or_create("rt1", factory).await.expect("first");
        assert!(was_new_first);
        // If the factory ran a second time, we'd open a new ProcessManager
        // (and re-seed). Use `get` after to verify the cached identity.
        let second = registry.get("rt1").await.expect("cached");
        assert_eq!(first.id, second.id);

        // Second get_or_create should report was_new=false.
        let db2 = Arc::clone(&db);
        let em2 = Arc::clone(&emitter);
        let factory_again =
            || Runtime::open(Arc::clone(&db2), "rt1", "/tmp", "/tmp", Arc::clone(&em2));
        let (_, was_new_second) = registry
            .get_or_create("rt1", factory_again)
            .await
            .expect("second");
        assert!(!was_new_second);

        let _ = std::fs::remove_dir_all(&home);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn close_removes_runtime_from_cache() {
        let home = temp_home("close");
        let db = Arc::new(AppDatabase::open(&home).expect("open"));
        let emitter: Arc<dyn RuntimeEmitter> = Arc::new(NullEmitter);
        let registry = RuntimeRegistry::new();
        let db1 = Arc::clone(&db);
        let em1 = Arc::clone(&emitter);
        let (_, was_new) = registry
            .get_or_create("rt2", || {
                Runtime::open(Arc::clone(&db1), "rt2", "/tmp", "/tmp", Arc::clone(&em1))
            })
            .await
            .expect("create");
        assert!(was_new);

        assert!(registry.close("rt2").await);
        assert!(registry.get("rt2").await.is_none());
        assert!(!registry.close("rt2").await);

        let _ = std::fs::remove_dir_all(&home);
    }
}
