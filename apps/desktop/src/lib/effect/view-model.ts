import type {
  ProjectRecord,
  WorkspaceRecord,
  WorkspaceRuntimeState,
} from "@/lib/shared/types";
import type { NavigationArea, WorkspaceStoreState } from "@/stores/workspace-store";

export interface UiPreferencesViewModel {
  readonly sidebarVisible: boolean;
  readonly sidebarHydrated: boolean;
  readonly fileTreeOpen: boolean;
  readonly fileTreeHydrated: boolean;
  readonly fileTreeWorkspaceId: string | null;
}

export interface AppViewModel {
  readonly projects: readonly ProjectRecord[];
  readonly workspaces: readonly WorkspaceRecord[];
  readonly selectedProjectID: string | null;
  readonly selectedWorkspaceID: string | null;
  readonly selectedProject: ProjectRecord | null;
  readonly selectedWorkspace: WorkspaceRecord | null;
  readonly runtimes: Readonly<Record<string, WorkspaceRuntimeState>>;
  readonly activeRuntime: WorkspaceRuntimeState | null;
  readonly connectionState: WorkspaceRuntimeState["connectionState"];
  readonly navigationArea: NavigationArea;
  readonly searchText: string;
  readonly layoutTargetRuntimeId: string | null;
}

export interface WorkspaceViewModel {
  readonly workspaceId: string;
  readonly workspace: WorkspaceRecord | null;
  readonly runtime: WorkspaceRuntimeState | null;
  readonly isSelected: boolean;
}

export interface ProjectTerminalViewModel {
  readonly runtimeId: string;
  readonly runtime: WorkspaceRuntimeState | null;
}

export const emptyUiPreferencesViewModel: UiPreferencesViewModel = {
  sidebarVisible: true,
  sidebarHydrated: false,
  fileTreeOpen: false,
  fileTreeHydrated: false,
  fileTreeWorkspaceId: null,
};

export const emptyAppViewModel: AppViewModel = {
  projects: [],
  workspaces: [],
  selectedProjectID: null,
  selectedWorkspaceID: null,
  selectedProject: null,
  selectedWorkspace: null,
  runtimes: {},
  activeRuntime: null,
  connectionState: "disconnected",
  navigationArea: "sidebar",
  searchText: "",
  layoutTargetRuntimeId: null,
};

export function buildAppViewModel(state: WorkspaceStoreState): AppViewModel {
  const selectedProject = state.selectedProject();
  const selectedWorkspace = state.selectedWorkspace();
  const activeRuntime = state.activeRuntime();

  return {
    projects: state.projects,
    workspaces: state.workspaces,
    selectedProjectID: state.selectedProjectID,
    selectedWorkspaceID: state.selectedWorkspaceID,
    selectedProject,
    selectedWorkspace,
    runtimes: state.runtimes,
    activeRuntime,
    connectionState: activeRuntime?.connectionState ?? "disconnected",
    navigationArea: state.navigationArea,
    searchText: state.searchText,
    layoutTargetRuntimeId: state.layoutTargetRuntimeId,
  };
}

export function buildWorkspaceViewModel(
  appView: AppViewModel,
  workspaceId: string
): WorkspaceViewModel {
  return {
    workspaceId,
    workspace: appView.workspaces.find((workspace) => workspace.id === workspaceId) ?? null,
    runtime: appView.runtimes[workspaceId] ?? null,
    isSelected: appView.selectedWorkspaceID === workspaceId,
  };
}

export function buildProjectTerminalViewModel(
  appView: AppViewModel,
  runtimeId: string
): ProjectTerminalViewModel {
  return {
    runtimeId,
    runtime: appView.runtimes[runtimeId] ?? null,
  };
}
