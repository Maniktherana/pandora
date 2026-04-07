import { memo } from "react";
import { GitPullRequest, RotateCcw, Trash2 } from "lucide-react";
import { useDesktopView } from "@/hooks/use-desktop-view";
import { useWorkspaceActions } from "@/hooks/use-workspace-actions";
import { cn } from "@/lib/shared/utils";
import type { WorkspaceRecord } from "@/lib/shared/types";
import { StatusDot } from "./status-dot";
import {
  WORKSPACE_KIND_LABEL,
  WORKSPACE_KIND_TITLE,
} from "./left-sidebar.types";

type WorkspaceRowProps = {
  workspace: WorkspaceRecord;
};

function WorkspaceRow({ workspace }: WorkspaceRowProps) {
  const selectedWorkspaceID = useDesktopView((view) => view.selectedWorkspaceID);
  const navigationArea = useDesktopView((view) => view.navigationArea);
  const workspaceCommands = useWorkspaceActions();

  const isSelected = workspace.id === selectedWorkspaceID;
  const isActive = navigationArea === "sidebar" && isSelected;

  return (
    <div className="group">
      <button
        onClick={() => {
          workspaceCommands.selectWorkspace(workspace.id);
          workspaceCommands.setNavigationArea("sidebar");
        }}
        onDoubleClick={() => {
          workspaceCommands.selectWorkspace(workspace.id);
          workspaceCommands.setNavigationArea("workspace");
        }}
        className={cn(
          "flex w-full select-none items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors",
          isActive
            ? "bg-[var(--theme-panel-interactive)] border border-[var(--theme-interactive)]/35"
            : isSelected
              ? "bg-[var(--theme-panel-hover)] border border-[var(--theme-border)]"
              : "hover:bg-[var(--theme-panel-hover)] border border-transparent"
        )}
      >
        <StatusDot status={workspace.status} />
        <span className="text-[13px] text-[var(--theme-text)] truncate min-w-0 flex-1">
          {workspace.name}
        </span>
        <span
          className={cn(
            "shrink-0 text-[9px] font-semibold uppercase tracking-wide px-1 py-px rounded",
            (workspace.workspaceKind ?? "worktree") === "linked"
              ? "bg-sky-500/15 text-sky-400/90"
              : "bg-violet-500/15 text-violet-300/90"
          )}
          title={WORKSPACE_KIND_TITLE[workspace.workspaceKind ?? "worktree"]}
        >
          {WORKSPACE_KIND_LABEL[workspace.workspaceKind ?? "worktree"]}
        </span>
        {workspace.prUrl && (
          <span
            className={cn(
              "shrink-0 flex items-center gap-0.5 text-[9px] font-semibold uppercase tracking-wide px-1 py-px rounded",
              workspace.prState === "merged"
                ? "bg-green-500/15 text-green-400/90"
                : workspace.prState === "closed"
                  ? "bg-red-500/15 text-red-400/90"
                  : "bg-blue-500/15 text-blue-400/90"
            )}
            title={`PR #${workspace.prNumber} — ${workspace.prState}`}
          >
            <GitPullRequest className="size-2.5" />
            #{workspace.prNumber}
          </span>
        )}
        {workspace.status === "failed" && (
          <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={(event) => {
                event.stopPropagation();
                workspaceCommands.retryWorkspace(workspace.id);
              }}
              className="p-0.5 rounded hover:bg-[var(--theme-panel-hover)]"
              title="Retry"
            >
              <RotateCcw className="w-3 h-3 text-[var(--theme-text-muted)]" />
            </button>
            <button
              onClick={(event) => {
                event.stopPropagation();
                workspaceCommands.removeWorkspace(workspace.id);
              }}
              className="p-0.5 rounded hover:bg-[var(--theme-panel-hover)]"
              title="Remove"
            >
              <Trash2 className="w-3 h-3 text-[var(--theme-text-muted)]" />
            </button>
          </div>
        )}
      </button>
      {workspace.status === "failed" && workspace.failureMessage && isSelected && (
        <div className="text-[11px] text-red-400/80 px-7 pb-1 truncate">
          {workspace.failureMessage}
        </div>
      )}
    </div>
  );
}

export const MemoWorkspaceRow = memo(WorkspaceRow);

