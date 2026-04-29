import type { ScmSnapshot } from "@/lib/shared/types";
import { useGitStore } from "./git-store";
import { useGitSummaryStore } from "./git-summary-store";

export function applyGitSnapshot(scopeId: string, snapshot: ScmSnapshot): void {
  useGitStore.getState().applySnapshot(scopeId, snapshot);
}

export function applyGitRefreshing(scopeId: string): void {
  useGitStore.getState().setRefreshing(scopeId, true);
}

export function applyGitError(scopeId: string, message: string): void {
  useGitStore.getState().setError(scopeId, message);
}

export function applyGitSummary(scopeId: string, snapshot: ScmSnapshot): void {
  const paths = new Set([
    ...snapshot.staged.map((e) => e.path),
    ...snapshot.unstaged.map((e) => e.path),
  ]);
  useGitSummaryStore.getState().applySummary(scopeId, {
    branch: snapshot.branch,
    lineStats: { added: snapshot.lineStats.added, removed: snapshot.lineStats.removed },
    filesChanged: paths.size,
  });
}
