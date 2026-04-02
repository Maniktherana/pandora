import { create } from "zustand";
import type { AppViewModel, UiPreferencesViewModel } from "@/lib/effect/view-model";
import { emptyAppViewModel, emptyUiPreferencesViewModel } from "@/lib/effect/view-model";

interface AppViewStoreState {
  appView: AppViewModel;
  uiPreferences: UiPreferencesViewModel;
  setAppView: (view: AppViewModel) => void;
  setUiPreferences: (view: UiPreferencesViewModel) => void;
}

export const useAppViewStore = create<AppViewStoreState>((set) => ({
  appView: emptyAppViewModel,
  uiPreferences: emptyUiPreferencesViewModel,
  setAppView: (view) => set({ appView: view }),
  setUiPreferences: (view) => set({ uiPreferences: view }),
}));
