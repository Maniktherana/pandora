import { create } from "zustand";
import type { DesktopView, UiPreferencesView } from "./desktop-view-projections";
import { emptyDesktopView, emptyUiPreferencesView } from "./desktop-view-projections";

interface DesktopViewStoreState {
  desktopView: DesktopView;
  uiPreferences: UiPreferencesView;
  setDesktopView: (view: DesktopView) => void;
  setUiPreferences: (view: UiPreferencesView) => void;
}

export const useDesktopViewStore = create<DesktopViewStoreState>((set) => ({
  desktopView: emptyDesktopView,
  uiPreferences: emptyUiPreferencesView,
  setDesktopView: (view) => set({ desktopView: view }),
  setUiPreferences: (view) => set({ uiPreferences: view }),
}));
