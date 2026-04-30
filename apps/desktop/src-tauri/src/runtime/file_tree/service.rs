//! Per-runtime file-tree service.
//!
//! Owns the workspace root and the set of currently-expanded directories.
//! All disk I/O runs on the blocking pool. Structural snapshots contain
//! pure filesystem layout (`is_ignored` is always `false`); Git decorations
//! are an async overlay concern handled outside this service. Mutations emit
//! `FileTreeDirectoryChanged` for every affected parent so the renderer
//! never has to refetch.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use tokio::sync::Mutex;

use crate::runtime::terminal::process_manager::ScopeEmitter;
use crate::runtime::types::{FileTreeEntry, FileTreeSnapshot};

const MAX_TEXT_FILE_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Clone)]
pub struct FileTreeService {
    inner: Arc<Mutex<Inner>>,
    runtime_id: String,
    emitter: Arc<dyn ScopeEmitter>,
}

struct Inner {
    /// Canonicalized workspace root.
    root: PathBuf,
    /// Workspace-relative paths (forward slashes, no leading `/`) that the
    /// renderer is currently rendering as expanded. Always includes `""`.
    expanded: BTreeSet<String>,
}

impl FileTreeService {
    pub fn open(
        runtime_id: String,
        workspace_root: &str,
        emitter: Arc<dyn ScopeEmitter>,
    ) -> Result<Self, String> {
        let root = Path::new(workspace_root)
            .canonicalize()
            .map_err(|e| format!("invalid workspace root '{workspace_root}': {e}"))?;
        let mut expanded = BTreeSet::new();
        expanded.insert(String::new());

        Ok(Self {
            inner: Arc::new(Mutex::new(Inner { root, expanded })),
            runtime_id,
            emitter,
        })
    }

    // ---- subscription ---------------------------------------------------

    /// Seed the expansion hint set and emit a full-tree snapshot.
    ///
    /// The `expanded_paths` are stored as UI/watcher hints only — they no
    /// longer control which directories appear in the snapshot.  The snapshot
    /// always contains the complete normal project tree (all non-ignored
    /// directories, excl. `.git`).
    pub async fn subscribe(&self, expanded_paths: Vec<String>) {
        self.replace_expanded(expanded_paths).await;
        self.emit_snapshot().await;
    }

    /// Update the expansion hint set.  Does NOT re-emit a snapshot — the
    /// frontend already has the full tree; the hints are for watcher
    /// priority only.
    pub async fn set_expanded_paths(&self, paths: Vec<String>) {
        self.replace_expanded(paths).await;
        // Intentionally no emit_snapshot() call here.
    }

    async fn replace_expanded(&self, paths: Vec<String>) {
        let mut next: BTreeSet<String> = paths.into_iter().map(normalize_relative).collect();
        next.insert(String::new());
        let mut inner = self.inner.lock().await;
        inner.expanded = next;
    }

    pub async fn refresh(&self, path: Option<String>) {
        let target = path.map(normalize_relative);
        let (root, dirs) = {
            let inner = self.inner.lock().await;
            let dirs: Vec<String> = match target {
                Some(p) if inner.expanded.contains(&p) => vec![p],
                Some(_) => Vec::new(),
                None => inner.expanded.iter().cloned().collect(),
            };
            (inner.root.clone(), dirs)
        };
        for rel in dirs {
            self.emit_directory_changed(&root, &rel).await;
        }
    }

    pub async fn emit_snapshot(&self) {
        let (root, expanded) = {
            let inner = self.inner.lock().await;
            (inner.root.clone(), inner.expanded.clone())
        };
        let snapshot = compute_snapshot(&root, &expanded).await;
        self.emitter.file_tree_snapshot(snapshot).await;
    }

    // ---- mutations ------------------------------------------------------

