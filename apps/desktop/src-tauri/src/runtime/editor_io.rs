//! Per-runtime editor IO service.
//!
//! Provides request-correlated text file reads and writes within the workspace
//! root, and emits `EditorFileChanged` events when a previously-read file
//! changes on disk.
//!
//! All disk I/O runs on the blocking pool. Workspace path safety is enforced
//! at the service boundary — absolute paths and traversals are rejected.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::{oneshot, Mutex};

use super::process_manager::RuntimeEmitter;

const MAX_TEXT_FILE_BYTES: u64 = 4 * 1024 * 1024;
const WATCHER_DEBOUNCE: Duration = Duration::from_millis(250);

// ---------------------------------------------------------------------------
// Public service
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct EditorIoService {
    inner: Arc<Mutex<EditorInner>>,
    runtime_id: String,
    root: PathBuf,
    emitter: Arc<dyn RuntimeEmitter>,
    shutdown_tx: Arc<Mutex<Option<oneshot::Sender<()>>>>,
}

struct EditorInner {
    /// Workspace-relative paths of files currently being watched.
    watched_files: HashSet<String>,
}

impl EditorIoService {
    /// Open the editor IO service rooted at `workspace_root`.
    pub fn open(
        runtime_id: String,
        workspace_root: &str,
        emitter: Arc<dyn RuntimeEmitter>,
    ) -> Result<Self, String> {
        let root = Path::new(workspace_root)
            .canonicalize()
            .map_err(|e| format!("invalid workspace root '{workspace_root}': {e}"))?;

        let inner = Arc::new(Mutex::new(EditorInner {
            watched_files: HashSet::new(),
        }));

        let (shutdown_tx, shutdown_rx) = oneshot::channel();

        let svc = Self {
            inner: Arc::clone(&inner),
            runtime_id: runtime_id.clone(),
            root,
            emitter: Arc::clone(&emitter),
            shutdown_tx: Arc::new(Mutex::new(Some(shutdown_tx))),
        };

        let svc_for_task = svc.clone();
        tokio::spawn(async move {
            svc_for_task.run_watcher(shutdown_rx).await;
        });

        Ok(svc)
    }

    /// Stop the watcher task.
    pub async fn close(&self) {
        if let Some(tx) = self.shutdown_tx.lock().await.take() {
            let _ = tx.send(());
        }
    }

    // ---- Read / write -----------------------------------------------------

    /// Read a workspace-relative text file. Emits `EditorFileRead` (with
    /// `None` contents if missing) or `EditorError` on failure. Also starts
    /// watching the file for changes.
    pub async fn read_text_file(&self, request_id: String, relative_path: String) {
        let relative_path = normalize_relative(relative_path);
        let root = self.root.clone();

        let result: Result<Option<String>, String> = tokio::task::spawn_blocking({
            let rel = relative_path.clone();
            let root = root.clone();
            move || {
                // Distinguish path safety errors (traversal, absolute) from
                // "file simply doesn't exist yet" — the former is an error,
                // the latter returns None so the editor treats it as a new file.
                let path = match resolve_under_root(&root, &rel, true) {
                    Ok(p) => p,
                    Err(err) => {
                        // Safety violations (absolute path, traversal, root
                        // escape) are errors. A plain "cannot resolve" means
                        // the file simply doesn't exist — return None.
                        if err.contains("not allowed") || err.contains("escapes workspace") {
                            return Err(err);
                        }
                        return Ok(None);
                    }
                };
                if !path.is_file() {
                    return Ok(None);
                }
                let len = path.metadata().map_err(|e| e.to_string())?.len();
                if len > MAX_TEXT_FILE_BYTES {
                    return Err(format!(
                        "file is too large for the editor (max {} MB)",
                        MAX_TEXT_FILE_BYTES / (1024 * 1024)
                    ));
                }
                std::fs::read_to_string(&path)
                    .map(Some)
                    .map_err(|e| e.to_string())
            }
        })
        .await
        .map_err(|e| e.to_string())
        .and_then(|r| r);

        match result {
            Ok(contents) => {
                // Register the file for change watching.
                if contents.is_some() {
                    self.inner
                        .lock()
                        .await
                        .watched_files
                        .insert(relative_path.clone());
                }
                self.emitter
                    .editor_file_read(request_id, relative_path, contents)
                    .await;
            }
            Err(err) => {
                self.emitter.editor_error(Some(request_id), err).await;
            }
        }
    }

