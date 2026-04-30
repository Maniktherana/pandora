import { create } from "zustand";

export interface UiPreferencesView {
  readonly sidebarVisible: boolean;
  readonly sidebarHydrated: boolean;
  readonly fileTreeOpen: boolean;
  readonly fileTreeHydrated: boolean;
  readonly fileTreeWorkspaceId: string | null;
}

export const emptyUiPreferencesView: UiPreferencesView = {
  sidebarVisible: true,
  sidebarHydrated: false,
  fileTreeOpen: false,
  fileTreeHydrated: false,
  fileTreeWorkspaceId: null,
};

interface UiPreferencesStoreState {
  uiPreferences: UiPreferencesView;
  setUiPreferences: (view: UiPreferencesView) => void;
}

export const useUiPreferencesStore = create<UiPreferencesStoreState>((set) => ({
  uiPreferences: emptyUiPreferencesView,
  setUiPreferences: (view) => set({ uiPreferences: view }),
}));
