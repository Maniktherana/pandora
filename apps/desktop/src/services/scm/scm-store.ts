import { create } from "zustand";
import type { ScmSnapshot } from "@/lib/shared/types";

export interface ScmRuntimeState {
  snapshot: ScmSnapshot | null;
  refreshing: boolean;
  lastError: string | null;
}

function emptyScmState(): ScmRuntimeState {
  return { snapshot: null, refreshing: false, lastError: null };
}

interface ScmStoreState {
  byRuntimeId: Record<string, ScmRuntimeState>;
  applySnapshot: (runtimeId: string, snapshot: ScmSnapshot) => void;
  setRefreshing: (runtimeId: string, refreshing: boolean) => void;
  setError: (runtimeId: string, error: string | null) => void;
  resetRuntime: (runtimeId: string) => void;
}

export const useScmStore = create<ScmStoreState>((set) => ({
  byRuntimeId: {},

  applySnapshot: (runtimeId, snapshot) =>
    set((s) => ({
      byRuntimeId: {
        ...s.byRuntimeId,
        [runtimeId]: {
          ...(s.byRuntimeId[runtimeId] ?? emptyScmState()),
          snapshot,
          refreshing: false,
          lastError: null,
        },
      },
    })),

  setRefreshing: (runtimeId, refreshing) =>
    set((s) => {
      const current = s.byRuntimeId[runtimeId] ?? emptyScmState();
      return {
        byRuntimeId: { ...s.byRuntimeId, [runtimeId]: { ...current, refreshing } },
      };
    }),

  setError: (runtimeId, error) =>
    set((s) => {
      const current = s.byRuntimeId[runtimeId] ?? emptyScmState();
      return {
        byRuntimeId: { ...s.byRuntimeId, [runtimeId]: { ...current, lastError: error } },
      };
    }),

  resetRuntime: (runtimeId) =>
    set((s) => {
      const next = { ...s.byRuntimeId };
      delete next[runtimeId];
      return { byRuntimeId: next };
    }),
}));
