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

use super::process_manager::{ProcessManager, RuntimeEmitter};
use super::seed::ensure_seed;

/// One workspace's worth of running sessions.
#[derive(Clone)]
pub struct Runtime {
    #[allow(dead_code)]
    pub id: String,
    #[allow(dead_code)]
    pub default_cwd: String,
    pub process_manager: ProcessManager,
}

impl Runtime {
    /// Open or hydrate a runtime: seeds the dormant terminal, reads
    /// definitions back from the DB, and constructs a `ProcessManager`
    /// with them.
    pub fn open(
        db: &AppDatabase,
        runtime_id: &str,
        default_cwd: &str,
        emitter: Arc<dyn RuntimeEmitter>,
    ) -> Result<Self, String> {
        ensure_seed(db, runtime_id, default_cwd)?;
        let slots = db.list_slot_definitions(runtime_id);
        let sessions = db.list_session_definitions(runtime_id);
        let pm = ProcessManager::new(
            slots,
            sessions,
            emitter,
            default_cwd.to_string(),
            runtime_id.to_string(),
        );
        Ok(Self {
            id: runtime_id.to_string(),
            default_cwd: default_cwd.to_string(),
            process_manager: pm,
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
        let db = AppDatabase::open(&home).expect("open");
        let emitter: Arc<dyn RuntimeEmitter> = Arc::new(NullEmitter);
        let registry = RuntimeRegistry::new();

        let factory = || Runtime::open(&db, "rt1", "/tmp", Arc::clone(&emitter));
        let (first, was_new_first) = registry
            .get_or_create("rt1", factory)
            .await
            .expect("first");
        assert!(was_new_first);
        // If the factory ran a second time, we'd open a new ProcessManager
        // (and re-seed). Use `get` after to verify the cached identity.
        let second = registry.get("rt1").await.expect("cached");
        assert_eq!(first.id, second.id);

        // Second get_or_create should report was_new=false.
        let factory_again = || Runtime::open(&db, "rt1", "/tmp", Arc::clone(&emitter));
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
        let db = AppDatabase::open(&home).expect("open");
        let emitter: Arc<dyn RuntimeEmitter> = Arc::new(NullEmitter);
        let registry = RuntimeRegistry::new();
        let (_, was_new) = registry
            .get_or_create("rt2", || {
                Runtime::open(&db, "rt2", "/tmp", Arc::clone(&emitter))
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
