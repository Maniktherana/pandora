import { useCallback, useEffect } from "react";
import { useScmStore } from "./scm-store";
import {
  scmInit,
  scmRefresh,
  scmStage,
  scmStageAll,
  scmUnstage,
  scmUnstageAll,
  scmDiscardTracked,
  scmDiscardUntracked,
  scmCommit,
  scmPush,
  scmFetch,
  scmPull,
  scmSetTargetBranch,
} from "./scm-service";

export function useScmController(runtimeId: string) {
  const snapshot = useScmStore((s) => s.byRuntimeId[runtimeId]?.snapshot ?? null);

  useEffect(() => {
    scmInit(runtimeId);
  }, [runtimeId]);

  const refresh = useCallback(() => scmRefresh(runtimeId), [runtimeId]);

  const stage = useCallback(
    (paths: string[]) => scmStage(runtimeId, paths),
    [runtimeId],
  );

  const stageAll = useCallback(() => scmStageAll(runtimeId), [runtimeId]);

  const unstage = useCallback(
    (paths: string[]) => scmUnstage(runtimeId, paths),
    [runtimeId],
  );

  const unstageAll = useCallback(() => scmUnstageAll(runtimeId), [runtimeId]);

  const discardTracked = useCallback(
    (paths: string[]) => scmDiscardTracked(runtimeId, paths),
    [runtimeId],
  );

  const discardUntracked = useCallback(
    (paths: string[]) => scmDiscardUntracked(runtimeId, paths),
    [runtimeId],
  );

  const commit = useCallback(
    (message: string, push = false) => scmCommit(runtimeId, message, push),
    [runtimeId],
  );

  const push = useCallback(() => scmPush(runtimeId), [runtimeId]);

  const fetch = useCallback(() => scmFetch(runtimeId), [runtimeId]);

  const pull = useCallback(() => scmPull(runtimeId), [runtimeId]);

  const setTargetBranch = useCallback(
    (branch: string | null) => scmSetTargetBranch(runtimeId, branch),
    [runtimeId],
  );

  return {
    snapshot,
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
  };
}