    pub async fn create_file(&self, parent: String, name: String, contents: String) {
        let parent = normalize_relative(parent);
        let trimmed = name.trim();
        if trimmed.is_empty() || trimmed.contains('/') || trimmed.contains('\\') {
            self.error(None, "invalid file name").await;
            return;
        }
        let trimmed = trimmed.to_string();
        let root = self.root().await;
        let result: Result<(), String> = tokio::task::spawn_blocking({
            let parent = parent.clone();
            let name = trimmed.clone();
            let root = root.clone();
            move || {
                let parent_path = resolve_under_root(&root, &parent, false)?;
                std::fs::create_dir_all(&parent_path).map_err(|e| e.to_string())?;
                let dest = parent_path.join(&name);
                if dest.exists() {
                    return Err("entry already exists".to_string());
                }
                if contents.as_bytes().len() as u64 > MAX_TEXT_FILE_BYTES {
                    return Err("content is too large to save".to_string());
                }
                std::fs::write(&dest, contents).map_err(|e| e.to_string())
            }
        })
        .await
        .map_err(|e| e.to_string())
        .and_then(|r| r);

        match result {
            Ok(()) => self.emit_directory_changed(&root, &parent).await,
            Err(err) => self.error(None, err).await,
        }
    }

    pub async fn create_directory(&self, relative_path: String) {
        let relative_path = normalize_relative(relative_path);
        if relative_path.is_empty() {
            self.error(None, "directory path is empty").await;
            return;
        }
        let root = self.root().await;
        let result: Result<(), String> = tokio::task::spawn_blocking({
            let rel = relative_path.clone();
            let root = root.clone();
            move || {
                let dir = resolve_under_root(&root, &rel, false)?;
                std::fs::create_dir_all(&dir).map_err(|e| e.to_string())
            }
        })
        .await
        .map_err(|e| e.to_string())
        .and_then(|r| r);

        match result {
            Ok(()) => {
                let parent = parent_of(&relative_path);
                self.emit_directory_changed(&root, &parent).await;
            }
            Err(err) => self.error(None, err).await,
        }
    }

    pub async fn rename(&self, source: String, new_name: String) {
        let source = normalize_relative(source);
        let trimmed = new_name.trim();
        if trimmed.is_empty() || trimmed.contains('/') || trimmed.contains('\\') {
            self.error(None, "invalid new name").await;
            return;
        }
        let new_name = trimmed.to_string();
        let root = self.root().await;
        let result: Result<(), String> = tokio::task::spawn_blocking({
            let source = source.clone();
            let new_name = new_name.clone();
            let root = root.clone();
            move || {
                let src = resolve_under_root(&root, &source, true)?;
                let parent = src
                    .parent()
                    .ok_or_else(|| "cannot determine parent".to_string())?;
                let dest = parent.join(&new_name);
                if dest == src {
                    return Ok(());
                }
                if dest.exists() {
                    return Err("destination already exists".to_string());
                }
                std::fs::rename(&src, &dest).map_err(|e| e.to_string())
            }
        })
        .await
        .map_err(|e| e.to_string())
        .and_then(|r| r);

        match result {
            Ok(()) => {
                let parent = parent_of(&source);
                self.emit_directory_changed(&root, &parent).await;
            }
            Err(err) => self.error(None, err).await,
        }
    }

    pub async fn delete(&self, relative_path: String) {
        let relative_path = normalize_relative(relative_path);
        if relative_path.is_empty() {
            self.error(None, "cannot delete workspace root").await;
            return;
        }
        let root = self.root().await;
        let result: Result<(), String> = tokio::task::spawn_blocking({
            let rel = relative_path.clone();
            let root = root.clone();
            move || {
                let path = resolve_under_root(&root, &rel, true)?;
                if path.is_dir() {
                    std::fs::remove_dir_all(&path).map_err(|e| e.to_string())
                } else {
                    std::fs::remove_file(&path).map_err(|e| e.to_string())
                }
            }
        })
        .await
        .map_err(|e| e.to_string())
        .and_then(|r| r);

        match result {
            Ok(()) => {
                self.drop_descendants(&relative_path).await;
                let parent = parent_of(&relative_path);
                self.emit_directory_changed(&root, &parent).await;
            }
            Err(err) => self.error(None, err).await,
        }
    }

