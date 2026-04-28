import { invoke } from "@tauri-apps/api/core";
import {
  loadPersistedFileTreeOpenMap,
  loadPersistedSidebarVisible,
  persistFileTreeOpen,
  persistSidebarVisible,
} from "@/services/file-tree/file-tree-preferences";
import type { UiPreferencesView } from "@/services/workspace/desktop-view-projections";
import { emptyUiPreferencesView } from "@/services/workspace/desktop-view-projections";
import { useDesktopViewStore } from "@/services/workspace/desktop-view-store";

// Module-level state — fileTreeOpen is a single global toggle, not per-workspace.
let currentView: UiPreferencesView = emptyUiPreferencesView;
let globalFileTreeOpen = false;

function publishUiPreferences(next: UiPreferencesView) {
  currentView = next;
  useDesktopViewStore.getState().setUiPreferences(next);
}

function updateView(updater: (current: UiPreferencesView) => UiPreferencesView) {
  publishUiPreferences(updater(currentView));
}

export const uiPreferencesService = {
  hydrate: async (): Promise<void> => {
    const [sidebarVisible, fileTreeOpenMap] = await Promise.all([
      loadPersistedSidebarVisible(),
      loadPersistedFileTreeOpenMap(),
    ]);
    globalFileTreeOpen = Object.values(fileTreeOpenMap).some(Boolean);
    publishUiPreferences({
      ...emptyUiPreferencesView,
      sidebarVisible,
      sidebarHydrated: true,
      fileTreeOpen: globalFileTreeOpen,
      fileTreeHydrated: true,
      fileTreeWorkspaceId: null,
    });
  },

  setSidebarVisible: async (visible: boolean): Promise<void> => {
    await persistSidebarVisible(visible);
    updateView((current) => ({
      ...current,
      sidebarVisible: visible,
      sidebarHydrated: true,
    }));
  },

  setFileTreeOpen: async (open: boolean): Promise<void> => {
    globalFileTreeOpen = open;
    updateView((current) => ({
      ...current,
      fileTreeOpen: open,
      fileTreeHydrated: true,
    }));
    await persistFileTreeOpen(open);
  },

  syncSelectedWorkspace: (workspaceId: string | null, ready: boolean): void => {
    updateView((current) => ({
      ...current,
      fileTreeOpen: globalFileTreeOpen,
      fileTreeHydrated: true,
      fileTreeWorkspaceId: ready ? workspaceId : null,
    }));
  },

  saveSelection: (projectId: string | null, workspaceId: string | null): Promise<void> =>
    invoke("save_selection", { projectId, workspaceId }),
};
