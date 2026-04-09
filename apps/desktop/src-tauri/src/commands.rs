use crate::daemon_bridge::{self, DaemonState};
use crate::database::{now_iso8601, AppDatabase};
use crate::git;
use crate::models::*;
use std::collections::HashSet;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Arc;
use tauri::AppHandle;
use tauri::Emitter;

pub struct DbState(pub Arc<AppDatabase>);

/// True when this binary was built with native libghostty (macOS Apple Silicon only).
#[tauri::command]
pub fn native_terminal_supported() -> bool {
    cfg!(all(target_os = "macos", target_arch = "aarch64"))
}

// ─── Project commands ───

#[tauri::command]
pub fn list_projects(db: tauri::State<'_, DbState>) -> Vec<ProjectRecord> {
    db.0.load_projects()
}

#[tauri::command]
pub fn add_project(
    db: tauri::State<'_, DbState>,
    selected_path: String,
) -> Result<ProjectRecord, String> {
    let resolved = git::resolve_project(&selected_path)?;

    // Check for existing project at same path
    if let Some(mut existing) = db.0.project_by_display_path(&resolved.selected_path) {
        existing.is_expanded = true;
        existing.updated_at = now_iso8601();
        db.0.upsert_project(&existing)?;
        return Ok(existing);
    }

    let now = now_iso8601();
    let project = ProjectRecord {
        id: uuid::Uuid::new_v4().to_string(),
        display_path: resolved.selected_path,
        git_root_path: resolved.git_root_path,
        git_context_subpath: resolved.git_context_subpath,
        display_name: resolved.display_name,
        git_remote_owner: resolved.git_remote_owner,
        is_expanded: true,
        created_at: now.clone(),
        updated_at: now,
    };
    db.0.upsert_project(&project)?;
    Ok(project)
}

