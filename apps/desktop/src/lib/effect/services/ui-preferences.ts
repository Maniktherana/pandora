import { Context, Effect, Layer, SubscriptionRef } from "effect";
import { invoke } from "@tauri-apps/api/core";
import {
  loadPersistedFileTreeOpenMap,
  loadPersistedSidebarVisible,
  persistFileTreeOpenForWorkspace,
  persistSidebarVisible,
} from "@/lib/workspace/ui-persistence";
import type { UiPreferencesViewModel } from "../view-model";
import { emptyUiPreferencesViewModel } from "../view-model";
import { useAppViewStore } from "@/stores/app-view-store";
import { UiPreferenceError } from "../errors";

export interface UiPreferencesService {
  readonly view: SubscriptionRef.SubscriptionRef<UiPreferencesViewModel>;
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

export class UiPreferences extends Context.Tag("pandora/UiPreferences")<
  UiPreferences,
  UiPreferencesService
>() {}

function publishUiPreferences(
  view: SubscriptionRef.SubscriptionRef<UiPreferencesViewModel>,
  next: UiPreferencesViewModel
) {
  useAppViewStore.getState().setUiPreferences(next);
  return SubscriptionRef.set(view, next);
}

export const UiPreferencesLive = Layer.effect(
  UiPreferences,
  Effect.gen(function* () {
    const view = yield* SubscriptionRef.make(emptyUiPreferencesViewModel);
    const fileTreeOpenByWorkspace = new Map<string, boolean>();
    useAppViewStore.getState().setUiPreferences(emptyUiPreferencesViewModel);

    const updateView = (updater: (current: UiPreferencesViewModel) => UiPreferencesViewModel) =>
      Effect.gen(function* () {
        const current = yield* SubscriptionRef.get(view);
        const next = updater(current);
        yield* publishUiPreferences(view, next);
      });

    return {
      view,
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
            const next: UiPreferencesViewModel = {
              ...emptyUiPreferencesViewModel,
              sidebarVisible,
              sidebarHydrated: true,
            };
            useAppViewStore.getState().setUiPreferences(next);
            await Effect.runPromise(SubscriptionRef.set(view, next));
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
            if (!workspaceId || !ready) {
              await Effect.runPromise(
                updateView((current) => ({
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
                sidebarVisible: useAppViewStore.getState().uiPreferences.sidebarVisible,
                sidebarHydrated: true,
                fileTreeOpen: open,
                fileTreeHydrated: true,
                fileTreeWorkspaceId: workspaceId,
              }))
            );
          },
          catch: (cause) => new UiPreferenceError({ cause, key: `selectedWorkspace:${workspaceId ?? "none"}` }),
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
    } satisfies UiPreferencesService;
  })
);