    pub async fn move_entry(&self, source: String, dest_dir: String) {
        let source = normalize_relative(source);
        let dest_dir = normalize_relative(dest_dir);
        let root = self.root().await;
        let result: Result<bool, String> = tokio::task::spawn_blocking({
            let source = source.clone();
            let dest_dir = dest_dir.clone();
            let root = root.clone();
            move || {
                let src = resolve_under_root(&root, &source, true)?;
                let dest_root = resolve_under_root(&root, &dest_dir, true)?;
                if !dest_root.is_dir() {
                    return Err("destination is not a directory".to_string());
                }
                let name = src
                    .file_name()
                    .ok_or_else(|| "cannot determine filename".to_string())?;
                let dest = dest_root.join(name);
                if dest == src {
                    return Ok(false);
                }
                if std::fs::rename(&src, &dest).is_err() {
                    copy_recursive(&src, &dest)?;
                    if src.is_dir() {
                        std::fs::remove_dir_all(&src).map_err(|e| e.to_string())?;
                    } else {
                        std::fs::remove_file(&src).map_err(|e| e.to_string())?;
                    }
                }
                Ok(true)
            }
        })
        .await
        .map_err(|e| e.to_string())
        .and_then(|r| r);

        match result {
            Ok(false) => {}
            Ok(true) => {
                self.drop_descendants(&source).await;
                let source_parent = parent_of(&source);
                self.emit_directory_changed(&root, &source_parent).await;
                if dest_dir != source_parent {
                    self.emit_directory_changed(&root, &dest_dir).await;
                }
            }
            Err(err) => self.error(None, err).await,
        }
    }

    pub async fn copy_entry(&self, source: String, dest_dir: String) {
        let source = normalize_relative(source);
        let dest_dir = normalize_relative(dest_dir);
        let root = self.root().await;
        let result: Result<(), String> = tokio::task::spawn_blocking({
            let source = source.clone();
            let dest_dir = dest_dir.clone();
            let root = root.clone();
            move || {
                let src = resolve_under_root(&root, &source, true)?;
                let dest_root = resolve_under_root(&root, &dest_dir, true)?;
                if !dest_root.is_dir() {
                    return Err("destination is not a directory".to_string());
                }
                let name = src
                    .file_name()
                    .ok_or_else(|| "cannot determine filename".to_string())?;
                let requested = dest_root.join(name);
                let final_dest = if requested.exists() {
                    next_copy_destination(&requested)?
                } else {
                    requested
                };
                copy_recursive(&src, &final_dest)
            }
        })
        .await
        .map_err(|e| e.to_string())
        .and_then(|r| r);

        match result {
            Ok(()) => self.emit_directory_changed(&root, &dest_dir).await,
            Err(err) => self.error(None, err).await,
        }
    }

    pub async fn import_external(&self, dest_dir: String, sources: Vec<String>) {
        let dest_dir = normalize_relative(dest_dir);
        let root = self.root().await;
        let result: Result<(), String> = tokio::task::spawn_blocking({
            let dest_dir = dest_dir.clone();
            let root = root.clone();
            move || {
                let dest_root = resolve_under_root(&root, &dest_dir, true)?;
                if !dest_root.is_dir() {
                    return Err("destination is not a directory".to_string());
                }
                for src_str in &sources {
                    let src = Path::new(src_str);
                    if !src.exists() {
                        return Err(format!("source does not exist: {src_str}"));
                    }
                    let name = src
                        .file_name()
                        .ok_or_else(|| format!("cannot determine filename for: {src_str}"))?;
                    let requested = dest_root.join(name);
                    let final_dest = if requested.exists() {
                        next_copy_destination(&requested)?
                    } else {
                        requested
                    };
                    copy_recursive(src, &final_dest)?;
                }
                Ok(())
            }
        })
        .await
        .map_err(|e| e.to_string())
        .and_then(|r| r);

        match result {
            Ok(()) => self.emit_directory_changed(&root, &dest_dir).await,
            Err(err) => self.error(None, err).await,
        }
    }

