import type {
  WorkspaceKind,
} from "@/lib/shared/types";

export const WORKSPACE_KIND_LABEL: Record<WorkspaceKind, string> = {
  worktree: "Worktree",
  linked: "Local",
};

export const WORKSPACE_KIND_TITLE: Record<WorkspaceKind, string> = {
  worktree:
    "Separate git worktree (own branch and folder under ~/.pandora/workspaces). Editor and workspace terminals use this path.",
  linked:
    "Linked to the project folder on disk — same checkout as the repo root. No extra worktree.",
};

