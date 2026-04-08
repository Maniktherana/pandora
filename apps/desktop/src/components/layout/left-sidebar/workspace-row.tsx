import { memo, useMemo } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Archive03Icon,
  ExternalDriveIcon,
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
  SplitIcon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { useDesktopView } from "@/hooks/use-desktop-view";
import { useWorkspaceActions } from "@/hooks/use-workspace-actions";
import { cn, formatCompactNumber } from "@/lib/shared/utils";
import type { WorkspaceRecord } from "@/lib/shared/types";
import { useScmLineStatsQuery } from "@/components/layout/right-sidebar/scm/scm-queries";

type WorkspaceRowProps = {
  workspace: WorkspaceRecord;
};

function WorkspaceRow({ workspace }: WorkspaceRowProps) {
  const selectedWorkspaceID = useDesktopView((view) => view.selectedWorkspaceID);
  const navigationArea = useDesktopView((view) => view.navigationArea);
  const workspaceCommands = useWorkspaceActions();
  const { data: scmCounts } = useScmLineStatsQuery(workspace.worktreePath, {
    enabled: workspace.status === "ready",
  });

  const isSelected = workspace.id === selectedWorkspaceID;
  const isActive = navigationArea === "sidebar" && isSelected;
  const isFailed = workspace.status === "failed";
  const addedCount = scmCounts?.added ?? 0;
  const removedCount = scmCounts?.removed ?? 0;
  const prState = workspace.prState as string | null;
  const stateIcon = useMemo(() => {
    if (prState === "open") {
      return { icon: GitPullRequestIcon, className: "text-green-400" };
    }
    if (prState === "merged") {
      return { icon: GitMergeIcon, className: "text-purple-400" };
    }
    if (prState === "draft") {
      return { icon: GitPullRequestDraftIcon, className: "text-[var(--theme-text-subtle)]" };
    }
    if (prState === "closed") {
      return { icon: GitPullRequestClosedIcon, className: "text-red-400" };
    }
    if (workspace.workspaceKind === "linked") {
      return { icon: ExternalDriveIcon, className: "text-[var(--theme-text-subtle)]" };
    }
    return { icon: SplitIcon, className: "text-[var(--theme-text-subtle)]" };
  }, [prState, workspace.workspaceKind]);

  return (
    <div className="group">
      <div
        role="button"
        tabIndex={0}
        onClick={() => {
          workspaceCommands.selectWorkspace(workspace.id);
          workspaceCommands.setNavigationArea("sidebar");
        }}
        onDoubleClick={() => {
          workspaceCommands.selectWorkspace(workspace.id);
          workspaceCommands.setNavigationArea("workspace");
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          workspaceCommands.selectWorkspace(workspace.id);
          workspaceCommands.setNavigationArea("sidebar");
        }}
        className={cn(
          "flex h-10 w-full cursor-pointer select-none items-center gap-2 rounded-md border border-transparent px-2.5 text-left transition-colors outline-none focus-visible:border-[var(--theme-border)]",
          {
            "bg-[var(--theme-panel-hover)]": isActive || isSelected,
            "hover:bg-[var(--theme-panel-hover)]": !isActive && !isSelected,
          },
        )}
      >
        <HugeiconsIcon
          icon={stateIcon.icon}
          strokeWidth={2}
          className={cn("h-3.5 w-3.5 shrink-0", stateIcon.className)}
        />
        <span className="min-w-0 ml-1 flex-1 truncate text-sm text-[var(--theme-text-subtle)]">
          {workspace.name}
        </span>
        {!isFailed && (
          <div className="relative h-4 w-16 shrink-0">
            <span className="absolute inset-0 flex items-center justify-end gap-1 transition-opacity group-hover:opacity-0">
              {addedCount > 0 && (
                <span className="font-mono text-[11px] text-green-400/90">
                  +{formatCompactNumber(addedCount)}
                </span>
              )}
              {removedCount > 0 && (
                <span className="font-mono text-[11px] text-red-400/90">
                  -{formatCompactNumber(removedCount)}
                </span>
              )}
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={(event) => {
                event.stopPropagation();
                workspaceCommands.archiveWorkspace(workspace.id);
              }}
              className="absolute right-0 top-1/2 h-4 w-4 -translate-y-1/2 p-0 opacity-0 transition-opacity active:translate-y-0 group-hover:opacity-100"
              title="Archive workspace"
              aria-label="Archive workspace"
            >
              <HugeiconsIcon icon={Archive03Icon} strokeWidth={2} className="size-4" />
            </Button>
          </div>
        )}
        {isFailed && (
          <span className="font-mono text-[11px] text-red-400/80">failed</span>
        )}
      </div>
      {workspace.status === "failed" && workspace.failureMessage && isSelected && (
        <div className="px-7 pb-1 text-[11px] text-red-400/80 truncate">
          {workspace.failureMessage}
        </div>
      )}
    </div>
  );
}

export const MemoWorkspaceRow = memo(WorkspaceRow);
