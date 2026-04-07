import type { DiffSource } from "@/lib/shared/types";

export const SCM_CHANGES_REFRESH_INTERVAL_MS = 2000;

export type ScmDiffResult = {
  diff: string;
  truncated: boolean;
};

export type ScmStatusEntry = {
  path: string;
  origPath: string | null;
  stagedKind: string | null;
  worktreeKind: string | null;
  untracked: boolean;
};

export type TreeScmTone =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "conflict"
  | "ignored"
  | null;

export type TreeScmDecoration = {
  badge: string | null;
  tone: TreeScmTone;
  dimmed: boolean;
};

export type ScmGitBlobSource = "head" | "index";

export type OpenDiffFn = (path: string, source: DiffSource) => void;
export type RunScmActionFn = (fn: () => Promise<void>) => void;
export type DiscardEntryFn = (entry: ScmStatusEntry) => void;

