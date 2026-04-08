import { useQuery } from "@tanstack/react-query";
import { scmLineStats, scmPathLineStatsBulk, scmStatus, sortScmEntriesByTreeOrder } from "./scm.utils";
import { SCM_CHANGES_REFRESH_INTERVAL_MS } from "./scm.types";

type ScmQueryOptions = {
  enabled?: boolean;
};

export function useScmStatusQuery(workspaceRoot: string, options?: ScmQueryOptions) {
  return useQuery({
    queryKey: ["scm-status", workspaceRoot],
    queryFn: () => scmStatus(workspaceRoot).then(sortScmEntriesByTreeOrder),
    enabled: Boolean(workspaceRoot) && (options?.enabled ?? true),
    refetchInterval: SCM_CHANGES_REFRESH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });
}

export function useScmLineStatsQuery(worktreePath: string, options?: ScmQueryOptions) {
  return useQuery({
    queryKey: ["scm-line-stats", worktreePath],
    queryFn: () => scmLineStats(worktreePath),
    enabled: Boolean(worktreePath) && (options?.enabled ?? true),
    refetchInterval: SCM_CHANGES_REFRESH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });
}

export function useScmPathLineStatsBulkQuery(
  worktreePath: string,
  relativePaths: string[],
  staged: boolean,
  untrackedPaths: string[] = [],
  options?: ScmQueryOptions,
) {
  return useQuery({
    queryKey: ["scm-path-line-stats-bulk", worktreePath, staged, relativePaths, untrackedPaths],
    queryFn: () => scmPathLineStatsBulk(worktreePath, relativePaths, staged, untrackedPaths),
    enabled:
      Boolean(worktreePath) &&
      relativePaths.length > 0 &&
      (options?.enabled ?? true),
    refetchInterval: SCM_CHANGES_REFRESH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });
}
