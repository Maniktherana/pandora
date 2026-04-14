import { memo, useMemo } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Archive03Icon,
  ExternalDriveIcon,
  GitBranchIcon,
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
  Refresh01Icon,
  SplitIcon,
  Clock01Icon,
} from "@hugeicons/core-free-icons";
import { open } from "@tauri-apps/plugin-shell";
import { Button } from "@/components/ui/button";
import {
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
} from "@/components/ui/preview-card";
import { useDesktopView, useRuntimeState } from "@/hooks/use-desktop-view";
import { useWorkspaceActions } from "@/hooks/use-workspace-actions";
import { cn, formatCompactNumber, formatRelativeTime } from "@/lib/shared/utils";
import type { WorkspaceRecord } from "@/lib/shared/types";
import {
  useScmLineStatsQuery,
  useScmStatusQuery,
} from "@/components/layout/right-sidebar/scm/scm-queries";
import DotGridLoader from "@/components/dot-grid-loader";
import {
  isTerminalAgentAttentionStatus,
  workspaceTerminalAgentStatus,
} from "@/lib/terminal/agent-activity";
import type { WorkspaceRuntimeState } from "@/lib/shared/types";

function selectAgentStatus(runtime: WorkspaceRuntimeState | null) {
  return workspaceTerminalAgentStatus(runtime);
}

type WorkspaceRowProps = {
  workspace: WorkspaceRecord;
};

