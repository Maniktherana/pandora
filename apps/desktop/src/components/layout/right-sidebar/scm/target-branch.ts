import type { HeaderBranchContext } from "@/lib/shared/types";
import { invoke } from "@tauri-apps/api/core";

const TARGET_BRANCH_STORAGE_KEY_PREFIX = "pandora.scm.targetBranch.";
export const WORKSPACE_TARGET_BRANCH_EVENT = "pandora:workspace-target-branch";

export type WorkspaceTargetBranchEventDetail = {
  workspaceId: string;
  targetBranch: string;
};

export function loadWorkspaceTargetBranch(workspaceId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(`${TARGET_BRANCH_STORAGE_KEY_PREFIX}${workspaceId}`);
  } catch {
    return null;
  }
}

export async function persistWorkspaceTargetBranch(workspaceId: string, targetBranch: string) {
  try {
    window.localStorage.setItem(`${TARGET_BRANCH_STORAGE_KEY_PREFIX}${workspaceId}`, targetBranch);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(
    new CustomEvent<WorkspaceTargetBranchEventDetail>(WORKSPACE_TARGET_BRANCH_EVENT, {
      detail: { workspaceId, targetBranch },
    }),
  );
  await invoke("set_workspace_target_branch", { workspaceId, targetBranch });
}

export function formatTargetBranch(branch: string | null): string {
  if (!branch) return "origin/...";
  return branch.startsWith("origin/") ? branch : `origin/${branch}`;
}

export function resolveWorkspaceTargetBranch(
  ctx: HeaderBranchContext,
  workspaceId: string,
): string | null {
  const stored = loadWorkspaceTargetBranch(workspaceId);
  if (stored && stored !== "origin" && ctx.availableBranches.includes(stored)) {
    return stored;
  }
  if (ctx.defaultTargetBranch) {
    return ctx.defaultTargetBranch;
  }
  if (ctx.availableBranches.includes("main") && ctx.currentBranch !== "main") {
    return "main";
  }
  return ctx.availableBranches.find((branch) => branch !== ctx.currentBranch) ?? null;
}