    /// Write text to a workspace-relative path. Emits `EditorFileWritten` or
    /// `EditorError`.
    pub async fn write_text_file(
        &self,
        request_id: String,
        relative_path: String,
        contents: String,
    ) {
        let relative_path = normalize_relative(relative_path);
        if relative_path.is_empty() {
            self.emitter
                .editor_error(Some(request_id), "cannot write workspace root".into())
                .await;
            return;
        }
        let root = self.root.clone();

        let result: Result<(), String> = tokio::task::spawn_blocking({
            let rel = relative_path.clone();
            let root = root.clone();
            move || {
                if contents.as_bytes().len() as u64 > MAX_TEXT_FILE_BYTES {
                    return Err("content is too large to save".to_string());
                }
                let path = resolve_under_root(&root, &rel, false)?;
                if let Some(parent) = path.parent() {
                    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                }
                std::fs::write(&path, contents).map_err(|e| e.to_string())
            }
        })
        .await
        .map_err(|e| e.to_string())
        .and_then(|r| r);

        match result {
            Ok(()) => {
                self.emitter
                    .editor_file_written(request_id, relative_path)
                    .await;
            }
            Err(err) => {
                self.emitter.editor_error(Some(request_id), err).await;
            }
        }
    }

    // ---- Watcher ----------------------------------------------------------

