import { Context, Effect, Layer, Ref } from "effect";
import { invoke } from "@tauri-apps/api/core";
import {
  loadPersistedFileTreeOpenMap,
  loadPersistedSidebarVisible,
  persistFileTreeOpenForWorkspace,
  persistSidebarVisible,
} from "@/lib/workspace/ui-persistence";
import type { UiPreferencesView } from "@/state/desktop-view-projections";
import { emptyUiPreferencesView } from "@/state/desktop-view-projections";
import { useDesktopViewStore } from "@/state/desktop-view-store";
import { UiPreferenceError } from "@/services/service-errors";

export interface UiPreferencesServiceApi {
  readonly hydrate: () => Effect.Effect<void, UiPreferenceError>;
  readonly setSidebarVisible: (visible: boolean) => Effect.Effect<void, UiPreferenceError>;
  readonly setFileTreeOpenForWorkspace: (
    workspaceId: string,
    open: boolean
  ) => Effect.Effect<void, UiPreferenceError>;
  readonly syncSelectedWorkspace: (
    workspaceId: string | null,
    ready: boolean
  ) => Effect.Effect<void, UiPreferenceError>;
  readonly saveSelection: (
    projectId: string | null,
    workspaceId: string | null
  ) => Effect.Effect<void, UiPreferenceError>;
}

export class UiPreferencesService extends Context.Tag("pandora/UiPreferencesService")<
  UiPreferencesService,
  UiPreferencesServiceApi
>() {}

function publishUiPreferences(next: UiPreferencesView) {
  useDesktopViewStore.getState().setUiPreferences(next);
}

export const UiPreferencesServiceLive = Layer.effect(
  UiPreferencesService,
  Effect.gen(function* () {
    const currentViewRef = yield* Ref.make(emptyUiPreferencesView);
    const fileTreeOpenByWorkspace = new Map<string, boolean>();
    publishUiPreferences(emptyUiPreferencesView);

    const updateView = (updater: (current: UiPreferencesView) => UiPreferencesView) =>
      Effect.gen(function* () {
        const current = yield* Ref.get(currentViewRef);
        const next = updater(current);
        yield* Ref.set(currentViewRef, next);
        yield* Effect.sync(() => {
          publishUiPreferences(next);
        });
      });

    return {
      hydrate: () =>
        Effect.tryPromise({
          try: async () => {
            const [sidebarVisible, fileTreeOpenMap] = await Promise.all([
              loadPersistedSidebarVisible(),
              loadPersistedFileTreeOpenMap(),
            ]);
            fileTreeOpenByWorkspace.clear();
            for (const [workspaceId, open] of Object.entries(fileTreeOpenMap)) {
              fileTreeOpenByWorkspace.set(workspaceId, open);
            }
            const next: UiPreferencesView = {
              ...emptyUiPreferencesView,
              sidebarVisible,
              sidebarHydrated: true,
            };
            publishUiPreferences(next);
            await Effect.runPromise(Ref.set(currentViewRef, next));
          },
          catch: (cause) => new UiPreferenceError({ cause, key: "sidebarVisible" }),
        }),
      setSidebarVisible: (visible) =>
        Effect.tryPromise({
          try: async () => {
            await persistSidebarVisible(visible);
            await Effect.runPromise(
              updateView((current) => ({
                ...current,
                sidebarVisible: visible,
                sidebarHydrated: true,
              }))
            );
          },
          catch: (cause) => new UiPreferenceError({ cause, key: "sidebarVisible" }),
        }),
      setFileTreeOpenForWorkspace: (workspaceId, open) =>
        Effect.tryPromise({
          try: async () => {
            fileTreeOpenByWorkspace.set(workspaceId, open);
            await Effect.runPromise(
              updateView((current) => ({
                ...current,
                fileTreeOpen: open,
                fileTreeHydrated: true,
                fileTreeWorkspaceId: workspaceId,
              }))
            );
            await persistFileTreeOpenForWorkspace(workspaceId, open);
          },
          catch: (cause) => new UiPreferenceError({ cause, key: `fileTree:${workspaceId}` }),
        }),
      syncSelectedWorkspace: (workspaceId, ready) =>
        Effect.tryPromise({
          try: async () => {
            const current = useDesktopViewStore.getState().uiPreferences;

            if (!workspaceId || !ready) {
              await Effect.runPromise(
                updateView(() => ({
                  ...current,
                  fileTreeOpen: false,
                  fileTreeHydrated: true,
                  fileTreeWorkspaceId: workspaceId,
                }))
              );
              return;
            }

            const open = fileTreeOpenByWorkspace.get(workspaceId) ?? false;
            await Effect.runPromise(
              updateView(() => ({
                sidebarVisible: current.sidebarVisible,
                sidebarHydrated: true,
                fileTreeOpen: open,
                fileTreeHydrated: true,
                fileTreeWorkspaceId: workspaceId,
              }))
            );
          },
          catch: (cause) =>
            new UiPreferenceError({ cause, key: `selectedWorkspace:${workspaceId ?? "none"}` }),
        }),
      saveSelection: (projectId, workspaceId) =>
        Effect.tryPromise({
          try: () =>
            invoke("save_selection", {
              projectId,
              workspaceId,
            }),
          catch: (cause) => new UiPreferenceError({ cause, key: "selection" }),
        }),
    } satisfies UiPreferencesServiceApi;
  })
);
