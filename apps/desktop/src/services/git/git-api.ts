import {
  ipcGitDiff,
  ipcGitReadBlob,
  ipcGitReadCompareBlob,
  ipcGitCheckRuns,
} from "@/services/ipc/ipc-client";
import { invoke } from "@tauri-apps/api/core";
import type { HeaderBranchContext } from "@/lib/shared/types";
import type { GitDiffResult, GitBlobSource, CheckRun } from "./git-types";

export function gitDiff(
  worktreePath: string,
  relativePath: string,
  staged: boolean,
): Promise<GitDiffResult> {
  return ipcGitDiff(worktreePath, relativePath, staged);
}

export function gitReadBlob(
  worktreePath: string,
  relativePath: string,
  source: GitBlobSource,
): Promise<string> {
  return ipcGitReadBlob(worktreePath, relativePath, source);
}

export function gitReadCompareBlob(
  worktreePath: string,
  relativePath: string,
  targetBranch: string,
  side: "base" | "head",
): Promise<string> {
  return ipcGitReadCompareBlob(worktreePath, relativePath, targetBranch, side);
}

export function gitCheckRuns(worktreePath: string): Promise<CheckRun[]> {
  return ipcGitCheckRuns(worktreePath);
}

export function gitHeaderBranchContext(workspaceId: string): Promise<HeaderBranchContext> {
  return invoke<HeaderBranchContext>("header_branch_context", { workspaceId });
}
