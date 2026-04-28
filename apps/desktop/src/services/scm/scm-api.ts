import { invoke } from "@tauri-apps/api/core";
import type { CheckRun, ScmDiffResult, ScmGitBlobSource } from "./scm-types";

export function scmGitDiff(
  worktreePath: string,
  relativePath: string,
  staged: boolean,
): Promise<ScmDiffResult> {
  return invoke<ScmDiffResult>("scm_git_diff", {
    worktreePath,
    relativePath,
    staged,
  });
}

export function scmReadGitBlob(
  worktreePath: string,
  relativePath: string,
  source: ScmGitBlobSource,
): Promise<string> {
  return invoke<string>("scm_read_git_blob", { worktreePath, relativePath, source });
}

export function scmReadGitCompareBlob(
  worktreePath: string,
  relativePath: string,
  targetBranch: string,
  side: "base" | "head",
): Promise<string> {
  return invoke<string>("scm_read_git_compare_blob", {
    worktreePath,
    relativePath,
    targetBranch,
    side,
  });
}

export function scmCheckRuns(worktreePath: string): Promise<CheckRun[]> {
  return invoke<CheckRun[]>("scm_check_runs", { worktreePath });
}
