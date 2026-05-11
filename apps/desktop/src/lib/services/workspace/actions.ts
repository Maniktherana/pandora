import type { DiffSource, WorkspaceKind, WorkspaceRecord } from "@/lib/shared/shared.types";
import {
  cycleWorkspaceTabs,
  openDiffTabInWorkspaceLayout,
  openReviewTabInWorkspaceLayout,
  openEditorTabInWorkspaceLayout,
} from "@/lib/services/layout/actions";
import {
  shouldAutoOpenTerminalSlot,
} from "@/lib/services/terminal/startup";
import {
  getWorkspaceSession,
  clearWorkspaceSessions,
  type WorkspaceSessionService,
} from "@/lib/services/layout/session";
import {
  markWorkspaceOpened as apiMarkWorkspaceOpened,
  saveSelection,
} from "@/lib/services/workspace/api";
import { persistWorkspaceLayout } from "@/lib/services/workspace/persistence";
import {
  createWorkspaceCrudService,
  findNearestWorkspaceInProject,
} from "@/lib/services/workspace/crud";
import { projectTerminalActions } from "@/lib/services/terminal/project";
import { useCatalogStore } from "@/lib/services/catalog/store";
import { useNavigationStore, type NavigationArea } from "@/lib/services/navigation/store";
import {
  selectWorkspaceById,
  selectWorkspaceRelative,
} from "@/lib/services/navigation/actions";
import {
  terminalStartup,
  updateWorkspaceLayout,
  mutateWorkspaceLayout,
  resetWorkspaceLayoutState,
} from "@/lib/services/workspace/startup";
import {
  startSelectedWorkspaceBackgroundStartup,
} from "@/lib/services/workspace/activate";
import { appBootstrapService } from "@/lib/services/app/bootstrap";

// ─── surface removal dep ──────────────────────────────────────────────────────

let removeWorkspaceSurfacesFn: ((workspaceId: string) => Promise<void>) | null = null;

// ─── sub-services ─────────────────────────────────────────────────────────────

const crudSvc = createWorkspaceCrudService({
  terminalStartup,
  resetWorkspaceLayoutState,
  selectWorkspaceById: async (workspaceId: string) => {
    await selectWorkspaceById(workspaceId);
    startSelectedWorkspaceBackgroundStartup(workspaceId).catch((error) =>
      console.warn("Failed to start workspace background startup:", error),
    );
  },
  startSelectedWorkspaceBackgroundStartup,
  getRemoveWorkspaceSurfaces: () => removeWorkspaceSurfacesFn,
});

// ─── public utilities ─────────────────────────────────────────────────────────

export { shouldAutoOpenTerminalSlot, findNearestWorkspaceInProject };

// ─── public API singleton ─────────────────────────────────────────────────────

