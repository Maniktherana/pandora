use crate::database::{now_iso8601, AppDatabase};
use crate::git;
use crate::models::*;
use crate::daemon_bridge::{self, DaemonState};
use std::sync::Arc;
use tauri::AppHandle;

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
pub fn remove_project(db: tauri::State<'_, DbState>, project_id: String) -> Result<(), String> {
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

/// Creates a workspace: inserts an optimistic `creating` record, then spawns
/// a blocking task to create the git worktree.  The frontend polls/reloads
/// to pick up the status change to `ready` or `failed`.
#[tauri::command]
pub async fn create_workspace(
    db: tauri::State<'_, DbState>,
    project_id: String,
) -> Result<WorkspaceRecord, String> {
    let projects = db.0.load_projects();
    let project = projects
        .into_iter()
        .find(|p| p.id == project_id)
        .ok_or("Project not found")?;

    let existing_count = db.0.load_workspaces(Some(&project_id)).len();
    let optimistic = git::make_optimistic_workspace(&project, existing_count);
    db.0.upsert_workspace(&optimistic)?;

    let workspace = optimistic.clone();
    let project_clone = project.clone();
    let db_arc = db.0.clone();

    tokio::task::spawn_blocking(move || {
        match git::create_worktree(&workspace, &project_clone) {
            Ok(ready) => {
                let _ = db_arc.upsert_workspace(&ready);
            }
            Err(e) => {
                let mut failed = workspace;
                failed.status = WorkspaceStatus::Failed;
                failed.failure_message = Some(e);
                failed.updated_at = now_iso8601();
                let _ = db_arc.upsert_workspace(&failed);
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?;

    // Return the final state
    let final_ws = db
        .0
        .load_workspaces(None)
        .into_iter()
        .find(|w| w.id == optimistic.id)
        .unwrap_or(optimistic);
    Ok(final_ws)
}

#[tauri::command]
pub async fn retry_workspace(
    db: tauri::State<'_, DbState>,
    workspace_id: String,
) -> Result<WorkspaceRecord, String> {
    let workspaces = db.0.load_workspaces(None);
    let workspace = workspaces
        .into_iter()
        .find(|w| w.id == workspace_id)
        .ok_or("Workspace not found")?;

    let projects = db.0.load_projects();
    let project = projects
        .into_iter()
        .find(|p| p.id == workspace.project_id)
        .ok_or("Project not found")?;

    let mut updating = workspace.clone();
    updating.status = WorkspaceStatus::Creating;
    updating.failure_message = None;
    updating.updated_at = now_iso8601();
    db.0.upsert_workspace(&updating)?;

    let db_arc = db.0.clone();
    let ws_id = workspace.id.clone();

    tokio::task::spawn_blocking(move || {
        match git::retry_worktree(&workspace, &project) {
            Ok(ready) => {
                let _ = db_arc.upsert_workspace(&ready);
            }
            Err(e) => {
                let mut failed = workspace;
                failed.status = WorkspaceStatus::Failed;
                failed.failure_message = Some(e);
                failed.updated_at = now_iso8601();
                let _ = db_arc.upsert_workspace(&failed);
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?;

    let final_ws = db
        .0
        .load_workspaces(None)
        .into_iter()
        .find(|w| w.id == ws_id)
        .unwrap_or(updating);
    Ok(final_ws)
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
    let project = projects
        .into_iter()
        .find(|p| p.id == workspace.project_id);

    // Stop runtime
    daemon_bridge::stop_workspace_runtime(daemon_state.inner(), &workspace_id).await;

    // Remove worktree
    if let Some(project) = project {
        let ws = workspace.clone();
        tokio::task::spawn_blocking(move || {
            let _ = git::remove_worktree(&ws, &project);
        })
        .await
        .map_err(|e| e.to_string())?;
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
    db.0.save_selection(
        project_id.as_deref(),
        workspace_id.as_deref(),
    );
}

// ─── Layout commands ───

#[tauri::command]
pub fn save_workspace_layout(
    db: tauri::State<'_, DbState>,
    workspace_id: String,
    layout: PersistedWorkspaceLayout,
) -> Result<(), String> {
    db.0.save_layout(&workspace_id, &layout)
}

#[tauri::command]
pub fn load_workspace_layout(
    db: tauri::State<'_, DbState>,
    workspace_id: String,
) -> Option<PersistedWorkspaceLayout> {
    db.0.load_layout(&workspace_id)
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
    let selected_project_id = db
        .0
        .load_selected_project_id()
        .or_else(|| projects.first().map(|p| p.id.clone()));
    let selected_workspace_id = db.0.load_selected_workspace_id();

    AppState {
        projects,
        workspaces,
        selected_project_id,
        selected_workspace_id,
    }
}
