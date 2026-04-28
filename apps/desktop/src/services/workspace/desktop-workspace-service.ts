import { listen } from "@tauri-apps/api/event";
import type { WritableDraft } from "immer";
import type {
  DiffSource,
  SlotState,
  WorkspaceKind,
  WorkspaceRecord,
  WorkspaceRuntimeState,
} from "@/lib/shared/types";
import {
  desktopStateSnapshot,
  cloneRuntimeState,
  readSessionRuntimeState,
  writeSessionRuntimeState,
  updateDesktopState,
  scheduleDesktopPublish,
  scheduleRuntimePublish,
  patchWorkspaceRecord,
  applyAppState,
} from "@/services/workspace/desktop-view-service";
import { useRuntimeStore } from "@/services/runtime/runtime-store";
import { runtimeEventBus } from "@/services/runtime/runtime-event-queue";
import { routeRuntimeEvent } from "@/services/runtime/runtime-event-router";
import {
  cycleRuntimeTabs,
  openDiffTabInWorkspaceRuntime,
  openReviewTabInWorkspaceRuntime,
} from "@/services/workspace/workspace-layout-model";
import {
  ensureProjectTerminalPanel as ensureProjectTerminalPanelState,
  ensureRuntimeLayout as ensureRuntimeLayoutState,
} from "@/services/workspace/workspace-runtime-model";
import {
  createWorkspaceStartupController,
  syncProjectScopedRuntime,
  type WorkspaceStartupGet,
  type WorkspaceStartupSet,
  type WorkspaceStartupState,
} from "@/services/workspace/workspace-startup";
import {
  isProjectRuntimeKey,
  projectRuntimeKey,
} from "@/lib/runtime/runtime-keys";
import {
  createTerminalStartupService,
  shouldAutoOpenTerminalSlot,
} from "@/services/terminal/terminal-startup-service";
import {
  getWorkspaceSession,
  clearWorkspaceSessions,
  type WorkspaceSessionService,
} from "@/services/workspace/workspace-session-service";
import {
  loadAppState,
  saveSelection,
  markWorkspaceOpened as apiMarkWorkspaceOpened,
} from "@/services/workspace/workspace-api";
import {
  persistWorkspaceLayout,
  loadPersistedProjectTerminalPanel,
  persistProjectTerminalPanel,
} from "@/services/workspace/workspace-persistence";
import { DesktopStateLoadError } from "@/services/service-errors";
import {
  createWorkspaceSelectionService,
  findNearestWorkspaceInProject,
} from "@/services/workspace/workspace-selection-service";
import { createWorkspaceCrudService } from "@/services/workspace/workspace-crud-service";
import { createProjectTerminalService } from "@/services/workspace/project-terminal-service";
import type { NavigationArea } from "@/services/workspace/desktop-view-projections";

// ─── module-level state ───────────────────────────────────────────────────────

let unsubscribeRuntimeEvents: (() => void) | null = null;
let unlistenWorkspaceRecord: (() => void) | null = null;
let removeWorkspaceSurfacesFn: ((workspaceId: string) => Promise<void>) | null = null;

// ─── startup controller ────────────────────────────────────────────────────────

const { startWorkspaceStartup, interruptWorkspaceStartup } =
  createWorkspaceStartupController();

// ─── terminal startup ─────────────────────────────────────────────────────────

let activeTerminalStartupRefreshQueued = false;

const scheduleActiveTerminalStartupRefresh = () => {
  if (activeTerminalStartupRefreshQueued) return;
  activeTerminalStartupRefreshQueued = true;
  queueMicrotask(() => {
    activeTerminalStartupRefreshQueued = false;
    void terminalStartup
      .refreshActiveRuntimeTerminalStartup({ rebuildHiddenQueues: true })
      .catch((err) => console.warn("Failed to refresh terminal startup state:", err));
  });
};

const terminalStartup = createTerminalStartupService({
  getRuntimes: () => desktopStateSnapshot.runtimes,
  getSelectedWorkspaceId: () => desktopStateSnapshot.selectedWorkspaceID,
  getSelectedProjectId: () => desktopStateSnapshot.selectedProjectID,
  getWorkspaceRecord: (workspaceId) =>
    desktopStateSnapshot.workspaces.find((w) => w.id === workspaceId),
  mutateRuntimeState,
  scheduleTerminalStartupRefresh: scheduleActiveTerminalStartupRefresh,
});

