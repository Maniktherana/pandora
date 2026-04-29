import { create } from "zustand";
import type { HeaderBranchContext, ScmEntry, ScmSnapshot } from "@/lib/shared/types";
import { buildGitDecorationIndex, flattenGitSnapshot } from "@/services/git/git-utils";
import type { GitDecorationIndex } from "./git-types";

const EMPTY_GIT_ENTRIES: ScmEntry[] = [];
export const EMPTY_DECORATION_INDEX: GitDecorationIndex = { byPath: {}, byDirectory: {} };
export const EMPTY_PENDING: ReadonlySet<string> = new Set<string>();

function hasStaged(entry: ScmEntry): boolean {
  return entry.stagedKind != null && entry.stagedKind !== "";
}

function hasUnstaged(entry: ScmEntry): boolean {
  return entry.untracked || (entry.worktreeKind != null && entry.worktreeKind !== "");
}

export interface GitWorkspaceState {
  snapshot: ScmSnapshot | null;
  /** Merged staged+unstaged flat list (for counts, review viewer, decorations). */
  entries: ScmEntry[];
  /** Entries that have staged changes — derived once on snapshot, not in render. */
  stagedEntries: ScmEntry[];
  /** Entries that have unstaged / untracked changes — derived once on snapshot. */
  unstagedEntries: ScmEntry[];
  /** Pre-built O(1) decoration lookup for the file tree. */
  decorationIndex: GitDecorationIndex;
  /** Paths for which a stage/unstage IPC call is in flight. Cleared on next snapshot. */
  pendingPaths: ReadonlySet<string>;
  branchContext: HeaderBranchContext | null;
  branchContextLoading: boolean;
  refreshing: boolean;
  lastError: string | null;
}

function emptyGitState(): GitWorkspaceState {
  return {
    snapshot: null,
    entries: EMPTY_GIT_ENTRIES,
    stagedEntries: EMPTY_GIT_ENTRIES,
    unstagedEntries: EMPTY_GIT_ENTRIES,
    decorationIndex: EMPTY_DECORATION_INDEX,
    pendingPaths: EMPTY_PENDING,
    branchContext: null,
    branchContextLoading: false,
    refreshing: false,
    lastError: null,
  };
}

interface GitStoreState {
  byScopeId: Record<string, GitWorkspaceState>;
  applySnapshot: (scopeId: string, snapshot: ScmSnapshot) => void;
  markPending: (scopeId: string, paths: string[]) => void;
  setBranchContext: (scopeId: string, context: HeaderBranchContext | null) => void;
  setBranchContextLoading: (scopeId: string, loading: boolean) => void;
  setRefreshing: (scopeId: string, refreshing: boolean) => void;
  setError: (scopeId: string, error: string | null) => void;
  resetScope: (scopeId: string) => void;
}

export const useGitStore = create<GitStoreState>((set) => ({
  byScopeId: {},

  applySnapshot: (scopeId, snapshot) =>
    set((s) => {
      const entries = flattenGitSnapshot(snapshot);
      return {
        byScopeId: {
          ...s.byScopeId,
          [scopeId]: {
            ...(s.byScopeId[scopeId] ?? emptyGitState()),
            snapshot,
            entries,
            stagedEntries: entries.filter(hasStaged),
            unstagedEntries: entries.filter(hasUnstaged),
            decorationIndex: buildGitDecorationIndex(entries),
            // Clear pending — server snapshot is now the authoritative state.
            pendingPaths: EMPTY_PENDING,
            refreshing: false,
            lastError: null,
          },
        },
      };
    }),

  markPending: (scopeId, paths) =>
    set((s) => {
      if (paths.length === 0) return s;
      const current = s.byScopeId[scopeId] ?? emptyGitState();
      const next = new Set([...current.pendingPaths, ...paths]);
      return {
        byScopeId: {
          ...s.byScopeId,
          [scopeId]: { ...current, pendingPaths: next },
        },
      };
    }),

  setBranchContext: (scopeId, context) =>
    set((s) => {
      const current = s.byScopeId[scopeId] ?? emptyGitState();
      return {
        byScopeId: {
          ...s.byScopeId,
          [scopeId]: { ...current, branchContext: context, branchContextLoading: false },
        },
      };
    }),

  setBranchContextLoading: (scopeId, loading) =>
    set((s) => {
      const current = s.byScopeId[scopeId] ?? emptyGitState();
      return {
        byScopeId: {
          ...s.byScopeId,
          [scopeId]: { ...current, branchContextLoading: loading },
        },
      };
    }),

  setRefreshing: (scopeId, refreshing) =>
    set((s) => {
      const current = s.byScopeId[scopeId] ?? emptyGitState();
      return {
        byScopeId: { ...s.byScopeId, [scopeId]: { ...current, refreshing } },
      };
    }),

  setError: (scopeId, error) =>
    set((s) => {
      const current = s.byScopeId[scopeId] ?? emptyGitState();
      return {
        byScopeId: { ...s.byScopeId, [scopeId]: { ...current, lastError: error } },
      };
    }),

  resetScope: (scopeId) =>
    set((s) => {
      const next = { ...s.byScopeId };
      delete next[scopeId];
      return { byScopeId: next };
    }),
}));
