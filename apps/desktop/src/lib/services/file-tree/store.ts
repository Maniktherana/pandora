import { create } from "zustand";

export type FileTreeBootStatus = "idle" | "loading" | "preparing" | "loaded" | "error";

interface FileTreeBootState {
  bootStatus: FileTreeBootStatus;
  lastError: string | null;
}

interface FileTreeStoreState {
  byScopeId: Record<string, FileTreeBootState>;
  setBootLoading: (scopeId: string) => void;
  setPreparing: (scopeId: string) => void;
  setBooted: (scopeId: string) => void;
  setError: (scopeId: string, error: string) => void;
  resetScope: (scopeId: string) => void;
}

export const useFileTreeStore = create<FileTreeStoreState>((set) => ({
  byScopeId: {},

  setBootLoading: (scopeId) =>
    set((s) => ({
      byScopeId: {
        ...s.byScopeId,
        [scopeId]: { ...(s.byScopeId[scopeId] ?? { bootStatus: "idle", lastError: null }), bootStatus: "loading" },
      },
    })),

  setPreparing: (scopeId) =>
    set((s) => ({
      byScopeId: {
        ...s.byScopeId,
        [scopeId]: {
          ...(s.byScopeId[scopeId] ?? { bootStatus: "idle", lastError: null }),
          bootStatus: "preparing",
        },
      },
    })),

  setBooted: (scopeId) =>
    set((s) => ({
      byScopeId: {
        ...s.byScopeId,
        [scopeId]: { bootStatus: "loaded", lastError: null },
      },
    })),

  setError: (scopeId, error) =>
    set((s) => {
      const current = s.byScopeId[scopeId];
      const isLoaded = current?.bootStatus === "loaded";
      return {
        byScopeId: {
          ...s.byScopeId,
          [scopeId]: {
            bootStatus: isLoaded ? "loaded" : "error",
            lastError: error,
          },
        },
      };
    }),

  resetScope: (scopeId) =>
    set((s) => {
      const next = { ...s.byScopeId };
      delete next[scopeId];
      return { byScopeId: next };
    }),
}));
