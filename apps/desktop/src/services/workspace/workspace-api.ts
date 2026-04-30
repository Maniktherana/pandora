import { invoke } from "@tauri-apps/api/core";
import type { AppState, WorkspaceRecord, WorkspaceKind } from "@/lib/shared/types";

export function loadAppState(): Promise<AppState> {
  return invoke<AppState>("load_app_state");
}

export function saveSelection(projectId: string, workspaceId: string | null): Promise<void> {
  return invoke("save_selection", { projectId, workspaceId });
}

export function addProject(selectedPath: string): Promise<{ id: string }> {
  return invoke<{ id: string }>("add_project", { selectedPath });
}

export function toggleProject(projectId: string): Promise<void> {
  return invoke("toggle_project", { projectId });
}

export function removeProject(projectId: string): Promise<void> {
  return invoke("remove_project", { projectId });
}


export function createWorkspace(
  projectId: string,
  options?: {
    workspaceKind?: WorkspaceKind;
    branchPrefix?: string;
  },
): Promise<WorkspaceRecord> {
  return invoke<WorkspaceRecord>("create_workspace", {
    projectId,
    ...options,
  });
}

export function archiveWorkspace(
  workspaceId: string,
  deleteWorktree: boolean,
  runTeardown: boolean,
): Promise<void> {
  return invoke("archive_workspace", { workspaceId, deleteWorktree, runTeardown });
}

export function canArchiveWorkspace(
  workspaceId: string,
  deleteWorktree: boolean,
): Promise<{ canArchive: boolean; message: string | null }> {
  return invoke("can_archive_workspace", { workspaceId, deleteWorktree });
}

export function restoreWorkspace(workspaceId: string): Promise<void> {
  return invoke("restore_workspace", { workspaceId });
}

export function renameWorkspace(workspaceId: string, name: string): Promise<WorkspaceRecord> {
  return invoke<WorkspaceRecord>("rename_workspace", { workspaceId, name });
}

export function removeWorkspace(workspaceId: string): Promise<void> {
  return invoke("remove_workspace", { workspaceId });
}

export function retryWorkspace(workspaceId: string): Promise<WorkspaceRecord> {
  return invoke<WorkspaceRecord>("retry_workspace", { workspaceId });
}

export function markWorkspaceOpened(workspaceId: string): Promise<void> {
  return invoke("mark_workspace_opened", { workspaceId });
}


export function saveWorkspaceLayout(workspaceId: string, layout: unknown): Promise<void> {
  return invoke("save_workspace_layout", { workspaceId, layout });
}

export function getUiState(key: string): Promise<string | null> {
  return invoke<string | null>("get_ui_state", { key });
}

export function setUiState(key: string, value: string | null): Promise<void> {
  return invoke("set_ui_state", { key, value });
}

export function prLink(workspaceId: string, prUrl: string, prNumber: number): Promise<void> {
  return invoke("pr_link", { workspaceId, prUrl, prNumber });
}
