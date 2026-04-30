import { useQuery, skipToken } from "@tanstack/react-query";
import { gitCheckRuns } from "./git-api";
import { flattenGitSnapshot, buildGitDecorationIndex } from "./git-utils";
import type { ScmSnapshot, ScmEntry } from "@/lib/shared/types";
import { EMPTY_DECORATION_INDEX } from "./git-types";
import type { GitDecorationIndex } from "./git-types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GIT_CHECK_RUNS_INTERVAL_MS = 15_000;
const GIT_STALE_TIME_MS = 5_000;
const GIT_GC_TIME_MS = 300_000;

type GitQueryOptions = {
  enabled?: boolean;
};

// ---------------------------------------------------------------------------
// CI check-runs query — has a real queryFn because it polls GitHub, not SCM
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// SCM Summary — lightweight data consumed by workspace rows
// ---------------------------------------------------------------------------

/**
 * Cheap summary that workspace rows need: branch, ahead/behind, dirty count,
 * line stats. Derived from ScmSnapshot; no heavy decoration work.
 */
export interface ScmSummaryData {
  branch: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  targetBranch: string | null;
  filesChanged: number;
  lineStats: { added: number; removed: number };
  hasChanges: boolean;
}

export function scmSummaryQueryKey(workspaceId: string) {
  return ["scm-summary", workspaceId] as const;
}

/** Derive the cheap summary shape from a raw ScmSnapshot. */
export function deriveScmSummary(snapshot: ScmSnapshot): ScmSummaryData {
  const paths = new Set([
    ...snapshot.staged.map((e) => e.path),
    ...snapshot.unstaged.map((e) => e.path),
  ]);
  const filesChanged = paths.size;
  return {
    branch: snapshot.branch,
    upstream: snapshot.upstream,
    ahead: snapshot.ahead,
    behind: snapshot.behind,
    targetBranch: snapshot.targetBranch,
    filesChanged,
    lineStats: { added: snapshot.lineStats.added, removed: snapshot.lineStats.removed },
    hasChanges: filesChanged > 0,
  };
}

/**
 * Passive cache hook for SCM summary data.
 *
 * Subscribes to the React Query cache entry so the component re-renders when
 * git-events.ts pushes a fresh snapshot via setQueryData. Returns cached data
 * when present, undefined on cache miss.
 *
 * Contract:
 * - queryFn is skipToken — never fetches, never starts backend work.
 * - Data is written exclusively by applyGitSnapshot in git-events.ts.
 * - Safe to call for null/undefined workspaceId; returns undefined.
 */
export function useScmSummaryCached(
  workspaceId: string | null | undefined,
): ScmSummaryData | undefined {
  const id = workspaceId ?? "";
  const { data } = useQuery<ScmSummaryData>({
    queryKey: scmSummaryQueryKey(id),
    queryFn: skipToken,
    staleTime: Infinity,
    gcTime: GIT_GC_TIME_MS,
  });
  return data;
}

// ---------------------------------------------------------------------------
// SCM Status — full status for the SCM panel and review viewer
// ---------------------------------------------------------------------------

function hasStaged(entry: ScmEntry): boolean {
  return entry.stagedKind != null && entry.stagedKind !== "";
}

function hasUnstaged(entry: ScmEntry): boolean {
  return entry.untracked || (entry.worktreeKind != null && entry.worktreeKind !== "");
}

/**
 * Full status shape: snapshot + derived entry lists + pre-built decoration
 * index + branch info.
 */
export interface ScmStatusData {
  snapshot: ScmSnapshot;
  entries: ScmEntry[];
  stagedEntries: ScmEntry[];
  unstagedEntries: ScmEntry[];
  decorationIndex: GitDecorationIndex;
  branch: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  targetBranch: string | null;
  lineStats: { added: number; removed: number };
}

export function scmStatusQueryKey(workspaceId: string) {
  return ["scm-status", workspaceId] as const;
}

/** Derive the full status shape from a raw ScmSnapshot. */
export function deriveScmStatus(snapshot: ScmSnapshot): ScmStatusData {
  const entries = flattenGitSnapshot(snapshot);
  return {
    snapshot,
    entries,
    stagedEntries: entries.filter(hasStaged),
    unstagedEntries: entries.filter(hasUnstaged),
    decorationIndex: buildGitDecorationIndex(entries),
    branch: snapshot.branch,
    upstream: snapshot.upstream,
    ahead: snapshot.ahead,
    behind: snapshot.behind,
    targetBranch: snapshot.targetBranch,
    lineStats: { added: snapshot.lineStats.added, removed: snapshot.lineStats.removed },
  };
}

/**
 * Apply an optimistic entry transformation to a cached ScmStatusData value,
 * re-deriving the staged/unstaged lists and decoration index from the new
 * entries. Used by workspace-changes-panel for instant UI response to stage
 * and unstage actions.
 */
export function applyOptimisticEntriesToStatus(
  current: ScmStatusData,
  newEntries: ScmEntry[],
): ScmStatusData {
  return {
    ...current,
    entries: newEntries,
    stagedEntries: newEntries.filter(hasStaged),
    unstagedEntries: newEntries.filter(hasUnstaged),
    decorationIndex: buildGitDecorationIndex(newEntries),
  };
}

/**
 * Passive cache hook for full SCM status.
 *
 * Subscribes to the React Query cache entry so the component re-renders when
 * git-events.ts pushes a fresh snapshot via setQueryData. Returns cached data
 * when present, undefined on cache miss.
 *
 * Contract:
 * - queryFn is skipToken — never fetches, never starts backend work.
 * - Data is written exclusively by applyGitSnapshot in git-events.ts.
 * - Safe to call for null/undefined workspaceId; returns undefined.
 */
export function useScmStatusCached(
  workspaceId: string | null | undefined,
): ScmStatusData | undefined {
  const id = workspaceId ?? "";
  const { data } = useQuery<ScmStatusData>({
    queryKey: scmStatusQueryKey(id),
    queryFn: skipToken,
    staleTime: Infinity,
    gcTime: GIT_GC_TIME_MS,
  });
  return data;
}

// ---------------------------------------------------------------------------
// Cached Git Decorations — read-only cache subscriber for FileTree badges
// ---------------------------------------------------------------------------

/**
 * Returns the git decoration index from the existing React Query cache for
 * this workspace. Returns EMPTY_DECORATION_INDEX when no snapshot has been
 * cached yet.
 *
 * Contract:
 * - Uses skipToken so queryFn is never invoked.
 * - Never starts any backend work.
 * - Subscribes to the scm-status cache entry so the file tree re-renders
 *   reactively when decorations update, without owning the fetch lifecycle.
 */
export function useCachedGitDecorations(workspaceId: string): GitDecorationIndex {
  const { data } = useQuery<ScmStatusData>({
    queryKey: scmStatusQueryKey(workspaceId),
    queryFn: skipToken,
    staleTime: Infinity,
  });
  return data?.decorationIndex ?? EMPTY_DECORATION_INDEX;
}
