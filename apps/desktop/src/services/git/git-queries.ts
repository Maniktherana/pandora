import { useQuery } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { gitCheckRuns } from "./git-api";
import { gitInit, gitRefresh } from "./git-service";
import { flattenGitSnapshot, buildGitDecorationIndex } from "./git-utils";
import type { ScmSnapshot, ScmEntry } from "@/lib/shared/types";
import type { GitDecorationIndex } from "./git-types";

const GIT_CHECK_RUNS_INTERVAL_MS = 15_000;
const GIT_STALE_TIME_MS = 5_000;
const GIT_GC_TIME_MS = 300_000;
/** How long a query waits for the backend's first scm_snapshot before timing out. */
const SCM_FETCH_TIMEOUT_MS = 10_000;

type GitQueryOptions = {
  enabled?: boolean;
};

// ---------------------------------------------------------------------------
// Existing: CI check-runs query (unchanged)
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
// Snapshot waiter registry
//
// Query functions call gitInit() then park a resolver here.
// git-events.ts calls resolveScmSnapshotWaiters() when a scm_snapshot event
// arrives, waking every waiting query for that workspace at once.
// This keeps query fetchers fully decoupled from Zustand.
// ---------------------------------------------------------------------------

const pendingSnapshotWaiters = new Map<string, Set<(snapshot: ScmSnapshot) => void>>();

/**
 * Called by git-events.ts on every incoming scm_snapshot event.
 * Resolves all query promises that are waiting for their first snapshot.
 */
export function resolveScmSnapshotWaiters(scopeId: string, snapshot: ScmSnapshot): void {
  const waiters = pendingSnapshotWaiters.get(scopeId);
  if (!waiters) return;
  pendingSnapshotWaiters.delete(scopeId);
  for (const resolve of waiters) {
    resolve(snapshot);
  }
}

/**
 * Core queryFn primitive: ensures the backend subscription is started then
 * waits for the first snapshot event. Subsequent updates arrive via
 * queryClient.setQueryData in git-events.ts.
 *
 * If the subscription was already active (gitInit returned false), a new
 * scm_snapshot event is not guaranteed to arrive — so we call gitRefresh to
 * ask the backend to re-emit the current state. This handles refetch after
 * stale time, query invalidation, and failure recovery correctly.
 */
function waitForScmSnapshot(workspaceId: string): Promise<ScmSnapshot> {
  const newSubscription = gitInit(workspaceId);

  if (!newSubscription) {
    // Already subscribed; request a fresh snapshot so the waiter resolves
    // promptly instead of sitting for up to SCM_FETCH_TIMEOUT_MS.
    gitRefresh(workspaceId).catch((err: unknown) => {
      console.warn(`[git] refresh failed for ${workspaceId}:`, err);
    });
  }

  return new Promise<ScmSnapshot>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error(`SCM snapshot timeout for workspace ${workspaceId}`));
    }, SCM_FETCH_TIMEOUT_MS);

    const onSnapshot = (snapshot: ScmSnapshot) => {
      cleanup();
      resolve(snapshot);
    };

    const cleanup = () => {
      window.clearTimeout(timer);
      pendingSnapshotWaiters.get(workspaceId)?.delete(onSnapshot);
    };

    const set = pendingSnapshotWaiters.get(workspaceId) ?? new Set();
    set.add(onSnapshot);
    pendingSnapshotWaiters.set(workspaceId, set);
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
 * React Query hook for SCM summary data.
 * Disabled when workspaceId is null/empty (e.g. non-ready workspaces).
 * Rows render immediately with undefined data; data appears once the first
 * snapshot resolves — no blocking loader in workspace rows.
 */
export function useScmSummaryQuery(
  workspaceId: string | null | undefined,
  options?: GitQueryOptions,
) {
  const id = workspaceId ?? "";
  return useQuery<ScmSummaryData>({
    queryKey: scmSummaryQueryKey(id),
    queryFn: () => waitForScmSnapshot(id).then(deriveScmSummary),
    enabled: Boolean(workspaceId) && (options?.enabled ?? true),
    staleTime: GIT_STALE_TIME_MS,
    gcTime: GIT_GC_TIME_MS,
  });
}

/** Imperatively prefetch SCM summary for a workspace at app launch. */
export function prefetchScmSummary(qc: QueryClient, workspaceId: string): Promise<void> {
  return qc.prefetchQuery({
    queryKey: scmSummaryQueryKey(workspaceId),
    queryFn: () => waitForScmSnapshot(workspaceId).then(deriveScmSummary),
    staleTime: GIT_STALE_TIME_MS,
  });
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
 * React Query hook for full SCM status.
 * Disabled when workspaceId is null/empty.
 */
export function useScmStatusQuery(
  workspaceId: string | null | undefined,
  options?: GitQueryOptions,
) {
  const id = workspaceId ?? "";
  return useQuery<ScmStatusData>({
    queryKey: scmStatusQueryKey(id),
    queryFn: () => waitForScmSnapshot(id).then(deriveScmStatus),
    enabled: Boolean(workspaceId) && (options?.enabled ?? true),
    staleTime: GIT_STALE_TIME_MS,
    gcTime: GIT_GC_TIME_MS,
  });
}

/** Imperatively prefetch full SCM status for a workspace. */
export function prefetchScmStatus(qc: QueryClient, workspaceId: string): Promise<void> {
  return qc.prefetchQuery({
    queryKey: scmStatusQueryKey(workspaceId),
    queryFn: () => waitForScmSnapshot(workspaceId).then(deriveScmStatus),
    staleTime: GIT_STALE_TIME_MS,
  });
}