#[tauri::command]
pub fn toggle_project(db: tauri::State<'_, DbState>, project_id: String) -> Result<(), String> {
    let projects = db.0.load_projects();
    if let Some(mut p) = projects.into_iter().find(|p| p.id == project_id) {
        p.is_expanded = !p.is_expanded;
        p.updated_at = now_iso8601();
        db.0.upsert_project(&p)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn remove_project(
    db: tauri::State<'_, DbState>,
    daemon_state: tauri::State<'_, DaemonState>,
    project_id: String,
) -> Result<(), String> {
    let runtime_key = format!("project:{}", project_id);
    daemon_bridge::stop_workspace_runtime(daemon_state.inner(), &runtime_key).await;
    db.0.remove_project(&project_id)
}

// ─── Workspace commands ───

#[tauri::command]
pub fn list_workspaces(
    db: tauri::State<'_, DbState>,
    project_id: Option<String>,
) -> Vec<WorkspaceRecord> {
    db.0.load_workspaces(project_id.as_deref())
}

/// Creates a workspace: for `worktree`, inserts an optimistic `creating` record and runs
/// `git worktree add` in a blocking task; for `linked`, persists a ready row at the project
/// git root (no new worktree).
#[tauri::command]
pub async fn create_workspace(
    app_handle: AppHandle,
    db: tauri::State<'_, DbState>,
    project_id: String,
    workspace_kind: Option<WorkspaceKind>,
) -> Result<WorkspaceRecord, String> {
    let projects = db.0.load_projects();
    let project = projects
        .into_iter()
        .find(|p| p.id == project_id)
        .ok_or("Project not found")?;

    let existing_workspaces = db.0.load_workspaces(Some(&project_id));
    let kind = workspace_kind.unwrap_or(WorkspaceKind::Worktree);

    if kind == WorkspaceKind::Linked {
        let linked = git::make_linked_workspace(&project, &existing_workspaces)?;
        db.0.upsert_workspace(&linked)?;
        return Ok(linked);
    }

    let optimistic = git::make_optimistic_workspace(&project, &existing_workspaces)?;
    db.0.upsert_workspace(&optimistic)?;

    let workspace = optimistic.clone();
    let workspace_for_create = workspace.clone();
    let workspace_for_failure = workspace.clone();
    let project_clone = project.clone();
    let db_arc = db.0.clone();
    let app_handle_clone = app_handle.clone();

    tokio::spawn(async move {
        let result = tokio::task::spawn_blocking(move || {
            git::create_worktree(&workspace_for_create, &project_clone)
        })
        .await;

        match result {
            Ok(Ok(ready)) => {
                let _ = db_arc.upsert_workspace(&ready);
                let _ = app_handle_clone.emit("workspace_record_changed", &ready);
            }
            Ok(Err(error)) => {
                let mut failed = workspace_for_failure.clone();
                failed.status = WorkspaceStatus::Failed;
                failed.failure_message = Some(error);
                failed.updated_at = now_iso8601();
                let _ = db_arc.upsert_workspace(&failed);
                let _ = app_handle_clone.emit("workspace_record_changed", &failed);
            }
            Err(error) => {
                let mut failed = workspace_for_failure;
                failed.status = WorkspaceStatus::Failed;
                failed.failure_message = Some(error.to_string());
                failed.updated_at = now_iso8601();
                let _ = db_arc.upsert_workspace(&failed);
                let _ = app_handle_clone.emit("workspace_record_changed", &failed);
            }
        }
    });

    Ok(optimistic)
}

#[tauri::command]
pub async fn retry_workspace(
    app_handle: AppHandle,
    db: tauri::State<'_, DbState>,
    workspace_id: String,
) -> Result<WorkspaceRecord, String> {
    let workspaces = db.0.load_workspaces(None);
    let workspace = workspaces
        .into_iter()
        .find(|w| w.id == workspace_id)
        .ok_or("Workspace not found")?;

    if workspace.workspace_kind == WorkspaceKind::Linked {
        return Err(
            "Linked workspaces do not use a separate worktree; retry is not applicable.".into(),
        );
    }

    let projects = db.0.load_projects();
    let project = projects
        .into_iter()
        .find(|p| p.id == workspace.project_id)
        .ok_or("Project not found")?;
    let other_workspaces: Vec<_> =
        db.0.load_workspaces(Some(&workspace.project_id))
            .into_iter()
            .filter(|entry| entry.id != workspace.id)
            .collect();

    let mut updating = workspace.clone();
    updating.status = WorkspaceStatus::Creating;
    updating.failure_message = None;
    updating.updated_at = now_iso8601();
    db.0.upsert_workspace(&updating)?;

    let db_arc = db.0.clone();
    let workspace_for_retry = workspace.clone();
    let workspace_for_failure = workspace.clone();
    let app_handle_clone = app_handle.clone();

    tokio::spawn(async move {
        let result = tokio::task::spawn_blocking(move || {
            git::retry_worktree(&workspace_for_retry, &project, &other_workspaces)
        })
        .await;

        match result {
            Ok(Ok(ready)) => {
                let _ = db_arc.upsert_workspace(&ready);
                let _ = app_handle_clone.emit("workspace_record_changed", &ready);
            }
            Ok(Err(error)) => {
                let mut failed = workspace_for_failure.clone();
                failed.status = WorkspaceStatus::Failed;
                failed.failure_message = Some(error);
                failed.updated_at = now_iso8601();
                let _ = db_arc.upsert_workspace(&failed);
                let _ = app_handle_clone.emit("workspace_record_changed", &failed);
            }
            Err(error) => {
                let mut failed = workspace_for_failure;
                failed.status = WorkspaceStatus::Failed;
                failed.failure_message = Some(error.to_string());
                failed.updated_at = now_iso8601();
                let _ = db_arc.upsert_workspace(&failed);
                let _ = app_handle_clone.emit("workspace_record_changed", &failed);
            }
        }
    });

    Ok(updating)
}

#[tauri::command]
pub async fn remove_workspace(
    db: tauri::State<'_, DbState>,
    daemon_state: tauri::State<'_, DaemonState>,
    workspace_id: String,
) -> Result<(), String> {
    let workspaces = db.0.load_workspaces(None);
    let workspace = workspaces
        .into_iter()
        .find(|w| w.id == workspace_id)
        .ok_or("Workspace not found")?;

    let projects = db.0.load_projects();
    let project = projects.into_iter().find(|p| p.id == workspace.project_id);

    // Stop runtime
    daemon_bridge::stop_workspace_runtime(daemon_state.inner(), &workspace_id).await;

    if workspace.workspace_kind == WorkspaceKind::Worktree {
        if let Some(project) = project {
            let ws = workspace.clone();
            tokio::task::spawn_blocking(move || {
                let _ = git::remove_worktree(&ws, &project);
            })
            .await
            .map_err(|e| e.to_string())?;
        }
    }

    db.0.remove_workspace(&workspace_id)?;
    Ok(())
}

#[tauri::command]
pub fn mark_workspace_opened(
    db: tauri::State<'_, DbState>,
    workspace_id: String,
) -> Result<(), String> {
    let workspaces = db.0.load_workspaces(None);
    if let Some(mut w) = workspaces.into_iter().find(|w| w.id == workspace_id) {
        w.last_opened_at = Some(now_iso8601());
        w.updated_at = now_iso8601();
        db.0.upsert_workspace(&w)?;
    }
    Ok(())
}

// ─── Selection commands ───

#[tauri::command]
pub fn load_selection(db: tauri::State<'_, DbState>) -> (Option<String>, Option<String>) {
    (
        db.0.load_selected_project_id(),
        db.0.load_selected_workspace_id(),
    )
}

#[tauri::command]
pub fn save_selection(
    db: tauri::State<'_, DbState>,
    project_id: Option<String>,
    workspace_id: Option<String>,
) {
    db.0.save_selection(project_id.as_deref(), workspace_id.as_deref());
}

#[tauri::command]
pub fn get_ui_state(db: tauri::State<'_, DbState>, key: String) -> Option<String> {
    db.0.load_ui_state(&key)
}

#[tauri::command]
pub fn set_ui_state(db: tauri::State<'_, DbState>, key: String, value: Option<String>) {
    db.0.save_ui_state(&key, value.as_deref());
}

// ─── Layout commands ───

#[tauri::command]
pub fn save_workspace_layout(
    db: tauri::State<'_, DbState>,
    workspace_id: String,
    layout: serde_json::Value,
) -> Result<(), String> {
    let payload = serde_json::to_string(&layout).map_err(|e| e.to_string())?;
    db.0.save_layout(&workspace_id, &payload)
}

#[tauri::command]
pub fn load_workspace_layout(
    db: tauri::State<'_, DbState>,
    workspace_id: String,
) -> Option<serde_json::Value> {
    let raw = db.0.load_layout(&workspace_id)?;
    serde_json::from_str(&raw).ok()
}

// ─── Workspace runtime start (called when selecting a ready workspace) ───

#[tauri::command]
pub fn start_workspace_runtime(
    app: AppHandle,
    workspace_id: String,
    workspace_path: String,
    default_cwd: String,
) {
    daemon_bridge::start_workspace_runtime(app, workspace_id, workspace_path, default_cwd);
}

#[tauri::command]
pub fn start_project_runtime(
    app: AppHandle,
    project_id: String,
    git_root_path: String,
    default_cwd: String,
) {
    daemon_bridge::start_project_runtime(app, project_id, git_root_path, default_cwd);
}

#[tauri::command]
pub async fn stop_project_runtime(
    daemon_state: tauri::State<'_, DaemonState>,
    project_id: String,
) -> Result<(), String> {
    let key = format!("project:{}", project_id);
    daemon_bridge::stop_workspace_runtime(daemon_state.inner(), &key).await;
    Ok(())
}

// ─── Workspace file tree ───

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDirEntry {
    pub name: String,
    pub is_directory: bool,
    pub is_ignored: bool,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GhosttyConfigSource {
    pub path: Option<String>,
    pub config: Option<String>,
}

fn read_system_ghostty_config_file() -> GhosttyConfigSource {
    let home = std::env::var("HOME").ok();
    let xdg = std::env::var("XDG_CONFIG_HOME").ok();
    let mut candidates = Vec::new();

    if let Some(xdg_home) = xdg {
        candidates.push(format!("{xdg_home}/ghostty/config"));
    }
    if let Some(home_dir) = &home {
        candidates.push(format!("{home_dir}/.config/ghostty/config"));
        candidates.push(format!(
            "{home_dir}/Library/Application Support/com.mitchellh.ghostty/config"
        ));
    }

    for path in candidates {
        let candidate = std::path::PathBuf::from(&path);
        if !candidate.is_file() {
            continue;
        }
        if let Ok(config) = std::fs::read_to_string(&candidate) {
            return GhosttyConfigSource {
                path: Some(candidate.to_string_lossy().into_owned()),
                config: Some(config),
            };
        }
    }

    GhosttyConfigSource {
        path: None,
        config: None,
    }
}

fn git_ignored_paths(workspace_root: &str, relative_paths: &[String]) -> HashSet<String> {
    if relative_paths.is_empty() {
        return HashSet::new();
    }

    let mut child = match Command::new("git")
        .args(["-C", workspace_root, "check-ignore", "--stdin"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        Err(_) => return HashSet::new(),
    };

    if let Some(stdin) = child.stdin.as_mut() {
        let input = relative_paths.join("\n");
        let _ = stdin.write_all(input.as_bytes());
    }

    let output = match child.wait_with_output() {
        Ok(output) => output,
        Err(_) => return HashSet::new(),
    };

    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(|line| line.trim().to_string())
        .filter(|line| !line.is_empty())
        .collect()
}

fn resolve_path_under_workspace_root(
    workspace_root: &str,
    relative_path: &str,
) -> Result<std::path::PathBuf, String> {
    resolve_workspace_path(workspace_root, relative_path, true)
}

/// Resolve a relative path under the workspace root.
/// When `must_exist` is true the full path is canonicalized (it must already
/// exist on disk).  When false only the *existing* ancestor is canonicalized
/// and the remaining tail is appended — this is needed for create operations
/// where the target does not yet exist.
fn resolve_workspace_path(
    workspace_root: &str,
    relative_path: &str,
    must_exist: bool,
) -> Result<std::path::PathBuf, String> {
    let root = Path::new(workspace_root);
    let root_abs = root
        .canonicalize()
        .map_err(|e| format!("Invalid workspace root: {e}"))?;
    let trimmed = relative_path.trim();
    let rel = trimmed.trim_start_matches(|c| c == '/' || c == '\\');
    if Path::new(rel).is_absolute() {
        return Err("Absolute paths are not allowed".to_string());
    }
    let candidate = if rel.is_empty() || rel == "." {
        root_abs.clone()
    } else {
        root_abs.join(rel)
    };
    let resolved = if must_exist {
        candidate
            .canonicalize()
            .map_err(|e| format!("Cannot read directory: {e}"))?
    } else {
        // Walk up to find the deepest existing ancestor, canonicalize that,
        // then re-append the non-existent tail.
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
            .map_err(|e| format!("Cannot resolve path: {e}"))?;
        for component in tail.into_iter().rev() {
            resolved.push(component);
        }
        resolved
    };
    if !resolved.starts_with(&root_abs) {
        return Err("Path escapes workspace root".to_string());
    }
    Ok(resolved)
}

fn list_workspace_directory_blocking(
    workspace_root: String,
    relative_path: String,
) -> Result<Vec<WorkspaceDirEntry>, String> {
    let root_abs = Path::new(&workspace_root)
        .canonicalize()
        .map_err(|e| format!("Invalid workspace root: {e}"))?;
    let dir = resolve_path_under_workspace_root(&workspace_root, &relative_path)?;
    if !dir.is_dir() {
        return Err("Not a directory".to_string());
    }

    let raw_entries: Vec<(String, bool, String)> = std::fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            let meta = e.file_type().ok()?;
            let child_path = dir.join(&name);
            let rel = child_path
                .strip_prefix(&root_abs)
                .ok()?
                .to_string_lossy()
                .replace('\\', "/");
            Some((name, meta.is_dir(), rel))
        })
        .collect();

    let rel_paths: Vec<String> = raw_entries.iter().map(|(_, _, rel)| rel.clone()).collect();
    let ignored = git_ignored_paths(&workspace_root, &rel_paths);

    let mut entries: Vec<WorkspaceDirEntry> = raw_entries
        .into_iter()
        .map(|(name, is_directory, rel)| WorkspaceDirEntry {
            name,
            is_directory,
            is_ignored: ignored.contains(&rel),
        })
        .collect();

    entries.sort_by(|a, b| match (a.is_directory, b.is_directory) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(entries)
}

#[tauri::command]
pub async fn list_workspace_directory(
    workspace_root: String,
    relative_path: String,
) -> Result<Vec<WorkspaceDirEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        list_workspace_directory_blocking(workspace_root, relative_path)
    })
    .await
    .map_err(|e| format!("Failed to list workspace directory: {e}"))?
}

