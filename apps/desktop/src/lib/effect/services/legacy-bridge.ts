import type { AppViewModel, ProjectTerminalViewModel, UiPreferencesViewModel, WorkspaceRuntimeSnapshot, WorkspaceViewModel } from "./contracts";
import type { WorkspaceStoreState } from "@/stores/workspace-store";
import type { WorkspaceRuntimeState } from "@/lib/shared/types";

export function snapshotRuntime(runtime: WorkspaceRuntimeState | undefined): WorkspaceRuntimeSnapshot | null {
  if (!runtime) return null;
  return {
    workspaceId: runtime.workspaceId,
    slots: runtime.slots,
    sessions: runtime.sessions,
    connectionState: runtime.connectionState,
    root: runtime.root,
    focusedPaneID: runtime.focusedPaneID,
    layoutLoading: runtime.layoutLoading,
    layoutLoaded: runtime.layoutLoaded,
  };
}

export function snapshotWorkspaceView(
  state: WorkspaceStoreState,
  workspaceId: string
): WorkspaceViewModel | null {
  const workspace = state.workspaces.find((item) => item.id === workspaceId);
  if (!workspace) return null;
  const runtime = state.runtimes[workspaceId] ?? null;
  return {
    workspace,
    runtime: snapshotRuntime(runtime),
    isSelected: state.selectedWorkspaceID === workspaceId,
    isActive: state.selectedWorkspaceID === workspaceId,
    hasLayout: Boolean(runtime?.root),
    layoutLoading: Boolean(runtime?.layoutLoading),
    layoutLoaded: Boolean(runtime?.layoutLoaded),
  };
}

export function snapshotAppView(
  state: WorkspaceStoreState,
  uiPreferences: UiPreferencesViewModel
): AppViewModel {
  return {
    projects: state.projects,
    workspaces: state.workspaces.flatMap((workspace) => {
      const view = snapshotWorkspaceView(state, workspace.id);
      return view ? [view] : [];
    }),
    selectedProjectId: state.selectedProjectID,
    selectedWorkspaceId: state.selectedWorkspaceID,
    navigationArea: state.navigationArea,
    searchText: state.searchText,
    layoutTargetRuntimeId: state.layoutTargetRuntimeId,
    uiPreferences,
  };
}

export function snapshotProjectTerminalView(
  state: WorkspaceStoreState,
  projectId: string,
  visible: boolean
): ProjectTerminalViewModel {
  const workspaceId = `project:${projectId}`;
  return {
    projectId,
    workspaceId,
    visible,
    runtime: snapshotRuntime(state.runtimes[workspaceId]),
  };
}
