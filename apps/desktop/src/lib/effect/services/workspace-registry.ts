import { Cache, Context, Effect, Layer, SubscriptionRef } from "effect";
import type { WorkspaceKind, WorkspaceRecord } from "@/lib/shared/types";
import type { WorkspaceStoreState } from "@/stores/workspace-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { AppViewModel, WorkspaceViewModel } from "../view-model";
import { buildAppViewModel, buildWorkspaceViewModel } from "../view-model";
import { useAppViewStore } from "@/stores/app-view-store";
import { WorkspaceLoadError, WorkspaceSelectionError } from "../errors";

export interface WorkspaceSessionHandle {
  readonly workspaceId: string;
  readonly view: SubscriptionRef.SubscriptionRef<WorkspaceViewModel>;
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
    readonly seedTerminal: () => Effect.Effect<void>;
  };
}

export interface WorkspaceRegistryService {
  readonly view: SubscriptionRef.SubscriptionRef<AppViewModel>;
  readonly loadAppState: () => Effect.Effect<void, WorkspaceLoadError>;
  readonly reloadFromBackend: () => Effect.Effect<void, WorkspaceLoadError>;
  readonly addProject: (path: string) => Effect.Effect<void, WorkspaceLoadError>;
  readonly toggleProject: (projectId: string) => Effect.Effect<void, WorkspaceLoadError>;
  readonly removeProject: (projectId: string) => Effect.Effect<void, WorkspaceLoadError>;
  readonly selectProject: (projectId: string) => Effect.Effect<void, WorkspaceSelectionError>;
  readonly selectWorkspace: (workspaceId: string) => Effect.Effect<void, WorkspaceSelectionError>;
  readonly activateSidebarSelection: () => Effect.Effect<void, WorkspaceSelectionError>;
  readonly navigateSidebar: (offset: number) => Effect.Effect<void>;
  readonly setNavigationArea: (area: WorkspaceStoreState["navigationArea"]) => Effect.Effect<void>;
  readonly setSearchText: (text: string) => Effect.Effect<void>;
  readonly setLayoutTargetRuntimeId: (runtimeId: string | null) => Effect.Effect<void>;
  readonly cycleTab: (direction: -1 | 1) => Effect.Effect<void>;
  readonly addDiffTabForPath: (
    relativePath: string,
    source: "working" | "staged"
  ) => Effect.Effect<void>;
  readonly updateWorkspacePrState: (workspaceId: string, prState: string) => Effect.Effect<void>;
  readonly setPrAwaiting: (workspaceId: string, awaiting: boolean) => Effect.Effect<void>;
  readonly archiveWorkspace: (workspaceId: string) => Effect.Effect<void>;
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
  ) => Effect.Effect<WorkspaceSessionHandle, WorkspaceSelectionError>;
}

export class WorkspaceRegistry extends Context.Tag("pandora/WorkspaceRegistry")<
  WorkspaceRegistry,
  WorkspaceRegistryService
>() {}

function workspaceSelectionError(cause: unknown, workspaceId?: string) {
  return new WorkspaceSelectionError({ cause, workspaceId });
}

