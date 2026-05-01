//! Per-terminal-scope `ProcessManager` registry.
//!
//! Keyed by terminal scope id:
//!   - workspace runtime  → workspace UUID
//!   - project runtime    → `"project:<project_id>"`
//!
//! Project terminal scope survives workspace switches: the registry is global
//! and the `project:*` entry is never closed when a workspace changes.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::database::AppDatabase;
use super::process_manager::{ProcessManager, ScopeEmitter};

/// Lightweight handle to a running `ProcessManager`.
#[derive(Clone)]
pub struct TerminalScope {
    pub process_manager: ProcessManager,
}

/// Global registry of `ProcessManager`s keyed by terminal scope id.
#[derive(Clone, Default)]
pub struct TerminalRegistry {
    inner: Arc<Mutex<HashMap<String, TerminalScope>>>,
}

impl TerminalRegistry {
    /// Get-or-create a `TerminalScope`. The `factory` is only called on cache
    /// miss. Returns `(scope, was_new)`.
    pub async fn get_or_create<F>(
        &self,
        scope_id: &str,
        factory: F,
    ) -> Result<(TerminalScope, bool), String>
    where
        F: FnOnce() -> Result<TerminalScope, String>,
    {
        let mut inner = self.inner.lock().await;
        if let Some(existing) = inner.get(scope_id) {
            return Ok((existing.clone(), false));
        }
        let scope = factory()?;
        inner.insert(scope_id.to_string(), scope.clone());
        Ok((scope, true))
    }

    pub async fn get(&self, scope_id: &str) -> Option<TerminalScope> {
        self.inner.lock().await.get(scope_id).cloned()
    }

    /// Remove and gracefully stop the scope.
    pub async fn close(&self, scope_id: &str) -> bool {
        let scope = {
            let mut inner = self.inner.lock().await;
            inner.remove(scope_id)
        };
        match scope {
            Some(s) => {
                s.process_manager.close_all_sessions().await;
                true
            }
            None => false,
        }
    }
}

/// Build a `TerminalScope` for a given scope id by loading DB state.
pub fn open_terminal_scope(
    db: Arc<AppDatabase>,
    scope_id: &str,
    default_cwd: &str,
    emitter: Arc<dyn ScopeEmitter>,
) -> Result<TerminalScope, String> {
    let slots = db.list_slot_definitions(scope_id);
    let sessions = db.list_session_definitions(scope_id);
    let pm = ProcessManager::new(
        slots,
        sessions,
        emitter,
        default_cwd.to_string(),
        scope_id.to_string(),
    );
    Ok(TerminalScope {
        process_manager: pm,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{
        PresentationMode, SessionDefinition, SessionKind, SlotDefinition, SlotKind,
    };
    use std::time::{SystemTime, UNIX_EPOCH};

    #[derive(Clone, Default)]
    struct NoopEmitter;

    #[async_trait::async_trait]
    impl ScopeEmitter for NoopEmitter {
        async fn session_state_changed(&self, _state: crate::runtime::types::SessionState) {}
        async fn output_chunk(&self, _session_id: &str, _data: bytes::Bytes) {}
        async fn ports_changed(&self, _ports: Vec<crate::runtime::types::DetectedPort>) {}
    }

    fn temp_home(prefix: &str) -> String {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("pandora-terminal-{prefix}-{nanos}"));
        std::fs::create_dir_all(&dir).unwrap();
        dir.to_string_lossy().into_owned()
    }

    fn slot(id: &str) -> SlotDefinition {
        SlotDefinition {
            id: id.to_string(),
            kind: SlotKind::ProcessSlot,
            name: id.to_string(),
            autostart: false,
            presentation_mode: PresentationMode::Single,
            primary_session_def_id: None,
            session_def_ids: vec![],
            persisted: true,
            sort_order: 0,
        }
    }

    fn session(id: &str, slot_id: &str) -> SessionDefinition {
        SessionDefinition {
            id: id.to_string(),
            slot_id: slot_id.to_string(),
            kind: SessionKind::Process,
            name: id.to_string(),
            command: "sleep 1".to_string(),
            cwd: Some("/tmp".to_string()),
            port: None,
            env_overrides: Default::default(),
            restart_policy: crate::models::RestartPolicy::Manual,
            pause_supported: true,
            resume_supported: true,
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn opening_empty_scope_loads_no_terminal_definitions() {
        let home = temp_home("empty");
        let db = Arc::new(AppDatabase::open(&home).expect("open db"));
        let emitter: Arc<dyn ScopeEmitter> = Arc::new(NoopEmitter::default());

        let scope = open_terminal_scope(Arc::clone(&db), "runtime-1", "/tmp", emitter)
            .expect("open scope");

        assert!(scope.process_manager.list_slot_states().await.is_empty());
        assert!(scope.process_manager.list_session_states().await.is_empty());

        let _ = std::fs::remove_dir_all(&home);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn opening_scope_keeps_existing_terminal_definitions() {
        let home = temp_home("existing");
        let db = Arc::new(AppDatabase::open(&home).expect("open db"));
        let runtime_id = "runtime-2";

        let slot = slot("slot-1");
        db.create_slot_definition(runtime_id, &slot)
            .expect("create slot");
        let session = session("session-1", &slot.id);
        db.create_session_definition(runtime_id, &session)
            .expect("create session");

        let emitter: Arc<dyn ScopeEmitter> = Arc::new(NoopEmitter::default());
        let scope = open_terminal_scope(Arc::clone(&db), runtime_id, "/tmp", emitter)
            .expect("open scope");

        let slots = scope.process_manager.list_slot_states().await;
        let sessions = scope.process_manager.list_session_states().await;
        assert_eq!(slots.len(), 1);
        assert!(sessions.is_empty());
        assert_eq!(slots[0].definition.id, "slot-1");
        assert_eq!(slots[0].definition.session_def_ids, vec!["session-1"]);

        let _sid = scope
            .process_manager
            .open_session_instance("session-1")
            .await
            .expect("open session");
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        let live_sessions = scope.process_manager.list_session_states().await;
        assert_eq!(live_sessions.len(), 1);
        assert_eq!(live_sessions[0].instance.session_def_id, "session-1");
        scope.process_manager.close_all_sessions().await;

        let _ = std::fs::remove_dir_all(&home);
    }
}
