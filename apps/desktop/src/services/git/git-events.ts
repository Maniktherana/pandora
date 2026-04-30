import type { ScmSnapshot, ScmEntry } from "@/lib/shared/types";
import { queryClient } from "@/lib/query-client";
import {
  scmSummaryQueryKey,
  scmStatusQueryKey,
  deriveScmSummary,
  deriveScmStatus,
  type ScmStatusData,
  type ScmSummaryData,
} from "./git-queries";

function scmEntriesEqual(a: ScmEntry[], b: ScmEntry[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const ae = a[i];
    const be = b[i];
    if (
      ae.path !== be.path ||
      ae.stagedKind !== be.stagedKind ||
      ae.worktreeKind !== be.worktreeKind ||
      ae.untracked !== be.untracked ||
      ae.origPath !== be.origPath ||
      ae.lineStats.added !== be.lineStats.added ||
      ae.lineStats.removed !== be.lineStats.removed
    ) return false;
  }
  return true;
}

export function applyGitSnapshot(scopeId: string, snapshot: ScmSnapshot): void {
  queryClient.setQueryData(scmSummaryQueryKey(scopeId), (prev: ScmSummaryData | undefined) => {
    const next = deriveScmSummary(snapshot);
    if (
      prev &&
      prev.branch === next.branch &&
      prev.upstream === next.upstream &&
      prev.ahead === next.ahead &&
      prev.behind === next.behind &&
      prev.targetBranch === next.targetBranch &&
      prev.filesChanged === next.filesChanged &&
      prev.lineStats.added === next.lineStats.added &&
      prev.lineStats.removed === next.lineStats.removed
    ) return prev;
    return next;
  });

  queryClient.setQueryData(scmStatusQueryKey(scopeId), (prev: ScmStatusData | undefined) => {
    const next = deriveScmStatus(snapshot);
    if (!prev) return next;
    const stagedSame = scmEntriesEqual(prev.stagedEntries, next.stagedEntries);
    const unstagedSame = scmEntriesEqual(prev.unstagedEntries, next.unstagedEntries);
    const entriesSame = scmEntriesEqual(prev.entries, next.entries);
    if (
      stagedSame && unstagedSame && entriesSame &&
      prev.branch === next.branch &&
      prev.upstream === next.upstream &&
      prev.ahead === next.ahead &&
      prev.behind === next.behind &&
      prev.targetBranch === next.targetBranch &&
      prev.lineStats.added === next.lineStats.added &&
      prev.lineStats.removed === next.lineStats.removed
    ) return prev;
    return {
      ...next,
      entries: entriesSame ? prev.entries : next.entries,
      stagedEntries: stagedSame ? prev.stagedEntries : next.stagedEntries,
      unstagedEntries: unstagedSame ? prev.unstagedEntries : next.unstagedEntries,
      decorationIndex: entriesSame ? prev.decorationIndex : next.decorationIndex,
    };
  });
}

export function applyGitError(_scopeId: string, message: string): void {
  console.error(`[git] backend error: ${message}`);
}
