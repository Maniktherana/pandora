import { create } from "zustand";
import type { DiffSource } from "@/lib/shared/types";

export type ReviewNavigationRequest = {
  workspaceId: string;
  path: string;
  source: DiffSource;
  nonce: number;
};

interface ReviewNavigationStoreState {
  requestByWorkspaceId: Record<string, ReviewNavigationRequest | undefined>;
  requestReviewNavigation: (workspaceId: string, path: string, source: DiffSource) => void;
  clearReviewNavigation: (workspaceId: string, nonce: number) => void;
}

export const useReviewNavigationStore = create<ReviewNavigationStoreState>((set) => ({
  requestByWorkspaceId: {},
  requestReviewNavigation: (workspaceId, path, source) =>
    set((state) => ({
      requestByWorkspaceId: {
        ...state.requestByWorkspaceId,
        [workspaceId]: {
          workspaceId,
          path,
          source,
          nonce: Date.now() + Math.random(),
        },
      },
    })),
  clearReviewNavigation: (workspaceId, nonce) =>
    set((state) => {
      const current = state.requestByWorkspaceId[workspaceId];
      if (!current || current.nonce !== nonce) return state;

      const next = { ...state.requestByWorkspaceId };
      delete next[workspaceId];
      return { requestByWorkspaceId: next };
    }),
}));

export function requestReviewNavigation(workspaceId: string, path: string, source: DiffSource) {
  useReviewNavigationStore.getState().requestReviewNavigation(workspaceId, path, source);
}
