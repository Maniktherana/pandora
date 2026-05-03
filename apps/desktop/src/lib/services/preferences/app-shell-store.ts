import { create } from "zustand";

export interface AppShellPreferencesView {
  readonly leftSidebarVisible: boolean;
  readonly leftSidebarHydrated: boolean;
  readonly rightSidebarOpen: boolean;
  readonly rightSidebarHydrated: boolean;
  readonly rightSidebarWorkspaceId: string | null;
}

export const emptyAppShellPreferencesView: AppShellPreferencesView = {
  leftSidebarVisible: true,
  leftSidebarHydrated: false,
  rightSidebarOpen: false,
  rightSidebarHydrated: false,
  rightSidebarWorkspaceId: null,
};

interface AppShellPreferencesStoreState {
  appShellPreferences: AppShellPreferencesView;
  setAppShellPreferences: (view: AppShellPreferencesView) => void;
}

export const useAppShellPreferencesStore = create<AppShellPreferencesStoreState>((set) => ({
  appShellPreferences: emptyAppShellPreferencesView,
  setAppShellPreferences: (view) => set({ appShellPreferences: view }),
}));
