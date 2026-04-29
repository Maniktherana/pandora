import { create } from "zustand";

export interface GitWorkspaceSummary {
  branch: string;
  lineStats: { added: number; removed: number };
  filesChanged: number;
}

interface GitSummaryStoreState {
  byWorkspaceId: Record<string, GitWorkspaceSummary>;
  applySummary: (workspaceId: string, summary: GitWorkspaceSummary) => void;
  resetWorkspace: (workspaceId: string) => void;
}

export const useGitSummaryStore = create<GitSummaryStoreState>((set) => ({
  byWorkspaceId: {},

  applySummary: (workspaceId, summary) =>
    set((s) => ({
      byWorkspaceId: { ...s.byWorkspaceId, [workspaceId]: summary },
    })),

  resetWorkspace: (workspaceId) =>
    set((s) => {
      const next = { ...s.byWorkspaceId };
      delete next[workspaceId];
      return { byWorkspaceId: next };
    }),
}));