    async fn run_watcher(&self, shutdown_rx: oneshot::Receiver<()>) {
        use notify::{recommended_watcher, Event, RecursiveMode, Watcher};

        let (tx, mut rx) = tokio::sync::mpsc::channel::<PathBuf>(16);

        let watcher = recommended_watcher(move |res: notify::Result<Event>| {
            if let Ok(event) = res {
                use notify::EventKind;
                if matches!(
                    event.kind,
                    EventKind::Modify(_) | EventKind::Create(_) | EventKind::Remove(_)
                ) {
                    for path in event.paths {
                        let _ = tx.try_send(path);
                    }
                }
            }
        });

        let mut watcher = match watcher {
            Ok(w) => w,
            Err(err) => {
                tracing::warn!(runtime_id = %self.runtime_id, %err, "editor_io watcher init failed");
                return;
            }
        };

        if let Err(err) = watcher.watch(&self.root, RecursiveMode::Recursive) {
            tracing::warn!(runtime_id = %self.runtime_id, %err, "editor_io watcher watch failed");
            return;
        }

        let mut shutdown = std::pin::pin!(shutdown_rx);

        loop {
            tokio::select! {
                _ = &mut shutdown => return,
                Some(changed_path) = rx.recv() => {
                    // Debounce: drain within the window.
                    let mut affected: HashSet<PathBuf> = HashSet::new();
                    affected.insert(changed_path);
                    let deadline = tokio::time::Instant::now() + WATCHER_DEBOUNCE;
                    loop {
                        let remaining = deadline
                            .saturating_duration_since(tokio::time::Instant::now());
                        if remaining.is_zero() {
                            break;
                        }
                        match tokio::time::timeout(remaining, rx.recv()).await {
                            Ok(Some(p)) => { affected.insert(p); }
                            _ => break,
                        }
                    }

                    // Check which affected paths are currently watched.
                    let watched = {
                        let inner = self.inner.lock().await;
                        inner.watched_files.clone()
                    };
                    for abs_path in &affected {
                        if let Ok(rel) = abs_path.strip_prefix(&self.root) {
                            let rel_str = rel.to_string_lossy().replace('\\', "/");
                            if watched.contains(&rel_str) {
                                self.emitter.editor_file_changed(rel_str).await;
                            }
                        }
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Pure helpers (shared with file_tree.rs style)
// ---------------------------------------------------------------------------

fn normalize_relative(input: String) -> String {
    // Strip only TRAILING separators so that the leading `/` on absolute paths
    // is preserved — `resolve_under_root` depends on `Path::is_absolute()` to
    // reject them, which requires the leading slash to be present.
    let trimmed = input
        .trim()
        .trim_end_matches(|c: char| c == '/' || c == '\\');
    trimmed.replace('\\', "/")
}

fn resolve_under_root(root: &Path, relative: &str, must_exist: bool) -> Result<PathBuf, String> {
    if Path::new(relative).is_absolute() {
        return Err("absolute paths are not allowed".to_string());
    }
    // Reject `..` components before joining — prevents traversal even when the
    // target path does not exist and canonicalize() would fail first.
    for component in std::path::Path::new(relative).components() {
        if component == std::path::Component::ParentDir {
            return Err("path escapes workspace root".to_string());
        }
    }
    let candidate = if relative.is_empty() {
        root.to_path_buf()
    } else {
        root.join(relative)
    };
    let resolved = if must_exist {
        candidate
            .canonicalize()
            .map_err(|e| format!("cannot resolve path: {e}"))?
    } else {
        let mut existing = candidate.as_path();
        let mut tail = Vec::new();
        while !existing.exists() {
            if let Some(name) = existing.file_name() {
                tail.push(name.to_os_string());
            } else {
                break;
            }
            existing = match existing.parent() {
                Some(p) => p,
                None => break,
            };
        }
        let mut resolved = existing
            .canonicalize()
            .map_err(|e| format!("cannot resolve path: {e}"))?;
        for component in tail.into_iter().rev() {
            resolved.push(component);
        }
        resolved
    };
    if !resolved.starts_with(root) {
        return Err("path escapes workspace root".to_string());
    }
    Ok(resolved)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime::process_manager::RuntimeEmitter;
    use crate::runtime::types::{DetectedPort, SessionState};
    use async_trait::async_trait;
    use bytes::Bytes;
    use std::sync::Mutex as StdMutex;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[derive(Default)]
    struct Captured {
        reads: Vec<(String, String, Option<String>)>,
        written: Vec<(String, String)>,
        errors: Vec<(Option<String>, String)>,
    }

    #[derive(Clone, Default)]
    struct CapturingEmitter(Arc<StdMutex<Captured>>);

    #[async_trait]
    impl RuntimeEmitter for CapturingEmitter {
        async fn session_state_changed(&self, _: SessionState) {}
        async fn output_chunk(&self, _: &str, _: Bytes) {}
        async fn ports_changed(&self, _: Vec<DetectedPort>) {}
        async fn editor_file_read(
            &self,
            request_id: String,
            relative_path: String,
            contents: Option<String>,
        ) {
            self.0
                .lock()
                .unwrap()
                .reads
                .push((request_id, relative_path, contents));
        }
        async fn editor_file_written(&self, request_id: String, relative_path: String) {
            self.0
                .lock()
                .unwrap()
                .written
                .push((request_id, relative_path));
        }
        async fn editor_error(&self, request_id: Option<String>, message: String) {
            self.0.lock().unwrap().errors.push((request_id, message));
        }
    }

    fn temp_workspace(prefix: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("pandora-eio-{prefix}-{nanos}"));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn service(prefix: &str) -> (EditorIoService, CapturingEmitter, PathBuf) {
        let workspace = temp_workspace(prefix);
        let emitter = CapturingEmitter::default();
        let arc: Arc<dyn RuntimeEmitter> = Arc::new(emitter.clone());
        let svc = EditorIoService::open(format!("rt-{prefix}"), workspace.to_str().unwrap(), arc)
            .unwrap();
        (svc, emitter, workspace)
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn read_missing_file_returns_none() {
        let (svc, emitter, _) = service("read-miss");
        svc.read_text_file("req-1".into(), "missing.txt".into())
            .await;
        let reads = emitter.0.lock().unwrap().reads.clone();
        assert_eq!(reads.len(), 1);
        assert_eq!(reads[0].0, "req-1");
        assert!(reads[0].2.is_none());
        svc.close().await;
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn write_then_read_round_trips() {
        let (svc, emitter, workspace) = service("rw");
        svc.write_text_file("w1".into(), "hello.txt".into(), "world".into())
            .await;
        svc.read_text_file("r1".into(), "hello.txt".into()).await;
        let reads = emitter.0.lock().unwrap().reads.clone();
        assert_eq!(reads.len(), 1);
        assert_eq!(reads[0].2.as_deref(), Some("world"));
        let written = emitter.0.lock().unwrap().written.clone();
        assert_eq!(written.len(), 1);
        let _ = std::fs::remove_dir_all(&workspace);
        svc.close().await;
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn write_path_traversal_is_rejected() {
        let (svc, emitter, _) = service("traversal-w");
        svc.write_text_file("w1".into(), "../escape.txt".into(), "bad".into())
            .await;
        let errors = emitter.0.lock().unwrap().errors.clone();
        assert!(!errors.is_empty(), "expected an error for traversal write");
        svc.close().await;
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn read_absolute_path_emits_error() {
        let (svc, emitter, _) = service("abs-r");
        svc.read_text_file("req-1".into(), "/tmp/secret".into())
            .await;
        let errors = emitter.0.lock().unwrap().errors.clone();
        assert!(
            !errors.is_empty(),
            "expected EditorError for absolute read path"
        );
        svc.close().await;
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn write_absolute_path_emits_error() {
        let (svc, emitter, _) = service("abs-w");
        svc.write_text_file("w1".into(), "/tmp/secret".into(), "bad".into())
            .await;
        let errors = emitter.0.lock().unwrap().errors.clone();
        assert!(
            !errors.is_empty(),
            "expected EditorError for absolute write path"
        );
        svc.close().await;
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn read_path_traversal_emits_error_not_none() {
        let (svc, emitter, _) = service("traversal-r");
        svc.read_text_file("req-1".into(), "../secret".into()).await;
        // Traversal must surface as EditorError, not a silent None read.
        let errors = emitter.0.lock().unwrap().errors.clone();
        let reads = emitter.0.lock().unwrap().reads.clone();
        assert!(
            !errors.is_empty() || reads.iter().all(|(_, _, c)| c.is_none()),
            "traversal read should produce an error or None (never real contents)"
        );
        // Specifically, a path that escapes the root MUST produce an error.
        assert!(
            !errors.is_empty(),
            "expected EditorError for ../secret traversal"
        );
        svc.close().await;
    }
}
