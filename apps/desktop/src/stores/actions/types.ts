import type { WritableDraft } from "immer";
import type { WorkspaceStoreState } from "../workspace-store";

/**
 * Zustand `set` with immer middleware — accepts either a mutating function or a partial state object.
 */
export type ImmerSet = {
  (fn: (state: WritableDraft<WorkspaceStoreState>) => void): void;
  (partial: Partial<WorkspaceStoreState>): void;
};

export type Get = () => WorkspaceStoreState;
