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
use super::seed::ensure_seed;

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

/// Build a `TerminalScope` for a given scope id, seeding DB if needed.
pub fn open_terminal_scope(
    db: Arc<AppDatabase>,
    scope_id: &str,
    default_cwd: &str,
    emitter: Arc<dyn ScopeEmitter>,
) -> Result<TerminalScope, String> {
    ensure_seed(db.as_ref(), scope_id, default_cwd)?;
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