export const workspaceActions = {
  init(deps: { removeWorkspaceSurfaces: (workspaceId: string) => Promise<void> }): void {
    removeWorkspaceSurfacesFn = deps.removeWorkspaceSurfaces;
    appBootstrapService.init();
  },

  loadDesktopState(): Promise<void> {
    return appBootstrapService.loadDesktopState();
  },

  reloadDesktopState(): Promise<void> {
    return appBootstrapService.reloadDesktopState();
  },

  // ── CRUD delegation ──────────────────────────────────────────────────────────

  async addProject(path: string): Promise<void> {
    return crudSvc.addProject(path);
  },

  async toggleProject(projectId: string): Promise<void> {
    return crudSvc.toggleProject(projectId);
  },

  async removeProject(projectId: string): Promise<void> {
    return crudSvc.removeProject(projectId);
  },

  async selectProject(projectId: string): Promise<void> {
    useNavigationStore.getState().selectProject(projectId);
    terminalStartup
      .refreshActiveScopeTerminalStartup({ rebuildHiddenQueues: true })
      .catch((err) => console.warn("Failed to refresh terminal startup on project select:", err));
    try {
      await saveSelection(projectId, useNavigationStore.getState().selectedWorkspaceID);
    } catch {
      // best-effort
    }
  },

  async selectWorkspace(workspaceId: string): Promise<void> {
    await selectWorkspaceById(workspaceId);
    startSelectedWorkspaceBackgroundStartup(workspaceId).catch((error) =>
      console.warn("Failed to start workspace background startup:", error),
    );
  },

  async activateSidebarSelection(): Promise<void> {
    const selectedWorkspaceID = useNavigationStore.getState().selectedWorkspaceID;
    if (!selectedWorkspaceID) return;
    await selectWorkspaceById(selectedWorkspaceID);
    startSelectedWorkspaceBackgroundStartup(selectedWorkspaceID).catch((error) =>
      console.warn("Failed to start workspace background startup:", error),
    );
    useNavigationStore.getState().setNavigationArea("workspace");
  },

  navigateSidebar(offset: number): void {
    selectWorkspaceRelative(offset, "sidebar")
      .then(() => {
        const selectedWorkspaceId = useNavigationStore.getState().selectedWorkspaceID;
        if (selectedWorkspaceId) {
          startSelectedWorkspaceBackgroundStartup(selectedWorkspaceId).catch((error) =>
            console.warn("Failed to start workspace background startup:", error),
          );
        }
      })
      .catch((err) => console.warn("Failed to navigate sidebar selection:", err));
  },

  async switchWorkspaceRelative(
    offset: number,
    navigationArea: NavigationArea = "workspace",
  ): Promise<void> {
    await selectWorkspaceRelative(offset, navigationArea);
    const selectedWorkspaceId = useNavigationStore.getState().selectedWorkspaceID;
    if (selectedWorkspaceId) {
      startSelectedWorkspaceBackgroundStartup(selectedWorkspaceId).catch((error) =>
        console.warn("Failed to start workspace background startup:", error),
      );
    }
  },

  setNavigationArea(area: NavigationArea): void {
    useNavigationStore.getState().setNavigationArea(area);
  },

  setSearchText(text: string): void {
    useNavigationStore.getState().setSearchText(text);
  },

  setLayoutTargetScopeId(scopeId: string | null): void {
    useNavigationStore.getState().setLayoutTargetScopeId(scopeId);
  },

  getEffectiveLayoutScopeId(): string | null {
    const nav = useNavigationStore.getState();
    return nav.layoutTargetScopeId ?? nav.selectedWorkspaceID;
  },

  getSelectedProjectId(): string | null {
    return useNavigationStore.getState().selectedProjectID;
  },

  getSelectedWorkspaceId(): string | null {
    return useNavigationStore.getState().selectedWorkspaceID;
  },

  getWorkspaceRecord(workspaceId: string): WorkspaceRecord | null {
    return useCatalogStore.getState().workspaces.find((w) => w.id === workspaceId) ?? null;
  },

  cycleTab(direction: -1 | 1): void {
    const scopeId = workspaceActions.getEffectiveLayoutScopeId();
    if (!scopeId) return;
    cycleWorkspaceTabs(scopeId, direction);
    terminalStartup
      .refreshScopeTerminalStartup(scopeId, { rebuildHiddenQueue: true })
      .catch((error) => console.warn("Failed to refresh scope terminal startup:", error));
  },

  addEditorTabForPath(relativePath: string): void {
    const workspaceId = useNavigationStore.getState().selectedWorkspaceID;
    if (!workspaceId) return;
    openEditorTabInWorkspaceLayout(workspaceId, relativePath);
    persistWorkspaceLayout(workspaceId).catch((error) =>
      console.warn("Failed to persist workspace layout:", error),
    );
  },

  addDiffTabForPath(relativePath: string, source: DiffSource): void {
    const workspaceId = useNavigationStore.getState().selectedWorkspaceID;
    if (!workspaceId) return;
    openDiffTabInWorkspaceLayout(workspaceId, relativePath, source);
    persistWorkspaceLayout(workspaceId).catch((error) =>
      console.warn("Failed to persist workspace layout:", error),
    );
  },

  addReviewTab(): void {
    const workspaceId = useNavigationStore.getState().selectedWorkspaceID;
    if (!workspaceId) return;
    openReviewTabInWorkspaceLayout(workspaceId);
    persistWorkspaceLayout(workspaceId).catch((error) =>
      console.warn("Failed to persist workspace layout:", error),
    );
  },

  updateWorkspacePrState(workspaceId: string, prState: string): void {
    const workspace = useCatalogStore.getState().workspaces.find((w) => w.id === workspaceId);
    if (workspace) {
      useCatalogStore.getState().patchWorkspace({
        ...workspace,
        prState: prState as WorkspaceRecord["prState"],
      });
    }
  },

  async archiveWorkspace(
    workspaceId: string,
    options?: { deleteWorktree?: boolean },
  ): Promise<void> {
    return crudSvc.archiveWorkspace(workspaceId, options);
  },

  async restoreWorkspace(workspaceId: string): Promise<void> {
    return crudSvc.restoreWorkspace(workspaceId);
  },

  // ── project terminal panel delegation ────────────────────────────────────────

  addProjectTerminalGroup: projectTerminalActions.addProjectTerminalGroup,
  splitProjectTerminalGroup: projectTerminalActions.splitProjectTerminalGroup,
  closeProjectTerminal: projectTerminalActions.closeProjectTerminal,
  selectProjectTerminalGroup: projectTerminalActions.selectProjectTerminalGroup,
  focusProjectTerminal: projectTerminalActions.focusProjectTerminal,
  setProjectTerminalPanelVisible: projectTerminalActions.setProjectTerminalPanelVisible,
  reorderProjectTerminalGroups: projectTerminalActions.reorderProjectTerminalGroups,
  reorderProjectTerminalGroupChildren: projectTerminalActions.reorderProjectTerminalGroupChildren,
  moveProjectTerminalToGroup: projectTerminalActions.moveProjectTerminalToGroup,
  moveProjectTerminalToNewGroup: projectTerminalActions.moveProjectTerminalToNewGroup,

  async createWorkspace(projectId: string, workspaceKind?: WorkspaceKind): Promise<void> {
    return crudSvc.createWorkspace(projectId, workspaceKind);
  },

  async retryWorkspace(workspaceId: string): Promise<void> {
    return crudSvc.retryWorkspace(workspaceId);
  },

  async renameWorkspace(workspaceId: string, name: string): Promise<void> {
    return crudSvc.renameWorkspace(workspaceId, name);
  },

  async removeWorkspace(workspaceId: string): Promise<void> {
    return crudSvc.removeWorkspace(workspaceId);
  },

  async markWorkspaceOpened(workspaceId: string): Promise<void> {
    await apiMarkWorkspaceOpened(workspaceId);
  },

  getWorkspaceSession(workspaceId: string): WorkspaceSessionService {
    return getWorkspaceSession(workspaceId, updateWorkspaceLayout, mutateWorkspaceLayout);
  },

  dispose(): void {
    appBootstrapService.dispose();
    clearWorkspaceSessions();
  },
};