    pub async fn read_text_file(&self, request_id: String, relative_path: String) {
        let relative_path = normalize_relative(relative_path);
        let root = self.root().await;
        let result: Result<Option<String>, String> = tokio::task::spawn_blocking({
            let rel = relative_path.clone();
            let root = root.clone();
            move || {
                let path = match resolve_under_root(&root, &rel, true) {
                    Ok(p) => p,
                    Err(_) => return Ok(None),
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
                self.emitter
                    .file_tree_file_read(request_id, relative_path, contents)
                    .await;
            }
            Err(err) => self.error(Some(request_id), err).await,
        }
    }

    pub async fn write_text_file(
        &self,
        request_id: String,
        relative_path: String,
        contents: String,
    ) {
        let relative_path = normalize_relative(relative_path);
        if relative_path.is_empty() {
            self.error(Some(request_id), "cannot write workspace root")
                .await;
            return;
        }
        let root = self.root().await;
        let outcome: Result<bool, String> = tokio::task::spawn_blocking({
            let rel = relative_path.clone();
            let root = root.clone();
            move || {
                if contents.as_bytes().len() as u64 > MAX_TEXT_FILE_BYTES {
                    return Err("content is too large to save".to_string());
                }
                let path = resolve_under_root(&root, &rel, false)?;
                let existed = path.is_file();
                if let Some(parent) = path.parent() {
                    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                }
                std::fs::write(&path, contents).map_err(|e| e.to_string())?;
                Ok(existed)
            }
        })
        .await
        .map_err(|e| e.to_string())
        .and_then(|r| r);

        match outcome {
            Ok(existed) => {
                self.emitter
                    .file_tree_file_written(request_id, relative_path.clone())
                    .await;
                if !existed {
                    let parent = parent_of(&relative_path);
                    self.emit_directory_changed(&root, &parent).await;
                }
            }
            Err(err) => self.error(Some(request_id), err).await,
        }
    }

    // ---- internal helpers ------------------------------------------------

    async fn root(&self) -> PathBuf {
        self.inner.lock().await.root.clone()
    }

    /// Drop `path` and any descendants from the expansion set after a
    /// destructive change so stale entries don't linger for the watcher.
    async fn drop_descendants(&self, path: &str) {
        if path.is_empty() {
            return;
        }
        let prefix = format!("{path}/");
        let mut inner = self.inner.lock().await;
        inner
            .expanded
            .retain(|p| p != path && !p.starts_with(&prefix));
    }

    async fn emit_directory_changed(&self, root: &Path, relative: &str) {
        let entries = list_directory(root, relative).await.unwrap_or_default();
        self.emitter
            .file_tree_directory_changed(relative.to_string(), entries)
            .await;
    }

    async fn error(&self, request_id: Option<String>, message: impl Into<String>) {
        let message = message.into();
        tracing::warn!(runtime_id = %self.runtime_id, ?request_id, %message, "file tree error");
        self.emitter.file_tree_error(request_id, message).await;
    }
}

// ---------------------------------------------------------------------------
// Pure helpers (no service state).
// ---------------------------------------------------------------------------

fn normalize_relative(input: String) -> String {
    // Strip only TRAILING separators; the leading `/` on absolute paths must
    // be preserved so `resolve_under_root`'s `is_absolute()` check fires.
    let trimmed = input
        .trim()
        .trim_end_matches(|c: char| c == '/' || c == '\\');
    trimmed.replace('\\', "/")
}

fn parent_of(relative: &str) -> String {
    match relative.rsplit_once('/') {
        Some((parent, _)) => parent.to_string(),
        None => String::new(),
    }
}

fn resolve_under_root(root: &Path, relative: &str, must_exist: bool) -> Result<PathBuf, String> {
    if Path::new(relative).is_absolute() {
        return Err("absolute paths are not allowed".to_string());
    }
    // Eagerly reject `..` components before joining so that traversal attempts
    // fail even when the target path does not exist and canonicalize() would
    // error out before we reach the starts_with(root) check.
    for component in Path::new(relative).components() {
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

/// Build a full-tree snapshot by recursively scanning every non-ignored,
/// non-`.git` directory under `root`.  The `expanded` set is persisted in the
/// snapshot's `expanded_paths` field for the renderer to restore UI state, but
/// it does NOT gate which directories appear in `directories`.
async fn compute_snapshot(root: &Path, expanded: &BTreeSet<String>) -> FileTreeSnapshot {
    let root_clone = root.to_path_buf();
    let directories = tokio::task::spawn_blocking(move || {
        list_directory_tree_blocking(&root_clone)
    })
    .await
    .unwrap_or_default();

    let mut expanded_paths: Vec<String> =
        expanded.iter().filter(|p| !p.is_empty()).cloned().collect();
    expanded_paths.sort();

    FileTreeSnapshot {
        root_path: root.to_string_lossy().into_owned(),
        directories,
        expanded_paths,
    }
}

/// Build a complete directory map from `root` by walking the entire
/// filesystem.  Every entry is included.  Gitignored entries are marked
/// with `is_ignored = true` so the frontend can dim them.  `.git` is
/// always excluded.
///
/// Uses a single `std::fs` recursive walk for the full listing, plus an
/// `ignore`-crate walk to build the set of non-ignored paths.
fn list_directory_tree_blocking(root: &Path) -> BTreeMap<String, Vec<FileTreeEntry>> {
    use ignore::WalkBuilder;
    use std::collections::HashSet;

    // First, collect the set of non-ignored paths so we can mark the rest.
    let mut non_ignored: HashSet<String> = HashSet::new();
    let walker = WalkBuilder::new(root)
        .hidden(false)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .ignore(true)
        .parents(true)
        .filter_entry(|e| e.file_name() != std::ffi::OsStr::new(".git"))
        .build();
    for item in walker.into_iter().filter_map(|e| e.ok()) {
        if item.depth() == 0 { continue; }
        if let Ok(rel) = item.path().strip_prefix(root) {
            non_ignored.insert(rel.to_string_lossy().replace('\\', "/"));
        }
    }

    // Now walk the entire filesystem tree with std::fs.
    let mut result: BTreeMap<String, Vec<FileTreeEntry>> = BTreeMap::new();
    result.insert(String::new(), Vec::new());

    let mut stack: Vec<String> = vec![String::new()];
    while let Some(dir_rel) = stack.pop() {
        let abs_dir = if dir_rel.is_empty() {
            root.to_path_buf()
        } else {
            root.join(&dir_rel)
        };
        let read = match std::fs::read_dir(&abs_dir) {
            Ok(r) => r,
            Err(_) => continue,
        };
        for fs_entry in read.filter_map(|e| e.ok()) {
            let name = fs_entry.file_name().to_string_lossy().into_owned();
            if name == ".git" { continue; }
            let child_rel = if dir_rel.is_empty() {
                name.clone()
            } else {
                format!("{dir_rel}/{name}")
            };
            let kind = match fs_entry.file_type() {
                Ok(k) => k,
                Err(_) => continue,
            };
            let is_dir = kind.is_dir();
            let is_ignored = !non_ignored.contains(&child_rel);

            result
                .entry(dir_rel.clone())
                .or_default()
                .push(FileTreeEntry {
                    path: child_rel.clone(),
                    name,
                    is_directory: is_dir,
                    is_ignored,
                });

            if is_dir {
                result.entry(child_rel.clone()).or_default();
                stack.push(child_rel);
            }
        }
    }

    // Sort every listing: directories first, then case-insensitive by name.
    for entries in result.values_mut() {
        entries.sort_by(|a, b| match (a.is_directory, b.is_directory) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        });
    }

    result
}

async fn list_directory(root: &Path, relative: &str) -> Option<Vec<FileTreeEntry>> {
    let root = root.to_path_buf();
    let relative = relative.to_string();
    tokio::task::spawn_blocking(move || list_directory_blocking(&root, &relative))
        .await
        .ok()
        .and_then(Result::ok)
}

fn list_directory_blocking(root: &Path, relative: &str) -> Result<Vec<FileTreeEntry>, String> {
    use ignore::WalkBuilder;
    use std::collections::HashSet;

    let dir = resolve_under_root(root, relative, true)?;
    if !dir.is_dir() {
        return Err("not a directory".to_string());
    }

    // Collect non-ignored children via a depth-1 gitignore-aware walk.
    let mut non_ignored: HashSet<String> = HashSet::new();
    let walker = WalkBuilder::new(root)
        .hidden(false)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .ignore(true)
        .parents(true)
        .max_depth(Some(if relative.is_empty() { 1 } else { relative.matches('/').count() + 2 }))
        .filter_entry(|e| e.file_name() != std::ffi::OsStr::new(".git"))
        .build();
    for item in walker.into_iter().filter_map(|e| e.ok()) {
        if item.depth() == 0 { continue; }
        if let Ok(rel) = item.path().strip_prefix(root) {
            let rel_str = rel.to_string_lossy().replace('\\', "/");
            let parent = parent_of(&rel_str);
            if parent == relative {
                non_ignored.insert(rel_str);
            }
        }
    }

    // List all filesystem children, marking those not in non_ignored as ignored.
    let mut entries: Vec<FileTreeEntry> = std::fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name == ".git" {
                return None;
            }
            let kind = entry.file_type().ok()?;
            let child = dir.join(&name);
            let path = child
                .strip_prefix(root)
                .ok()?
                .to_string_lossy()
                .replace('\\', "/");
            let is_ignored = !non_ignored.contains(&path);
            Some(FileTreeEntry {
                is_ignored,
                path,
                name,
                is_directory: kind.is_dir(),
            })
        })
        .collect();

    entries.sort_by(|a, b| match (a.is_directory, b.is_directory) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(entries)
}

fn copy_recursive(src: &Path, dest: &Path) -> Result<(), String> {
    if src.is_dir() {
        std::fs::create_dir_all(dest)
            .map_err(|e| format!("create directory '{}': {e}", dest.display()))?;
        for entry in std::fs::read_dir(src).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            copy_recursive(&entry.path(), &dest.join(entry.file_name()))?;
        }
        Ok(())
    } else {
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::copy(src, dest)
            .map(|_| ())
            .map_err(|e| format!("copy '{}': {e}", src.display()))
    }
}

fn next_copy_destination(dest: &Path) -> Result<PathBuf, String> {
    for index in 1usize.. {
        let candidate = copy_name_destination(dest, index)?;
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    unreachable!("copy index exhausted")
}

fn copy_name_destination(dest: &Path, index: usize) -> Result<PathBuf, String> {
    let parent = dest
        .parent()
        .ok_or_else(|| format!("cannot determine parent for '{}'", dest.display()))?;
    let file_name = dest
        .file_name()
        .ok_or_else(|| format!("cannot determine filename for '{}'", dest.display()))?
        .to_string_lossy();
    let suffix = if index == 1 {
        " copy".to_string()
    } else {
        format!(" copy {index}")
    };
    let candidate_name = if dest.is_dir() || dest.extension().is_none() {
        format!("{file_name}{suffix}")
    } else {
        let stem = dest
            .file_stem()
            .ok_or_else(|| format!("cannot determine file stem for '{}'", dest.display()))?
            .to_string_lossy();
        let extension = dest
            .extension()
            .ok_or_else(|| format!("cannot determine extension for '{}'", dest.display()))?
            .to_string_lossy();
        format!("{stem}{suffix}.{extension}")
    };
    Ok(parent.join(candidate_name))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime::types::{
        DetectedPort, FileTreeEntry, FileTreeSnapshot, SessionState, SlotState,
    };
    use async_trait::async_trait;
    use bytes::Bytes;
    use std::sync::Mutex as StdMutex;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[derive(Default)]
    struct Captured {
        snapshots: Vec<FileTreeSnapshot>,
        directory_changes: Vec<(String, Vec<FileTreeEntry>)>,
        file_reads: Vec<(String, String, Option<String>)>,
        errors: Vec<(Option<String>, String)>,
    }

    #[derive(Clone, Default)]
    struct CapturingEmitter(Arc<StdMutex<Captured>>);

    #[async_trait]
    impl ScopeEmitter for CapturingEmitter {
        async fn session_state_changed(&self, _: SessionState) {}
        async fn output_chunk(&self, _: &str, _: Bytes) {}
        async fn ports_changed(&self, _: Vec<DetectedPort>) {}
        async fn slot_snapshot(&self, _: Vec<SlotState>) {}
        async fn session_snapshot(&self, _: Vec<SessionState>) {}
        async fn file_tree_snapshot(&self, snapshot: FileTreeSnapshot) {
            self.0.lock().unwrap().snapshots.push(snapshot);
        }
        async fn file_tree_directory_changed(&self, path: String, entries: Vec<FileTreeEntry>) {
            self.0
                .lock()
                .unwrap()
                .directory_changes
                .push((path, entries));
        }
        async fn file_tree_file_read(
            &self,
            request_id: String,
            relative_path: String,
            contents: Option<String>,
        ) {
            self.0
                .lock()
                .unwrap()
                .file_reads
                .push((request_id, relative_path, contents));
        }
        async fn file_tree_file_written(&self, _: String, _: String) {}
        async fn file_tree_error(&self, request_id: Option<String>, message: String) {
            self.0.lock().unwrap().errors.push((request_id, message));
        }
    }

    fn temp_workspace(prefix: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let workspace = std::env::temp_dir().join(format!("pandora-ft-{prefix}-{nanos}"));
        std::fs::create_dir_all(&workspace).unwrap();
        workspace
    }

    fn service(prefix: &str) -> (FileTreeService, CapturingEmitter, PathBuf) {
        let workspace = temp_workspace(prefix);
        let emitter = CapturingEmitter::default();
        let arc: Arc<dyn ScopeEmitter> = Arc::new(emitter.clone());
        let svc = FileTreeService::open(format!("rt-{prefix}"), workspace.to_str().unwrap(), arc)
            .unwrap();
        (svc, emitter, workspace)
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn subscribe_emits_root_listing() {
        let (svc, emitter, workspace) = service("subscribe");
        std::fs::write(workspace.join("alpha.txt"), "a").unwrap();
        std::fs::create_dir(workspace.join("zed")).unwrap();

        svc.subscribe(vec![]).await;
        let snap = emitter.0.lock().unwrap().snapshots.last().cloned().unwrap();
        let root = snap.directories.get("").expect("root listing");
        assert_eq!(
            root.iter().map(|e| &e.name).collect::<Vec<_>>(),
            vec!["zed", "alpha.txt"]
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn create_file_emits_directory_changed_for_parent() {
        let (svc, emitter, _workspace) = service("create");
        svc.subscribe(vec![]).await;
        emitter.0.lock().unwrap().directory_changes.clear();

        svc.create_file("".into(), "hello.txt".into(), "hi".into())
            .await;

        let changes = emitter.0.lock().unwrap().directory_changes.clone();
        assert_eq!(changes.len(), 1);
        let (path, entries) = &changes[0];
        assert_eq!(path, "");
        assert!(entries.iter().any(|e| e.name == "hello.txt"));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn rename_emits_change_for_parent() {
        let (svc, emitter, workspace) = service("rename");
        std::fs::create_dir(workspace.join("nested")).unwrap();
        std::fs::write(workspace.join("nested/a.txt"), "a").unwrap();
        svc.subscribe(vec!["nested".into()]).await;
        emitter.0.lock().unwrap().directory_changes.clear();

        svc.rename("nested/a.txt".into(), "b.txt".into()).await;
        let changes = emitter.0.lock().unwrap().directory_changes.clone();
        assert!(changes.iter().any(|(p, _)| p == "nested"));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn delete_drops_expanded_descendants() {
        let (svc, _emitter, workspace) = service("delete");
        std::fs::create_dir_all(workspace.join("a/b")).unwrap();
        svc.subscribe(vec!["a".into(), "a/b".into()]).await;

        svc.delete("a".into()).await;
        // After delete the persisted set should not contain "a" or "a/b".
        let inner = svc.inner.lock().await;
        assert!(!inner.expanded.contains("a"));
        assert!(!inner.expanded.contains("a/b"));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn read_text_file_returns_none_for_missing_path() {
        let (svc, emitter, _workspace) = service("read-missing");
        svc.read_text_file("req-1".into(), "missing.txt".into())
            .await;
        let reads = emitter.0.lock().unwrap().file_reads.clone();
        assert_eq!(reads.len(), 1);
        assert_eq!(reads[0].0, "req-1");
        assert!(reads[0].2.is_none());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn path_traversal_is_rejected() {
        let (svc, emitter, _workspace) = service("traversal");
        svc.create_directory("../escape".into()).await;
        let errors = emitter.0.lock().unwrap().errors.clone();
        assert!(!errors.is_empty());
    }

    // ---- gitignore-aware snapshot tests ------------------------------------

    /// Directories excluded by .gitignore must not appear in the snapshot at
    /// all — neither as entries in the root listing nor as their own keys.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn gitignore_excluded_dir_absent_from_snapshot() {
        let (svc, emitter, workspace) = service("gi-excl");
        // A bare .git/ dir makes the ignore crate treat this as a git repo
        // so that .gitignore rules are loaded.
        std::fs::create_dir(workspace.join(".git")).unwrap();
        std::fs::write(workspace.join(".gitignore"), "generated/\n").unwrap();
        std::fs::create_dir(workspace.join("generated")).unwrap();
        std::fs::write(workspace.join("generated/out.js"), "").unwrap();
        std::fs::create_dir(workspace.join("src")).unwrap();
        std::fs::write(workspace.join("src/main.rs"), "").unwrap();

        svc.subscribe(vec![]).await;
        let snap = emitter.0.lock().unwrap().snapshots.last().cloned().unwrap();

        // src must be traversed.
        assert!(snap.directories.contains_key("src"), "src must be traversed");

        // generated must be absent from both root listing and directories map.
        let root_names: Vec<&str> = snap.directories[""]
            .iter()
            .map(|e| e.name.as_str())
            .collect();
        assert!(
            !root_names.contains(&"generated"),
            "generated must not appear in root listing"
        );
        assert!(
            !snap.directories.contains_key("generated"),
            "generated must not be a directories key"
        );
    }

    /// Normal (non-ignored) directories and their contents must be present.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn normal_dir_traversed_in_snapshot() {
        let (svc, emitter, workspace) = service("normal-dir");
        std::fs::create_dir(workspace.join("lib")).unwrap();
        std::fs::write(workspace.join("lib/utils.rs"), "").unwrap();
        std::fs::write(workspace.join("README.md"), "").unwrap();

        svc.subscribe(vec![]).await;
        let snap = emitter.0.lock().unwrap().snapshots.last().cloned().unwrap();

        assert!(snap.directories.contains_key("lib"), "lib must be in snapshot");
        assert!(
            snap.directories["lib"].iter().any(|e| e.name == "utils.rs"),
            "lib/utils.rs must be visible"
        );
        let root_names: Vec<&str> = snap.directories[""]
            .iter()
            .map(|e| e.name.as_str())
            .collect();
        assert!(
            root_names.contains(&"README.md"),
            "README.md must be in root listing"
        );
    }

    /// .git must never appear as an entry or have its contents traversed.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn git_dir_excluded_from_snapshot() {
        let (svc, emitter, workspace) = service("git-excl");
        std::fs::create_dir(workspace.join(".git")).unwrap();
        std::fs::write(workspace.join(".git/HEAD"), "ref: refs/heads/main\n").unwrap();
        std::fs::create_dir(workspace.join("src")).unwrap();
        std::fs::write(workspace.join("src/lib.rs"), "").unwrap();

        svc.subscribe(vec![]).await;
        let snap = emitter.0.lock().unwrap().snapshots.last().cloned().unwrap();

        let root_names: Vec<&str> = snap.directories[""]
            .iter()
            .map(|e| e.name.as_str())
            .collect();
        assert!(
            !root_names.contains(&".git"),
            ".git must not appear in root listing"
        );
        assert!(
            !snap.directories.contains_key(".git"),
            ".git must not be traversed"
        );
        assert!(
            snap.directories.contains_key("src"),
            "src must still be traversed"
        );
    }

    /// Dotfiles that are NOT gitignored must still appear in the tree.
    /// This confirms that `hidden(false)` is in effect and we are not
    /// accidentally hiding all files whose names start with `.`.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn non_ignored_dotfiles_visible_in_snapshot() {
        let (svc, emitter, workspace) = service("dotfiles");
        // .env is intentionally NOT listed in .gitignore.
        std::fs::write(workspace.join(".env"), "SECRET=1").unwrap();
        // .vscode/ sub-directory also not ignored.
        std::fs::create_dir(workspace.join(".vscode")).unwrap();
        std::fs::write(workspace.join(".vscode/settings.json"), "{}").unwrap();

        svc.subscribe(vec![]).await;
        let snap = emitter.0.lock().unwrap().snapshots.last().cloned().unwrap();

        let root_names: Vec<&str> = snap.directories[""]
            .iter()
            .map(|e| e.name.as_str())
            .collect();
        assert!(
            root_names.contains(&".env"),
            ".env must appear in root listing (hidden(false) is required)"
        );
        assert!(
            root_names.contains(&".vscode"),
            ".vscode must appear in root listing"
        );
        assert!(
            snap.directories.contains_key(".vscode"),
            ".vscode must be traversed"
        );
        assert!(
            snap.directories[".vscode"]
                .iter()
                .any(|e| e.name == "settings.json"),
            ".vscode/settings.json must be visible"
        );
    }
}
