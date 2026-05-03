import type { ScmEntry, ScmSnapshot } from "@/lib/shared/shared.types";
import type { GitDecorationIndex, TreeGitDecoration, TreeGitTone } from "./git.types";

export function gitToneTextClass(tone: TreeGitTone, dimmed = false): string {
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

export function statusTone(entry: ScmEntry): TreeGitTone {
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

export function decorationForGitEntry(
  entry: ScmEntry,
  opts?: { includeDeleted?: boolean },
): TreeGitDecoration {
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

export function compareGitPathsByTreeOrder(aPath: string, bPath: string): number {
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

export function sortGitEntriesByTreeOrder(entries: ScmEntry[]): ScmEntry[] {
  return [...entries].sort((a, b) => compareGitPathsByTreeOrder(a.path, b.path));
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

export function optimisticallyStageEntries(
  entries: ScmEntry[],
  paths: string[],
): ScmEntry[] {
  if (paths.length === 0) return entries;
  const pathSet = new Set(paths);
  return sortGitEntriesByTreeOrder(
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

export function optimisticallyUnstageEntries(
  entries: ScmEntry[],
  paths: string[],
): ScmEntry[] {
  if (paths.length === 0) return entries;
  const pathSet = new Set(paths);
  return sortGitEntriesByTreeOrder(
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

export function optimisticallyStageAllEntries(entries: ScmEntry[]): ScmEntry[] {
  return optimisticallyStageEntries(
    entries,
    entries.filter((entry) => entry.untracked || entry.worktreeKind).map((entry) => entry.path),
  );
}

export function optimisticallyUnstageAllEntries(entries: ScmEntry[]): ScmEntry[] {
  return optimisticallyUnstageEntries(
    entries,
    entries.filter((entry) => entry.stagedKind).map((entry) => entry.path),
  );
}

/** Tone strength for directory decoration aggregation (higher = stronger). */
function tonePriority(tone: TreeGitDecoration["tone"]): number {
  switch (tone) {
    case "conflict":
      return 6;
    case "deleted":
      return 5;
    case "modified":
      return 4;
    case "renamed":
      return 3;
    case "added":
      return 2;
    case "ignored":
      return 1;
    default:
      return 0;
  }
}

/**
 * Build pre-computed decoration lookup tables from a flat entry list.
 *
 * - `byPath`      — exact decoration for each changed file
 * - `byDirectory` — strongest-tone decoration for every ancestor directory
 *
 * This lets file tree rows look up decorations in O(1) instead of scanning
 * the full entry list on every render.
 */
export function buildGitDecorationIndex(entries: readonly ScmEntry[]): GitDecorationIndex {
  const byPath: Record<string, TreeGitDecoration> = {};
  const byDirectory: Record<string, TreeGitDecoration> = {};

  for (const entry of entries) {
    const decoration = decorationForGitEntry(entry, { includeDeleted: false });
    if (decoration.tone === null) continue;

    byPath[entry.path] = decoration;

    // Walk every ancestor directory and propagate the strongest tone.
    const segments = entry.path.split("/");
    // segments.length - 1 because the last segment is the file name.
    for (let depth = 1; depth < segments.length; depth++) {
      const dirPath = segments.slice(0, depth).join("/");
      const existing = byDirectory[dirPath];
      if (!existing || tonePriority(decoration.tone) > tonePriority(existing.tone)) {
        byDirectory[dirPath] = decoration;
      }
    }

    // Also handle renames: the original path's directories get the same tone.
    if (entry.origPath) {
      const origSegments = entry.origPath.split("/");
      for (let depth = 1; depth < origSegments.length; depth++) {
        const dirPath = origSegments.slice(0, depth).join("/");
        const existing = byDirectory[dirPath];
        if (!existing || tonePriority(decoration.tone) > tonePriority(existing.tone)) {
          byDirectory[dirPath] = decoration;
        }
      }
    }
  }

  return { byPath, byDirectory };
}

/** Flatten a ScmSnapshot into a unified entry list compatible with the Git panel UI. */
export function flattenGitSnapshot(snapshot: ScmSnapshot | null): ScmEntry[] {
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
