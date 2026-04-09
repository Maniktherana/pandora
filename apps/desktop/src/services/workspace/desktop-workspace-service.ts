import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Cache, Context, Effect, Fiber, Layer } from "effect";
import type { WritableDraft } from "immer";
import type {
  AppState,
  DiffSource,
  ProjectRecord,
  TerminalPanelState,
  WorkspaceKind,
  WorkspaceRecord,
  LayoutNode,
  SlotState,
  WorkspaceRuntimeState,
} from "@/lib/shared/types";
import { useDesktopViewStore } from "@/state/desktop-view-store";
import { useRuntimeStore } from "@/state/runtime-store";
import { buildDesktopView, type DesktopViewStateSnapshot } from "@/state/desktop-view-projections";
import { DesktopStateLoadError, WorkspaceSelectionError } from "@/services/service-errors";
import { DaemonEventQueue } from "@/services/daemon/daemon-event-queue";
import { DaemonGateway } from "@/services/daemon/daemon-gateway";
import {
  addDiffTabToWorkspaceRuntime,
  addEditorTabToWorkspaceRuntime,
  addEditorTabToPaneInWorkspaceRuntime,
  addTerminalTabToWorkspaceRuntime,
  splitPaneWithEditorInWorkspaceRuntime,
} from "@/state/workspaces/workspace-layout-state";
import {
  addTabToPaneInWorkspaceRuntime,
  cycleRuntimeTabs,
  moveTabInWorkspaceRuntime,
  openDiffTabInWorkspaceRuntime,
  openReviewTabInWorkspaceRuntime,
  removeTabFromWorkspaceRuntime,
  reorderTabInWorkspaceRuntime,
  selectTabInPaneInWorkspaceRuntime,
  setFocusedPaneInWorkspaceRuntime,
  splitPaneInWorkspaceRuntime,
} from "@/state/workspaces/layout-state";
import {
  sanitizeWorkspaceTerminalLayout,
  addRuntimeSession as addRuntimeSessionState,
  addRuntimeSlot as addRuntimeSlotState,
  createWorkspaceRuntimeState as createRuntimeState,
  ensureProjectTerminalPanel as ensureProjectTerminalPanelState,
  ensureRuntimeLayout as ensureRuntimeLayoutState,
  removeRuntimeSession as removeRuntimeSessionState,
  removeRuntimeSlot as removeRuntimeSlotState,
  replaceRuntimeSessions,
  replaceRuntimeSlots,
  setRuntimeConnectionState as setRuntimeConnectionStateState,
  updateRuntimeSession as updateRuntimeSessionState,
  updateRuntimeSlot as updateRuntimeSlotState,
} from "@/state/workspaces/runtime-state";
import {
  addProjectTerminalGroupInRuntime,
  closeProjectTerminalInRuntime,
  focusProjectTerminalInRuntime,
  moveProjectTerminalToGroupInRuntime,
  moveProjectTerminalToNewGroupInRuntime,
  reorderProjectTerminalGroupChildrenInRuntime,
  reorderProjectTerminalGroupsInRuntime,
  selectProjectTerminalGroupInRuntime,
  setProjectTerminalPanelVisibleInRuntime,
  splitProjectTerminalGroupInRuntime,
} from "@/state/workspaces/project-terminal-panel-state";
import {
  createWorkspaceStartupController,
  syncProjectScopedRuntime,
  type WorkspaceStartupGet,
  type WorkspaceStartupSet,
  type WorkspaceStartupState,
} from "@/services/workspace/workspace-startup";
import { isProjectRuntimeKey, projectRuntimeKey } from "@/lib/runtime/runtime-keys";
import {
  getOrderedProjectTerminalSlotIds,
  getOrderedWorkspaceTerminalSlotIds,
  getVisibleProjectTerminalSlotIds,
  getVisibleWorkspaceTerminalSlotIds,
} from "@/lib/terminal/lazy-terminal-connections";
import { seedWorkspaceTerminal } from "@/lib/terminal/terminal-seed";
import { TerminalSurfaceService } from "@/services/terminal/terminal-surface-service";

export interface WorkspaceSessionService {
  readonly workspaceId: string;
  readonly commands: {
    readonly focusPane: (paneId: string) => Effect.Effect<void>;
    readonly addTabToPane: (
      targetPaneID: string,
      sourcePaneID: string,
      sourceTabIndex: number,
    ) => Effect.Effect<void>;
    readonly removeTab: (paneID: string, tabIndex: number) => Effect.Effect<void>;
    readonly selectTabInPane: (paneID: string, index: number) => Effect.Effect<void>;
    readonly splitPane: (
      targetPaneID: string,
      sourcePaneID: string,
      sourceTabIndex: number,
      axis: "horizontal" | "vertical",
      position: "before" | "after",
    ) => Effect.Effect<void>;
    readonly moveTab: (
      fromPaneID: string,
      toPaneID: string,
      fromIndex: number,
      toIndex: number,
    ) => Effect.Effect<void>;
    readonly reorderTab: (
      paneID: string,
      fromIndex: number,
      toIndex: number,
    ) => Effect.Effect<void>;
    readonly closeTab: (paneID: string, tabIndex: number) => Effect.Effect<void>;
    readonly addEditorTab: (relativePath: string) => Effect.Effect<void>;
    readonly addEditorTabToPane: (
      paneID: string,
      relativePath: string,
      insertIndex?: number,
    ) => Effect.Effect<void>;
    readonly splitPaneWithEditor: (
      targetPaneID: string,
      relativePath: string,
      axis: "horizontal" | "vertical",
      position: "before" | "after",
    ) => Effect.Effect<void>;
    readonly addDiffTab: (relativePath: string, source: DiffSource) => Effect.Effect<void>;
    readonly addReviewTab: () => Effect.Effect<void>;
    readonly addTerminalTab: (slotId: string) => Effect.Effect<void>;
    readonly seedTerminal: () => Effect.Effect<void>;
  };
}

export interface DesktopWorkspaceServiceApi {
  readonly loadDesktopState: () => Effect.Effect<void, DesktopStateLoadError>;
  readonly reloadDesktopState: () => Effect.Effect<void, DesktopStateLoadError>;
  readonly addProject: (path: string) => Effect.Effect<void, DesktopStateLoadError>;
  readonly toggleProject: (projectId: string) => Effect.Effect<void, DesktopStateLoadError>;
  readonly removeProject: (projectId: string) => Effect.Effect<void, DesktopStateLoadError>;
  readonly selectProject: (projectId: string) => Effect.Effect<void, WorkspaceSelectionError>;
  readonly selectWorkspace: (workspaceId: string) => Effect.Effect<void, WorkspaceSelectionError>;
  readonly ensureWorkspaceRuntimeConnected: (
    workspaceId: string,
  ) => Effect.Effect<void, WorkspaceSelectionError>;
  readonly activateSidebarSelection: () => Effect.Effect<void, WorkspaceSelectionError>;
  readonly navigateSidebar: (offset: number) => Effect.Effect<void>;
  readonly switchWorkspaceRelative: (
    offset: number,
    navigationArea?: DesktopViewStateSnapshot["navigationArea"],
  ) => Effect.Effect<void>;
  readonly setNavigationArea: (
    area: DesktopViewStateSnapshot["navigationArea"],
  ) => Effect.Effect<void>;
  readonly setSearchText: (text: string) => Effect.Effect<void>;
  readonly setLayoutTargetRuntimeId: (runtimeId: string | null) => Effect.Effect<void>;
  readonly getEffectiveLayoutRuntimeId: () => Effect.Effect<string | null>;
  readonly getSelectedProjectId: () => Effect.Effect<string | null>;
  readonly getSelectedWorkspaceId: () => Effect.Effect<string | null>;
  readonly getWorkspaceRecord: (workspaceId: string) => Effect.Effect<WorkspaceRecord | null>;
  readonly getRuntimeState: (workspaceId: string) => Effect.Effect<WorkspaceRuntimeState | null>;
  readonly getSlotState: (
    workspaceId: string,
    slotId: string,
  ) => Effect.Effect<SlotState | undefined>;
  readonly cycleTab: (direction: -1 | 1) => Effect.Effect<void>;
  readonly addEditorTabForPath: (relativePath: string) => Effect.Effect<void>;
  readonly addDiffTabForPath: (
    relativePath: string,
    source: "working" | "staged",
  ) => Effect.Effect<void>;
  readonly addReviewTab: () => Effect.Effect<void>;
  readonly updateWorkspacePrState: (workspaceId: string, prState: string) => Effect.Effect<void>;
  readonly setPrAwaiting: (workspaceId: string, awaiting: boolean) => Effect.Effect<void>;
  readonly archiveWorkspace: (workspaceId: string) => Effect.Effect<void, WorkspaceSelectionError>;
  readonly addProjectTerminalGroup: (
    workspaceId: string,
    slotId: string,
    index?: number,
  ) => Effect.Effect<void>;
  readonly splitProjectTerminalGroup: (
    workspaceId: string,
    groupId: string,
    slotId: string,
  ) => Effect.Effect<void>;
  readonly closeProjectTerminal: (workspaceId: string, slotId: string) => Effect.Effect<void>;
  readonly selectProjectTerminalGroup: (
    workspaceId: string,
    groupId: string,
    slotId?: string | null,
  ) => Effect.Effect<void>;
  readonly focusProjectTerminal: (
    workspaceId: string,
    slotId: string | null,
  ) => Effect.Effect<void>;
  readonly setProjectTerminalPanelVisible: (
    workspaceId: string,
    visible: boolean,
  ) => Effect.Effect<void>;
  readonly reorderProjectTerminalGroups: (
    workspaceId: string,
    fromIndex: number,
    toIndex: number,
  ) => Effect.Effect<void>;
  readonly reorderProjectTerminalGroupChildren: (
    workspaceId: string,
    groupId: string,
    fromIndex: number,
    toIndex: number,
  ) => Effect.Effect<void>;
  readonly moveProjectTerminalToGroup: (
    workspaceId: string,
    slotId: string,
    targetGroupId: string,
    index?: number,
  ) => Effect.Effect<void>;
  readonly moveProjectTerminalToNewGroup: (
    workspaceId: string,
    slotId: string,
    index: number,
  ) => Effect.Effect<void>;
  readonly createWorkspace: (
    projectId: string,
    workspaceKind?: WorkspaceKind,
  ) => Effect.Effect<void, WorkspaceSelectionError>;
  readonly retryWorkspace: (workspaceId: string) => Effect.Effect<void, WorkspaceSelectionError>;
  readonly removeWorkspace: (workspaceId: string) => Effect.Effect<void, WorkspaceSelectionError>;
  readonly markWorkspaceOpened: (
    workspaceId: string,
  ) => Effect.Effect<void, WorkspaceSelectionError>;
  readonly getWorkspaceSession: (
    workspaceId: string,
  ) => Effect.Effect<WorkspaceSessionService, WorkspaceSelectionError>;
}