#[tauri::command]
pub fn read_system_ghostty_config() -> GhosttyConfigSource {
    read_system_ghostty_config_file()
}

const MAX_TEXT_FILE_BYTES: u64 = 4 * 1024 * 1024;

#[tauri::command]
pub fn read_workspace_text_file(
    workspace_root: String,
    relative_path: String,
) -> Result<String, String> {
    let path = resolve_path_under_workspace_root(&workspace_root, &relative_path)?;
    if !path.is_file() {
        return Err("Not a file".to_string());
    }
    let len = path.metadata().map_err(|e| e.to_string())?.len();
    if len > MAX_TEXT_FILE_BYTES {
        return Err(format!(
            "File is too large for the editor (max {} MB)",
            MAX_TEXT_FILE_BYTES / (1024 * 1024)
        ));
    }
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_workspace_text_file(
    workspace_root: String,
    relative_path: String,
    contents: String,
) -> Result<(), String> {
    let path = resolve_workspace_path(&workspace_root, &relative_path, false)?;
    if contents.as_bytes().len() as u64 > MAX_TEXT_FILE_BYTES {
        return Err("Content is too large to save".to_string());
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, contents).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_workspace_directory(
    workspace_root: String,
    relative_path: String,
) -> Result<(), String> {
    let dir = resolve_workspace_path(&workspace_root, &relative_path, false)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())
}

// ─── SCM / diff (git in workspace work tree) ───

#[tauri::command]
pub fn scm_git_diff(
    worktree_path: String,
    relative_path: String,
    staged: bool,
) -> Result<git::ScmDiffResult, String> {
    git::git_file_diff(&worktree_path, &relative_path, staged)
}

/// `source`: `"head"` → `HEAD:path`, `"index"` → `:path` (staged blob, stage 0).
#[tauri::command]
pub fn scm_read_git_blob(
    worktree_path: String,
    relative_path: String,
    source: String,
) -> Result<String, String> {
    git::sanitize_repo_relative_path(&relative_path)?;
    let spec = match source.as_str() {
        "head" => format!("HEAD:{relative_path}"),
        "index" => format!(":{relative_path}"),
        _ => return Err(r#"Invalid source: use "head" or "index""#.into()),
    };
    git::git_read_blob_text(&worktree_path, &spec)
}

#[tauri::command]
pub async fn scm_status(worktree_path: String) -> Result<Vec<git::ScmStatusEntry>, String> {
    tokio::task::spawn_blocking(move || git::git_status(&worktree_path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn scm_line_stats(worktree_path: String) -> Result<git::ScmLineStats, String> {
    tokio::task::spawn_blocking(move || git::git_line_stats(&worktree_path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn scm_path_line_stats(
    worktree_path: String,
    relative_path: String,
    staged: bool,
) -> Result<git::ScmLineStats, String> {
    tokio::task::spawn_blocking(move || {
        git::git_path_line_stats(&worktree_path, &relative_path, staged)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn scm_path_line_stats_bulk(
    worktree_path: String,
    relative_paths: Vec<String>,
    staged: bool,
    untracked_paths: Vec<String>,
) -> Result<Vec<git::ScmPathLineStats>, String> {
    tokio::task::spawn_blocking(move || {
        git::git_path_line_stats_bulk(&worktree_path, &relative_paths, staged, &untracked_paths)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn scm_stage(worktree_path: String, paths: Vec<String>) -> Result<(), String> {
    git::git_add_paths(&worktree_path, &paths)
}

#[tauri::command]
pub fn scm_stage_all(worktree_path: String) -> Result<(), String> {
    git::git_add_all(&worktree_path)
}

#[tauri::command]
pub fn scm_unstage(worktree_path: String, paths: Vec<String>) -> Result<(), String> {
    git::git_restore_staged_paths(&worktree_path, &paths)
}

#[tauri::command]
pub fn scm_unstage_all(worktree_path: String) -> Result<(), String> {
    git::git_restore_staged_all(&worktree_path)
}

#[tauri::command]
pub fn scm_discard_tracked(worktree_path: String, path: String) -> Result<(), String> {
    git::git_restore_worktree_path(&worktree_path, &path)
}

#[tauri::command]
pub fn scm_discard_untracked(worktree_path: String, path: String) -> Result<(), String> {
    git::git_clean_untracked_path(&worktree_path, &path)
}

#[tauri::command]
pub fn scm_commit(worktree_path: String, message: String) -> Result<(), String> {
    git::git_commit_message(&worktree_path, &message)
}

// ─── PR + archive commands ───

#[tauri::command]
pub fn pr_gather_context(
    db: tauri::State<'_, DbState>,
    workspace_id: String,
) -> Result<git::PrContext, String> {
    let workspace =
        db.0.load_workspaces(None)
            .into_iter()
            .find(|w| w.id == workspace_id)
            .ok_or("Workspace not found")?;
    git::gather_pr_context(&workspace.worktree_path)
}

#[tauri::command]
pub fn header_branch_context(
    db: tauri::State<'_, DbState>,
    workspace_id: String,
) -> Result<git::HeaderBranchContext, String> {
    let workspace =
        db.0.load_workspaces(None)
            .into_iter()
            .find(|w| w.id == workspace_id)
            .ok_or("Workspace not found")?;
    let owner =
        db.0.load_projects()
            .into_iter()
            .find(|p| p.id == workspace.project_id)
            .and_then(|p| p.git_remote_owner)
            .or_else(|| git::resolve_remote_owner(&workspace.worktree_path));
    git::gather_header_branch_context(&workspace.worktree_path, owner)
}

#[tauri::command]
pub fn pr_check_status(
    db: tauri::State<'_, DbState>,
    workspace_id: String,
) -> Result<Option<git::GhPrInfo>, String> {
    let workspace =
        db.0.load_workspaces(None)
            .into_iter()
            .find(|w| w.id == workspace_id)
            .ok_or("Workspace not found")?;
    let pr_number = match workspace.pr_number {
        Some(n) => n,
        None => return Ok(None),
    };
    if !git::gh_cli_available() {
        return Ok(None);
    }
    let info = git::gh_pr_status(&workspace.worktree_path, pr_number)?;
    Ok(Some(info))
}

#[tauri::command]
pub fn pr_write_instruction(contents: String) -> Result<String, String> {
    let dir = PathBuf::from(git::pandora_home()).join("tmp");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("pr-instruction.md");
    std::fs::write(&path, &contents).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn pr_link(
    db: tauri::State<'_, DbState>,
    workspace_id: String,
    pr_url: String,
    pr_number: i64,
) -> Result<(), String> {
    db.0.update_workspace_pr(&workspace_id, Some(&pr_url), Some(pr_number), Some("open"))
}

#[tauri::command]
pub async fn archive_workspace(
    db: tauri::State<'_, DbState>,
    daemon_state: tauri::State<'_, DaemonState>,
    workspace_id: String,
) -> Result<(), String> {
    let workspaces = db.0.load_workspaces(None);
    let workspace = workspaces
        .into_iter()
        .find(|w| w.id == workspace_id)
        .ok_or("Workspace not found")?;

    // Stop runtime
    daemon_bridge::stop_workspace_runtime(daemon_state.inner(), &workspace_id).await;

    // Remove worktree if applicable
    if workspace.workspace_kind == WorkspaceKind::Worktree {
        let projects = db.0.load_projects();
        if let Some(project) = projects.into_iter().find(|p| p.id == workspace.project_id) {
            let ws = workspace.clone();
            tokio::task::spawn_blocking(move || {
                let _ = git::remove_worktree(&ws, &project);
            })
            .await
            .map_err(|e| e.to_string())?;
        }
    }

    // Mark as archived (keep DB record)
    db.0.update_workspace_status(&workspace_id, "archived")?;
    Ok(())
}

// ─── File import (drag-drop into workspace) ───

fn copy_path_recursive(src: &Path, dest: &Path) -> Result<(), String> {
    if src.is_dir() {
        std::fs::create_dir_all(dest)
            .map_err(|e| format!("Failed to create directory '{}': {e}", dest.display()))?;
        for entry in std::fs::read_dir(src).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            copy_path_recursive(&entry.path(), &dest.join(entry.file_name()))?;
        }
    } else {
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::copy(src, dest)
            .map(|_| ())
            .map_err(|e| format!("Failed to copy '{}': {e}", src.display()))?;
    }
    Ok(())
}

fn copy_name_destination(original_dest: &Path, copy_index: usize) -> Result<PathBuf, String> {
    let parent = original_dest
        .parent()
        .ok_or_else(|| format!("Cannot determine parent for '{}'", original_dest.display()))?;
    let file_name = original_dest.file_name().ok_or_else(|| {
        format!(
            "Cannot determine filename for '{}'",
            original_dest.display()
        )
    })?;
    let file_name = file_name.to_string_lossy();

    let suffix = if copy_index == 1 {
        " copy".to_string()
    } else {
        format!(" copy {}", copy_index)
    };

    let candidate_name = if original_dest.is_dir() || original_dest.extension().is_none() {
        format!("{file_name}{suffix}")
    } else {
        let stem = original_dest
            .file_stem()
            .ok_or_else(|| {
                format!(
                    "Cannot determine file stem for '{}'",
                    original_dest.display()
                )
            })?
            .to_string_lossy();
        let extension = original_dest
            .extension()
            .ok_or_else(|| {
                format!(
                    "Cannot determine extension for '{}'",
                    original_dest.display()
                )
            })?
            .to_string_lossy();
        format!("{stem}{suffix}.{extension}")
    };

    Ok(parent.join(candidate_name))
}

fn next_copy_destination(dest: &Path) -> Result<PathBuf, String> {
    let mut copy_index = 1;
    loop {
        let candidate = copy_name_destination(dest, copy_index)?;
        if !candidate.exists() {
            return Ok(candidate);
        }
        copy_index += 1;
    }
}

#[tauri::command]
pub fn copy_into_workspace(
    workspace_root: String,
    dest_relative_path: String,
    source_paths: Vec<String>,
) -> Result<(), String> {
    let root_abs = Path::new(&workspace_root)
        .canonicalize()
        .map_err(|e| format!("Invalid workspace root: {e}"))?;

    let dest_dir = if dest_relative_path.is_empty() || dest_relative_path == "." {
        root_abs.clone()
    } else {
        let rel = dest_relative_path.trim_start_matches(|c: char| c == '/' || c == '\\');
        let candidate = root_abs.join(rel);
        let resolved = candidate
            .canonicalize()
            .map_err(|e| format!("Invalid destination: {e}"))?;
        if !resolved.starts_with(&root_abs) {
            return Err("Destination escapes workspace root".to_string());
        }
        resolved
    };

    if !dest_dir.is_dir() {
        return Err("Destination is not a directory".to_string());
    }

    for src_str in &source_paths {
        let src = Path::new(src_str);
        if !src.exists() {
            return Err(format!("Source does not exist: {src_str}"));
        }
        let name = src
            .file_name()
            .ok_or_else(|| format!("Cannot determine filename for: {src_str}"))?;
        let requested_dest = dest_dir.join(name);
        let final_dest = if requested_dest.exists() {
            next_copy_destination(&requested_dest)?
        } else {
            requested_dest
        };
        copy_path_recursive(src, &final_dest)?;
    }

    Ok(())
}

#[tauri::command]
pub fn move_within_workspace(
    workspace_root: String,
    source_relative_path: String,
    dest_relative_path: String,
) -> Result<(), String> {
    let root_abs = Path::new(&workspace_root)
        .canonicalize()
        .map_err(|e| format!("Invalid workspace root: {e}"))?;

    let src = resolve_path_under_workspace_root(&workspace_root, &source_relative_path)?;

    let dest_dir = if dest_relative_path.is_empty() || dest_relative_path == "." {
        root_abs.clone()
    } else {
        let rel = dest_relative_path.trim_start_matches(|c: char| c == '/' || c == '\\');
        let candidate = root_abs.join(rel);
        let resolved = candidate
            .canonicalize()
            .map_err(|e| format!("Invalid destination: {e}"))?;
        if !resolved.starts_with(&root_abs) {
            return Err("Destination escapes workspace root".to_string());
        }
        resolved
    };

    if !dest_dir.is_dir() {
        return Err("Destination is not a directory".to_string());
    }

    let name = src
        .file_name()
        .ok_or_else(|| "Cannot determine filename".to_string())?;
    let dest = dest_dir.join(name);

    if dest == src {
        return Ok(());
    }

    // Try rename first (same filesystem), fall back to copy+delete
    if std::fs::rename(&src, &dest).is_err() {
        copy_path_recursive(&src, &dest)?;
        if src.is_dir() {
            std::fs::remove_dir_all(&src).map_err(|e| e.to_string())?;
        } else {
            std::fs::remove_file(&src).map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

#[tauri::command]
pub fn rename_workspace_entry(
    workspace_root: String,
    source_relative_path: String,
    new_name: String,
) -> Result<(), String> {
    let src = resolve_path_under_workspace_root(&workspace_root, &source_relative_path)?;
    let parent = src
        .parent()
        .ok_or_else(|| "Cannot determine parent directory".to_string())?;

    let trimmed = new_name.trim();
    if trimmed.is_empty() {
        return Err("New name cannot be empty".to_string());
    }
    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err("New name cannot contain path separators".to_string());
    }

    let dest = parent.join(trimmed);
    if dest == src {
        return Ok(());
    }
    if dest.exists() {
        return Err("Destination already exists".to_string());
    }

    std::fs::rename(&src, &dest).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_workspace_entry(workspace_root: String, relative_path: String) -> Result<(), String> {
    let path = resolve_path_under_workspace_root(&workspace_root, &relative_path)?;
    if path.is_dir() {
        std::fs::remove_dir_all(&path).map_err(|e| e.to_string())
    } else {
        std::fs::remove_file(&path).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn copy_within_workspace(
    workspace_root: String,
    source_relative_path: String,
    dest_relative_path: String,
) -> Result<(), String> {
    let src = resolve_path_under_workspace_root(&workspace_root, &source_relative_path)?;
    let root_abs = Path::new(&workspace_root)
        .canonicalize()
        .map_err(|e| format!("Invalid workspace root: {e}"))?;

    let dest_dir = if dest_relative_path.is_empty() || dest_relative_path == "." {
        root_abs.clone()
    } else {
        let rel = dest_relative_path.trim_start_matches(|c: char| c == '/' || c == '\\');
        let candidate = root_abs.join(rel);
        let resolved = candidate
            .canonicalize()
            .map_err(|e| format!("Invalid destination: {e}"))?;
        if !resolved.starts_with(&root_abs) {
            return Err("Destination escapes workspace root".to_string());
        }
        resolved
    };

    if !dest_dir.is_dir() {
        return Err("Destination is not a directory".to_string());
    }

    let name = src
        .file_name()
        .ok_or_else(|| "Cannot determine filename".to_string())?;
    let requested_dest = dest_dir.join(name);
    let final_dest = if requested_dest.exists() {
        next_copy_destination(&requested_dest)?
    } else {
        requested_dest
    };
    copy_path_recursive(&src, &final_dest)?;
    Ok(())
}

#[tauri::command]
pub fn read_clipboard_file_paths() -> Vec<String> {
    #[cfg(target_os = "macos")]
    {
        read_clipboard_file_paths_macos()
    }
    #[cfg(not(target_os = "macos"))]
    {
        Vec::new()
    }
}

#[cfg(target_os = "macos")]
fn read_clipboard_file_paths_macos() -> Vec<String> {
    use std::process::Command;
    // Use osascript to read file paths from clipboard — works for Finder copies
    let output = Command::new("osascript")
        .args([
            "-e",
            r#"set theFiles to {}
try
    set clipItems to the clipboard as «class furl»
    set end of theFiles to POSIX path of clipItems
on error
    try
        set clipItems to the clipboard as list
        repeat with f in clipItems
            try
                set end of theFiles to POSIX path of (f as alias)
            end try
        end repeat
    on error
        try
            set clipData to the clipboard as «class utf8»
            if clipData starts with "/" and (do shell script "test -e " & quoted form of clipData & " && echo yes || echo no") is "yes" then
                set end of theFiles to clipData
            end if
        end try
    end try
end try
set AppleScript's text item delimiters to linefeed
return theFiles as text"#,
        ])
        .output();
    match output {
        Ok(out) => {
            let text = String::from_utf8_lossy(&out.stdout);
            text.lines()
                .map(|l| l.trim().to_string())
                .filter(|l| !l.is_empty())
                .collect()
        }
        Err(_) => Vec::new(),
    }
}

// ─── Reload all data (convenience for frontend) ───

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppState {
    pub projects: Vec<ProjectRecord>,
    pub workspaces: Vec<WorkspaceRecord>,
    pub selected_project_id: Option<String>,
    pub selected_workspace_id: Option<String>,
}

#[tauri::command]
pub fn load_app_state(db: tauri::State<'_, DbState>) -> AppState {
    let projects = db.0.load_projects();
    let workspaces = db.0.load_workspaces(None);
    let selected_project_id =
        db.0.load_selected_project_id()
            .or_else(|| projects.first().map(|p| p.id.clone()));
    let selected_workspace_id = db.0.load_selected_workspace_id();

    AppState {
        projects,
        workspaces,
        selected_project_id,
        selected_workspace_id,
    }
}
