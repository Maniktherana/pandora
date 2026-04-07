import { Context, Effect, Layer, Ref } from "effect";
import { invoke } from "@tauri-apps/api/core";
import {
  loadPersistedFileTreeOpenMap,
  loadPersistedSidebarVisible,
  persistFileTreeOpenForWorkspace,
  persistSidebarVisible,
} from "@/components/layout/right-sidebar/files/files-persistence.utils";
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
    let globalFileTreeOpen = false;
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
        Effect.gen(function* () {
          const [sidebarVisible, fileTreeOpenMap] = yield* Effect.tryPromise({
            try: () =>
              Promise.all([loadPersistedSidebarVisible(), loadPersistedFileTreeOpenMap()]),
            catch: (cause) => new UiPreferenceError({ cause, key: "sidebarVisible" }),
          });
          fileTreeOpenByWorkspace.clear();
          for (const [workspaceId, open] of Object.entries(fileTreeOpenMap)) {
            fileTreeOpenByWorkspace.set(workspaceId, open);
          }
          globalFileTreeOpen = Object.values(fileTreeOpenMap).some(Boolean);
          const next: UiPreferencesView = {
            ...emptyUiPreferencesView,
            sidebarVisible,
            sidebarHydrated: true,
            fileTreeOpen: globalFileTreeOpen,
            fileTreeHydrated: true,
            fileTreeWorkspaceId: null,
          };
          publishUiPreferences(next);
          yield* Ref.set(currentViewRef, next);
        }),
      setSidebarVisible: (visible) =>
        Effect.gen(function* () {
          yield* Effect.tryPromise({
            try: () => persistSidebarVisible(visible),
            catch: (cause) => new UiPreferenceError({ cause, key: "sidebarVisible" }),
          });
          yield* updateView((current) => ({
            ...current,
            sidebarVisible: visible,
            sidebarHydrated: true,
          }));
        }),
      setFileTreeOpenForWorkspace: (workspaceId, open) =>
        Effect.gen(function* () {
          fileTreeOpenByWorkspace.set(workspaceId, open);
          globalFileTreeOpen = open;
          yield* updateView((current) => ({
            ...current,
            fileTreeOpen: open,
            fileTreeHydrated: true,
            fileTreeWorkspaceId: workspaceId,
          }));
          yield* Effect.tryPromise({
            try: () => persistFileTreeOpenForWorkspace(workspaceId, open),
            catch: (cause) => new UiPreferenceError({ cause, key: `fileTree:${workspaceId}` }),
          });
        }),
      syncSelectedWorkspace: (workspaceId, ready) =>
        Effect.gen(function* () {
          const current = yield* Ref.get(currentViewRef);

          if (!workspaceId || !ready) {
            yield* updateView(() => ({
              ...current,
              fileTreeOpen: globalFileTreeOpen,
              fileTreeHydrated: true,
              fileTreeWorkspaceId: workspaceId,
            }));
            return;
          }

          const open = fileTreeOpenByWorkspace.get(workspaceId) ?? globalFileTreeOpen;
          yield* updateView(() => ({
            sidebarVisible: current.sidebarVisible,
            sidebarHydrated: true,
            fileTreeOpen: open,
            fileTreeHydrated: true,
            fileTreeWorkspaceId: workspaceId,
          }));
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