// ─── runtime state mutation ───────────────────────────────────────────────────

function mutateRuntimeState<T>(
  workspaceId: string,
  mutate: (runtime: WritableDraft<WorkspaceRuntimeState>) => T,
): T {
  const current = readSessionRuntimeState(workspaceId);
  const previousProjectPanel = isProjectRuntimeKey(workspaceId)
    ? JSON.stringify(current.terminalPanel ?? null)
    : null;
  const runtime = cloneRuntimeState(current);
  const result = mutate(runtime as WritableDraft<WorkspaceRuntimeState>);
  writeSessionRuntimeState(workspaceId, runtime);
  if (
    isProjectRuntimeKey(workspaceId) &&
    previousProjectPanel !== JSON.stringify(runtime.terminalPanel ?? null)
  ) {
    void persistProjectTerminalPanel(workspaceId, runtime.terminalPanel);
  }
  return result;
}

function updateWorkspaceRuntime(
  workspaceId: string,
  mutate: (runtime: WritableDraft<WorkspaceRuntimeState>) => boolean | void,
) {
  const runtime = cloneRuntimeState(readSessionRuntimeState(workspaceId));
  const changed = Boolean(mutate(runtime as WritableDraft<WorkspaceRuntimeState>));
  writeSessionRuntimeState(workspaceId, runtime);
  if (changed && !isProjectRuntimeKey(workspaceId)) {
    void persistWorkspaceLayout(desktopStateSnapshot.runtimes[workspaceId], workspaceId);
  }
  void terminalStartup.refreshRuntimeTerminalStartup(workspaceId, { rebuildHiddenQueue: true });
}

function mutateAndRefreshTerminal(
  workspaceId: string,
  fn: (runtime: WritableDraft<WorkspaceRuntimeState>) => void,
): void {
  mutateRuntimeState(workspaceId, fn);
  void terminalStartup.refreshRuntimeTerminalStartup(workspaceId, { rebuildHiddenQueue: true });
}

// ─── startup get/set ──────────────────────────────────────────────────────────

const startupGet: WorkspaceStartupGet = () =>
  ({
    projects: desktopStateSnapshot.projects,
    runtimes: desktopStateSnapshot.runtimes,
    ensureRuntimeLayout: ensureRuntimeLayoutForWorkspace,
  }) satisfies WorkspaceStartupState;

const startupSet: WorkspaceStartupSet = ((update: unknown) => {
  const nextRuntimes = structuredClone(desktopStateSnapshot.runtimes);
  const nextState = {
    projects: desktopStateSnapshot.projects,
    runtimes: nextRuntimes,
    ensureRuntimeLayout: ensureRuntimeLayoutForWorkspace,
  } as WorkspaceStartupState;

  if (typeof update === "function") {
    (update as (state: WritableDraft<WorkspaceStartupState>) => void)(
      nextState as WritableDraft<WorkspaceStartupState>,
    );
  } else if (update && typeof update === "object") {
    Object.assign(nextState, update);
  }
  desktopStateSnapshot.runtimes = nextState.runtimes;
  scheduleRuntimePublish();
  scheduleActiveTerminalStartupRefresh();
}) as WorkspaceStartupSet;

function ensureRuntimeLayoutForWorkspace(workspaceId: string) {
  const current = desktopStateSnapshot.runtimes[workspaceId];
  if (!current) return;
  const runtime = cloneRuntimeState(current);
  if (isProjectRuntimeKey(workspaceId)) {
    ensureProjectTerminalPanelState(runtime);
  } else {
    ensureRuntimeLayoutState(runtime);
  }
  writeSessionRuntimeState(workspaceId, runtime);
  terminalStartup.ensureWorkspaceDefaultTerminal(workspaceId, (slotId) => {
    getWorkspaceSession(workspaceId, updateWorkspaceRuntime, mutateRuntimeState).commands.addTerminalTab(slotId);
  });
}

async function hydrateProjectRuntimePanel(runtimeId: string): Promise<void> {
  if (!isProjectRuntimeKey(runtimeId)) return;
  const runtime = desktopStateSnapshot.runtimes[runtimeId];
  if (!runtime || (runtime.terminalPanel?.groups.length ?? 0) > 0) return;
  const panel = await loadPersistedProjectTerminalPanel(runtimeId);
  if (!panel) return;
  const next = cloneRuntimeState(readSessionRuntimeState(runtimeId));
  next.terminalPanel = panel;
  writeSessionRuntimeState(runtimeId, next);
}

