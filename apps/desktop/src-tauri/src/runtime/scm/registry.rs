//! Per-workspace `ScmService` registry.
//!
//! Keyed by workspace id (or `"project:<project_id>"` for project runtimes).

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::database::AppDatabase;
use crate::runtime::terminal::process_manager::ScopeEmitter;
use super::service::ScmService;

/// Global registry of `ScmService`s keyed by workspace id.
#[derive(Clone, Default)]
pub struct ScmRegistry {
    inner: Arc<Mutex<HashMap<String, ScmService>>>,
}

impl ScmRegistry {
    pub async fn get_or_create<F>(
        &self,
        workspace_id: &str,
        factory: F,
    ) -> (ScmService, bool)
    where
        F: FnOnce() -> ScmService,
    {
        let mut inner = self.inner.lock().await;
        if let Some(existing) = inner.get(workspace_id) {
            return (existing.clone(), false);
        }
        let svc = factory();
        inner.insert(workspace_id.to_string(), svc.clone());
        (svc, true)
    }

    pub async fn remove(&self, workspace_id: &str) {
        let svc = self.inner.lock().await.remove(workspace_id);
        if let Some(s) = svc {
            s.close().await;
        }
    }
}

pub fn open_scm(
    db: Arc<AppDatabase>,
    workspace_id: &str,
    workspace_root: &str,
    emitter: Arc<dyn ScopeEmitter>,
) -> ScmService {
    ScmService::open(
        db,
        workspace_id.to_string(),
        workspace_root.to_string(),
        emitter,
    )
}
