import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SubscriptionRef from "effect/SubscriptionRef";
import type { AppViewModel, WorkspaceViewModel } from "./contracts";
import { WorkspaceRegistry, type WorkspaceRegistryService } from "./contracts";
import { WorkspaceLoadError, WorkspaceSelectionError } from "../errors";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { snapshotAppView, snapshotWorkspaceView } from "./legacy-bridge";
import { UiPreferences } from "./contracts";

function makeUiSnapshot() {
  return {
    sidebarVisible: true,
    fileTreeOpenByWorkspaceId: {},
  };
}

function makeInitialView(): AppViewModel {
  const state = useWorkspaceStore.getState();
  return snapshotAppView(state, makeUiSnapshot());
}

function refreshViewEffect(view: SubscriptionRef.SubscriptionRef<AppViewModel>) {
  return Effect.sync(() => {
    const state = useWorkspaceStore.getState();
    const uiPreferences = makeUiSnapshot();
    void SubscriptionRef.set(view, snapshotAppView(state, uiPreferences));
  });
}

export function makeWorkspaceRegistryLive() {
  return Layer.effect(
    WorkspaceRegistry,
    Effect.gen(function* () {
      const view = yield* SubscriptionRef.make(makeInitialView());

      const refresh = refreshViewEffect(view);
      const loadAppState = Effect.tryPromise({
        try: () => useWorkspaceStore.getState().loadAppState(),
        catch: (cause) =>
          new WorkspaceLoadError({
            workspaceId: "app",
            cause,
          }),
      }).pipe(Effect.zipRight(refresh));

      const reloadFromBackend = Effect.tryPromise({
        try: () => useWorkspaceStore.getState().reloadFromBackend(),
        catch: (cause) =>
          new WorkspaceLoadError({
            workspaceId: "app",
            cause,
          }),
      }).pipe(Effect.zipRight(refresh));

      const selectProject = (projectId: string) =>
        Effect.sync(() => {
          useWorkspaceStore.getState().selectProject(projectId);
        }).pipe(Effect.zipRight(refresh));

      const selectWorkspace = (workspaceId: string) =>
        Effect.sync(() => {
          const workspace = useWorkspaceStore
            .getState()
            .workspaces.find((item) => item.id === workspaceId);
          if (!workspace) {
            throw new WorkspaceSelectionError({
              workspaceId,
              cause: new Error("workspace not found"),
            });
          }
          useWorkspaceStore.getState().selectWorkspace(workspace);
        }).pipe(Effect.zipRight(refresh));

      const createWorkspace = (projectId: string) =>
        Effect.tryPromise({
          try: () => useWorkspaceStore.getState().createWorkspace(projectId),
          catch: (cause) =>
            new WorkspaceLoadError({
              workspaceId: projectId,
              cause,
            }),
        }).pipe(Effect.zipRight(refresh));

      const retryWorkspace = (workspaceId: string) =>
        Effect.tryPromise({
          try: () => useWorkspaceStore.getState().retryWorkspace(workspaceId),
          catch: (cause) =>
            new WorkspaceLoadError({
              workspaceId,
              cause,
            }),
        }).pipe(Effect.zipRight(refresh));

      const removeWorkspace = (workspaceId: string) =>
        Effect.tryPromise({
          try: () => useWorkspaceStore.getState().removeWorkspace(workspaceId),
          catch: (cause) =>
            new WorkspaceLoadError({
              workspaceId,
              cause,
            }),
        }).pipe(Effect.zipRight(refresh));

      const markWorkspaceOpened = (workspaceId: string) =>
        Effect.tryPromise({
          try: () => useWorkspaceStore.getState().markWorkspaceOpened(workspaceId),
          catch: (cause) =>
            new WorkspaceLoadError({
              workspaceId,
              cause,
            }),
        }).pipe(Effect.zipRight(refresh));

      const setNavigationArea = (area: "sidebar" | "workspace") =>
        Effect.sync(() => {
          useWorkspaceStore.getState().setNavigationArea(area);
        }).pipe(Effect.zipRight(refresh));

      const setSearchText = (text: string) =>
        Effect.sync(() => {
          useWorkspaceStore.getState().setSearchText(text);
        }).pipe(Effect.zipRight(refresh));

      const service: WorkspaceRegistryService = {
        view,
        refresh,
        loadAppState,
        reloadFromBackend,
        selectProject,
        selectWorkspace,
        createWorkspace,
        retryWorkspace,
        removeWorkspace,
        markWorkspaceOpened,
        setNavigationArea,
        setSearchText,
      };

      return service;
    })
  );
}

export function snapshotWorkspace(
  workspaceId: string
): WorkspaceViewModel | null {
  const state = useWorkspaceStore.getState();
  return snapshotWorkspaceView(state, workspaceId);
}