// ─── sub-services ─────────────────────────────────────────────────────────────

const selectionSvc = createWorkspaceSelectionService({
  terminalStartup,
  updateWorkspaceRuntime,
  startupGet,
  startupSet,
  startWorkspaceStartup,
  hydrateProjectRuntimePanel,
});

const crudSvc = createWorkspaceCrudService({
  terminalStartup,
  interruptWorkspaceStartup,
  startupSet,
  selectWorkspaceById: selectionSvc.selectWorkspaceById,
  startSelectionSettle: selectionSvc.startSelectionSettle,
  maybeStartSelectedWorkspace: selectionSvc.maybeStartSelectedWorkspace,
  getRemoveWorkspaceSurfaces: () => removeWorkspaceSurfacesFn,
});

const terminalSvc = createProjectTerminalService({ mutateAndRefreshTerminal });

// ─── runtime event subscription ───────────────────────────────────────────────

function ensureRuntimeEventSubscription() {
  if (unsubscribeRuntimeEvents) return;
  unsubscribeRuntimeEvents = runtimeEventBus.subscribe((event) => {
    if (event.runtimeId === "__settings_terminal__") return;
    try {
      const result = routeRuntimeEvent(event, {
        mutateRuntimeState,
        getSelectedWorkspaceId: () => desktopStateSnapshot.selectedWorkspaceID,
        connectionWaiters: selectionSvc.connectionWaiters,
        onConnectionStateChanged: (runtimeId, state) => {
          if (state === "connected") {
            terminalStartup.ensureWorkspaceDefaultTerminal(runtimeId, (slotId) => {
              getWorkspaceSession(runtimeId, updateWorkspaceRuntime, mutateRuntimeState).commands.addTerminalTab(slotId);
            });
          }
          void terminalStartup.refreshRuntimeTerminalStartup(runtimeId);
        },
        onSlotAdded: (runtimeId) => {
          terminalStartup.ensureWorkspaceDefaultTerminal(runtimeId, (slotId) => {
            getWorkspaceSession(runtimeId, updateWorkspaceRuntime, mutateRuntimeState).commands.addTerminalTab(slotId);
          });
          void terminalStartup.refreshRuntimeTerminalStartup(runtimeId);
        },
        getPrAwaitingWorkspaceIds: () => desktopStateSnapshot.prAwaitingWorkspaceIds,
        getWorkspaces: () => desktopStateSnapshot.workspaces,
        onPrDetected: (workspaceId, prUrl, prNumber) => {
          const next = new Set(desktopStateSnapshot.prAwaitingWorkspaceIds);
          next.delete(workspaceId);
          desktopStateSnapshot.prAwaitingWorkspaceIds = next;
          const workspace = desktopStateSnapshot.workspaces.find((w) => w.id === workspaceId);
          if (workspace) {
            workspace.prUrl = prUrl;
            workspace.prNumber = prNumber;
            workspace.prState = "open";
          }
          scheduleDesktopPublish();
        },
        scheduleDesktopPublish,
      });
      if (result instanceof Promise) {
        result.catch((err) =>
          console.error("[runtime-event] failed", { type: event.type, runtimeId: event.runtimeId, err }),
        );
      }
    } catch (error) {
      console.error("[runtime-event] failed", { type: event.type, runtimeId: event.runtimeId, error });
    }
    if (
      event.type === "slot_snapshot" ||
      event.type === "session_snapshot" ||
      event.type === "slot_state_changed" ||
      event.type === "session_state_changed" ||
      event.type === "slot_added" ||
      event.type === "slot_removed" ||
      event.type === "session_opened" ||
      event.type === "session_closed"
    ) {
      void terminalStartup.refreshRuntimeTerminalStartup(event.runtimeId);
    }
  });
}

// ─── public utilities ─────────────────────────────────────────────────────────

export { shouldAutoOpenTerminalSlot, findNearestWorkspaceInProject };

// ─── public API singleton ─────────────────────────────────────────────────────