function WorkspaceRow({ workspace }: WorkspaceRowProps) {
  const selectedWorkspaceID = useDesktopView((view) => view.selectedWorkspaceID);
  const navigationArea = useDesktopView((view) => view.navigationArea);
  const workspaceCommands = useWorkspaceActions();
  const agentStatus = useRuntimeState(workspace.id, selectAgentStatus);
  const { data: scmCounts } = useScmLineStatsQuery(workspace.worktreePath, {
    enabled: workspace.status === "ready",
  });
  const { data: scmStatus } = useScmStatusQuery(workspace.worktreePath, {
    enabled: workspace.status === "ready",
  });

  const isSelected = workspace.id === selectedWorkspaceID;
  const isActive = navigationArea === "sidebar" && isSelected;
  const isFailed = workspace.status === "failed";
  const addedCount = scmCounts?.added ?? 0;
  const removedCount = scmCounts?.removed ?? 0;
  const filesChanged = scmStatus?.length ?? 0;
  const hasAgentAttention = !isSelected && isTerminalAgentAttentionStatus(agentStatus);
  const showAgentLoader = agentStatus === "working";
  const highlightName = hasAgentAttention;
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

  const hasChanges = addedCount > 0 || removedCount > 0;

  const statusDotColor = useMemo(() => {
    if (workspace.status === "creating") return "bg-yellow-400";
    if (workspace.status === "archived") return "bg-[var(--theme-text-muted)]";
    if (workspace.status === "ready" && hasChanges) return "bg-green-400";
    return "bg-[var(--theme-text-muted)]";
  }, [workspace.status, hasChanges]);

  const prIcon = useMemo(() => {
    if (prState === "merged") return { icon: GitMergeIcon, className: "text-purple-400" };
    if (prState === "closed") return { icon: GitPullRequestClosedIcon, className: "text-red-400" };
    if (prState === "draft") return { icon: GitPullRequestDraftIcon, className: "text-[var(--theme-text-muted)]" };
    return { icon: GitPullRequestIcon, className: "text-green-400" };
  }, [prState]);

  return (
    <div className="group">
      <HoverCard>
        <HoverCardTrigger
          delay={300}
          render={<div />}
        >
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
            {showAgentLoader ? (
              <DotGridLoader
                variant="default"
                gridSize={3}
                sizeClassName="h-4 w-4"
                className="shrink-0 opacity-85"
              />
            ) : (
              <HugeiconsIcon
                icon={stateIcon.icon}
                strokeWidth={2}
                className={cn("h-3.5 w-3.5 shrink-0", stateIcon.className)}
              />
            )}
            <span
              className={cn("min-w-0 ml-1 flex-1 truncate text-sm", {
                "text-[var(--theme-text)]": highlightName,
                "text-[var(--theme-text-subtle)]": !highlightName,
              })}
            >
              {workspace.name}
            </span>
            {workspace.status === "creating" ? (
              <DotGridLoader
                variant="default"
                gridSize={3}
                sizeClassName="h-4 w-4"
                className="mr-1 shrink-0 opacity-80"
              />
            ) : null}
            {!isFailed && workspace.status !== "creating" && (
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
                {workspace.status === "archived" ? (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={(event) => {
                      event.stopPropagation();
                      workspaceCommands.restoreWorkspace(workspace.id);
                    }}
                    className="absolute inset-y-0 right-0 my-auto h-4 w-4 p-0 opacity-0 transition-opacity active:not-aria-[haspopup]:translate-y-0 group-hover:opacity-100"
                    title="Restore workspace"
                    aria-label="Restore workspace"
                  >
                    <HugeiconsIcon icon={Refresh01Icon} strokeWidth={2} className="size-4" />
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={(event) => {
                      event.stopPropagation();
                      workspaceCommands.archiveWorkspace(workspace.id);
                    }}
                    className="absolute inset-y-0 right-0 my-auto h-4 w-4 p-0 opacity-0 transition-opacity active:not-aria-[haspopup]:translate-y-0 group-hover:opacity-100"
                    title="Archive workspace"
                    aria-label="Archive workspace"
                  >
                    <HugeiconsIcon icon={Archive03Icon} strokeWidth={2} className="size-4" />
                  </Button>
                )}
              </div>
            )}
            {isFailed && (
              <span className="font-mono text-[11px] text-red-400/80">failed</span>
            )}
          </div>
        </HoverCardTrigger>

        <HoverCardContent
          side="right"
          sideOffset={8}
          className="w-72 bg-[var(--theme-panel-elevated)] p-0"
        >
          <div className="flex flex-col gap-2 p-3">
            {/* Header: branch badge with status dot */}
            <div className="flex items-center gap-2">
              <HugeiconsIcon
                icon={GitBranchIcon}
                strokeWidth={2}
                className="h-3.5 w-3.5 shrink-0 text-[var(--theme-text-subtle)]"
              />
              <span className="min-w-0 truncate rounded bg-[var(--theme-bg)] px-1.5 py-0.5 font-mono text-xs text-[var(--theme-text-subtle)]">
                {workspace.gitBranchName}
              </span>
              <span
                className={cn("ml-auto h-2 w-2 shrink-0 rounded-full", statusDotColor)}
              />
            </div>

            {/* Workspace name */}
            <span className="truncate text-sm font-semibold text-[var(--theme-text)]">
              {workspace.name}
            </span>

            {/* Stats line */}
            {workspace.status === "ready" && (addedCount > 0 || removedCount > 0 || filesChanged > 0) && (
              <div className="flex items-center gap-1.5 font-mono text-xs text-[var(--theme-text-subtle)]">
                {addedCount > 0 && (
                  <span className="text-green-400">+{formatCompactNumber(addedCount)}</span>
                )}
                {removedCount > 0 && (
                  <span className="text-red-400">-{formatCompactNumber(removedCount)}</span>
                )}
                {filesChanged > 0 && (
                  <>
                    <span className="text-[var(--theme-text-muted)]">&middot;</span>
                    <span>
                      {filesChanged} {filesChanged === 1 ? "file" : "files"} changed
                    </span>
                  </>
                )}
              </div>
            )}

            {/* Time */}
            <div className="flex items-center gap-1.5 text-xs text-[var(--theme-text-muted)]">
              <HugeiconsIcon
                icon={Clock01Icon}
                strokeWidth={2}
                className="h-3 w-3 shrink-0"
              />
              <span>
                {workspace.updatedAt !== workspace.createdAt
                  ? `Updated ${formatRelativeTime(workspace.updatedAt)}`
                  : `Created ${formatRelativeTime(workspace.createdAt)}`}
              </span>
            </div>
          </div>

          {/* PR footer */}
          {workspace.prUrl && workspace.prNumber != null && (
            <div className="border-t border-[var(--theme-border)] px-3 py-2">
              <button
                type="button"
                onClick={() => {
                  if (workspace.prUrl) {
                    void open(workspace.prUrl).catch(() =>
                      window.open(workspace.prUrl!, "_blank"),
                    );
                  }
                }}
                className={cn(
                  "flex w-full items-center gap-1.5 truncate text-left text-xs transition-opacity hover:opacity-80",
                  prIcon.className,
                )}
              >
                <HugeiconsIcon
                  icon={prIcon.icon}
                  strokeWidth={2}
                  className="h-3.5 w-3.5 shrink-0"
                />
                <span className="min-w-0 truncate">
                  #{workspace.prNumber} &middot; {workspace.name}
                </span>
              </button>
            </div>
          )}
        </HoverCardContent>
      </HoverCard>

      {workspace.status === "failed" && workspace.failureMessage && isSelected && (
        <div className="px-7 pb-1 text-[11px] text-red-400/80 truncate">
          {workspace.failureMessage}
        </div>
      )}
    </div>
  );
}

export const MemoWorkspaceRow = memo(WorkspaceRow);
