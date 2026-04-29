import { useQuery } from "@tanstack/react-query";
import { gitCheckRuns } from "./git-api";

const GIT_CHECK_RUNS_INTERVAL_MS = 15_000;
const GIT_STALE_TIME_MS = 5_000;
const GIT_GC_TIME_MS = 300_000;

type GitQueryOptions = {
  enabled?: boolean;
};

export function useCheckRunsQuery(worktreePath: string, options?: GitQueryOptions) {
  return useQuery({
    queryKey: ["git-check-runs", worktreePath],
    queryFn: () => gitCheckRuns(worktreePath),
    enabled: Boolean(worktreePath) && (options?.enabled ?? true),
    refetchInterval: GIT_CHECK_RUNS_INTERVAL_MS,
    refetchIntervalInBackground: false,
    staleTime: GIT_STALE_TIME_MS,
    gcTime: GIT_GC_TIME_MS,
  });
}
