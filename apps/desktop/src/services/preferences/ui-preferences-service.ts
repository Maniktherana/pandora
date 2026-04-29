import { invoke } from "@tauri-apps/api/core";
import {
  loadPersistedFileTreeOpenMap,
  loadPersistedSidebarVisible,
  persistFileTreeOpen,
  persistSidebarVisible,
} from "@/services/file-tree/file-tree-preferences";
import {
  emptyUiPreferencesView,
  useUiPreferencesStore,
  type UiPreferencesView,
} from "@/services/preferences/ui-preferences-store";

let currentView: UiPreferencesView = emptyUiPreferencesView;
let globalFileTreeOpen = false;

function publishUiPreferences(next: UiPreferencesView) {
  currentView = next;
  useUiPreferencesStore.getState().setUiPreferences(next);
}

function updateView(updater: (current: UiPreferencesView) => UiPreferencesView) {
  publishUiPreferences(updater(currentView));
}

// Trailing-debounce timers for preference persistence.
const PERSIST_DELAY_MS = 300;
let sidebarPersistTimer: ReturnType<typeof setTimeout> | null = null;
let fileTreeOpenPersistTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSidebarPersist(visible: boolean): void {
  if (sidebarPersistTimer !== null) clearTimeout(sidebarPersistTimer);
  sidebarPersistTimer = setTimeout(() => {
    sidebarPersistTimer = null;
    persistSidebarVisible(visible).catch(console.error);
  }, PERSIST_DELAY_MS);
}

function scheduleFileTreeOpenPersist(open: boolean): void {
  if (fileTreeOpenPersistTimer !== null) clearTimeout(fileTreeOpenPersistTimer);
  fileTreeOpenPersistTimer = setTimeout(() => {
    fileTreeOpenPersistTimer = null;
    persistFileTreeOpen(open).catch(console.error);
  }, PERSIST_DELAY_MS);
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

  setSidebarVisible: (visible: boolean): void => {
    updateView((current) => ({
      ...current,
      sidebarVisible: visible,
      sidebarHydrated: true,
    }));
    scheduleSidebarPersist(visible);
  },

  setFileTreeOpen: (open: boolean): void => {
    globalFileTreeOpen = open;
    updateView((current) => ({
      ...current,
      fileTreeOpen: open,
      fileTreeHydrated: true,
    }));
    scheduleFileTreeOpenPersist(open);
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
