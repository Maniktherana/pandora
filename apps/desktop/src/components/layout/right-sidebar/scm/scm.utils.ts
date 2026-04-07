import { invoke } from "@tauri-apps/api/core";
import type {
  ScmDiffResult,
  ScmGitBlobSource,
  ScmStatusEntry,
  TreeScmDecoration,
  TreeScmTone,
} from "./scm.types";

export function scmGitDiff(
  worktreePath: string,
  relativePath: string,
  staged: boolean
): Promise<ScmDiffResult> {
  return invoke<ScmDiffResult>("scm_git_diff", {
    worktreePath,
    relativePath,
    staged,
  });
}

export function scmStatus(worktreePath: string): Promise<ScmStatusEntry[]> {
  return invoke<ScmStatusEntry[]>("scm_status", { worktreePath });
}


export const SCM_TONE_HEX = {
  added: "#D0FDC6",
  modified: "#F9E38D",
  deleted: "#D9432A",
} as const;

export function scmToneTextClass(tone: TreeScmTone, dimmed = false): string {
  if (dimmed || tone === "ignored") return "text-[var(--theme-text-faint)]";
  switch (tone) {
    case "added":
      return "text-[#D0FDC6]";
    case "modified":
      return "text-[#F9E38D]";
    case "deleted":
      return "text-[#D9432A]";
    case "renamed":
      return "text-[var(--theme-interactive)]";
    case "conflict":
      return "text-[var(--theme-info)]";
    default:
      return "text-[var(--theme-text-muted)]";
  }
}

export function statusTone(entry: ScmStatusEntry): TreeScmTone {
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
  entry: ScmStatusEntry,
  opts?: { includeDeleted?: boolean }
): TreeScmDecoration {
  const includeDeleted = opts?.includeDeleted ?? true;
  if (entry.untracked) {
    return { badge: "U", tone: "added", dimmed: false };
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

export function scmStage(worktreePath: string, paths: string[]): Promise<void> {
  return invoke("scm_stage", { worktreePath, paths });
}

export function scmStageAll(worktreePath: string): Promise<void> {
  return invoke("scm_stage_all", { worktreePath });
}

export function scmUnstage(worktreePath: string, paths: string[]): Promise<void> {
  return invoke("scm_unstage", { worktreePath, paths });
}

export function scmUnstageAll(worktreePath: string): Promise<void> {
  return invoke("scm_unstage_all", { worktreePath });
}

export function scmDiscardTracked(worktreePath: string, path: string): Promise<void> {
  return invoke("scm_discard_tracked", { worktreePath, path });
}

export function scmDiscardUntracked(worktreePath: string, path: string): Promise<void> {
  return invoke("scm_discard_untracked", { worktreePath, path });
}

export function scmCommit(worktreePath: string, message: string): Promise<void> {
  return invoke("scm_commit", { worktreePath, message });
}

export function scmReadGitBlob(
  worktreePath: string,
  relativePath: string,
  source: ScmGitBlobSource
): Promise<string> {
  return invoke<string>("scm_read_git_blob", { worktreePath, relativePath, source });
}

export function readWorkspaceTextFile(workspaceRoot: string, relativePath: string): Promise<string> {
  return invoke<string>("read_workspace_text_file", { workspaceRoot, relativePath });
}
