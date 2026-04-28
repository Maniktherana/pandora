use crate::database::{now_iso8601, AppDatabase};
use crate::git;
use crate::models::*;
use crate::runtime_ipc::{self, RuntimeIpcState};
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
pub async fn add_project(
    db: tauri::State<'_, DbState>,
    selected_path: String,
) -> Result<ProjectRecord, String> {
    let db = db.0.clone();
    tokio::task::spawn_blocking(move || {
        let resolved = git::resolve_project(&selected_path)?;

        // Check for existing project at same path
        if let Some(mut existing) = db.project_by_display_path(&resolved.selected_path) {
            existing.is_expanded = true;
            existing.updated_at = now_iso8601();
            db.upsert_project(&existing)?;
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
        db.upsert_project(&project)?;
        Ok(project)
    })
    .await
    .map_err(|e| e.to_string())?
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
    runtime_state: tauri::State<'_, RuntimeIpcState>,
    project_id: String,
) -> Result<(), String> {
    let runtime_key = format!("project:{}", project_id);
    runtime_ipc::stop_runtime(runtime_state.inner(), &runtime_key).await;
    db.0.remove_project(&project_id)
}

// ─── Project settings commands ───

#[tauri::command]
pub fn get_project_settings(
    db: tauri::State<'_, DbState>,
    project_id: String,
) -> Option<ProjectSettingsRow> {
    db.0.load_project_settings(&project_id)
}

#[tauri::command]
pub fn save_project_settings(
    db: tauri::State<'_, DbState>,
    settings: ProjectSettingsRow,
) -> Result<(), String> {
    db.0.upsert_project_settings(&settings)
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
    branch_prefix: Option<String>,
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

    let settings = db.0.load_project_settings(&project_id);
    let optimistic = git::make_optimistic_workspace(
        &project,
        settings.as_ref(),
        &existing_workspaces,
        branch_prefix.map(|prefix| prefix.trim().trim_matches('/').to_string()),
    )?;
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
    let settings = db.0.load_project_settings(&project.id);

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
            git::retry_worktree(
                &workspace_for_retry,
                &project,
                settings.as_ref(),
                &other_workspaces,
            )
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
pub async fn rename_workspace(
    app_handle: AppHandle,
    db: tauri::State<'_, DbState>,
    runtime_state: tauri::State<'_, RuntimeIpcState>,
    workspace_id: String,
    name: String,
) -> Result<WorkspaceRecord, String> {
    let workspace =
        db.0.load_workspaces(None)
            .into_iter()
            .find(|w| w.id == workspace_id)
            .ok_or("Workspace not found")?;

    let project =
        db.0.load_projects()
            .into_iter()
            .find(|p| p.id == workspace.project_id)
            .ok_or("Project not found")?;

    let existing_workspaces: Vec<_> =
        db.0.load_workspaces(Some(&workspace.project_id))
            .into_iter()
            .filter(|entry| entry.id != workspace.id)
            .collect();
    let settings = db.0.load_project_settings(&project.id);

    if workspace.workspace_kind == WorkspaceKind::Worktree {
        runtime_ipc::stop_runtime(runtime_state.inner(), &workspace_id).await;
    }

    let renamed = tokio::task::spawn_blocking(move || {
        git::rename_workspace(
            &workspace,
            &project,
            settings.as_ref(),
            &existing_workspaces,
            &name,
        )
    })
    .await
    .map_err(|e| e.to_string())??;

    db.0.upsert_workspace(&renamed)?;
    let _ = app_handle.emit("workspace_record_changed", &renamed);
    Ok(renamed)
}

#[tauri::command]
pub async fn remove_workspace(
    db: tauri::State<'_, DbState>,
    runtime_state: tauri::State<'_, RuntimeIpcState>,
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
    runtime_ipc::stop_runtime(runtime_state.inner(), &workspace_id).await;

    if workspace.workspace_kind == WorkspaceKind::Worktree {
        if let Some(project) = project {
            let ws = workspace.clone();
            tokio::task::spawn_blocking(move || git::remove_worktree(&ws, &project))
                .await
                .map_err(|e| e.to_string())??;
        }
    }

    // Clean up runtime tables for this workspace.
    let _ = db.0.remove_runtime_data(&workspace_id);
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
    runtime_ipc::start_workspace_runtime(app, workspace_id, workspace_path, default_cwd);
}

#[tauri::command]
pub fn start_project_runtime(
    app: AppHandle,
    project_id: String,
    git_root_path: String,
    default_cwd: String,
) {
    runtime_ipc::start_project_runtime(app, project_id, git_root_path, default_cwd);
}

#[tauri::command]
pub async fn stop_project_runtime(
    runtime_state: tauri::State<'_, RuntimeIpcState>,
    project_id: String,
) -> Result<(), String> {
    let key = format!("project:{}", project_id);
    runtime_ipc::stop_runtime(runtime_state.inner(), &key).await;
    Ok(())
}

// ─── Ghostty config ───

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

#[tauri::command]
pub fn read_system_ghostty_config() -> GhosttyConfigSource {
    read_system_ghostty_config_file()
}

// ─── SCM / diff (git in workspace work tree) ───

#[tauri::command]
pub async fn scm_git_diff(
    worktree_path: String,
    relative_path: String,
    staged: bool,
) -> Result<git::ScmDiffResult, String> {
    tokio::task::spawn_blocking(move || git::git_file_diff(&worktree_path, &relative_path, staged))
        .await
        .map_err(|e| e.to_string())?
}

/// `source`: `"head"` → `HEAD:path`, `"index"` → `:path` (staged blob, stage 0).
#[tauri::command]
pub async fn scm_read_git_blob(
    worktree_path: String,
    relative_path: String,
    source: String,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        git::sanitize_repo_relative_path(&relative_path)?;
        let spec = match source.as_str() {
            "head" => format!("HEAD:{relative_path}"),
            "index" => format!(":{relative_path}"),
            _ => return Err(r#"Invalid source: use "head" or "index""#.into()),
        };
        git::git_read_blob_text(&worktree_path, &spec)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn scm_read_git_compare_blob(
    worktree_path: String,
    relative_path: String,
    target_branch: String,
    side: String,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        git::git_compare_blob_text(&worktree_path, &relative_path, &target_branch, &side)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn scm_check_runs(worktree_path: String) -> Result<Vec<crate::models::CheckRun>, String> {
    tokio::task::spawn_blocking(move || git::check_runs(&worktree_path))
        .await
        .map_err(|e| e.to_string())?
}

// ─── PR + archive commands ───

#[tauri::command]
pub async fn pr_gather_context(
    db: tauri::State<'_, DbState>,
    workspace_id: String,
    target_branch: Option<String>,
) -> Result<git::PrContext, String> {
    let workspace =
        db.0.load_workspaces(None)
            .into_iter()
            .find(|w| w.id == workspace_id)
            .ok_or("Workspace not found")?;
    let worktree_path = workspace.worktree_path;
    let target_branch = target_branch.or(workspace.target_branch);
    tokio::task::spawn_blocking(move || git::gather_pr_context(&worktree_path, target_branch))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn header_branch_context(
    db: tauri::State<'_, DbState>,
    workspace_id: String,
) -> Result<git::HeaderBranchContext, String> {
    let workspace =
        db.0.load_workspaces(None)
            .into_iter()
            .find(|w| w.id == workspace_id)
            .ok_or("Workspace not found")?;
    let target_branch = workspace.target_branch.clone();
    let owner =
        db.0.load_projects()
            .into_iter()
            .find(|p| p.id == workspace.project_id)
            .and_then(|p| p.git_remote_owner)
            .or_else(|| git::resolve_remote_owner(&workspace.worktree_path));
    let worktree_path = workspace.worktree_path;
    tokio::task::spawn_blocking(move || {
        git::gather_header_branch_context(&worktree_path, owner, target_branch)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn pr_check_status(
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
    let worktree_path = workspace.worktree_path;
    tokio::task::spawn_blocking(move || {
        if !git::gh_cli_available() {
            return Ok(None);
        }
        let info = git::gh_pr_status(&worktree_path, pr_number)?;
        Ok(Some(info))
    })
    .await
    .map_err(|e| e.to_string())?
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
pub async fn list_available_editors() -> Vec<EditorInfo> {
    let known_apps: Vec<(&str, &str, &str, &str)> = vec![
        ("finder", "Finder", "Finder", "finder"),
        ("cursor", "Cursor", "Cursor", "ide"),
        ("vscode", "VS Code", "Visual Studio Code", "ide"),
        ("xcode", "Xcode", "Xcode", "ide"),
        ("zed", "Zed", "Zed", "ide"),
        ("sublime", "Sublime Text", "Sublime Text", "ide"),
        ("ghostty", "Ghostty", "Ghostty", "terminal"),
        ("warp", "Warp", "Warp", "terminal"),
        ("terminal", "Terminal", "Terminal", "terminal"),
        ("iterm", "iTerm", "iTerm", "terminal"),
    ];

    tokio::task::spawn_blocking(move || {
        let mut available = Vec::new();
        for (id, display_name, app_name, category) in &known_apps {
            let status = std::process::Command::new("open")
                .args(["-Ra", app_name])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
            if let Ok(s) = status {
                if s.success() {
                    available.push(EditorInfo {
                        id: id.to_string(),
                        display_name: display_name.to_string(),
                        category: category.to_string(),
                    });
                }
            }
        }
        // Always include copy_path utility
        available.push(EditorInfo {
            id: "copy_path".to_string(),
            display_name: "Copy Path".to_string(),
            category: "utility".to_string(),
        });
        available
    })
    .await
    .unwrap_or_default()
}

#[tauri::command]
pub async fn open_in_app(path: String, app_id: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        if app_id == "copy_path" {
            let mut child = Command::new("pbcopy")
                .stdin(Stdio::piped())
                .spawn()
                .map_err(|e| e.to_string())?;
            if let Some(mut stdin) = child.stdin.take() {
                stdin
                    .write_all(path.as_bytes())
                    .map_err(|e| e.to_string())?;
            }
            child.wait().map_err(|e| e.to_string())?;
            return Ok(());
        }

        let app_name = match app_id.as_str() {
            "finder" => None,
            "cursor" => Some("Cursor"),
            "vscode" => Some("Visual Studio Code"),
            "xcode" => Some("Xcode"),
            "zed" => Some("Zed"),
            "sublime" => Some("Sublime Text"),
            "ghostty" => Some("Ghostty"),
            "warp" => Some("Warp"),
            "terminal" => Some("Terminal"),
            "iterm" => Some("iTerm"),
            _ => return Err(format!("Unknown app: {}", app_id)),
        };

        let mut cmd = Command::new("open");
        if let Some(name) = app_name {
            cmd.args(["-a", name, &path]);
        } else {
            // Finder: reveal in Finder. For files, use -R to highlight the file.
            // For directories, just open the directory.
            let p = std::path::Path::new(&path);
            if p.is_file() {
                cmd.args(["-R", &path]);
            } else {
                cmd.arg(&path);
            }
        }
        cmd.status().map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CanArchiveResult {
    pub can_archive: bool,
    pub message: Option<String>,
    pub has_uncommitted_changes: bool,
    pub has_untracked_files: bool,
    pub has_unpushed_commits: bool,
    pub has_remote_branch: bool,
}

#[tauri::command]
pub async fn can_archive_workspace(
    db: tauri::State<'_, DbState>,
    workspace_id: String,
    _delete_worktree: Option<bool>,
) -> Result<CanArchiveResult, String> {
    let workspaces = db.0.load_workspaces(None);
    let workspace = workspaces
        .into_iter()
        .find(|w| w.id == workspace_id)
        .ok_or("Workspace not found")?;

    let project =
        db.0.load_projects()
            .into_iter()
            .find(|p| p.id == workspace.project_id)
            .ok_or("Project not found")?;

    let safety = tokio::task::spawn_blocking(move || git::archive_safety(&workspace, &project))
        .await
        .map_err(|e| e.to_string())?;

    Ok(CanArchiveResult {
        can_archive: safety.can_archive,
        message: safety.message,
        has_uncommitted_changes: safety.has_uncommitted_changes,
        has_untracked_files: safety.has_untracked_files,
        has_unpushed_commits: safety.has_unpushed_commits,
        has_remote_branch: safety.has_remote_branch,
    })
}

#[tauri::command]
pub async fn archive_workspace(
    db: tauri::State<'_, DbState>,
    runtime_state: tauri::State<'_, RuntimeIpcState>,
    workspace_id: String,
    delete_worktree: Option<bool>,
    run_teardown: Option<bool>,
) -> Result<(), String> {
    let workspaces = db.0.load_workspaces(None);
    let workspace = workspaces
        .into_iter()
        .find(|w| w.id == workspace_id)
        .ok_or("Workspace not found")?;

    // Optimistic UI: mark as deleting so it vanishes from queries immediately.
    db.0.mark_workspace_deleting(&workspace_id)?;

    let result = archive_workspace_inner(
        &db,
        &runtime_state,
        &workspace,
        delete_worktree.unwrap_or(false),
        run_teardown.unwrap_or(true),
    )
    .await;

    match result {
        Ok(()) => {
            // Finalize: clear deleting_at and set status to archived.
            db.0.clear_workspace_deleting(&workspace_id)?;
            db.0.update_workspace_status(&workspace_id, "archived")?;
            Ok(())
        }
        Err(e) => {
            // Restore visibility on failure.
            let _ = db.0.clear_workspace_deleting(&workspace_id);
            Err(e)
        }
    }
}

async fn archive_workspace_inner(
    db: &tauri::State<'_, DbState>,
    runtime_state: &tauri::State<'_, RuntimeIpcState>,
    workspace: &WorkspaceRecord,
    delete_worktree: bool,
    run_teardown: bool,
) -> Result<(), String> {
    let projects = db.0.load_projects();
    let project = projects.into_iter().find(|p| p.id == workspace.project_id);

    if workspace.workspace_kind == WorkspaceKind::Worktree {
        if let Some(ref proj) = project {
            let safety_workspace = workspace.clone();
            let safety_project = proj.clone();
            let safety = tokio::task::spawn_blocking(move || {
                git::archive_safety(&safety_workspace, &safety_project)
            })
            .await
            .map_err(|e| e.to_string())?;
            if !safety.can_archive {
                return Err(safety
                    .message
                    .unwrap_or_else(|| "Workspace is not safe to archive.".into()));
            }
        }
    }

    // Stop runtime
    runtime_ipc::stop_runtime(runtime_state.inner(), &workspace.id).await;

    // Run teardown scripts if requested
    if run_teardown {
        if let Some(ref proj) = project {
            if let Some(settings) = db.0.load_project_settings(&proj.id) {
                let scripts: Vec<String> =
                    serde_json::from_str(&settings.teardown_scripts).unwrap_or_default();
                let env_vars: serde_json::Map<String, serde_json::Value> =
                    serde_json::from_str(&settings.env_vars).unwrap_or_default();
                let worktree_path = workspace.worktree_path.clone();
                let git_root = proj.git_root_path.clone();
                let ws_name = workspace.name.clone();
                let ws_id_clone = workspace.id.clone();
                tokio::task::spawn_blocking(move || {
                    for script in &scripts {
                        let mut cmd = Command::new("/bin/bash");
                        cmd.arg("-c")
                            .arg(script)
                            .current_dir(&worktree_path)
                            .env("PANDORA_WORKSPACE_PATH", &worktree_path)
                            .env("PANDORA_WORKSPACE_NAME", &ws_name)
                            .env("PANDORA_WORKSPACE_ID", &ws_id_clone)
                            .env("PANDORA_PROJECT_ROOT", &git_root)
                            .stdout(Stdio::null())
                            .stderr(Stdio::null());
                        for (k, v) in &env_vars {
                            if let Some(val) = v.as_str() {
                                cmd.env(k, val);
                            }
                        }
                        if let Ok(mut child) = cmd.spawn() {
                            let start = std::time::Instant::now();
                            let timeout = std::time::Duration::from_secs(30);
                            loop {
                                match child.try_wait() {
                                    Ok(Some(_)) => break,
                                    Ok(None) => {
                                        if start.elapsed() >= timeout {
                                            let _ = child.kill();
                                            let _ = child.wait();
                                            break;
                                        }
                                        std::thread::sleep(std::time::Duration::from_millis(100));
                                    }
                                    Err(_) => break,
                                }
                            }
                        }
                    }
                })
                .await
                .map_err(|e| e.to_string())?;
            }
        }
    }

    if delete_worktree && workspace.workspace_kind == WorkspaceKind::Worktree {
        if let Some(ref proj) = project {
            let ws = workspace.clone();
            let proj_clone = proj.clone();
            tokio::task::spawn_blocking(move || git::remove_worktree(&ws, &proj_clone))
                .await
                .map_err(|e| e.to_string())??;
        }
        db.0.update_worktree_deleted(&workspace.id, true)?;
    }

    Ok(())
}

#[tauri::command]
pub async fn restore_workspace(
    db: tauri::State<'_, DbState>,
    workspace_id: String,
) -> Result<(), String> {
    let workspace =
        db.0.load_workspaces(None)
            .into_iter()
            .find(|w| w.id == workspace_id)
            .ok_or("Workspace not found")?;

    let worktree_exists = std::path::Path::new(&workspace.worktree_path).exists();

    if worktree_exists {
        // Fast path: worktree still on disk
        db.0.update_workspace_status(&workspace_id, "ready")?;
        return Ok(());
    }

    if workspace.workspace_kind == WorkspaceKind::Linked {
        db.0.update_workspace_status(&workspace_id, "failed")?;
        return Err(format!(
            "Linked workspace path no longer exists: {}",
            workspace.worktree_path
        ));
    }

    // Worktree was deleted — need to recreate it
    db.0.update_workspace_status(&workspace_id, "creating")?;

    let project =
        db.0.load_projects()
            .into_iter()
            .find(|p| p.id == workspace.project_id)
            .ok_or("Project not found")?;

    let settings = db.0.load_project_settings(&project.id);

    let worktree_path = workspace.worktree_path.clone();
    let git_root = project.git_root_path.clone();
    let ws_name = workspace.name.clone();
    let ws_id_clone = workspace_id.clone();
    let db_arc = db.0.clone();
    let ws_id = workspace_id.clone();
    let workspace_for_restore = workspace.clone();
    let project_for_restore = project.clone();

    tokio::task::spawn_blocking(move || {
        match git::recreate_worktree_from_remote(&workspace_for_restore, &project_for_restore) {
            Ok(()) => {
                // Run setup scripts if auto_run_setup is enabled
                if let Some(ref s) = settings {
                    if s.auto_run_setup {
                        let scripts: Vec<String> =
                            serde_json::from_str(&s.setup_scripts).unwrap_or_default();
                        let env_vars: serde_json::Map<String, serde_json::Value> =
                            serde_json::from_str(&s.env_vars).unwrap_or_default();
                        for script in &scripts {
                            let mut cmd = Command::new("/bin/bash");
                            cmd.arg("-c")
                                .arg(script)
                                .current_dir(&worktree_path)
                                .env("PANDORA_WORKSPACE_PATH", &worktree_path)
                                .env("PANDORA_WORKSPACE_NAME", &ws_name)
                                .env("PANDORA_WORKSPACE_ID", &ws_id_clone)
                                .env("PANDORA_PROJECT_ROOT", &git_root)
                                .stdout(Stdio::null())
                                .stderr(Stdio::null());
                            for (k, v) in &env_vars {
                                if let Some(val) = v.as_str() {
                                    cmd.env(k, val);
                                }
                            }
                            if let Ok(mut child) = cmd.spawn() {
                                let start = std::time::Instant::now();
                                let timeout = std::time::Duration::from_secs(60);
                                loop {
                                    match child.try_wait() {
                                        Ok(Some(_)) => break,
                                        Ok(None) => {
                                            if start.elapsed() >= timeout {
                                                let _ = child.kill();
                                                let _ = child.wait();
                                                break;
                                            }
                                            std::thread::sleep(std::time::Duration::from_millis(
                                                100,
                                            ));
                                        }
                                        Err(_) => break,
                                    }
                                }
                            }
                        }
                    }
                }

                db_arc.update_worktree_deleted(&ws_id, false)?;
                db_arc.update_workspace_status(&ws_id, "ready")?;
                Ok(())
            }
            Err(e) => {
                let _ = db_arc.update_workspace_status(&ws_id, "failed");
                Err(e)
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
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

#[cfg(target_os = "macos")]
extern "C" {
    fn pandora_set_pasteboard_files(paths: *const *const std::ffi::c_char, count: usize);
}

/// Puts file URL(s) on the general pasteboard (Finder-style) **and** UTF-8 plain text
/// with absolute POSIX paths so apps that only read `NSPasteboardTypeString` (many agent UIs)
/// still receive full paths. Runs on the AppKit main thread.
#[tauri::command]
pub fn write_clipboard_file_paths(app: AppHandle, paths: Vec<String>) -> Result<(), String> {
    if paths.is_empty() {
        return Err("No paths provided".to_string());
    }
    for p in &paths {
        if !Path::new(p).exists() {
            return Err(format!("Path does not exist: {p}"));
        }
    }

    #[cfg(target_os = "macos")]
    {
        use std::ffi::{c_char, CString};
        use std::sync::mpsc;

        let cstrings: Vec<CString> = paths
            .into_iter()
            .map(|p| CString::new(p).map_err(|_| "Path contains an interior NUL byte".to_string()))
            .collect::<Result<_, _>>()?;

        let (tx, rx) = mpsc::channel();
        app.run_on_main_thread(move || {
            let ptrs: Vec<*const c_char> = cstrings.iter().map(|c| c.as_ptr()).collect();
            unsafe {
                pandora_set_pasteboard_files(ptrs.as_ptr(), ptrs.len());
            }
            let _ = tx.send(());
        })
        .map_err(|e| e.to_string())?;

        rx.recv()
            .map_err(|e| format!("Clipboard main-thread channel: {e}"))?;
        return Ok(());
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(())
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
