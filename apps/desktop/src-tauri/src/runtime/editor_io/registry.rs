//! Per-workspace `EditorIoService` registry.
//!
//! Keyed by workspace id (or `"project:<project_id>"` for project runtimes).

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use super::service::EditorIoService;
use crate::runtime::terminal::process_manager::ScopeEmitter;

/// Global registry of `EditorIoService`s keyed by workspace id.
#[derive(Clone, Default)]
pub struct EditorIoRegistry {
    inner: Arc<Mutex<HashMap<String, EditorIoService>>>,
}

impl EditorIoRegistry {
    pub async fn get_or_create<F>(
        &self,
        workspace_id: &str,
        factory: F,
    ) -> Result<(EditorIoService, bool), String>
    where
        F: FnOnce() -> Result<EditorIoService, String>,
    {
        let mut inner = self.inner.lock().await;
        if let Some(existing) = inner.get(workspace_id) {
            return Ok((existing.clone(), false));
        }
        let svc = factory()?;
        inner.insert(workspace_id.to_string(), svc.clone());
        Ok((svc, true))
    }

    pub async fn remove(&self, workspace_id: &str) {
        let svc = self.inner.lock().await.remove(workspace_id);
        if let Some(s) = svc {
            s.close().await;
        }
    }
}

pub fn open_editor_io(
    workspace_id: &str,
    workspace_root: &str,
    emitter: Arc<dyn ScopeEmitter>,
) -> Result<EditorIoService, String> {
    EditorIoService::open(workspace_id.to_string(), workspace_root, emitter)
}
