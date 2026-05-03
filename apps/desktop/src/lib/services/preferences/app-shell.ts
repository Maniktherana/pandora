import { ipcGetUiState, ipcSetUiState } from "@/lib/services/ipc/client";
import { preferenceKeys } from "./keys";
import {
  emptyAppShellPreferencesView,
  useAppShellPreferencesStore,
  type AppShellPreferencesView,
} from "./app-shell-store";

interface PersistedAppShellPreferences {
  leftSidebarVisible?: unknown;
  rightSidebarOpen?: unknown;
}

let currentView: AppShellPreferencesView = emptyAppShellPreferencesView;
let globalRightSidebarOpen = false;

function publishAppShellPreferences(next: AppShellPreferencesView) {
  currentView = next;
  useAppShellPreferencesStore.getState().setAppShellPreferences(next);
}

function updateView(updater: (current: AppShellPreferencesView) => AppShellPreferencesView) {
  publishAppShellPreferences(updater(currentView));
}

function parseAppShellPreferences(raw: string | null): PersistedAppShellPreferences | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as PersistedAppShellPreferences;
  } catch {
    return null;
  }
}

async function loadPersistedAppShellPreferences(): Promise<{
  leftSidebarVisible: boolean;
  rightSidebarOpen: boolean;
}> {
  const appShell = parseAppShellPreferences(await ipcGetUiState(preferenceKeys.appShell));
  if (appShell) {
    return {
      leftSidebarVisible:
        typeof appShell.leftSidebarVisible === "boolean" ? appShell.leftSidebarVisible : true,
      rightSidebarOpen:
        typeof appShell.rightSidebarOpen === "boolean" ? appShell.rightSidebarOpen : false,
    };
  }

  return {
    leftSidebarVisible: true,
    rightSidebarOpen: false,
  };
}

async function persistAppShellPreferences(view: AppShellPreferencesView): Promise<void> {
  await ipcSetUiState(
    preferenceKeys.appShell,
    JSON.stringify({
      leftSidebarVisible: view.leftSidebarVisible,
      rightSidebarOpen: view.rightSidebarOpen,
    }),
  );
}

const PERSIST_DELAY_MS = 300;
let appShellPersistTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleAppShellPersist(): void {
  if (appShellPersistTimer !== null) clearTimeout(appShellPersistTimer);
  appShellPersistTimer = setTimeout(() => {
    appShellPersistTimer = null;
    persistAppShellPreferences(currentView).catch(console.error);
  }, PERSIST_DELAY_MS);
}

export const appShellPreferences = {
  hydrate: async (): Promise<void> => {
    const { leftSidebarVisible, rightSidebarOpen } = await loadPersistedAppShellPreferences();
    globalRightSidebarOpen = rightSidebarOpen;
    publishAppShellPreferences({
      leftSidebarVisible,
      leftSidebarHydrated: true,
      rightSidebarOpen,
      rightSidebarHydrated: true,
      rightSidebarWorkspaceId: null,
    });
  },

  setLeftSidebarVisible: (visible: boolean): void => {
    updateView((current) =>
      ({
        ...current,
        leftSidebarVisible: visible,
        leftSidebarHydrated: true,
      }),
    );
    scheduleAppShellPersist();
  },

  setRightSidebarOpen: (open: boolean): void => {
    globalRightSidebarOpen = open;
    updateView((current) =>
      ({
        ...current,
        rightSidebarOpen: open,
        rightSidebarHydrated: true,
      }),
    );
    scheduleAppShellPersist();
  },

  syncSelectedWorkspace: (workspaceId: string | null, ready: boolean): void => {
    updateView((current) =>
      ({
        ...current,
        rightSidebarOpen: globalRightSidebarOpen,
        rightSidebarHydrated: true,
        rightSidebarWorkspaceId: ready ? workspaceId : null,
      }),
    );
  },
};