export class DesktopWorkspaceService extends Context.Tag("pandora/DesktopWorkspaceService")<
  DesktopWorkspaceService,
  DesktopWorkspaceServiceApi
>() {}

type DesktopStateSnapshot = {
  -readonly [K in keyof DesktopViewStateSnapshot]: DesktopViewStateSnapshot[K] extends Readonly<
    Record<string, infer V>
  >
    ? Record<string, V>
    : DesktopViewStateSnapshot[K] extends readonly (infer U)[]
      ? U[]
      : DesktopViewStateSnapshot[K];
} & {
  runtimes: Record<string, WorkspaceRuntimeState>;
  prAwaitingWorkspaceIds: Set<string>;
};

function workspaceSelectionError(cause: unknown, workspaceId?: string) {
  return new WorkspaceSelectionError({ cause, workspaceId });
}

function publishDesktopView(snapshot: DesktopViewStateSnapshot) {
  useDesktopViewStore.getState().setDesktopView(buildDesktopView(snapshot));
}

function publishRuntimeState(runtimes: Record<string, WorkspaceRuntimeState>) {
  useRuntimeStore.getState().setRuntimeState(runtimes);
}

function cloneRuntimeState(runtime: WorkspaceRuntimeState): WorkspaceRuntimeState {
  return structuredClone(runtime);
}

function compareCreatedAtDesc<T extends { createdAt: string }>(a: T, b: T) {
  return b.createdAt.localeCompare(a.createdAt);
}

function persistWorkspaceLayout(snapshot: DesktopStateSnapshot, workspaceId: string) {
  const runtime = snapshot.runtimes[workspaceId];
  const root =
    runtime?.root?.type === "leaf" && runtime.root.tabs.length === 0
      ? null
      : (runtime?.root ?? null);
  const layout = {
    root,
    focusedPaneID: root ? (runtime?.focusedPaneID ?? null) : null,
  };

  return Effect.tryPromise({
    try: () => invoke("save_workspace_layout", { workspaceId, layout }),
    catch: (cause) => cause,
  }).pipe(
    Effect.catchAll(() => Effect.void),
    Effect.asVoid,
  );
}

function projectTerminalPanelStorageKey(runtimeId: string) {
  return `project-terminal-panel:${runtimeId}`;
}

function parsePersistedProjectTerminalPanel(raw: string | null): TerminalPanelState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<TerminalPanelState>;
    if (!Array.isArray(parsed?.groups)) return null;
    return {
      groups: parsed.groups
        .filter(
          (group): group is { id: string; children: string[] } =>
            Boolean(group) &&
            typeof group.id === "string" &&
            Array.isArray(group.children) &&
            group.children.every((child) => typeof child === "string"),
        )
        .map((group) => ({
          id: group.id,
          children: [...group.children],
        })),
      activeGroupIndex: typeof parsed.activeGroupIndex === "number" ? parsed.activeGroupIndex : 0,
      activeSlotId: typeof parsed.activeSlotId === "string" ? parsed.activeSlotId : null,
      visible: parsed.visible === true,
    };
  } catch {
    return null;
  }
}

function loadPersistedProjectTerminalPanel(runtimeId: string) {
  return Effect.tryPromise({
    try: () =>
      invoke<string | null>("get_ui_state", {
        key: projectTerminalPanelStorageKey(runtimeId),
      }),
    catch: () => null,
  }).pipe(
    Effect.map((raw) => parsePersistedProjectTerminalPanel(raw)),
    Effect.catchAll(() => Effect.succeed(null)),
  );
}

function persistProjectTerminalPanel(runtimeId: string, panel: TerminalPanelState | null) {
  return Effect.tryPromise({
    try: () =>
      invoke("set_ui_state", {
        key: projectTerminalPanelStorageKey(runtimeId),
        value: panel ? JSON.stringify(panel) : null,
      }),
    catch: () => undefined,
  }).pipe(
    Effect.catchAll(() => Effect.void),
    Effect.asVoid,
  );
}

function decodeOutputChunk(data: string) {
  try {
    return atob(data);
  } catch {
    return data;
  }
}

export function shouldAutoOpenTerminalSlot(slot: SlotState | undefined) {
  return Boolean(
    slot &&
    slot.kind === "terminal_slot" &&
    slot.sessionIDs.length === 0 &&
    slot.sessionDefIDs.length > 0,
  );
}

