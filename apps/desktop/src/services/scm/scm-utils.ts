import type { ScmEntry, ScmSnapshot } from "@/lib/shared/types";
import type { TreeScmDecoration, TreeScmTone } from "./scm-types";

export function scmToneTextClass(tone: TreeScmTone, dimmed = false): string {
  if (dimmed || tone === "ignored") return "text-[var(--theme-text-faint)]";
  switch (tone) {
    case "added":
      return "text-[var(--theme-scm-added)]";
    case "modified":
      return "text-[var(--theme-scm-modified)]";
    case "deleted":
      return "text-[var(--theme-scm-deleted)]";
    case "renamed":
      return "text-[var(--theme-scm-renamed)]";
    case "conflict":
      return "text-[var(--theme-scm-conflict)]";
    default:
      return "text-[var(--theme-text-subtle)]";
  }
}

export function statusTone(entry: ScmEntry): TreeScmTone {
  const staged = entry.stagedKind ?? "";
  const worktree = entry.worktreeKind ?? "";
  const combined = `${staged}${worktree}`;
  if (entry.untracked) return "added";
  if (combined.includes("U")) return "conflict";
  if (staged === "D" || worktree === "D") return "deleted";
  if (staged === "R" || worktree === "R" || entry.origPath) return "renamed";
  if (staged === "A" || worktree === "A") return "added";
  if (staged === "M" || worktree === "M") return "modified";
  return null;
}

export function decorationForScmEntry(
  entry: ScmEntry,
  opts?: { includeDeleted?: boolean },
): TreeScmDecoration {
  const includeDeleted = opts?.includeDeleted ?? true;
  if (entry.untracked) {
    return { badge: "A", tone: "added", dimmed: false };
  }
  const tone = statusTone(entry);
  if (!includeDeleted && tone === "deleted") {
    return { badge: null, tone: null, dimmed: false };
  }
  if (tone === "conflict") return { badge: "!", tone, dimmed: false };
  if (tone === "deleted") return { badge: "D", tone, dimmed: false };
  if (tone === "renamed") return { badge: "R", tone, dimmed: false };
  if (tone === "added") return { badge: "A", tone, dimmed: false };
  if (tone === "modified") return { badge: "M", tone, dimmed: false };
  return { badge: null, tone: null, dimmed: false };
}

function pathSegments(path: string): string[] {
  return path.split("/").filter(Boolean);
}

function comparePathSegment(a: string, b: string): number {
  const folded = a.toLowerCase().localeCompare(b.toLowerCase());
  if (folded !== 0) {
    return folded;
  }
  return a.localeCompare(b);
}

export function compareScmPathsByTreeOrder(aPath: string, bPath: string): number {
  const aSegments = pathSegments(aPath);
  const bSegments = pathSegments(bPath);
  const sharedDepth = Math.min(aSegments.length, bSegments.length);

  for (let index = 0; index < sharedDepth; index += 1) {
    const aSegment = aSegments[index];
    const bSegment = bSegments[index];
    if (aSegment === bSegment) {
      continue;
    }

    const aIsDirectory = index < aSegments.length - 1;
    const bIsDirectory = index < bSegments.length - 1;
    if (aIsDirectory !== bIsDirectory) {
      return aIsDirectory ? -1 : 1;
    }

    return comparePathSegment(aSegment, bSegment);
  }

  if (aSegments.length !== bSegments.length) {
    return aSegments.length - bSegments.length;
  }

  return comparePathSegment(aPath, bPath);
}

export function sortScmEntriesByTreeOrder(entries: ScmEntry[]): ScmEntry[] {
  return [...entries].sort((a, b) => compareScmPathsByTreeOrder(a.path, b.path));
}

function stagedKindAfterStage(entry: ScmEntry): string {
  if (entry.stagedKind) return entry.stagedKind;
  if (entry.untracked || entry.worktreeKind === "?") return "A";
  return entry.worktreeKind ?? "M";
}

function worktreeKindAfterUnstage(entry: ScmEntry): string {
  if (entry.stagedKind === "A") return "?";
  return entry.worktreeKind ?? entry.stagedKind ?? "M";
}

export function optimisticallyStageScmEntries(
  entries: ScmEntry[],
  paths: string[],
): ScmEntry[] {
  if (paths.length === 0) return entries;
  const pathSet = new Set(paths);
  return sortScmEntriesByTreeOrder(
    entries.map((entry) => {
      if (!pathSet.has(entry.path) || (!entry.untracked && !entry.worktreeKind)) {
        return entry;
      }
      return {
        ...entry,
        origPath: entry.origPath,
        stagedKind: stagedKindAfterStage(entry),
        worktreeKind: null,
        untracked: false,
      };
    }),
  );
}

export function optimisticallyUnstageScmEntries(
  entries: ScmEntry[],
  paths: string[],
): ScmEntry[] {
  if (paths.length === 0) return entries;
  const pathSet = new Set(paths);
  return sortScmEntriesByTreeOrder(
    entries.map((entry) => {
      if (!pathSet.has(entry.path) || !entry.stagedKind) {
        return entry;
      }
      const worktreeKind = worktreeKindAfterUnstage(entry);
      return {
        ...entry,
        origPath: entry.stagedKind === "R" ? null : entry.origPath,
        stagedKind: null,
        worktreeKind,
        untracked: worktreeKind === "?",
      };
    }),
  );
}

export function optimisticallyStageAllScmEntries(entries: ScmEntry[]): ScmEntry[] {
  return optimisticallyStageScmEntries(
    entries,
    entries.filter((entry) => entry.untracked || entry.worktreeKind).map((entry) => entry.path),
  );
}

export function optimisticallyUnstageAllScmEntries(entries: ScmEntry[]): ScmEntry[] {
  return optimisticallyUnstageScmEntries(
    entries,
    entries.filter((entry) => entry.stagedKind).map((entry) => entry.path),
  );
}

/** Flatten a ScmSnapshot into a unified entry list compatible with the SCM panel UI. */
export function flattenScmSnapshot(snapshot: ScmSnapshot | null): ScmEntry[] {
  if (!snapshot) return [];
  const byPath = new Map<string, ScmEntry>();
  for (const entry of snapshot.staged) {
    byPath.set(entry.path, { ...entry, worktreeKind: null, untracked: false });
  }
  for (const entry of snapshot.unstaged) {
    const existing = byPath.get(entry.path);
    if (existing) {
      byPath.set(entry.path, {
        ...existing,
        worktreeKind: entry.worktreeKind,
        untracked: entry.untracked,
        lineStats: {
          added: existing.lineStats.added + entry.lineStats.added,
          removed: existing.lineStats.removed + entry.lineStats.removed,
        },
      });
    } else {
      byPath.set(entry.path, { ...entry, stagedKind: null });
    }
  }
  return Array.from(byPath.values());
}
