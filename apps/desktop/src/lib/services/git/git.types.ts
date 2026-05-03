import type { ScmEntry } from "@/lib/shared/shared.types";

export const GIT_SECTION_STICKY_ROW_HEIGHT_PX = 28;
export const GIT_SECTION_STICKY_Z_INDEX_BASE = 20;

export type GitDiffResult = {
  diff: string;
  truncated: boolean;
};

export type GitLineStats = {
  added: number;
  removed: number;
};

export type TreeGitTone =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "conflict"
  | "ignored"
  | null;

export type TreeGitDecoration = {
  badge: string | null;
  tone: TreeGitTone;
  dimmed: boolean;
};

/** Pre-computed decoration lookup tables built from a ScmSnapshot. */
export interface GitDecorationIndex {
  /** Exact file decorations keyed by relative path. */
  byPath: Record<string, TreeGitDecoration>;
  /** Strongest-tone decoration for each directory, keyed by relative path. */
  byDirectory: Record<string, TreeGitDecoration>;
}

/** Stable empty sentinel — use as default when no snapshot has arrived yet. */
export const EMPTY_DECORATION_INDEX: GitDecorationIndex = { byPath: {}, byDirectory: {} };

export type GitBlobSource = "head" | "index";

export type GitSelectionModifiers = {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
};

export type SelectGitEntryFn = (
  path: string,
  visiblePaths: string[],
  modifiers: GitSelectionModifiers,
) => boolean;

export type DiscardEntryFn = (entry: ScmEntry) => void;

export type CheckRun = {
  name: string;
  status: string;
  conclusion: string | null;
  htmlUrl: string;
  startedAt: string | null;
  completedAt: string | null;
};
