import { useQuery } from "@tanstack/react-query";
import { scmLineStats, scmStatus } from "./scm.utils";
import { SCM_CHANGES_REFRESH_INTERVAL_MS } from "./scm.types";

type ScmQueryOptions = {
  enabled?: boolean;
};

export function useScmStatusQuery(workspaceRoot: string, options?: ScmQueryOptions) {
  return useQuery({
    queryKey: ["scm-status", workspaceRoot],
    queryFn: () => scmStatus(workspaceRoot),
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
