import type { ScmEntry, DiffSource } from "@/lib/shared/types";
import type { GitLineStats, TreeGitDecoration } from "@/services/git/git-types";
import { decorationForGitEntry } from "@/services/git/git-utils";

export type ReviewRowData = {
  entry: ScmEntry;
  stats: GitLineStats | undefined;
  decoration: TreeGitDecoration;
  statsKey: string;
};

export function reviewStatsKey(path: string, source: DiffSource): string {
  return `${source}:${path}`;
}

let prevDecorations = new Map<string, TreeGitDecoration>();

export function buildRowModel(
  entries: ScmEntry[],
  source: DiffSource,
  loadedStatsByKey: Record<string, GitLineStats>,
): ReviewRowData[] {
  const nextDecorations = new Map<string, TreeGitDecoration>();
  const result = entries.map((entry) => {
    const key = reviewStatsKey(entry.path, source);
    const newDec = decorationForGitEntry(entry);
    const prevDec = prevDecorations.get(entry.path);
    const decoration =
      prevDec &&
      prevDec.badge === newDec.badge &&
      prevDec.tone === newDec.tone &&
      prevDec.dimmed === newDec.dimmed
        ? prevDec
        : newDec;
    nextDecorations.set(entry.path, decoration);
    return {
      entry,
      stats: loadedStatsByKey[key] ?? entry.lineStats,
      decoration,
      statsKey: key,
    };
  });
  prevDecorations = nextDecorations;
  return result;
}
