import type { HeaderBranchContext } from "@/lib/shared/types";

export function formatTargetBranch(branch: string | null): string {
  if (!branch) return "origin/...";
  return branch.startsWith("origin/") ? branch : `origin/${branch}`;
}

export function resolveWorkspaceTargetBranch(
  ctx: HeaderBranchContext,
  targetBranch: string | null,
): string | null {
  if (targetBranch && targetBranch !== "origin" && ctx.availableBranches.includes(targetBranch)) {
    return targetBranch;
  }
  if (ctx.defaultTargetBranch) {
    return ctx.defaultTargetBranch;
  }
  if (ctx.availableBranches.includes("main") && ctx.currentBranch !== "main") {
    return "main";
  }
  return ctx.availableBranches.find((branch) => branch !== ctx.currentBranch) ?? null;
}