export const desktopWorkspaceService = {
  init(deps: { removeWorkspaceSurfaces: (workspaceId: string) => Promise<void> }) {
    removeWorkspaceSurfacesFn = deps.removeWorkspaceSurfaces;
    ensureRuntimeEventSubscription();
    if (!unlistenWorkspaceRecord) {
      void listen<WorkspaceRecord>("workspace_record_changed", ({ payload }) => {
        patchWorkspaceRecord(payload);
        if (
          payload.id === desktopStateSnapshot.selectedWorkspaceID &&
          payload.status === "ready"
        ) {
          selectionSvc.startSelectionSettle(payload);
        }
      })
        .then((unlisten) => {
          unlistenWorkspaceRecord = unlisten;
        })
        .catch((cause) =>
          console.error("Failed to listen to workspace_record_changed:", cause),
        );
    }
  },

  async loadDesktopState(): Promise<void> {
    try {
      const appState = await loadAppState();
      const { allowedRuntimeIds } = applyAppState(appState);
      terminalStartup.cleanupAllowedRuntimeIds(allowedRuntimeIds);
      selectionSvc.setSelectionTarget(appState.selectedWorkspaceId);
    } catch (cause) {
      throw new DesktopStateLoadError({ cause });
    }
    const selectedWorkspaceId = desktopStateSnapshot.selectedWorkspaceID;
    if (!selectedWorkspaceId) return;
    try {
      await selectionSvc.selectWorkspaceById(selectedWorkspaceId);
    } catch (e) {
      throw new DesktopStateLoadError({ cause: e });
    }
  },

  async reloadDesktopState(): Promise<void> {
    try {
      const appState = await loadAppState();
      const { allowedRuntimeIds } = applyAppState(appState);
      terminalStartup.cleanupAllowedRuntimeIds(allowedRuntimeIds);
      selectionSvc.setSelectionTarget(appState.selectedWorkspaceId);
    } catch (cause) {
      throw new DesktopStateLoadError({ cause });
    }
    await selectionSvc.maybeStartSelectedWorkspace();
    await terminalStartup.refreshActiveRuntimeTerminalStartup({ rebuildHiddenQueues: true });
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
    updateDesktopState((state) => {
      state.selectedProjectID = projectId;
    });
    void terminalStartup.refreshActiveRuntimeTerminalStartup({ rebuildHiddenQueues: true });
    try {
      await saveSelection(projectId, desktopStateSnapshot.selectedWorkspaceID);
    } catch {
      // best-effort
    }
  },

  async selectWorkspace(workspaceId: string): Promise<void> {
    await selectionSvc.selectWorkspaceById(workspaceId);
  },

  ensureWorkspaceRuntimeConnected: selectionSvc.ensureWorkspaceRuntimeConnected,

  async activateSidebarSelection(): Promise<void> {
    if (!desktopStateSnapshot.selectedWorkspaceID) return;
    await selectionSvc.selectWorkspaceById(desktopStateSnapshot.selectedWorkspaceID);
    updateDesktopState((state) => {
      state.navigationArea = "workspace";
    });
  },

  navigateSidebar(offset: number): void {
    void selectionSvc.selectWorkspaceRelative(offset, "sidebar").catch(() => {});
  },

  async switchWorkspaceRelative(
    offset: number,
    navigationArea: NavigationArea = "workspace",
  ): Promise<void> {
    await selectionSvc.selectWorkspaceRelative(offset, navigationArea).catch(() => {});
  },

  setNavigationArea(area: NavigationArea): void {
    updateDesktopState((state) => {
      state.navigationArea = area;
    });
  },

  setSearchText(text: string): void {
    updateDesktopState((state) => {
      state.searchText = text;
    });
  },

  setLayoutTargetRuntimeId(runtimeId: string | null): void {
    updateDesktopState((state) => {
      state.layoutTargetRuntimeId = runtimeId;
    });
  },

  getEffectiveLayoutRuntimeId(): string | null {
    return (
      desktopStateSnapshot.layoutTargetRuntimeId ?? desktopStateSnapshot.selectedWorkspaceID
    );
  },

  getSelectedProjectId(): string | null {
    return desktopStateSnapshot.selectedProjectID;
  },

  getSelectedWorkspaceId(): string | null {
    return desktopStateSnapshot.selectedWorkspaceID;
  },

  getWorkspaceRecord(workspaceId: string): WorkspaceRecord | null {
    return (
      desktopStateSnapshot.workspaces.find((workspace) => workspace.id === workspaceId) ?? null
    );
  },

  getRuntimeState(workspaceId: string): WorkspaceRuntimeState | null {
    return readSessionRuntimeState(workspaceId) ?? null;
  },

  getSlotState(workspaceId: string, slotId: string): SlotState | undefined {
    return readSessionRuntimeState(workspaceId).slots.find((slot) => slot.id === slotId);
  },

  cycleTab(direction: -1 | 1): void {
    const runtimeId = desktopWorkspaceService.getEffectiveLayoutRuntimeId();
    if (!runtimeId) return;
    const runtime = desktopStateSnapshot.runtimes[runtimeId];
    if (!runtime) return;
    mutateRuntimeState(runtimeId, (current) => {
      cycleRuntimeTabs(current, direction);
    });
    void terminalStartup.refreshRuntimeTerminalStartup(runtimeId, { rebuildHiddenQueue: true });
  },

  addEditorTabForPath(relativePath: string): void {
    const workspaceId = desktopStateSnapshot.selectedWorkspaceID;
    if (!workspaceId) return;
    getWorkspaceSession(workspaceId, updateWorkspaceRuntime, mutateRuntimeState).commands.addEditorTab(relativePath);
  },

  addDiffTabForPath(relativePath: string, source: DiffSource): void {
    const workspaceId = desktopStateSnapshot.selectedWorkspaceID;
    if (!workspaceId) return;
    updateWorkspaceRuntime(workspaceId, (runtime) =>
      openDiffTabInWorkspaceRuntime(runtime, relativePath, source),
    );
  },

  addReviewTab(): void {
    const workspaceId = desktopStateSnapshot.selectedWorkspaceID;
    if (!workspaceId) return;
    updateWorkspaceRuntime(workspaceId, (runtime) =>
      openReviewTabInWorkspaceRuntime(runtime),
    );
  },

  updateWorkspacePrState(workspaceId: string, prState: string): void {
    updateDesktopState((state) => {
      const workspace = state.workspaces.find((entry) => entry.id === workspaceId);
      if (workspace) workspace.prState = prState as WorkspaceRecord["prState"];
    });
  },

  setPrAwaiting(workspaceId: string, awaiting: boolean): void {
    updateDesktopState((state) => {
      const next = new Set(state.prAwaitingWorkspaceIds);
      if (awaiting) next.add(workspaceId);
      else next.delete(workspaceId);
      state.prAwaitingWorkspaceIds = next;
    });
    if (awaiting) {
      setTimeout(() => {
        if (desktopStateSnapshot.prAwaitingWorkspaceIds.has(workspaceId)) {
          desktopStateSnapshot.prAwaitingWorkspaceIds.delete(workspaceId);
          scheduleDesktopPublish();
        }
      }, 90_000);
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

  addProjectTerminalGroup: terminalSvc.addProjectTerminalGroup.bind(terminalSvc),
  splitProjectTerminalGroup: terminalSvc.splitProjectTerminalGroup.bind(terminalSvc),
  closeProjectTerminal: terminalSvc.closeProjectTerminal.bind(terminalSvc),
  selectProjectTerminalGroup: terminalSvc.selectProjectTerminalGroup.bind(terminalSvc),
  focusProjectTerminal: terminalSvc.focusProjectTerminal.bind(terminalSvc),
  setProjectTerminalPanelVisible: terminalSvc.setProjectTerminalPanelVisible.bind(terminalSvc),
  reorderProjectTerminalGroups: terminalSvc.reorderProjectTerminalGroups.bind(terminalSvc),
  reorderProjectTerminalGroupChildren: terminalSvc.reorderProjectTerminalGroupChildren.bind(terminalSvc),
  moveProjectTerminalToGroup: terminalSvc.moveProjectTerminalToGroup.bind(terminalSvc),
  moveProjectTerminalToNewGroup: terminalSvc.moveProjectTerminalToNewGroup.bind(terminalSvc),

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
    return getWorkspaceSession(workspaceId, updateWorkspaceRuntime, mutateRuntimeState);
  },

  dispose() {
    unsubscribeRuntimeEvents?.();
    unsubscribeRuntimeEvents = null;
    unlistenWorkspaceRecord?.();
    unlistenWorkspaceRecord = null;
    clearWorkspaceSessions();
  },
};
