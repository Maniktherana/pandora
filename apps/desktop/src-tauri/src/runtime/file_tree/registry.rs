//! Per-workspace `FileTreeService` registry.
//!
//! Keyed by workspace id (or `"project:<project_id>"` for project runtimes).

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use super::service::FileTreeService;
use crate::runtime::terminal::process_manager::ScopeEmitter;

/// Global registry of `FileTreeService`s keyed by workspace id.
#[derive(Clone, Default)]
pub struct FileTreeRegistry {
    inner: Arc<Mutex<HashMap<String, FileTreeService>>>,
}

impl FileTreeRegistry {
    pub async fn get_or_create<F>(
        &self,
        workspace_id: &str,
        factory: F,
    ) -> Result<(FileTreeService, bool), String>
    where
        F: FnOnce() -> Result<FileTreeService, String>,
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
        self.inner.lock().await.remove(workspace_id);
    }
}

pub fn open_file_tree(
    workspace_id: &str,
    workspace_root: &str,
    emitter: Arc<dyn ScopeEmitter>,
) -> Result<FileTreeService, String> {
    FileTreeService::open(workspace_id.to_string(), workspace_root, emitter)
}
