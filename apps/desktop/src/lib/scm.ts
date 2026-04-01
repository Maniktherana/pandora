import { invoke } from "@tauri-apps/api/core";

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

/** `head` = `HEAD:path`, `index` = staged blob (`:path`, stage 0). */
export type ScmGitBlobSource = "head" | "index";

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
