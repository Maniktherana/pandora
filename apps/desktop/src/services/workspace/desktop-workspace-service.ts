import { invoke } from "@tauri-apps/api/core";
import { Cache, Context, Effect, Layer } from "effect";
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
import {
  buildDesktopView,
  type DesktopViewStateSnapshot,
} from "@/state/desktop-view-projections";
import { DesktopStateLoadError, WorkspaceSelectionError } from "@/services/service-errors";
import { DaemonEventQueue } from "@/services/daemon/daemon-event-queue";
import { DaemonGateway } from "@/services/daemon/daemon-gateway";
import {
  addDiffTabToWorkspaceRuntime,
  addEditorTabToWorkspaceRuntime,
  addTerminalTabToWorkspaceRuntime,
} from "@/state/workspaces/workspace-layout-state";
import {
  addTabToPaneInWorkspaceRuntime,
  cycleRuntimeTabs,
  moveTabInWorkspaceRuntime,
  openDiffTabInWorkspaceRuntime,
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
import { TerminalSurfaceService } from "@/services/terminal/terminal-surface-service";

export interface WorkspaceSessionService {
  readonly workspaceId: string;
  readonly commands: {
    readonly focusPane: (paneId: string) => Effect.Effect<void>;
    readonly addTabToPane: (
      targetPaneID: string,
      sourcePaneID: string,
      sourceTabIndex: number
    ) => Effect.Effect<void>;
    readonly removeTab: (paneID: string, tabIndex: number) => Effect.Effect<void>;
    readonly selectTabInPane: (paneID: string, index: number) => Effect.Effect<void>;
    readonly splitPane: (
      targetPaneID: string,
      sourcePaneID: string,
      sourceTabIndex: number,
      axis: "horizontal" | "vertical",
      position: "before" | "after"
    ) => Effect.Effect<void>;
    readonly moveTab: (
      fromPaneID: string,
      toPaneID: string,
      fromIndex: number,
      toIndex: number
    ) => Effect.Effect<void>;
    readonly reorderTab: (
      paneID: string,
      fromIndex: number,
      toIndex: number
    ) => Effect.Effect<void>;
    readonly closeTab: (paneID: string, tabIndex: number) => Effect.Effect<void>;
    readonly addEditorTab: (relativePath: string) => Effect.Effect<void>;
    readonly addDiffTab: (relativePath: string, source: DiffSource) => Effect.Effect<void>;
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
    workspaceId: string
  ) => Effect.Effect<void, WorkspaceSelectionError>;
  readonly activateSidebarSelection: () => Effect.Effect<void, WorkspaceSelectionError>;
  readonly navigateSidebar: (offset: number) => Effect.Effect<void>;
  readonly setNavigationArea: (area: DesktopViewStateSnapshot["navigationArea"]) => Effect.Effect<void>;
  readonly setSearchText: (text: string) => Effect.Effect<void>;
  readonly setLayoutTargetRuntimeId: (runtimeId: string | null) => Effect.Effect<void>;
  readonly getEffectiveLayoutRuntimeId: () => Effect.Effect<string | null>;
  readonly getSelectedProjectId: () => Effect.Effect<string | null>;
  readonly getSelectedWorkspaceId: () => Effect.Effect<string | null>;
  readonly getWorkspaceRecord: (workspaceId: string) => Effect.Effect<WorkspaceRecord | null>;
  readonly getRuntimeState: (workspaceId: string) => Effect.Effect<WorkspaceRuntimeState | null>;
  readonly getSlotState: (
    workspaceId: string,
    slotId: string
  ) => Effect.Effect<SlotState | undefined>;
  readonly cycleTab: (direction: -1 | 1) => Effect.Effect<void>;
  readonly addEditorTabForPath: (relativePath: string) => Effect.Effect<void>;
  readonly addDiffTabForPath: (
    relativePath: string,
    source: "working" | "staged"
  ) => Effect.Effect<void>;
  readonly updateWorkspacePrState: (workspaceId: string, prState: string) => Effect.Effect<void>;
  readonly setPrAwaiting: (workspaceId: string, awaiting: boolean) => Effect.Effect<void>;
  readonly archiveWorkspace: (workspaceId: string) => Effect.Effect<void, WorkspaceSelectionError>;
  readonly addProjectTerminalGroup: (
    workspaceId: string,
    slotId: string,
    index?: number
  ) => Effect.Effect<void>;
  readonly splitProjectTerminalGroup: (
    workspaceId: string,
    groupId: string,
    slotId: string
  ) => Effect.Effect<void>;
  readonly closeProjectTerminal: (workspaceId: string, slotId: string) => Effect.Effect<void>;
  readonly selectProjectTerminalGroup: (
    workspaceId: string,
    groupId: string,
    slotId?: string | null
  ) => Effect.Effect<void>;
  readonly focusProjectTerminal: (
    workspaceId: string,
    slotId: string | null
  ) => Effect.Effect<void>;
  readonly setProjectTerminalPanelVisible: (
    workspaceId: string,
    visible: boolean
  ) => Effect.Effect<void>;
  readonly reorderProjectTerminalGroups: (
    workspaceId: string,
    fromIndex: number,
    toIndex: number
  ) => Effect.Effect<void>;
  readonly reorderProjectTerminalGroupChildren: (
    workspaceId: string,
    groupId: string,
    fromIndex: number,
    toIndex: number
  ) => Effect.Effect<void>;
  readonly moveProjectTerminalToGroup: (
    workspaceId: string,
    slotId: string,
    targetGroupId: string,
    index?: number
  ) => Effect.Effect<void>;
  readonly moveProjectTerminalToNewGroup: (
    workspaceId: string,
    slotId: string,
    index: number
  ) => Effect.Effect<void>;
  readonly createWorkspace: (
    projectId: string,
    workspaceKind?: WorkspaceKind
  ) => Effect.Effect<void, WorkspaceSelectionError>;
  readonly retryWorkspace: (workspaceId: string) => Effect.Effect<void, WorkspaceSelectionError>;
  readonly removeWorkspace: (workspaceId: string) => Effect.Effect<void, WorkspaceSelectionError>;
  readonly markWorkspaceOpened: (workspaceId: string) => Effect.Effect<void, WorkspaceSelectionError>;
  readonly getWorkspaceSession: (
    workspaceId: string
  ) => Effect.Effect<WorkspaceSessionService, WorkspaceSelectionError>;
}

export class DesktopWorkspaceService extends Context.Tag("pandora/DesktopWorkspaceService")<
  DesktopWorkspaceService,
  DesktopWorkspaceServiceApi
>() {}

type DesktopStateSnapshot = {
  -readonly [K in keyof DesktopViewStateSnapshot]: DesktopViewStateSnapshot[K] extends Readonly<Record<string, infer V>>
    ? Record<string, V>
    : DesktopViewStateSnapshot[K] extends readonly (infer U)[]
    ? U[]
    : DesktopViewStateSnapshot[K];
} & {
  prAwaitingWorkspaceIds: Set<string>;
};

function workspaceSelectionError(cause: unknown, workspaceId?: string) {
  return new WorkspaceSelectionError({ cause, workspaceId });
}

function publishDesktopView(snapshot: DesktopViewStateSnapshot) {
  useDesktopViewStore.getState().setDesktopView(buildDesktopView(snapshot));
}

function cloneRuntimeState(runtime: WorkspaceRuntimeState): WorkspaceRuntimeState {
  return structuredClone(runtime);
}

function persistWorkspaceLayout(snapshot: DesktopViewStateSnapshot, workspaceId: string) {
  const runtime = snapshot.runtimes[workspaceId];
  const root =
    runtime?.root?.type === "leaf" && runtime.root.tabs.length === 0
      ? null
      : runtime?.root ?? null;
  const layout = {
    root,
    focusedPaneID: root ? runtime?.focusedPaneID ?? null : null,
  };

  return Effect.tryPromise({
    try: () => invoke("save_workspace_layout", { workspaceId, layout }),
    catch: (cause) => cause,
  }).pipe(Effect.catchAll(() => Effect.void), Effect.asVoid);
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
            group.children.every((child) => typeof child === "string")
        )
        .map((group) => ({
          id: group.id,
          children: [...group.children],
        })),
      activeGroupIndex:
        typeof parsed.activeGroupIndex === "number" ? parsed.activeGroupIndex : 0,
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
    Effect.catchAll(() => Effect.succeed(null))
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
  }).pipe(Effect.catchAll(() => Effect.void), Effect.asVoid);
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
      slot.sessionDefIDs.length > 0
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
    const publish = () => publishDesktopView(desktopStateSnapshot);
    const getEffectiveLayoutRuntimeId = () =>
      desktopStateSnapshot.layoutTargetRuntimeId ?? desktopStateSnapshot.selectedWorkspaceID;

    const applyAppState = (appState: AppState) => {
      desktopStateSnapshot.projects = structuredClone(appState.projects);
      desktopStateSnapshot.workspaces = structuredClone(appState.workspaces);
      desktopStateSnapshot.selectedProjectID = appState.selectedProjectId;
      desktopStateSnapshot.selectedWorkspaceID = appState.selectedWorkspaceId;

      const allowedRuntimeIds = new Set<string>(
        appState.workspaces.map((workspace) => workspace.id)
      );
      for (const project of appState.projects) {
        allowedRuntimeIds.add(`project:${project.id}`);
      }

      for (const runtimeId of Object.keys(desktopStateSnapshot.runtimes)) {
        if (!allowedRuntimeIds.has(runtimeId)) {
          delete desktopStateSnapshot.runtimes[runtimeId];
        }
      }

      publish();
    };

    const loadAppStateFromBackend = () =>
      Effect.tryPromise({
        try: () => invoke<AppState>("load_app_state"),
        catch: (cause) => new DesktopStateLoadError({ cause }),
      }).pipe(
        Effect.tap((appState) =>
          Effect.sync(() => {
            applyAppState(appState);
          })
        )
      );

    const updateDesktopState = (mutate: (state: DesktopStateSnapshot) => void) =>
      Effect.sync(() => {
        mutate(desktopStateSnapshot);
        publish();
      });

    /** When the daemon has not created any terminal slot yet, seed one so the workspace always has a terminal tab. */
    const ensureWorkspaceDefaultTerminal = (workspaceId: string) => {
      if (isProjectRuntimeKey(workspaceId)) return;
      const runtime = desktopStateSnapshot.runtimes[workspaceId];
      if (!runtime) return;
      if (runtime.layoutLoading) return;
      if (runtime.connectionState !== "connected") return;
      if (runtime.slots.some((s) => s.kind === "terminal_slot")) return;
      void Promise.all([import("@/app/desktop-runtime"), import("@/services/terminal/terminal-command-service")]).then(
        ([{ getDesktopRuntime }, { TerminalCommandService }]) => {
          getDesktopRuntime().runFork(
            Effect.flatMap(TerminalCommandService, (svc) => svc.createWorkspaceTerminal(workspaceId))
          );
        }
      );
    };

    const ensureRuntimeLayoutForWorkspace = (workspaceId: string) => {
      const runtime = desktopStateSnapshot.runtimes[workspaceId];
      if (!runtime) return;
      if (isProjectRuntimeKey(workspaceId)) {
        ensureProjectTerminalPanelState(runtime);
      } else {
        ensureRuntimeLayoutState(runtime);
      }
      publish();
      ensureWorkspaceDefaultTerminal(workspaceId);
    };

    const startupGet: WorkspaceStartupGet = () =>
      ({
        projects: desktopStateSnapshot.projects as ProjectRecord[],
        runtimes: desktopStateSnapshot.runtimes,
        ensureRuntimeLayout: ensureRuntimeLayoutForWorkspace,
      }) satisfies WorkspaceStartupState;

    const startupSet: WorkspaceStartupSet = ((update: unknown) => {
      if (typeof update === "function") {
        (update as (state: WritableDraft<WorkspaceStartupState>) => void)(
          desktopStateSnapshot as unknown as WritableDraft<WorkspaceStartupState>
        );
      } else if (update && typeof update === "object") {
        Object.assign(desktopStateSnapshot, update);
      }
      publish();
    }) as WorkspaceStartupSet;

    const { startWorkspaceStartup, interruptWorkspaceStartup } = createWorkspaceStartupController();

    const readSessionRuntimeState = (workspaceId: string) => {
      const existing = desktopStateSnapshot.runtimes[workspaceId];
      if (existing) return existing;

      const runtime = createRuntimeState(workspaceId);
      desktopStateSnapshot.runtimes[workspaceId] = runtime;
      publish();
      return runtime;
    };

    const writeSessionRuntimeState = (workspaceId: string, runtime: WorkspaceRuntimeState) => {
      desktopStateSnapshot.runtimes[workspaceId] = runtime;
      publish();
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
      attemptsLeft = 50
    ): Effect.Effect<void, WorkspaceSelectionError> =>
      Effect.gen(function* () {
        const runtime = desktopStateSnapshot.runtimes[workspaceId];
        if (runtime?.connectionState === "connected") return;
        if (attemptsLeft <= 0) {
          yield* Effect.fail(
            workspaceSelectionError(
              new Error(`Workspace runtime did not connect for ${workspaceId}`),
              workspaceId
            )
          );
        }

        yield* Effect.sleep("100 millis");
        yield* waitForWorkspaceConnection(workspaceId, attemptsLeft - 1);
      });

    const ensureWorkspaceRuntimeConnected = (workspaceId: string) =>
      Effect.gen(function* () {
        if (desktopStateSnapshot.runtimes[workspaceId]?.connectionState === "connected") return;

        const workspace = desktopStateSnapshot.workspaces.find((entry) => entry.id === workspaceId);
        if (!workspace || workspace.status !== "ready") {
          return yield* Effect.fail(
            workspaceSelectionError(new Error(`Workspace ${workspaceId} is not ready`), workspaceId)
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
          const workspace = desktopStateSnapshot.workspaces.find((entry) => entry.id === workspaceId);
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
        Effect.flatMap((workspace) =>
          Effect.gen(function* () {
            yield* updateDesktopState((state) => {
              state.selectedWorkspaceID = workspace.id;
              state.selectedProjectID = workspace.projectId;
              state.navigationArea = "sidebar";
              state.layoutTargetRuntimeId = null;
            });
            yield* Effect.sync(() => {
              void invoke("save_selection", {
                projectId: workspace.projectId,
                workspaceId: workspace.id,
              });
              void invoke("mark_workspace_opened", { workspaceId: workspace.id });
            });
            if (workspace.status === "ready") {
              yield* Effect.sync(() => {
                syncProjectScopedRuntime(startupSet, startupGet, workspace);
                startWorkspaceStartup(startupSet, startupGet, workspace);
              });
              yield* hydrateProjectRuntimePanel(projectRuntimeKey(workspace.projectId));
            }
          })
        )
      );

    const maybeStartSelectedWorkspace = () =>
      Effect.gen(function* () {
        const selectedWorkspaceId = desktopStateSnapshot.selectedWorkspaceID;
        if (!selectedWorkspaceId) return;
        const workspace = desktopStateSnapshot.workspaces.find((entry) => entry.id === selectedWorkspaceId);
        if (!workspace || workspace.status !== "ready") return;
        yield* Effect.sync(() => {
          syncProjectScopedRuntime(startupSet, startupGet, workspace);
          startWorkspaceStartup(startupSet, startupGet, workspace);
        });
        yield* hydrateProjectRuntimePanel(projectRuntimeKey(workspace.projectId));
      });

    const maybeOpenSessionInstances = (workspaceId: string, slotIds: string[]) =>
      Effect.gen(function* () {
        if (slotIds.length === 0) return;
        const client = yield* daemonGateway.getClient();
        if (!client) return;

        const runtime = readSessionRuntimeState(workspaceId);
        if (!runtime) return;

        for (const slotId of slotIds) {
          const slot = runtime.slots.find((entry) => entry.id === slotId);
          if (slot && shouldAutoOpenTerminalSlot(slot)) {
            client.openSessionInstance(workspaceId, slot.sessionDefIDs[0]);
          }
        }
      });

    const updateWorkspaceRuntime = (
      workspaceId: string,
      mutate: (runtime: WritableDraft<WorkspaceRuntimeState>) => boolean | void
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
            : Effect.void
        )
      );

    const mutateRuntimeState = <T>(
      workspaceId: string,
      mutate: (runtime: WritableDraft<WorkspaceRuntimeState>) => T
    ) =>
      Effect.sync(() => {
        const current = readSessionRuntimeState(workspaceId);
        const previousProjectPanel =
          isProjectRuntimeKey(workspaceId) ? JSON.stringify(current.terminalPanel ?? null) : null;
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
            : Effect.succeed(result)
        )
      );

    const handleTerminalOutput = (workspaceId: string, data: string) =>
      updateDesktopState((state) => {
        if (!state.prAwaitingWorkspaceIds.has(workspaceId)) return;

        const match = data.match(/https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/(\d+)/);
        if (!match) return;

        const prUrl = match[0];
        const prNumber = parseInt(match[1], 10);
        const next = new Set(state.prAwaitingWorkspaceIds);
        next.delete(workspaceId);
        state.prAwaitingWorkspaceIds = next;
        const workspace = state.workspaces.find((entry) => entry.id === workspaceId);
        if (workspace) {
          workspace.prUrl = prUrl;
          workspace.prNumber = prNumber;
          workspace.prState = "open";
        }
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
              const client = yield* daemonGateway.getClient();
              if (client) {
                yield* Effect.sync(() => {
                  client.requestSnapshot(event.workspaceId);
                });
              }
              yield* Effect.sync(() => ensureWorkspaceDefaultTerminal(event.workspaceId));
            }
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
                  liveSlotIds
                );
                runtime.root = layout.root as WritableDraft<LayoutNode> | null;
                runtime.focusedPaneID = layout.focusedPaneID;
                ensureRuntimeLayoutState(runtime);
              }
            });
            yield* maybeOpenSessionInstances(
              event.workspaceId,
              event.slots.map((slot) => slot.id)
            );
            yield* Effect.sync(() => ensureWorkspaceDefaultTerminal(event.workspaceId));
            break;
          case "session_snapshot":
            yield* mutateRuntimeState(event.workspaceId, (runtime) => {
              replaceRuntimeSessions(runtime, event.sessions);
            });
            break;
          case "slot_state_changed":
            yield* mutateRuntimeState(event.workspaceId, (runtime) => {
              updateRuntimeSlotState(runtime, event.slot);
            });
            break;
          case "session_state_changed":
            {
              const crashedTerminalSlotId = yield* mutateRuntimeState(event.workspaceId, (runtime) =>
                updateRuntimeSessionState(runtime, event.session).crashedTerminalSlotId
              );
              if (crashedTerminalSlotId) {
                yield* mutateRuntimeState(event.workspaceId, (runtime) => {
                  closeProjectTerminalInRuntime(runtime, crashedTerminalSlotId);
                });
              }
            }
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
            yield* maybeOpenSessionInstances(event.workspaceId, [event.slot.id]);
            yield* Effect.sync(() => ensureWorkspaceDefaultTerminal(event.workspaceId));
            break;
          case "slot_removed":
            yield* mutateRuntimeState(event.workspaceId, (runtime) => {
              removeRuntimeSlotState(runtime, event.slotID);
            });
            break;
          case "session_opened":
            yield* mutateRuntimeState(event.workspaceId, (runtime) => {
              addRuntimeSessionState(runtime, event.session);
            });
            break;
          case "session_closed":
            yield* mutateRuntimeState(event.workspaceId, (runtime) => {
              removeRuntimeSessionState(runtime, event.sessionID);
            });
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
          })
        )
      )
    );

    yield* Effect.forkScoped(Effect.forever(processDaemonEvent));

    const sessionCache = yield* Cache.make<string, WorkspaceSessionService, WorkspaceSelectionError>({
      capacity: 3,
      timeToLive: "30 minutes",
      lookup: (workspaceId) =>
        Effect.succeed({
          workspaceId,
          commands: {
            focusPane: (paneId) =>
              updateWorkspaceRuntime(workspaceId, (runtime) =>
                setFocusedPaneInWorkspaceRuntime(runtime, paneId)
              ),
            addTabToPane: (targetPaneID, sourcePaneID, sourceTabIndex) =>
              updateWorkspaceRuntime(workspaceId, (runtime) =>
                addTabToPaneInWorkspaceRuntime(
                  runtime,
                  targetPaneID,
                  sourcePaneID,
                  sourceTabIndex
                )
              ),
            removeTab: (paneID, tabIndex) =>
              updateWorkspaceRuntime(workspaceId, (runtime) =>
                removeTabFromWorkspaceRuntime(runtime, paneID, tabIndex)
              ),
            selectTabInPane: (paneID, index) =>
              updateWorkspaceRuntime(workspaceId, (runtime) =>
                selectTabInPaneInWorkspaceRuntime(runtime, paneID, index)
              ),
            splitPane: (targetPaneID, sourcePaneID, sourceTabIndex, axis, position) =>
              updateWorkspaceRuntime(workspaceId, (runtime) =>
                splitPaneInWorkspaceRuntime(
                  runtime,
                  targetPaneID,
                  sourcePaneID,
                  sourceTabIndex,
                  axis,
                  position
                )
              ),
            moveTab: (fromPaneID, toPaneID, fromIndex, toIndex) =>
              updateWorkspaceRuntime(workspaceId, (runtime) =>
                moveTabInWorkspaceRuntime(runtime, fromPaneID, toPaneID, fromIndex, toIndex)
              ),
            reorderTab: (paneID, fromIndex, toIndex) =>
              updateWorkspaceRuntime(workspaceId, (runtime) =>
                reorderTabInWorkspaceRuntime(runtime, paneID, fromIndex, toIndex)
              ),
            closeTab: (paneID, tabIndex) =>
              updateWorkspaceRuntime(workspaceId, (runtime) =>
                removeTabFromWorkspaceRuntime(runtime, paneID, tabIndex)
              ),
            addEditorTab: (relativePath) =>
              updateWorkspaceRuntime(workspaceId, (runtime) =>
                addEditorTabToWorkspaceRuntime(runtime, relativePath)
              ),
            addDiffTab: (relativePath, source) =>
              updateWorkspaceRuntime(workspaceId, (runtime) =>
                addDiffTabToWorkspaceRuntime(runtime, relativePath, source)
              ),
            addTerminalTab: (slotId) =>
              updateWorkspaceRuntime(workspaceId, (runtime) =>
                addTerminalTabToWorkspaceRuntime(runtime, slotId)
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
              Effect.fail(new DesktopStateLoadError({ cause: e }))
            )
          );
        }),
      reloadDesktopState: () =>
        Effect.gen(function* () {
          yield* loadAppStateFromBackend();
          yield* maybeStartSelectedWorkspace();
        }),
      addProject: (path) =>
        Effect.tryPromise({
          try: async () => {
            const project = await invoke<ProjectRecord>("add_project", { selectedPath: path });
            const appState = await invoke<AppState>("load_app_state");
            applyAppState(appState);
            desktopStateSnapshot.selectedProjectID = project.id;
            publish();
            await invoke("save_selection", {
              projectId: project.id,
              workspaceId: desktopStateSnapshot.selectedWorkspaceID,
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
        Effect.tryPromise({
          try: async () => {
            const runtimeId = `project:${projectId}`;
            await invoke("stop_project_runtime", { projectId }).catch(() => {});
            delete desktopStateSnapshot.runtimes[runtimeId];
            if (desktopStateSnapshot.layoutTargetRuntimeId === runtimeId) {
              desktopStateSnapshot.layoutTargetRuntimeId = null;
            }
            publish();
            await invoke("remove_project", { projectId });
            const appState = await invoke<AppState>("load_app_state");
            applyAppState(appState);
          },
          catch: (cause) => new DesktopStateLoadError({ cause }),
        }),
      selectProject: (projectId) =>
        updateDesktopState((state) => {
          state.selectedProjectID = projectId;
        }).pipe(
          Effect.tap(() =>
            Effect.tryPromise({
              try: () =>
                invoke("save_selection", {
                  projectId,
                  workspaceId: desktopStateSnapshot.selectedWorkspaceID,
                }),
              catch: (cause) => workspaceSelectionError(cause),
            })
          )
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
            cause instanceof WorkspaceSelectionError
              ? cause
              : workspaceSelectionError(cause)
          )
        ),
      navigateSidebar: (offset) =>
        Effect.gen(function* () {
          if (desktopStateSnapshot.workspaces.length === 0) return;
          const currentIndex = desktopStateSnapshot.workspaces.findIndex(
            (workspace) => workspace.id === desktopStateSnapshot.selectedWorkspaceID
          );
          const nextIndex = Math.max(
            0,
            Math.min(desktopStateSnapshot.workspaces.length - 1, currentIndex + offset)
          );
          const workspace = desktopStateSnapshot.workspaces[nextIndex];
          if (!workspace) return;
          yield* selectWorkspaceById(workspace.id);
        }).pipe(Effect.catchAll(() => Effect.void)),
      setNavigationArea: (area) => updateDesktopState((state) => { state.navigationArea = area; }),
      setSearchText: (text) => updateDesktopState((state) => { state.searchText = text; }),
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
            desktopStateSnapshot.workspaces.find((workspace) => workspace.id === workspaceId) ?? null
        ),
      getRuntimeState: (workspaceId) =>
        Effect.sync(() => readSessionRuntimeState(workspaceId) ?? null),
      getSlotState: (workspaceId, slotId) =>
        Effect.sync(() => readSessionRuntimeState(workspaceId).slots.find((slot) => slot.id === slotId)),
      cycleTab: (direction) =>
        Effect.gen(function* () {
          const runtimeId = getEffectiveLayoutRuntimeId();
          if (!runtimeId) return;
          const runtime = desktopStateSnapshot.runtimes[runtimeId];
          if (!runtime) return;
          yield* mutateRuntimeState(runtimeId, (current) => {
            cycleRuntimeTabs(current, direction);
          }).pipe(Effect.asVoid);
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
            openDiffTabInWorkspaceRuntime(runtime, relativePath, source)
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
                      publish();
                    }
                  }, 90_000);
                })
              : Effect.void
          )
        ),
      archiveWorkspace: (workspaceId) =>
        Effect.gen(function* () {
          yield* terminalSurfaceService.removeWorkspaceSurfaces(workspaceId).pipe(
            Effect.orElseSucceed(() => undefined)
          );
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
                workspace.status !== "archived"
            );
            if (next) {
              yield* selectWorkspaceById(next.id);
            }
          }
        }).pipe(
          Effect.mapError((cause) =>
            cause instanceof WorkspaceSelectionError
              ? cause
              : workspaceSelectionError(cause, workspaceId)
          )
        ),
      addProjectTerminalGroup: (workspaceId, slotId, index) =>
        mutateRuntimeState(workspaceId, (runtime) => {
          addProjectTerminalGroupInRuntime(runtime, slotId, index);
        }).pipe(Effect.asVoid),
      splitProjectTerminalGroup: (workspaceId, groupId, slotId) =>
        mutateRuntimeState(workspaceId, (runtime) => {
          splitProjectTerminalGroupInRuntime(runtime, groupId, slotId);
        }).pipe(Effect.asVoid),
      closeProjectTerminal: (workspaceId, slotId) =>
        mutateRuntimeState(workspaceId, (runtime) => {
          closeProjectTerminalInRuntime(runtime, slotId);
        }).pipe(Effect.asVoid),
      selectProjectTerminalGroup: (workspaceId, groupId, slotId) =>
        mutateRuntimeState(workspaceId, (runtime) => {
          selectProjectTerminalGroupInRuntime(runtime, groupId, slotId);
        }).pipe(Effect.asVoid),
      focusProjectTerminal: (workspaceId, slotId) =>
        mutateRuntimeState(workspaceId, (runtime) => {
          focusProjectTerminalInRuntime(runtime, slotId);
        }).pipe(Effect.asVoid),
      setProjectTerminalPanelVisible: (workspaceId, visible) =>
        mutateRuntimeState(workspaceId, (runtime) => {
          setProjectTerminalPanelVisibleInRuntime(runtime, visible);
        }).pipe(Effect.asVoid),
      reorderProjectTerminalGroups: (workspaceId, fromIndex, toIndex) =>
        mutateRuntimeState(workspaceId, (runtime) => {
          reorderProjectTerminalGroupsInRuntime(runtime, fromIndex, toIndex);
        }).pipe(Effect.asVoid),
      reorderProjectTerminalGroupChildren: (workspaceId, groupId, fromIndex, toIndex) =>
        mutateRuntimeState(workspaceId, (runtime) => {
          reorderProjectTerminalGroupChildrenInRuntime(runtime, groupId, fromIndex, toIndex);
        }).pipe(Effect.asVoid),
      moveProjectTerminalToGroup: (workspaceId, slotId, targetGroupId, index) =>
        mutateRuntimeState(workspaceId, (runtime) => {
          moveProjectTerminalToGroupInRuntime(runtime, slotId, targetGroupId, index);
        }).pipe(Effect.asVoid),
      moveProjectTerminalToNewGroup: (workspaceId, slotId, index) =>
        mutateRuntimeState(workspaceId, (runtime) => {
          moveProjectTerminalToNewGroupInRuntime(runtime, slotId, index);
        }).pipe(Effect.asVoid),
      createWorkspace: (projectId, workspaceKind) =>
        Effect.tryPromise({
          try: async () => {
            await invoke("create_workspace", {
              projectId,
              ...(workspaceKind != null ? { workspaceKind } : {}),
            });
            const appState = await invoke<AppState>("load_app_state");
            applyAppState(appState);
          },
          catch: (cause) => workspaceSelectionError(cause),
        }),
      retryWorkspace: (workspaceId) =>
        Effect.gen(function* () {
          yield* Effect.sync(() => {
            interruptWorkspaceStartup(startupSet, workspaceId, true);
          });
          yield* Effect.tryPromise({
            try: async () => {
              await invoke("retry_workspace", { workspaceId });
              const appState = await invoke<AppState>("load_app_state");
              applyAppState(appState);
            },
            catch: (cause) => workspaceSelectionError(cause, workspaceId),
          });
          yield* maybeStartSelectedWorkspace();
        }),
      removeWorkspace: (workspaceId) =>
        Effect.gen(function* () {
          yield* terminalSurfaceService.removeWorkspaceSurfaces(workspaceId).pipe(
            Effect.orElseSucceed(() => undefined)
          );
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
        }),
      markWorkspaceOpened: (workspaceId) =>
        Effect.tryPromise({
          try: () => invoke("mark_workspace_opened", { workspaceId }),
          catch: (cause) => workspaceSelectionError(cause, workspaceId),
        }),
      getWorkspaceSession: (workspaceId) => sessionCache.get(workspaceId),
    } satisfies DesktopWorkspaceServiceApi;
  })
);
