import type { ScmSnapshot } from "@/lib/shared/types";
import { queryClient } from "@/lib/query-client";
import {
  resolveScmSnapshotWaiters,
  scmSummaryQueryKey,
  scmStatusQueryKey,
  deriveScmSummary,
  deriveScmStatus,
} from "./git-queries";

/**
 * Primary handler for incoming scm_snapshot events.
 *
 * 1. Resolves any query-function promises that are waiting for a first
 *    snapshot (waiter registry in git-queries.ts).
 * 2. Pushes fresh data directly into the React Query cache so all
 *    subscribers (workspace rows, SCM panel, review viewer) re-render
 *    immediately without a background refetch.
 */
export function applyGitSnapshot(scopeId: string, snapshot: ScmSnapshot): void {
  // Wake pending query fetchers for this workspace.
  resolveScmSnapshotWaiters(scopeId, snapshot);

  // Push authoritative data into the React Query cache.
  queryClient.setQueryData(scmSummaryQueryKey(scopeId), deriveScmSummary(snapshot));
  queryClient.setQueryData(scmStatusQueryKey(scopeId), deriveScmStatus(snapshot));
}

/**
 * Called alongside applyGitSnapshot from the IPC event router.
 * The React Query cache update is handled entirely by applyGitSnapshot;
 * this is kept for router compatibility but performs no additional work.
 */
export function applyGitSummary(_scopeId: string, _snapshot: ScmSnapshot): void {
  // No-op: applyGitSnapshot above owns the cache and waiter resolution.
}

/** Signals that the backend is recomputing git status (no data change yet). */
export function applyGitRefreshing(_scopeId: string): void {
  // No-op for now; could update a per-workspace refreshing flag in future.
}

/** Records a backend git error; the affected query will remain stale. */
export function applyGitError(_scopeId: string, message: string): void {
  console.error(`[git] backend error: ${message}`);
}