export const WorkspaceRegistryLive = Layer.effect(
  WorkspaceRegistry,
  Effect.gen(function* () {
    const initialView = buildAppViewModel(useWorkspaceStore.getState());
    const view = yield* SubscriptionRef.make(initialView);
    const sessionViews = new Map<string, SubscriptionRef.SubscriptionRef<WorkspaceViewModel>>();
    useAppViewStore.getState().setAppView(initialView);

    useWorkspaceStore.subscribe((state) => {
      const nextView = buildAppViewModel(state);
      useAppViewStore.getState().setAppView(nextView);
      void Effect.runPromise(SubscriptionRef.set(view, nextView));
      for (const [workspaceId, sessionView] of sessionViews) {
        void Effect.runPromise(
          SubscriptionRef.set(sessionView, buildWorkspaceViewModel(nextView, workspaceId))
        );
      }
    });

    const sessionCache = yield* Cache.make<string, WorkspaceSessionHandle, WorkspaceSelectionError>({
      capacity: 3,
      timeToLive: "30 minutes",
      lookup: (workspaceId) =>
        Effect.gen(function* () {
          const current = yield* SubscriptionRef.get(view);
          const sessionView = yield* SubscriptionRef.make(buildWorkspaceViewModel(current, workspaceId));
          sessionViews.set(workspaceId, sessionView);

          return {
            workspaceId,
            view: sessionView,
            commands: {
              focusPane: (paneId) =>
                Effect.sync(() => {
                  useWorkspaceStore.getState().setFocusedPane(paneId);
                }),
              addTabToPane: (targetPaneID, sourcePaneID, sourceTabIndex) =>
                Effect.sync(() => {
                  useWorkspaceStore
                    .getState()
                    .addTabToPane(targetPaneID, sourcePaneID, sourceTabIndex);
                }),
              removeTab: (paneID, tabIndex) =>
                Effect.sync(() => {
                  useWorkspaceStore.getState().removePaneTabByIndex(paneID, tabIndex);
                }),
              selectTabInPane: (paneID, index) =>
                Effect.sync(() => {
                  useWorkspaceStore.getState().selectTabInPane(paneID, index);
                }),
              splitPane: (targetPaneID, sourcePaneID, sourceTabIndex, axis, position) =>
                Effect.sync(() => {
                  useWorkspaceStore
                    .getState()
                    .splitPane(targetPaneID, sourcePaneID, sourceTabIndex, axis, position);
                }),
              moveTab: (fromPaneID, toPaneID, fromIndex, toIndex) =>
                Effect.sync(() => {
                  useWorkspaceStore.getState().moveTab(fromPaneID, toPaneID, fromIndex, toIndex);
                }),
              reorderTab: (paneID, fromIndex, toIndex) =>
                Effect.sync(() => {
                  useWorkspaceStore.getState().reorderTab(paneID, fromIndex, toIndex);
                }),
              closeTab: (paneID, tabIndex) =>
                Effect.sync(() => {
                  useWorkspaceStore.getState().removePaneTabByIndex(paneID, tabIndex);
                }),
              seedTerminal: () => Effect.void,
            },
          } satisfies WorkspaceSessionHandle;
        }),
    });

    return {
      view,
      loadAppState: () =>
        Effect.tryPromise({
          try: async () => {
            const store = useWorkspaceStore.getState();
            await store.loadAppState();
            const selectedWorkspaceId = useWorkspaceStore.getState().selectedWorkspaceID;
            if (!selectedWorkspaceId) return;
            const workspace = useWorkspaceStore
              .getState()
              .workspaces.find((entry) => entry.id === selectedWorkspaceId);
            if (workspace?.status === "ready") {
              useWorkspaceStore.getState().selectWorkspace(workspace);
            }
          },
          catch: (cause) => new WorkspaceLoadError({ cause }),
        }),
      reloadFromBackend: () =>
        Effect.tryPromise({
          try: () => useWorkspaceStore.getState().reloadFromBackend(),
          catch: (cause) => new WorkspaceLoadError({ cause }),
        }),
      addProject: (path) =>
        Effect.tryPromise({
          try: () => useWorkspaceStore.getState().addProject(path),
          catch: (cause) => new WorkspaceLoadError({ cause }),
        }),
      toggleProject: (projectId) =>
        Effect.tryPromise({
          try: () => useWorkspaceStore.getState().toggleProject(projectId),
          catch: (cause) => new WorkspaceLoadError({ cause }),
        }),
      removeProject: (projectId) =>
        Effect.tryPromise({
          try: () => useWorkspaceStore.getState().removeProject(projectId),
          catch: (cause) => new WorkspaceLoadError({ cause }),
        }),
      selectProject: (projectId) =>
        Effect.try({
          try: () => {
            useWorkspaceStore.getState().selectProject(projectId);
          },
          catch: (cause) => workspaceSelectionError(cause),
        }),
      selectWorkspace: (workspaceId) =>
        Effect.try({
          try: () => {
            const workspace = useWorkspaceStore
              .getState()
              .workspaces.find((entry) => entry.id === workspaceId);
            if (!workspace) {
              throw workspaceSelectionError(new Error("Workspace not found"), workspaceId);
            }
            useWorkspaceStore.getState().selectWorkspace(workspace);
          },
          catch: (cause) =>
            cause instanceof WorkspaceSelectionError
              ? cause
              : workspaceSelectionError(cause, workspaceId),
        }),
      activateSidebarSelection: () =>
        Effect.try({
          try: () => {
            const state = useWorkspaceStore.getState();
            if (!state.selectedWorkspaceID) return;
            const workspace = state.workspaces.find((entry) => entry.id === state.selectedWorkspaceID);
            if (!workspace) return;
            state.selectWorkspace(workspace);
            state.setNavigationArea("workspace");
          },
          catch: (cause) => workspaceSelectionError(cause),
        }),
      navigateSidebar: (offset) =>
        Effect.sync(() => {
          useWorkspaceStore.getState().navigateSidebar(offset);
        }),
      setNavigationArea: (area) =>
        Effect.sync(() => {
          useWorkspaceStore.getState().setNavigationArea(area);
        }),
      setSearchText: (text) =>
        Effect.sync(() => {
          useWorkspaceStore.getState().setSearchText(text);
        }),
      setLayoutTargetRuntimeId: (runtimeId) =>
        Effect.sync(() => {
          useWorkspaceStore.getState().setLayoutTargetRuntimeId(runtimeId);
        }),
      cycleTab: (direction) =>
        Effect.sync(() => {
          useWorkspaceStore.getState().cycleTab(direction);
        }),
      addDiffTabForPath: (relativePath, source) =>
        Effect.sync(() => {
          useWorkspaceStore.getState().addDiffTabForPath(relativePath, source);
        }),
      updateWorkspacePrState: (workspaceId, prState) =>
        Effect.sync(() => {
          useWorkspaceStore.getState().updateWorkspacePrState(workspaceId, prState);
        }),
      setPrAwaiting: (workspaceId, awaiting) =>
        Effect.sync(() => {
          useWorkspaceStore.getState().setPrAwaiting(workspaceId, awaiting);
        }),
      archiveWorkspace: (workspaceId) =>
        Effect.sync(() => {
          useWorkspaceStore.getState().archiveWorkspaceFromStore(workspaceId);
        }),
      addProjectTerminalGroup: (workspaceId, slotId, index) =>
        Effect.sync(() => {
          useWorkspaceStore.getState().addProjectTerminalGroup(workspaceId, slotId, index);
        }),
      splitProjectTerminalGroup: (workspaceId, groupId, slotId) =>
        Effect.sync(() => {
          useWorkspaceStore.getState().splitProjectTerminalGroup(workspaceId, groupId, slotId);
        }),
      closeProjectTerminal: (workspaceId, slotId) =>
        Effect.sync(() => {
          useWorkspaceStore.getState().closeProjectTerminal(workspaceId, slotId);
        }),
      selectProjectTerminalGroup: (workspaceId, groupId, slotId) =>
        Effect.sync(() => {
          useWorkspaceStore.getState().selectProjectTerminalGroup(workspaceId, groupId, slotId);
        }),
      focusProjectTerminal: (workspaceId, slotId) =>
        Effect.sync(() => {
          useWorkspaceStore.getState().focusProjectTerminal(workspaceId, slotId);
        }),
      setProjectTerminalPanelVisible: (workspaceId, visible) =>
        Effect.sync(() => {
          useWorkspaceStore.getState().setProjectTerminalPanelVisible(workspaceId, visible);
        }),
      reorderProjectTerminalGroups: (workspaceId, fromIndex, toIndex) =>
        Effect.sync(() => {
          useWorkspaceStore.getState().reorderProjectTerminalGroups(workspaceId, fromIndex, toIndex);
        }),
      reorderProjectTerminalGroupChildren: (workspaceId, groupId, fromIndex, toIndex) =>
        Effect.sync(() => {
          useWorkspaceStore
            .getState()
            .reorderProjectTerminalGroupChildren(workspaceId, groupId, fromIndex, toIndex);
        }),
      moveProjectTerminalToGroup: (workspaceId, slotId, targetGroupId, index) =>
        Effect.sync(() => {
          useWorkspaceStore
            .getState()
            .moveProjectTerminalToGroup(workspaceId, slotId, targetGroupId, index);
        }),
      moveProjectTerminalToNewGroup: (workspaceId, slotId, index) =>
        Effect.sync(() => {
          useWorkspaceStore.getState().moveProjectTerminalToNewGroup(workspaceId, slotId, index);
        }),
      createWorkspace: (projectId, workspaceKind) =>
        Effect.tryPromise({
          try: () => useWorkspaceStore.getState().createWorkspace(projectId, workspaceKind),
          catch: (cause) => workspaceSelectionError(cause),
        }),
      retryWorkspace: (workspaceId) =>
        Effect.tryPromise({
          try: () => useWorkspaceStore.getState().retryWorkspace(workspaceId),
          catch: (cause) => workspaceSelectionError(cause, workspaceId),
        }),
      removeWorkspace: (workspaceId) =>
        Effect.tryPromise({
          try: () => useWorkspaceStore.getState().removeWorkspace(workspaceId),
          catch: (cause) => workspaceSelectionError(cause, workspaceId),
        }),
      markWorkspaceOpened: (workspaceId) =>
        Effect.tryPromise({
          try: () => useWorkspaceStore.getState().markWorkspaceOpened(workspaceId),
          catch: (cause) => workspaceSelectionError(cause, workspaceId),
        }),
      getWorkspaceSession: (workspaceId) => sessionCache.get(workspaceId),
    } satisfies WorkspaceRegistryService;
  })
);

export const workspaceRegistryView = Effect.flatMap(WorkspaceRegistry, (service) =>
  SubscriptionRef.get(service.view)
);
