import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { UiPreferenceError } from "../errors";
import { loadFileTreeOpenForWorkspace, loadPersistedSidebarVisible, persistFileTreeOpenForWorkspace, persistSidebarVisible } from "@/lib/workspace/ui-persistence";
import { invoke } from "@tauri-apps/api/core";
import { UiPreferences, type UiPreferencesService, type UiPreferencesViewModel } from "./contracts";

function makeInitialView(): UiPreferencesViewModel {
  return {
    sidebarVisible: true,
    fileTreeOpenByWorkspaceId: {},
  };
}

export function makeUiPreferencesLive() {
  return Layer.effect(
    UiPreferences,
    Effect.gen(function* () {
      const view = yield* SubscriptionRef.make(makeInitialView());

      const refresh = Effect.sync(() => {
        void SubscriptionRef.set(view, makeInitialView());
      });

      const service: UiPreferencesService = {
        view,
        refresh,
        loadSidebarVisible: Effect.tryPromise({
          try: () => loadPersistedSidebarVisible(),
          catch: (cause) =>
            new UiPreferenceError({
              key: "sidebarVisible",
              cause,
            }),
        }),
        saveSidebarVisible: (visible: boolean) =>
          Effect.tryPromise({
            try: () => persistSidebarVisible(visible),
            catch: (cause) =>
              new UiPreferenceError({
                key: "sidebarVisible",
                cause,
              }),
          }),
        loadFileTreeOpen: (workspaceId: string) =>
          Effect.tryPromise({
            try: () => loadFileTreeOpenForWorkspace(workspaceId),
            catch: (cause) =>
              new UiPreferenceError({
                key: `fileTree:${workspaceId}`,
                cause,
              }),
          }),
        saveFileTreeOpen: (workspaceId: string, open: boolean) =>
          Effect.tryPromise({
            try: () => persistFileTreeOpenForWorkspace(workspaceId, open),
            catch: (cause) =>
              new UiPreferenceError({
                key: `fileTree:${workspaceId}`,
                cause,
              }),
          }),
        loadSelection: Effect.tryPromise({
          try: async () => {
            const state = await invoke<{
              selectedProjectId: string | null;
              selectedWorkspaceId: string | null;
            }>("load_app_state");
            return {
              projectId: state.selectedProjectId,
              workspaceId: state.selectedWorkspaceId,
            };
          },
          catch: (cause) =>
            new UiPreferenceError({
              key: "selection",
              cause,
            }),
        }),
        saveSelection: (projectId: string | null, workspaceId: string | null) =>
          Effect.tryPromise({
            try: () =>
              invoke("save_selection", {
                projectId,
                workspaceId,
              }),
            catch: (cause) =>
              new UiPreferenceError({
                key: "selection",
                cause,
              }),
          }),
      };

      return service;
    })
  );
}