export const DesktopWorkspaceServiceLive = Layer.scoped(
  DesktopWorkspaceService,
  Effect.gen(function* () {
    const eventQueue = yield* DaemonEventQueue;
    const daemonGateway = yield* DaemonGateway;
    const terminalSurfaceService = yield* TerminalSurfaceService;
    const desktopStateSnapshot: DesktopStateSnapshot = {
      projects: [],
      workspaces: [],
      selectedProjectID: null,
      selectedWorkspaceID: null,
      runtimes: {},
      navigationArea: "sidebar",
      searchText: "",
      layoutTargetRuntimeId: null,
      prAwaitingWorkspaceIds: new Set<string>(),
    };
    const connectionWaiters = new Map<string, Array<() => void>>();
    const pendingDefaultTerminalSeeds = new Set<string>();
    const pendingInitialTerminalWorkspaceIds = new Set<string>();
    let desktopPublishScheduled = false;
    let runtimePublishScheduled = false;
    const publishDesktopNow = () => publishDesktopView(desktopStateSnapshot);
    const scheduleDesktopPublish = () => {
      if (desktopPublishScheduled) return;
      desktopPublishScheduled = true;
      queueMicrotask(() => {
        desktopPublishScheduled = false;
        publishDesktopNow();
      });
    };
    const publishRuntimeNow = () => publishRuntimeState(desktopStateSnapshot.runtimes);
    const scheduleRuntimePublish = () => {
      if (runtimePublishScheduled) return;
      runtimePublishScheduled = true;
      queueMicrotask(() => {
        runtimePublishScheduled = false;
        publishRuntimeNow();
      });
    };
    const getEffectiveLayoutRuntimeId = () =>
      desktopStateSnapshot.layoutTargetRuntimeId ?? desktopStateSnapshot.selectedWorkspaceID;
    const pendingSessionOpens = new Set<string>();
    const hiddenWarmupFibers = new Map<string, Fiber.RuntimeFiber<void, never>>();
    const hiddenWarmupPendingSlots = new Map<string, string>();
    const hiddenWarmupGeneration = new Map<string, number>();
    const hiddenWarmupDelay = "120 millis";
    let requestActiveTerminalStartupRefresh: (() => void) | null = null;
    let activeTerminalStartupRefreshQueued = false;
    let selectionTargetWorkspaceID: string | null = null;
    let selectionSettleFiber: Fiber.RuntimeFiber<void, never> | null = null;

    const runLoggedBackgroundEffect = (
      effect: Effect.Effect<void, unknown>,
      label: string,
    ) =>
      Effect.runFork(
        effect.pipe(
          Effect.catchAll((error) =>
            Effect.sync(() => {
              console.warn(label, error);
            }),
          ),
        ),
      );

    const applyAppState = (appState: AppState) => {
      desktopStateSnapshot.projects = structuredClone(appState.projects).sort(compareCreatedAtDesc);
      desktopStateSnapshot.workspaces = structuredClone(appState.workspaces).sort(compareCreatedAtDesc);
      desktopStateSnapshot.selectedProjectID = appState.selectedProjectId;
      desktopStateSnapshot.selectedWorkspaceID = appState.selectedWorkspaceId;
      selectionTargetWorkspaceID = appState.selectedWorkspaceId;

      const allowedRuntimeIds = new Set<string>(
        appState.workspaces.map((workspace) => workspace.id),
      );
      for (const project of appState.projects) {
        allowedRuntimeIds.add(`project:${project.id}`);
      }

      for (const runtimeId of Object.keys(desktopStateSnapshot.runtimes)) {
        if (!allowedRuntimeIds.has(runtimeId)) {
          delete desktopStateSnapshot.runtimes[runtimeId];
        }
      }
      for (const workspaceId of pendingInitialTerminalWorkspaceIds) {
        if (!allowedRuntimeIds.has(workspaceId)) {
          pendingInitialTerminalWorkspaceIds.delete(workspaceId);
        }
      }

      scheduleDesktopPublish();
      scheduleRuntimePublish();
    };

    const patchWorkspaceRecord = (record: WorkspaceRecord) => {
      const nextRecord = structuredClone(record);
      const index = desktopStateSnapshot.workspaces.findIndex((entry) => entry.id === record.id);
      if (index >= 0) {
        const nextWorkspaces = [...desktopStateSnapshot.workspaces];
        nextWorkspaces[index] = nextRecord;
        desktopStateSnapshot.workspaces = nextWorkspaces.sort(compareCreatedAtDesc);
      } else {
        desktopStateSnapshot.workspaces = [nextRecord, ...desktopStateSnapshot.workspaces].sort(
          compareCreatedAtDesc,
        );
      }
      scheduleDesktopPublish();
    };

    const getVisibleSidebarWorkspaces = () =>
      desktopStateSnapshot.projects.flatMap((project) =>
        desktopStateSnapshot.workspaces.filter(
          (workspace) =>
            workspace.projectId === project.id && workspace.status !== "archived",
        ),
      );

    const loadAppStateFromBackend = () =>
      Effect.tryPromise({
        try: () => invoke<AppState>("load_app_state"),
        catch: (cause) => new DesktopStateLoadError({ cause }),
      }).pipe(
        Effect.tap((appState) =>
          Effect.sync(() => {
            applyAppState(appState);
          }),
        ),
      );

    yield* Effect.acquireRelease(
      Effect.tryPromise({
        try: () =>
          listen<WorkspaceRecord>("workspace_record_changed", ({ payload }) => {
            patchWorkspaceRecord(payload);
            if (
              payload.id === desktopStateSnapshot.selectedWorkspaceID &&
              payload.status === "ready"
            ) {
              startSelectionSettle(payload);
            }
          }),
        catch: (cause) => new DesktopStateLoadError({ cause }),
      }),
      (unlisten) =>
        Effect.sync(() => {
          unlisten();
        }),
    );

    const updateDesktopState = (
      mutate: (state: DesktopStateSnapshot) => void,
      options?: { sync?: boolean },
    ) =>
      Effect.sync(() => {
        mutate(desktopStateSnapshot);
        if (options?.sync) {
          publishDesktopNow();
        } else {
          scheduleDesktopPublish();
        }
      });

    /**
     * Only newly created workspaces should get an initial terminal automatically.
     * Existing workspaces may legitimately have no terminals and should stay empty.
     */
    const ensureWorkspaceDefaultTerminal = (workspaceId: string) => {
      if (isProjectRuntimeKey(workspaceId)) return;
      if (!pendingInitialTerminalWorkspaceIds.has(workspaceId)) return;
      const runtime = desktopStateSnapshot.runtimes[workspaceId];
      if (!runtime) return;
      if (runtime.layoutLoading) return;
      if (runtime.connectionState !== "connected") return;
      if (runtime.slots.some((s) => s.kind === "terminal_slot")) {
        pendingInitialTerminalWorkspaceIds.delete(workspaceId);
        return;
      }
      if (pendingDefaultTerminalSeeds.has(workspaceId)) return;
      pendingDefaultTerminalSeeds.add(workspaceId);
      const fiber = runLoggedBackgroundEffect(
        Effect.gen(function* () {
          const alreadySeeded = yield* Effect.sync(
            () =>
              desktopStateSnapshot.runtimes[workspaceId]?.slots.some(
                (slot) => slot.kind === "terminal_slot",
              ) ?? false,
          );
          if (alreadySeeded) {
            pendingInitialTerminalWorkspaceIds.delete(workspaceId);
            return;
          }

          const client = yield* daemonGateway.getClient();
          if (!client) return;

          const seeded = seedWorkspaceTerminal(client, workspaceId);
          const session = yield* sessionCache.get(workspaceId);
          yield* session.commands.addTerminalTab(seeded.slotID);
          pendingInitialTerminalWorkspaceIds.delete(workspaceId);
        }),
        "Failed to seed default workspace terminal:",
      );
      fiber.addObserver(() => {
        pendingDefaultTerminalSeeds.delete(workspaceId);
      });
    };

    const ensureRuntimeLayoutForWorkspace = (workspaceId: string) => {
      const current = desktopStateSnapshot.runtimes[workspaceId];
      if (!current) return;
      const runtime = cloneRuntimeState(current);
      if (isProjectRuntimeKey(workspaceId)) {
        ensureProjectTerminalPanelState(runtime);
      } else {
        ensureRuntimeLayoutState(runtime);
      }
      writeSessionRuntimeState(workspaceId, runtime);
      ensureWorkspaceDefaultTerminal(workspaceId);
    };

    const startupGet: WorkspaceStartupGet = () =>
      ({
        projects: desktopStateSnapshot.projects as ProjectRecord[],
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
      requestActiveTerminalStartupRefresh?.();
    }) as WorkspaceStartupSet;

    const { startWorkspaceStartup, interruptWorkspaceStartup } = createWorkspaceStartupController();

    const readSessionRuntimeState = (workspaceId: string) => {
      const existing = desktopStateSnapshot.runtimes[workspaceId];
      if (existing) return existing;

      const runtime = createRuntimeState(workspaceId);
      desktopStateSnapshot.runtimes[workspaceId] = runtime;
      scheduleRuntimePublish();
      return runtime;
    };

    const writeSessionRuntimeState = (workspaceId: string, runtime: WorkspaceRuntimeState) => {
      desktopStateSnapshot.runtimes[workspaceId] = runtime;
      scheduleRuntimePublish();
    };

    const terminalStartupKey = (runtimeId: string, slotId: string) => `${runtimeId}:${slotId}`;

    const selectedRuntimeIds = () => {
      const runtimeIds: string[] = [];
      if (desktopStateSnapshot.selectedWorkspaceID) {
        runtimeIds.push(desktopStateSnapshot.selectedWorkspaceID);
      }
      if (desktopStateSnapshot.selectedProjectID) {
        runtimeIds.push(projectRuntimeKey(desktopStateSnapshot.selectedProjectID));
      }
      return runtimeIds;
    };

    const isRuntimeStartupActive = (runtimeId: string) => {
      if (isProjectRuntimeKey(runtimeId)) {
        return (
          desktopStateSnapshot.selectedProjectID !== null &&
          runtimeId === projectRuntimeKey(desktopStateSnapshot.selectedProjectID)
        );
      }
      return desktopStateSnapshot.selectedWorkspaceID === runtimeId;
    };

    const clearPendingSessionOpensForRuntime = (runtimeId: string) => {
      for (const key of Array.from(pendingSessionOpens)) {
        if (key.startsWith(`${runtimeId}:`)) {
          pendingSessionOpens.delete(key);
        }
      }
    };

    const getRuntimeSlotState = (runtimeId: string, slotId: string) =>
      desktopStateSnapshot.runtimes[runtimeId]?.slots.find((slot) => slot.id === slotId);

    const reconcilePendingSessionOpens = (runtimeId: string) => {
      for (const key of Array.from(pendingSessionOpens)) {
        if (!key.startsWith(`${runtimeId}:`)) continue;
        const slotId = key.slice(runtimeId.length + 1);
        if (!shouldAutoOpenTerminalSlot(getRuntimeSlotState(runtimeId, slotId))) {
          pendingSessionOpens.delete(key);
        }
      }
    };

    const reconcileHiddenWarmupPendingSlot = (runtimeId: string) => {
      const pendingSlotId = hiddenWarmupPendingSlots.get(runtimeId);
      if (!pendingSlotId) return;
      if (!shouldAutoOpenTerminalSlot(getRuntimeSlotState(runtimeId, pendingSlotId))) {
        hiddenWarmupPendingSlots.delete(runtimeId);
      }
    };

    const cancelHiddenWarmup = (runtimeId: string) =>
      Effect.sync(() => {
        hiddenWarmupGeneration.set(runtimeId, (hiddenWarmupGeneration.get(runtimeId) ?? 0) + 1);
        hiddenWarmupPendingSlots.delete(runtimeId);
        const fiber = hiddenWarmupFibers.get(runtimeId);
        if (!fiber) return;
        hiddenWarmupFibers.delete(runtimeId);
        void Effect.runFork(Fiber.interrupt(fiber));
      });

    const clearRuntimeTerminalStartupTracking = (runtimeId: string) =>
      Effect.gen(function* () {
        yield* cancelHiddenWarmup(runtimeId);
        clearPendingSessionOpensForRuntime(runtimeId);
        hiddenWarmupPendingSlots.delete(runtimeId);
        hiddenWarmupGeneration.delete(runtimeId);
      });

    const getVisibleRuntimeTerminalSlotIds = (runtimeId: string) => {
      if (!isRuntimeStartupActive(runtimeId)) return [];
      const runtime = desktopStateSnapshot.runtimes[runtimeId];
      if (!runtime || runtime.connectionState !== "connected") return [];
      return isProjectRuntimeKey(runtimeId)
        ? getVisibleProjectTerminalSlotIds(runtime.terminalPanel)
        : getVisibleWorkspaceTerminalSlotIds(runtime.root);
    };

    const getOrderedRuntimeTerminalSlotIds = (runtimeId: string) => {
      if (!isRuntimeStartupActive(runtimeId)) return [];
      const runtime = desktopStateSnapshot.runtimes[runtimeId];
      if (!runtime || runtime.connectionState !== "connected") return [];
      return isProjectRuntimeKey(runtimeId)
        ? getOrderedProjectTerminalSlotIds(runtime.terminalPanel)
        : getOrderedWorkspaceTerminalSlotIds(runtime.root);
    };

    const ensureTerminalSlotSession = (runtimeId: string, slotId: string): Effect.Effect<boolean> =>
      Effect.gen(function* () {
        const runtime = desktopStateSnapshot.runtimes[runtimeId];
        if (!runtime || runtime.connectionState !== "connected") return false;

        reconcilePendingSessionOpens(runtimeId);
        const slot = runtime.slots.find((candidate) => candidate.id === slotId);
        if (!shouldAutoOpenTerminalSlot(slot)) return false;
        if (!slot) return false;

        const requestKey = terminalStartupKey(runtimeId, slotId);
        if (pendingSessionOpens.has(requestKey)) return false;

        const sessionDefID = slot.sessionDefIDs[0];
        if (!sessionDefID) return false;

        pendingSessionOpens.add(requestKey);
        const client = yield* daemonGateway.getClient();
        if (!client) {
          pendingSessionOpens.delete(requestKey);
          return false;
        }

        yield* client.sendEffect(runtimeId, {
          type: "open_session_instance",
          sessionDefID,
        });
        return true;
      });

    const ensureVisibleTerminalSessions = (runtimeId: string) =>
      Effect.all(
        [...new Set(getVisibleRuntimeTerminalSlotIds(runtimeId))].map((slotId) =>
          ensureTerminalSlotSession(runtimeId, slotId),
        ),
        { concurrency: "unbounded", discard: true },
      );

    const scheduleHiddenWarmup = (runtimeId: string) =>
      Effect.gen(function* () {
        const runtime = desktopStateSnapshot.runtimes[runtimeId];
        if (
          !runtime ||
          runtime.connectionState !== "connected" ||
          !isRuntimeStartupActive(runtimeId)
        ) {
          yield* cancelHiddenWarmup(runtimeId);
          return;
        }

        reconcilePendingSessionOpens(runtimeId);
        reconcileHiddenWarmupPendingSlot(runtimeId);

        if (hiddenWarmupFibers.has(runtimeId) || hiddenWarmupPendingSlots.has(runtimeId)) return;

        const visibleSlotIds = [...new Set(getVisibleRuntimeTerminalSlotIds(runtimeId))];
        if (
          visibleSlotIds.some((slotId) =>
            shouldAutoOpenTerminalSlot(runtime.slots.find((slot) => slot.id === slotId)),
          )
        ) {
          return;
        }

        const visibleSlotIdSet = new Set(visibleSlotIds);
        const hiddenSlotId = getOrderedRuntimeTerminalSlotIds(runtimeId).find(
          (slotId) =>
            !visibleSlotIdSet.has(slotId) &&
            shouldAutoOpenTerminalSlot(runtime.slots.find((slot) => slot.id === slotId)),
        );
        if (!hiddenSlotId) return;

        const generation = hiddenWarmupGeneration.get(runtimeId) ?? 0;
        yield* Effect.sync(() => {
          const fiber = Effect.runFork(
            Effect.gen(function* () {
              yield* Effect.sleep(hiddenWarmupDelay);
              reconcilePendingSessionOpens(runtimeId);
              reconcileHiddenWarmupPendingSlot(runtimeId);

              if ((hiddenWarmupGeneration.get(runtimeId) ?? 0) !== generation) return;
              if (!isRuntimeStartupActive(runtimeId)) return;

              const opened = yield* ensureTerminalSlotSession(runtimeId, hiddenSlotId);
              if (opened) {
                hiddenWarmupPendingSlots.set(runtimeId, hiddenSlotId);
              }
            }),
          );

          hiddenWarmupFibers.set(runtimeId, fiber);
          fiber.addObserver(() => {
            if (hiddenWarmupFibers.get(runtimeId) === fiber) {
              hiddenWarmupFibers.delete(runtimeId);
            }
          });
        });
      });

    const refreshRuntimeTerminalStartup = (
      runtimeId: string,
      options?: { rebuildHiddenQueue?: boolean },
    ) =>
      Effect.gen(function* () {
        const runtime = desktopStateSnapshot.runtimes[runtimeId];
        if (options?.rebuildHiddenQueue) {
          yield* cancelHiddenWarmup(runtimeId);
        }

        if (
          !runtime ||
          runtime.connectionState !== "connected" ||
          !isRuntimeStartupActive(runtimeId)
        ) {
          if (!runtime || runtime.connectionState !== "connected") {
            clearPendingSessionOpensForRuntime(runtimeId);
          }
          yield* cancelHiddenWarmup(runtimeId);
          return;
        }

        reconcilePendingSessionOpens(runtimeId);
        reconcileHiddenWarmupPendingSlot(runtimeId);
        yield* ensureVisibleTerminalSessions(runtimeId);
        yield* scheduleHiddenWarmup(runtimeId);
      });

    const refreshActiveRuntimeTerminalStartup = (options?: { rebuildHiddenQueues?: boolean }) =>
      Effect.gen(function* () {
        const activeRuntimeIds = selectedRuntimeIds();
        const activeRuntimeIdSet = new Set(activeRuntimeIds);

        for (const runtimeId of new Set([
          ...hiddenWarmupFibers.keys(),
          ...hiddenWarmupPendingSlots.keys(),
        ])) {
          if (!activeRuntimeIdSet.has(runtimeId)) {
            yield* cancelHiddenWarmup(runtimeId);
          }
        }

        yield* Effect.all(
          activeRuntimeIds.map((runtimeId) =>
            refreshRuntimeTerminalStartup(runtimeId, {
              rebuildHiddenQueue: options?.rebuildHiddenQueues === true,
            }),
          ),
          { concurrency: "unbounded", discard: true },
        );
      });

    requestActiveTerminalStartupRefresh = () => {
      if (activeTerminalStartupRefreshQueued) return;
      activeTerminalStartupRefreshQueued = true;
      queueMicrotask(() => {
        activeTerminalStartupRefreshQueued = false;
        runLoggedBackgroundEffect(
          refreshActiveRuntimeTerminalStartup({ rebuildHiddenQueues: true }),
          "Failed to refresh terminal startup state:",
        );
      });
    };

    const hydrateProjectRuntimePanel = (runtimeId: string) =>
      Effect.gen(function* () {
        if (!isProjectRuntimeKey(runtimeId)) return;
        const runtime = desktopStateSnapshot.runtimes[runtimeId];
        if (!runtime || (runtime.terminalPanel?.groups.length ?? 0) > 0) return;
        const panel = yield* loadPersistedProjectTerminalPanel(runtimeId);
        if (!panel) return;

        const next = cloneRuntimeState(readSessionRuntimeState(runtimeId));
        next.terminalPanel = panel;
        writeSessionRuntimeState(runtimeId, next);
      });

    const waitForWorkspaceConnection = (
      workspaceId: string,
    ): Effect.Effect<void, WorkspaceSelectionError> =>
      Effect.gen(function* () {
        if (desktopStateSnapshot.runtimes[workspaceId]?.connectionState === "connected") return;

        yield* Effect.async<void, WorkspaceSelectionError>((resume) => {
          const timeoutId = setTimeout(() => {
            const waiters = connectionWaiters.get(workspaceId);
            if (waiters) {
              const idx = waiters.indexOf(onConnected);
              if (idx !== -1) waiters.splice(idx, 1);
              if (waiters.length === 0) connectionWaiters.delete(workspaceId);
            }
            resume(
              Effect.fail(
                workspaceSelectionError(
                  new Error(`Workspace runtime did not connect for ${workspaceId}`),
                  workspaceId,
                ),
              ),
            );
          }, 5000);

          const onConnected = () => {
            clearTimeout(timeoutId);
            resume(Effect.void);
          };

          const existing = connectionWaiters.get(workspaceId) ?? [];
          existing.push(onConnected);
          connectionWaiters.set(workspaceId, existing);

          return Effect.sync(() => {
            clearTimeout(timeoutId);
            const waiters = connectionWaiters.get(workspaceId);
            if (waiters) {
              const idx = waiters.indexOf(onConnected);
              if (idx !== -1) waiters.splice(idx, 1);
              if (waiters.length === 0) connectionWaiters.delete(workspaceId);
            }
          });
        });
      });

    const interruptSelectionSettle = () => {
      const fiber = selectionSettleFiber;
      if (!fiber) return;
      selectionSettleFiber = null;
      void Effect.runFork(Fiber.interrupt(fiber));
    };

    const startSelectionSettle = (workspace: WorkspaceRecord) => {
      interruptSelectionSettle();
      const fiber = runLoggedBackgroundEffect(
        Effect.gen(function* () {
          if (desktopStateSnapshot.selectedWorkspaceID !== workspace.id) return;

          if (workspace.status === "ready") {
            yield* Effect.sync(() => {
              syncProjectScopedRuntime(startupSet, startupGet, workspace);
              startWorkspaceStartup(startupSet, startupGet, workspace);
            });
            if (desktopStateSnapshot.selectedWorkspaceID !== workspace.id) return;
            yield* hydrateProjectRuntimePanel(projectRuntimeKey(workspace.projectId));
          }

          if (desktopStateSnapshot.selectedWorkspaceID !== workspace.id) return;
          yield* refreshActiveRuntimeTerminalStartup({ rebuildHiddenQueues: false });
        }),
        "Failed to settle selected workspace:",
      );
      selectionSettleFiber = fiber;
      fiber.addObserver(() => {
        if (selectionSettleFiber === fiber) {
          selectionSettleFiber = null;
        }
      });
    };

    const applyWorkspaceSelection = (
      workspace: WorkspaceRecord,
      navigationArea: DesktopViewStateSnapshot["navigationArea"] = "sidebar",
    ) => {
      selectionTargetWorkspaceID = workspace.id;
      desktopStateSnapshot.selectedWorkspaceID = workspace.id;
      desktopStateSnapshot.selectedProjectID = workspace.projectId;
      desktopStateSnapshot.navigationArea = navigationArea;
      desktopStateSnapshot.layoutTargetRuntimeId = null;
      publishDesktopNow();
    };

    const ensureWorkspaceRuntimeConnected = (workspaceId: string) =>
      Effect.gen(function* () {
        if (desktopStateSnapshot.runtimes[workspaceId]?.connectionState === "connected") return;

        const workspace = desktopStateSnapshot.workspaces.find((entry) => entry.id === workspaceId);
        if (!workspace || workspace.status !== "ready") {
          return yield* Effect.fail(
            workspaceSelectionError(
              new Error(`Workspace ${workspaceId} is not ready`),
              workspaceId,
            ),
          );
        }

        const defaultCwd = workspace.workspaceContextSubpath
          ? `${workspace.worktreePath}/${workspace.workspaceContextSubpath}`
          : workspace.worktreePath;

        yield* Effect.tryPromise({
          try: () =>
            invoke("start_workspace_runtime", {
              workspaceId: workspace.id,
              workspacePath: workspace.worktreePath,
              defaultCwd,
            }),
          catch: (cause) => workspaceSelectionError(cause, workspaceId),
        });

        yield* waitForWorkspaceConnection(workspaceId);
      });

    const selectWorkspaceById = (workspaceId: string) =>
      Effect.try({
        try: () => {
          const workspace = desktopStateSnapshot.workspaces.find(
            (entry) => entry.id === workspaceId,
          );
          if (!workspace) {
            throw workspaceSelectionError(new Error("Workspace not found"), workspaceId);
          }
          return workspace;
        },
        catch: (cause) =>
          cause instanceof WorkspaceSelectionError
            ? cause
            : workspaceSelectionError(cause, workspaceId),
      }).pipe(
        Effect.tap((workspace) =>
          Effect.sync(() => {
            applyWorkspaceSelection(workspace, "sidebar");
            void invoke("save_selection", {
              projectId: workspace.projectId,
              workspaceId: workspace.id,
            });
            void invoke("mark_workspace_opened", { workspaceId: workspace.id });
            startSelectionSettle(workspace);
          }),
        ),
        Effect.asVoid,
      );

    const selectWorkspaceRelative = (
      offset: number,
      navigationArea: DesktopViewStateSnapshot["navigationArea"] = "sidebar",
    ) =>
      Effect.gen(function* () {
        const visibleWorkspaces = getVisibleSidebarWorkspaces();
        if (visibleWorkspaces.length === 0) return;
        const currentIndex = visibleWorkspaces.findIndex(
          (workspace) =>
            workspace.id ===
            (selectionTargetWorkspaceID ?? desktopStateSnapshot.selectedWorkspaceID),
        );
        const nextIndex = Math.max(
          0,
          Math.min(visibleWorkspaces.length - 1, (currentIndex >= 0 ? currentIndex : 0) + offset),
        );
        const workspace = visibleWorkspaces[nextIndex];
        if (!workspace) return;
        yield* selectWorkspaceById(workspace.id);
        if (navigationArea !== "sidebar") {
          yield* updateDesktopState((state) => {
            state.navigationArea = navigationArea;
          });
        }
      }).pipe(Effect.catchAll(() => Effect.void));

    const maybeStartSelectedWorkspace = () =>
      Effect.gen(function* () {
        const selectedWorkspaceId = desktopStateSnapshot.selectedWorkspaceID;
        if (!selectedWorkspaceId) return;
        const workspace = desktopStateSnapshot.workspaces.find(
          (entry) => entry.id === selectedWorkspaceId,
        );
        if (!workspace || workspace.status !== "ready") return;
        yield* Effect.sync(() => {
          syncProjectScopedRuntime(startupSet, startupGet, workspace);
          startWorkspaceStartup(startupSet, startupGet, workspace);
        });
        yield* hydrateProjectRuntimePanel(projectRuntimeKey(workspace.projectId));
        yield* refreshActiveRuntimeTerminalStartup({ rebuildHiddenQueues: false });
      });

    const updateWorkspaceRuntime = (
      workspaceId: string,
      mutate: (runtime: WritableDraft<WorkspaceRuntimeState>) => boolean | void,
    ) =>
      Effect.sync(() => {
        const runtime = cloneRuntimeState(readSessionRuntimeState(workspaceId));
        const changed = Boolean(mutate(runtime as WritableDraft<WorkspaceRuntimeState>));
        writeSessionRuntimeState(workspaceId, runtime);
        return changed;
      }).pipe(
        Effect.flatMap((changed) =>
          changed && !isProjectRuntimeKey(workspaceId)
            ? persistWorkspaceLayout(desktopStateSnapshot, workspaceId)
            : Effect.void,
        ),
        Effect.tap(() => refreshRuntimeTerminalStartup(workspaceId, { rebuildHiddenQueue: true })),
      );

    const mutateRuntimeState = <T>(
      workspaceId: string,
      mutate: (runtime: WritableDraft<WorkspaceRuntimeState>) => T,
    ) =>
      Effect.sync(() => {
        const current = readSessionRuntimeState(workspaceId);
        const previousProjectPanel = isProjectRuntimeKey(workspaceId)
          ? JSON.stringify(current.terminalPanel ?? null)
          : null;
        const runtime = cloneRuntimeState(current);
        const result = mutate(runtime as WritableDraft<WorkspaceRuntimeState>);
        writeSessionRuntimeState(workspaceId, runtime);
        return {
          result,
          projectPanelChanged:
            isProjectRuntimeKey(workspaceId) &&
            previousProjectPanel !== JSON.stringify(runtime.terminalPanel ?? null),
          terminalPanel: runtime.terminalPanel,
        };
      }).pipe(
        Effect.flatMap(({ result, projectPanelChanged, terminalPanel }) =>
          projectPanelChanged
            ? Effect.as(persistProjectTerminalPanel(workspaceId, terminalPanel), result)
            : Effect.succeed(result),
        ),
      );

    const handleTerminalOutput = (workspaceId: string, data: string) =>
      Effect.sync(() => {
        if (!desktopStateSnapshot.prAwaitingWorkspaceIds.has(workspaceId)) return;

        const match = data.match(/https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/(\d+)/);
        if (!match) return;

        const prUrl = match[0];
        const prNumber = parseInt(match[1], 10);
        const next = new Set(desktopStateSnapshot.prAwaitingWorkspaceIds);
        next.delete(workspaceId);
        desktopStateSnapshot.prAwaitingWorkspaceIds = next;
        const workspace = desktopStateSnapshot.workspaces.find((entry) => entry.id === workspaceId);
        if (workspace) {
          workspace.prUrl = prUrl;
          workspace.prNumber = prNumber;
          workspace.prState = "open";
        }
        scheduleDesktopPublish();
        void invoke("pr_link", { workspaceId, prUrl, prNumber });
      });

    const processDaemonEvent = Effect.flatMap(eventQueue.take(), (event) =>
      Effect.gen(function* () {
        switch (event.type) {
          case "connection_state_changed":
            yield* mutateRuntimeState(event.workspaceId, (runtime) => {
              setRuntimeConnectionStateState(runtime, event.state);
            });
            if (event.state === "connected") {
              const waiters = connectionWaiters.get(event.workspaceId);
              if (waiters?.length) {
                connectionWaiters.delete(event.workspaceId);
                waiters.forEach((fn) => fn());
              }
              const client = yield* daemonGateway.getClient();
              if (client) {
                yield* Effect.sync(() => {
                  client.requestSnapshot(event.workspaceId);
                });
              }
              yield* Effect.sync(() => ensureWorkspaceDefaultTerminal(event.workspaceId));
            }
            yield* refreshRuntimeTerminalStartup(event.workspaceId);
            break;
          case "slot_snapshot":
            yield* mutateRuntimeState(event.workspaceId, (runtime) => {
              replaceRuntimeSlots(runtime, event.slots);
              if (isProjectRuntimeKey(event.workspaceId)) {
                ensureProjectTerminalPanelState(runtime);
              } else {
                const liveSlotIds = new Set(event.slots.map((slot) => slot.id));
                const layout = sanitizeWorkspaceTerminalLayout(
                  runtime.root,
                  runtime.focusedPaneID,
                  liveSlotIds,
                );
                runtime.root = layout.root as WritableDraft<LayoutNode> | null;
                runtime.focusedPaneID = layout.focusedPaneID;
                ensureRuntimeLayoutState(runtime);
              }
            });
            yield* Effect.sync(() => ensureWorkspaceDefaultTerminal(event.workspaceId));
            yield* refreshRuntimeTerminalStartup(event.workspaceId);
            break;
          case "session_snapshot":
            yield* mutateRuntimeState(event.workspaceId, (runtime) => {
              replaceRuntimeSessions(runtime, event.sessions);
            });
            yield* refreshRuntimeTerminalStartup(event.workspaceId);
            break;
          case "slot_state_changed":
            yield* mutateRuntimeState(event.workspaceId, (runtime) => {
              updateRuntimeSlotState(runtime, event.slot);
            });
            yield* refreshRuntimeTerminalStartup(event.workspaceId);
            break;
          case "session_state_changed":
            {
              const crashedTerminalSlotId = yield* mutateRuntimeState(
                event.workspaceId,
                (runtime) =>
                  updateRuntimeSessionState(runtime, event.session).crashedTerminalSlotId,
              );
              if (crashedTerminalSlotId) {
                yield* mutateRuntimeState(event.workspaceId, (runtime) => {
                  closeProjectTerminalInRuntime(runtime, crashedTerminalSlotId);
                });
              }
            }
            yield* refreshRuntimeTerminalStartup(event.workspaceId);
            break;
          case "slot_added":
            yield* mutateRuntimeState(event.workspaceId, (runtime) => {
              addRuntimeSlotState(runtime, event.slot);
              if (isProjectRuntimeKey(event.workspaceId)) {
                ensureProjectTerminalPanelState(runtime);
              } else {
                ensureRuntimeLayoutState(runtime);
              }
            });
            yield* Effect.sync(() => ensureWorkspaceDefaultTerminal(event.workspaceId));
            yield* refreshRuntimeTerminalStartup(event.workspaceId);
            break;
          case "slot_removed":
            yield* mutateRuntimeState(event.workspaceId, (runtime) => {
              removeRuntimeSlotState(runtime, event.slotID);
            });
            yield* refreshRuntimeTerminalStartup(event.workspaceId);
            break;
          case "session_opened":
            yield* mutateRuntimeState(event.workspaceId, (runtime) => {
              addRuntimeSessionState(runtime, event.session);
            });
            yield* refreshRuntimeTerminalStartup(event.workspaceId);
            break;
          case "session_closed":
            yield* mutateRuntimeState(event.workspaceId, (runtime) => {
              removeRuntimeSessionState(runtime, event.sessionID);
            });
            yield* refreshRuntimeTerminalStartup(event.workspaceId);
            break;
          case "output_chunk":
            yield* handleTerminalOutput(event.workspaceId, decodeOutputChunk(event.data));
            break;
          case "error":
            console.error(`Daemon error [${event.workspaceId}]:`, event.message);
            break;
        }
      }).pipe(
        Effect.catchAll((error) =>
          Effect.sync(() => {
            console.error("[daemon-event] failed", {
              type: event.type,
              workspaceId: event.workspaceId,
              error,
            });
          }),
        ),
      ),
    );

    yield* Effect.forkScoped(Effect.forever(processDaemonEvent));

    const sessionCache = yield* Cache.make<
      string,
      WorkspaceSessionService,
      WorkspaceSelectionError
    >({
      capacity: 3,
      timeToLive: "30 minutes",
      lookup: (workspaceId) =>
        Effect.succeed({
          workspaceId,
          commands: {
            focusPane: (paneId) =>
              updateWorkspaceRuntime(workspaceId, (runtime) =>
                setFocusedPaneInWorkspaceRuntime(runtime, paneId),
              ),
            addTabToPane: (targetPaneID, sourcePaneID, sourceTabIndex) =>
              updateWorkspaceRuntime(workspaceId, (runtime) =>
                addTabToPaneInWorkspaceRuntime(runtime, targetPaneID, sourcePaneID, sourceTabIndex),
              ),
            removeTab: (paneID, tabIndex) =>
              updateWorkspaceRuntime(workspaceId, (runtime) =>
                removeTabFromWorkspaceRuntime(runtime, paneID, tabIndex),
              ),
            selectTabInPane: (paneID, index) =>
              updateWorkspaceRuntime(workspaceId, (runtime) =>
                selectTabInPaneInWorkspaceRuntime(runtime, paneID, index),
              ),
            splitPane: (targetPaneID, sourcePaneID, sourceTabIndex, axis, position) =>
              updateWorkspaceRuntime(workspaceId, (runtime) =>
                splitPaneInWorkspaceRuntime(
                  runtime,
                  targetPaneID,
                  sourcePaneID,
                  sourceTabIndex,
                  axis,
                  position,
                ),
              ),
            moveTab: (fromPaneID, toPaneID, fromIndex, toIndex) =>
              updateWorkspaceRuntime(workspaceId, (runtime) =>
                moveTabInWorkspaceRuntime(runtime, fromPaneID, toPaneID, fromIndex, toIndex),
              ),
            reorderTab: (paneID, fromIndex, toIndex) =>
              updateWorkspaceRuntime(workspaceId, (runtime) =>
                reorderTabInWorkspaceRuntime(runtime, paneID, fromIndex, toIndex),
              ),
            closeTab: (paneID, tabIndex) =>
              updateWorkspaceRuntime(workspaceId, (runtime) =>
                removeTabFromWorkspaceRuntime(runtime, paneID, tabIndex),
              ),
            addEditorTab: (relativePath) =>
              updateWorkspaceRuntime(workspaceId, (runtime) =>
                addEditorTabToWorkspaceRuntime(runtime, relativePath),
              ),
            addEditorTabToPane: (paneID, relativePath, insertIndex) =>
              updateWorkspaceRuntime(workspaceId, (runtime) =>
                addEditorTabToPaneInWorkspaceRuntime(runtime, paneID, relativePath, insertIndex),
              ),
            splitPaneWithEditor: (targetPaneID, relativePath, axis, position) =>
              updateWorkspaceRuntime(workspaceId, (runtime) =>
                splitPaneWithEditorInWorkspaceRuntime(
                  runtime,
                  targetPaneID,
                  relativePath,
                  axis,
                  position,
                ),
              ),
            addDiffTab: (relativePath, source) =>
              updateWorkspaceRuntime(workspaceId, (runtime) =>
                addDiffTabToWorkspaceRuntime(runtime, relativePath, source),
              ),
            addReviewTab: () =>
              updateWorkspaceRuntime(workspaceId, (runtime) =>
                openReviewTabInWorkspaceRuntime(runtime),
              ),
            addTerminalTab: (slotId) =>
              updateWorkspaceRuntime(workspaceId, (runtime) =>
                addTerminalTabToWorkspaceRuntime(runtime, slotId),
              ),
            seedTerminal: () => Effect.void,
          },
        } satisfies WorkspaceSessionService),
    });

    return {
      loadDesktopState: () =>
        Effect.gen(function* () {
          yield* loadAppStateFromBackend();
          const selectedWorkspaceId = desktopStateSnapshot.selectedWorkspaceID;
          if (!selectedWorkspaceId) return;
          yield* selectWorkspaceById(selectedWorkspaceId).pipe(
            Effect.catchTag("WorkspaceSelectionError", (e) =>
              Effect.fail(new DesktopStateLoadError({ cause: e })),
            ),
          );
        }),
      reloadDesktopState: () =>
        Effect.gen(function* () {
          yield* loadAppStateFromBackend();
          yield* maybeStartSelectedWorkspace();
          yield* refreshActiveRuntimeTerminalStartup({ rebuildHiddenQueues: true });
        }),
      addProject: (path) =>
        Effect.tryPromise({
          try: async () => {
            const knownProjectIds = new Set(desktopStateSnapshot.projects.map((entry) => entry.id));
            const project = await invoke<ProjectRecord>("add_project", { selectedPath: path });
            const isNewProject = !knownProjectIds.has(project.id);
            let autoCreatedWorkspaceId: string | null = null;
            if (isNewProject) {
              const created = await invoke<WorkspaceRecord>("create_workspace", {
                projectId: project.id,
                workspaceKind: "linked",
              });
              autoCreatedWorkspaceId = created.id;
              pendingInitialTerminalWorkspaceIds.add(created.id);
            }
            const appState = await invoke<AppState>("load_app_state");
            applyAppState(appState);
            desktopStateSnapshot.selectedProjectID = project.id;
            if (autoCreatedWorkspaceId) {
              desktopStateSnapshot.selectedWorkspaceID = autoCreatedWorkspaceId;
            }
            publishDesktopNow();
            await invoke("save_selection", {
              projectId: project.id,
              workspaceId: autoCreatedWorkspaceId ?? desktopStateSnapshot.selectedWorkspaceID,
            });
          },
          catch: (cause) => new DesktopStateLoadError({ cause }),
        }),
      toggleProject: (projectId) =>
        Effect.tryPromise({
          try: async () => {
            await invoke("toggle_project", { projectId });
            const appState = await invoke<AppState>("load_app_state");
            applyAppState(appState);
          },
          catch: (cause) => new DesktopStateLoadError({ cause }),
        }),
      removeProject: (projectId) =>
        Effect.gen(function* () {
          const runtimeId = `project:${projectId}`;
          yield* clearRuntimeTerminalStartupTracking(runtimeId);
          yield* Effect.tryPromise({
            try: async () => {
              await invoke("stop_project_runtime", { projectId }).catch(() => {});
              delete desktopStateSnapshot.runtimes[runtimeId];
              if (desktopStateSnapshot.layoutTargetRuntimeId === runtimeId) {
                desktopStateSnapshot.layoutTargetRuntimeId = null;
              }
              scheduleDesktopPublish();
              scheduleRuntimePublish();
              await invoke("remove_project", { projectId });
              const appState = await invoke<AppState>("load_app_state");
              applyAppState(appState);
            },
            catch: (cause) => new DesktopStateLoadError({ cause }),
          });
          yield* refreshActiveRuntimeTerminalStartup({ rebuildHiddenQueues: true });
        }),
      selectProject: (projectId) =>
        updateDesktopState((state) => {
          state.selectedProjectID = projectId;
        }).pipe(
          Effect.tap(() => refreshActiveRuntimeTerminalStartup({ rebuildHiddenQueues: true })),
          Effect.tap(() =>
            Effect.tryPromise({
              try: () =>
                invoke("save_selection", {
                  projectId,
                  workspaceId: desktopStateSnapshot.selectedWorkspaceID,
                }),
              catch: (cause) => workspaceSelectionError(cause),
            }),
          ),
        ),
      selectWorkspace: (workspaceId) => selectWorkspaceById(workspaceId),
      ensureWorkspaceRuntimeConnected,
      activateSidebarSelection: () =>
        Effect.gen(function* () {
          if (!desktopStateSnapshot.selectedWorkspaceID) return;
          yield* selectWorkspaceById(desktopStateSnapshot.selectedWorkspaceID);
          yield* updateDesktopState((state) => {
            state.navigationArea = "workspace";
          });
        }).pipe(
          Effect.mapError((cause) =>
            cause instanceof WorkspaceSelectionError ? cause : workspaceSelectionError(cause),
          ),
        ),
      navigateSidebar: (offset) => selectWorkspaceRelative(offset, "sidebar"),
      switchWorkspaceRelative: (offset, navigationArea = "workspace") =>
        selectWorkspaceRelative(offset, navigationArea),
      setNavigationArea: (area) =>
        updateDesktopState((state) => {
          state.navigationArea = area;
        }),
      setSearchText: (text) =>
        updateDesktopState((state) => {
          state.searchText = text;
        }),
      setLayoutTargetRuntimeId: (runtimeId) =>
        updateDesktopState((state) => {
          state.layoutTargetRuntimeId = runtimeId;
        }),
      getEffectiveLayoutRuntimeId: () => Effect.sync(() => getEffectiveLayoutRuntimeId()),
      getSelectedProjectId: () => Effect.sync(() => desktopStateSnapshot.selectedProjectID),
      getSelectedWorkspaceId: () => Effect.sync(() => desktopStateSnapshot.selectedWorkspaceID),
      getWorkspaceRecord: (workspaceId) =>
        Effect.sync(
          () =>
            desktopStateSnapshot.workspaces.find((workspace) => workspace.id === workspaceId) ??
            null,
        ),
      getRuntimeState: (workspaceId) =>
        Effect.sync(() => readSessionRuntimeState(workspaceId) ?? null),
      getSlotState: (workspaceId, slotId) =>
        Effect.sync(() =>
          readSessionRuntimeState(workspaceId).slots.find((slot) => slot.id === slotId),
        ),
      cycleTab: (direction) =>
        Effect.gen(function* () {
          const runtimeId = getEffectiveLayoutRuntimeId();
          if (!runtimeId) return;
          const runtime = desktopStateSnapshot.runtimes[runtimeId];
          if (!runtime) return;
          yield* mutateRuntimeState(runtimeId, (current) => {
            cycleRuntimeTabs(current, direction);
          }).pipe(Effect.asVoid);
          yield* refreshRuntimeTerminalStartup(runtimeId, { rebuildHiddenQueue: true });
        }),
      addEditorTabForPath: (relativePath) =>
        Effect.gen(function* () {
          const workspaceId = desktopStateSnapshot.selectedWorkspaceID;
          if (!workspaceId) return;
          const session = yield* sessionCache.get(workspaceId);
          yield* session.commands.addEditorTab(relativePath);
        }).pipe(Effect.catchAll(() => Effect.void)),
      addDiffTabForPath: (relativePath, source) =>
        Effect.gen(function* () {
          const workspaceId = desktopStateSnapshot.selectedWorkspaceID;
          if (!workspaceId) return;
          yield* updateWorkspaceRuntime(workspaceId, (runtime) =>
            openDiffTabInWorkspaceRuntime(runtime, relativePath, source),
          );
        }),
      addReviewTab: () =>
        Effect.gen(function* () {
          const workspaceId = desktopStateSnapshot.selectedWorkspaceID;
          if (!workspaceId) return;
          yield* updateWorkspaceRuntime(workspaceId, (runtime) =>
            openReviewTabInWorkspaceRuntime(runtime),
          );
        }),
      updateWorkspacePrState: (workspaceId, prState) =>
        updateDesktopState((state) => {
          const workspace = state.workspaces.find((entry) => entry.id === workspaceId);
          if (workspace) {
            workspace.prState = prState as WorkspaceRecord["prState"];
          }
        }),
      setPrAwaiting: (workspaceId, awaiting) =>
        updateDesktopState((state) => {
          const next = new Set(state.prAwaitingWorkspaceIds);
          if (awaiting) {
            next.add(workspaceId);
          } else {
            next.delete(workspaceId);
          }
          state.prAwaitingWorkspaceIds = next;
        }).pipe(
          Effect.tap(() =>
            awaiting
              ? Effect.sync(() => {
                  setTimeout(() => {
                    if (desktopStateSnapshot.prAwaitingWorkspaceIds.has(workspaceId)) {
                      desktopStateSnapshot.prAwaitingWorkspaceIds.delete(workspaceId);
                      scheduleDesktopPublish();
                    }
                  }, 90_000);
                })
              : Effect.void,
          ),
        ),
      archiveWorkspace: (workspaceId) =>
        Effect.gen(function* () {
          yield* terminalSurfaceService
            .removeWorkspaceSurfaces(workspaceId)
            .pipe(Effect.orElseSucceed(() => undefined));
          yield* updateDesktopState((state) => {
            const workspace = state.workspaces.find((entry) => entry.id === workspaceId);
            if (workspace) {
              workspace.status = "archived";
            }
          });
          if (desktopStateSnapshot.selectedWorkspaceID === workspaceId) {
            const next = desktopStateSnapshot.workspaces.find(
              (workspace) =>
                workspace.projectId === desktopStateSnapshot.selectedProjectID &&
                workspace.id !== workspaceId &&
                workspace.status !== "archived",
            );
            if (next) {
              yield* selectWorkspaceById(next.id);
            }
          }
        }).pipe(
          Effect.mapError((cause) =>
            cause instanceof WorkspaceSelectionError
              ? cause
              : workspaceSelectionError(cause, workspaceId),
          ),
        ),
      addProjectTerminalGroup: (workspaceId, slotId, index) =>
        mutateRuntimeState(workspaceId, (runtime) => {
          addProjectTerminalGroupInRuntime(runtime, slotId, index);
        }).pipe(
          Effect.tap(() =>
            refreshRuntimeTerminalStartup(workspaceId, { rebuildHiddenQueue: true }),
          ),
          Effect.asVoid,
        ),
      splitProjectTerminalGroup: (workspaceId, groupId, slotId) =>
        mutateRuntimeState(workspaceId, (runtime) => {
          splitProjectTerminalGroupInRuntime(runtime, groupId, slotId);
        }).pipe(
          Effect.tap(() =>
            refreshRuntimeTerminalStartup(workspaceId, { rebuildHiddenQueue: true }),
          ),
          Effect.asVoid,
        ),
      closeProjectTerminal: (workspaceId, slotId) =>
        mutateRuntimeState(workspaceId, (runtime) => {
          closeProjectTerminalInRuntime(runtime, slotId);
        }).pipe(
          Effect.tap(() =>
            refreshRuntimeTerminalStartup(workspaceId, { rebuildHiddenQueue: true }),
          ),
          Effect.asVoid,
        ),
      selectProjectTerminalGroup: (workspaceId, groupId, slotId) =>
        mutateRuntimeState(workspaceId, (runtime) => {
          selectProjectTerminalGroupInRuntime(runtime, groupId, slotId);
        }).pipe(
          Effect.tap(() =>
            refreshRuntimeTerminalStartup(workspaceId, { rebuildHiddenQueue: true }),
          ),
          Effect.asVoid,
        ),
      focusProjectTerminal: (workspaceId, slotId) =>
        mutateRuntimeState(workspaceId, (runtime) => {
          focusProjectTerminalInRuntime(runtime, slotId);
        }).pipe(
          Effect.tap(() =>
            refreshRuntimeTerminalStartup(workspaceId, { rebuildHiddenQueue: true }),
          ),
          Effect.asVoid,
        ),
      setProjectTerminalPanelVisible: (workspaceId, visible) =>
        mutateRuntimeState(workspaceId, (runtime) => {
          setProjectTerminalPanelVisibleInRuntime(runtime, visible);
        }).pipe(
          Effect.tap(() =>
            refreshRuntimeTerminalStartup(workspaceId, { rebuildHiddenQueue: true }),
          ),
          Effect.asVoid,
        ),
      reorderProjectTerminalGroups: (workspaceId, fromIndex, toIndex) =>
        mutateRuntimeState(workspaceId, (runtime) => {
          reorderProjectTerminalGroupsInRuntime(runtime, fromIndex, toIndex);
        }).pipe(
          Effect.tap(() =>
            refreshRuntimeTerminalStartup(workspaceId, { rebuildHiddenQueue: true }),
          ),
          Effect.asVoid,
        ),
      reorderProjectTerminalGroupChildren: (workspaceId, groupId, fromIndex, toIndex) =>
        mutateRuntimeState(workspaceId, (runtime) => {
          reorderProjectTerminalGroupChildrenInRuntime(runtime, groupId, fromIndex, toIndex);
        }).pipe(
          Effect.tap(() =>
            refreshRuntimeTerminalStartup(workspaceId, { rebuildHiddenQueue: true }),
          ),
          Effect.asVoid,
        ),
      moveProjectTerminalToGroup: (workspaceId, slotId, targetGroupId, index) =>
        mutateRuntimeState(workspaceId, (runtime) => {
          moveProjectTerminalToGroupInRuntime(runtime, slotId, targetGroupId, index);
        }).pipe(
          Effect.tap(() =>
            refreshRuntimeTerminalStartup(workspaceId, { rebuildHiddenQueue: true }),
          ),
          Effect.asVoid,
        ),
      moveProjectTerminalToNewGroup: (workspaceId, slotId, index) =>
        mutateRuntimeState(workspaceId, (runtime) => {
          moveProjectTerminalToNewGroupInRuntime(runtime, slotId, index);
        }).pipe(
          Effect.tap(() =>
            refreshRuntimeTerminalStartup(workspaceId, { rebuildHiddenQueue: true }),
          ),
          Effect.asVoid,
        ),
      createWorkspace: (projectId, workspaceKind) =>
        Effect.gen(function* () {
          const created = yield* Effect.tryPromise({
            try: () =>
              invoke<WorkspaceRecord>("create_workspace", {
                projectId,
                ...(workspaceKind != null ? { workspaceKind } : {}),
              }),
            catch: (cause) => workspaceSelectionError(cause),
          });
          yield* Effect.sync(() => {
            pendingInitialTerminalWorkspaceIds.add(created.id);
            desktopStateSnapshot.projects = desktopStateSnapshot.projects.map((entry) =>
              entry.id === projectId ? { ...entry, isExpanded: true } : entry,
            );
            patchWorkspaceRecord(created);
          });
          yield* selectWorkspaceById(created.id);
        }),
      retryWorkspace: (workspaceId) =>
        Effect.gen(function* () {
          yield* Effect.sync(() => {
            interruptWorkspaceStartup(startupSet, workspaceId, true);
          });
          yield* Effect.tryPromise({
            try: async () => {
              const updated = await invoke<WorkspaceRecord>("retry_workspace", { workspaceId });
              patchWorkspaceRecord(updated);
            },
            catch: (cause) => workspaceSelectionError(cause, workspaceId),
          });
        }),
      removeWorkspace: (workspaceId) =>
        Effect.gen(function* () {
          yield* terminalSurfaceService
            .removeWorkspaceSurfaces(workspaceId)
            .pipe(Effect.orElseSucceed(() => undefined));
          yield* clearRuntimeTerminalStartupTracking(workspaceId);
          yield* Effect.sync(() => {
            interruptWorkspaceStartup(startupSet, workspaceId);
            delete desktopStateSnapshot.runtimes[workspaceId];
          });
          yield* Effect.tryPromise({
            try: async () => {
              await invoke("remove_workspace", { workspaceId });
              const appState = await invoke<AppState>("load_app_state");
              applyAppState(appState);
            },
            catch: (cause) => workspaceSelectionError(cause, workspaceId),
          });
          yield* maybeStartSelectedWorkspace();
          yield* refreshActiveRuntimeTerminalStartup({ rebuildHiddenQueues: true });
        }),
      markWorkspaceOpened: (workspaceId) =>
        Effect.tryPromise({
          try: () => invoke("mark_workspace_opened", { workspaceId }),
          catch: (cause) => workspaceSelectionError(cause, workspaceId),
        }),
      getWorkspaceSession: (workspaceId) => sessionCache.get(workspaceId),
    } satisfies DesktopWorkspaceServiceApi;
  }),
);
