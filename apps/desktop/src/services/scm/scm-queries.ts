import { useQuery } from "@tanstack/react-query";
import { scmCheckRuns } from "./scm-api";

const SCM_CHECK_RUNS_INTERVAL_MS = 15_000;
const SCM_STALE_TIME_MS = 5_000;
const SCM_GC_TIME_MS = 300_000;

type ScmQueryOptions = {
  enabled?: boolean;
};

export function useCheckRunsQuery(worktreePath: string, options?: ScmQueryOptions) {
  return useQuery({
    queryKey: ["scm-check-runs", worktreePath],
    queryFn: () => scmCheckRuns(worktreePath),
    enabled: Boolean(worktreePath) && (options?.enabled ?? true),
    refetchInterval: SCM_CHECK_RUNS_INTERVAL_MS,
    refetchIntervalInBackground: false,
    staleTime: SCM_STALE_TIME_MS,
    gcTime: SCM_GC_TIME_MS,
  });
}
