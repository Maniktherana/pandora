import { useCallback } from "react";
import type { ScmEntry } from "@/lib/shared/types";
import { useGitStore, EMPTY_DECORATION_INDEX, EMPTY_PENDING } from "./git-store";
import type { GitDecorationIndex } from "./git-types";
import {
  gitRefresh,
  gitStage,
  gitStageAll,
  gitUnstage,
  gitUnstageAll,
  gitDiscardTracked,
  gitDiscardUntracked,
  gitCommit,
  gitPush,
  gitFetch,
  gitPull,
  gitSetTargetBranch,
  gitLoadBranchContext,
} from "./git-service";

const EMPTY_GIT_ENTRIES: ScmEntry[] = [];

export function useGitController(scopeId: string) {
  const snapshot = useGitStore((s) => s.byScopeId[scopeId]?.snapshot ?? null);
  const entries = useGitStore((s) => s.byScopeId[scopeId]?.entries ?? EMPTY_GIT_ENTRIES);
  const stagedEntries = useGitStore(
    (s) => s.byScopeId[scopeId]?.stagedEntries ?? EMPTY_GIT_ENTRIES,
  );
  const unstagedEntries = useGitStore(
    (s) => s.byScopeId[scopeId]?.unstagedEntries ?? EMPTY_GIT_ENTRIES,
  );
  const decorationIndex = useGitStore(
    (s) => s.byScopeId[scopeId]?.decorationIndex ?? EMPTY_DECORATION_INDEX,
  );
  const pendingPaths = useGitStore(
    (s) => s.byScopeId[scopeId]?.pendingPaths ?? EMPTY_PENDING,
  );
  const branchContext = useGitStore((s) => s.byScopeId[scopeId]?.branchContext ?? null);
  const branchContextLoading = useGitStore(
    (s) => s.byScopeId[scopeId]?.branchContextLoading ?? false,
  );

  const refresh = useCallback(() => gitRefresh(scopeId), [scopeId]);
  const stage = useCallback((paths: string[]) => gitStage(scopeId, paths), [scopeId]);
  const stageAll = useCallback(() => gitStageAll(scopeId), [scopeId]);
  const unstage = useCallback((paths: string[]) => gitUnstage(scopeId, paths), [scopeId]);
  const unstageAll = useCallback(() => gitUnstageAll(scopeId), [scopeId]);
  const discardTracked = useCallback(
    (paths: string[]) => gitDiscardTracked(scopeId, paths),
    [scopeId],
  );
  const discardUntracked = useCallback(
    (paths: string[]) => gitDiscardUntracked(scopeId, paths),
    [scopeId],
  );
  const commit = useCallback(
    (message: string, push = false) => gitCommit(scopeId, message, push),
    [scopeId],
  );
  const push = useCallback(() => gitPush(scopeId), [scopeId]);
  const fetch = useCallback(() => gitFetch(scopeId), [scopeId]);
  const pull = useCallback(() => gitPull(scopeId), [scopeId]);
  const setTargetBranch = useCallback(
    (branch: string | null) => gitSetTargetBranch(scopeId, branch),
    [scopeId],
  );
  const loadBranchContext = useCallback(() => gitLoadBranchContext(scopeId), [scopeId]);

  return {
    snapshot,
    entries,
    stagedEntries,
    unstagedEntries,
    decorationIndex,
    pendingPaths,
    branchContext,
    branchContextLoading,
    refresh,
    stage,
    stageAll,
    unstage,
    unstageAll,
    discardTracked,
    discardUntracked,
    commit,
    push,
    fetch,
    pull,
    setTargetBranch,
    loadBranchContext,
  };
}

// Re-export stable empty sentinels for consumers that read the store directly.
export type { GitDecorationIndex };
export { EMPTY_DECORATION_INDEX, EMPTY_PENDING };
