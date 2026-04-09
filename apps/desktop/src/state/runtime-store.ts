import { create } from "zustand";
import {
  emptyRuntimeStateView,
  type RuntimeStateView,
} from "@/state/desktop-view-projections";

interface RuntimeStoreState {
  runtimeState: RuntimeStateView;
  setRuntimeState: (view: RuntimeStateView) => void;
}

export const useRuntimeStore = create<RuntimeStoreState>((set) => ({
  runtimeState: emptyRuntimeStateView,
  setRuntimeState: (view) => set({ runtimeState: view }),
}));
