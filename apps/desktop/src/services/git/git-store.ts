import { create } from "zustand";
import type { HeaderBranchContext } from "@/lib/shared/types";

export interface GitBranchContextState {
  branchContext: HeaderBranchContext | null;
  branchContextLoading: boolean;
}

interface GitStoreState {
  byScopeId: Record<string, GitBranchContextState>;
  setBranchContext: (scopeId: string, context: HeaderBranchContext | null) => void;
  setBranchContextLoading: (scopeId: string, loading: boolean) => void;
  resetScope: (scopeId: string) => void;
}

function emptyState(): GitBranchContextState {
  return { branchContext: null, branchContextLoading: false };
}

export const useGitStore = create<GitStoreState>((set) => ({
  byScopeId: {},

  setBranchContext: (scopeId, context) =>
    set((s) => ({
      byScopeId: {
        ...s.byScopeId,
        [scopeId]: {
          ...(s.byScopeId[scopeId] ?? emptyState()),
          branchContext: context,
          branchContextLoading: false,
        },
      },
    })),

  setBranchContextLoading: (scopeId, loading) =>
    set((s) => ({
      byScopeId: {
        ...s.byScopeId,
        [scopeId]: {
          ...(s.byScopeId[scopeId] ?? emptyState()),
          branchContextLoading: loading,
        },
      },
    })),

  resetScope: (scopeId) =>
    set((s) => {
      const next = { ...s.byScopeId };
      delete next[scopeId];
      return { byScopeId: next };
    }),
}));

export function useBranchContext(scopeId: string) {
  const branchContext = useGitStore((s) => s.byScopeId[scopeId]?.branchContext ?? null);
  const branchContextLoading = useGitStore(
    (s) => s.byScopeId[scopeId]?.branchContextLoading ?? false,
  );
  return { branchContext, branchContextLoading };
}
