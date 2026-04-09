import type { ProjectRecord, WorkspaceRecord, WorkspaceRuntimeState } from "@/lib/shared/types";

export type NavigationArea = "sidebar" | "workspace";

export interface UiPreferencesView {
  readonly sidebarVisible: boolean;
  readonly sidebarHydrated: boolean;
  readonly fileTreeOpen: boolean;
  readonly fileTreeHydrated: boolean;
  readonly fileTreeWorkspaceId: string | null;
}

export interface DesktopView {
  readonly projects: readonly ProjectRecord[];
  readonly workspaces: readonly WorkspaceRecord[];
  readonly selectedProjectID: string | null;
  readonly selectedWorkspaceID: string | null;
  readonly selectedProject: ProjectRecord | null;
  readonly selectedWorkspace: WorkspaceRecord | null;
  readonly navigationArea: NavigationArea;
  readonly searchText: string;
  readonly layoutTargetRuntimeId: string | null;
}

export interface WorkspaceView {
  readonly workspaceId: string;
  readonly workspace: WorkspaceRecord | null;
  readonly isSelected: boolean;
}

export type RuntimeStateView = Readonly<Record<string, WorkspaceRuntimeState>>;

export interface DesktopViewStateSnapshot {
  readonly projects: readonly ProjectRecord[];
  readonly workspaces: readonly WorkspaceRecord[];
  readonly selectedProjectID: string | null;
  readonly selectedWorkspaceID: string | null;
  readonly navigationArea: NavigationArea;
  readonly searchText: string;
  readonly layoutTargetRuntimeId: string | null;
}

export const emptyUiPreferencesView: UiPreferencesView = {
  sidebarVisible: true,
  sidebarHydrated: false,
  fileTreeOpen: false,
  fileTreeHydrated: false,
  fileTreeWorkspaceId: null,
};

export const emptyDesktopView: DesktopView = {
  projects: [],
  workspaces: [],
  selectedProjectID: null,
  selectedWorkspaceID: null,
  selectedProject: null,
  selectedWorkspace: null,
  navigationArea: "sidebar",
  searchText: "",
  layoutTargetRuntimeId: null,
};

export const emptyRuntimeStateView: RuntimeStateView = {};

export function buildDesktopView(state: DesktopViewStateSnapshot): DesktopView {
  const selectedProject =
    state.projects.find((project) => project.id === state.selectedProjectID) ?? null;
  const selectedWorkspace =
    state.workspaces.find((workspace) => workspace.id === state.selectedWorkspaceID) ?? null;

  return {
    projects: state.projects,
    workspaces: state.workspaces,
    selectedProjectID: state.selectedProjectID,
    selectedWorkspaceID: state.selectedWorkspaceID,
    selectedProject,
    selectedWorkspace,
    navigationArea: state.navigationArea,
    searchText: state.searchText,
    layoutTargetRuntimeId: state.layoutTargetRuntimeId,
  };
}

export function buildWorkspaceView(desktopView: DesktopView, workspaceId: string): WorkspaceView {
  return {
    workspaceId,
    workspace: desktopView.workspaces.find((workspace) => workspace.id === workspaceId) ?? null,
    isSelected: desktopView.selectedWorkspaceID === workspaceId,
  };
}
