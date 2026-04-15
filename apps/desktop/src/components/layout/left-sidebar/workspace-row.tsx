import { memo, useMemo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ExternalDriveIcon,
  GitBranchIcon,
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
  SplitIcon,
  Clock01Icon,
} from "@hugeicons/core-free-icons";
import { open } from "@tauri-apps/plugin-shell";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/preview-card";
import { useDesktopView, useRuntimeState } from "@/hooks/use-desktop-view";
import { useWorkspaceActions } from "@/hooks/use-workspace-actions";
import { cn, formatCompactNumber, formatRelativeTime } from "@/lib/shared/utils";
import type { WorkspaceRecord, WorkspaceRuntimeState } from "@/lib/shared/types";
import {
  useScmLineStatsQuery,
  useScmStatusQuery,
} from "@/components/layout/right-sidebar/scm/scm-queries";
import DotGridLoader from "@/components/dot-grid-loader";
import {
  isTerminalAgentAttentionStatus,
  workspaceTerminalAgentStatus,
} from "@/lib/terminal/agent-activity";

function selectAgentStatus(runtime: WorkspaceRuntimeState | null) {
  return workspaceTerminalAgentStatus(runtime);
}

function isRowActionTarget(target: EventTarget | null) {
  return target instanceof Element && target.closest("[data-workspace-row-action='true']") != null;
}

type WorkspaceRowProps = {
  workspace: WorkspaceRecord;
};

function WorkspaceRow({ workspace }: WorkspaceRowProps) {
  const selectedWorkspaceID = useDesktopView((view) => view.selectedWorkspaceID);
  const navigationArea = useDesktopView((view) => view.navigationArea);
  const workspaceCommands = useWorkspaceActions();
  const [renameValue, setRenameValue] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteErrorMessage, setDeleteErrorMessage] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"deleting" | null>(null);
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
  const isArchived = workspace.status === "archived";
  const isPending = pendingAction !== null;
  const addedCount = scmCounts?.added ?? 0;
  const removedCount = scmCounts?.removed ?? 0;
  const filesChanged = scmStatus?.length ?? 0;
  const hasAgentAttention = !isSelected && isTerminalAgentAttentionStatus(agentStatus);
  const showAgentLoader = agentStatus === "working";
  const highlightName = hasAgentAttention;
  const prState = workspace.prState as string | null;
  const hasChanges = addedCount > 0 || removedCount > 0;
  const isRenaming = renameValue !== null;

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

  const statusDotColor = useMemo(() => {
    if (workspace.status === "creating") return "bg-yellow-400";
    if (workspace.status === "archived") return "bg-[var(--theme-text-muted)]";
    if (workspace.status === "ready" && hasChanges) return "bg-green-400";
    return "bg-[var(--theme-text-muted)]";
  }, [workspace.status, hasChanges]);

  const prIcon = useMemo(() => {
    if (prState === "merged") return { icon: GitMergeIcon, className: "text-purple-400" };
    if (prState === "closed") return { icon: GitPullRequestClosedIcon, className: "text-red-400" };
    if (prState === "draft") {
      return { icon: GitPullRequestDraftIcon, className: "text-[var(--theme-text-muted)]" };
    }
    return { icon: GitPullRequestIcon, className: "text-green-400" };
  }, [prState]);

  const deleteDialogDescription = useMemo(() => {
    if (workspace.workspaceKind === "linked") {
      return "Are you sure? This will remove the workspace from Pandora. Your local files and branches will stay on disk.";
    }
    if (isArchived) {
      return "Are you sure? This will permanently remove this workspace from Pandora. This can't be undone.";
    }
    return "Are you sure? This will delete the workspace and remove its Pandora worktree from disk. This can't be undone.";
  }, [isArchived, workspace.workspaceKind]);

  const startRename = () => {
    if (isArchived) return;
    setRenameValue(workspace.name);
  };

  const cancelRename = () => {
    setRenameValue(null);
  };

  const submitRename = () => {
    if (renameValue == null) return;
    const next = renameValue.trim();
    setRenameValue(null);
    if (!next) return;
    workspaceCommands.renameWorkspace(workspace.id, next);
  };

  const requestDeleteWorkspace = () => {
    if (isPending) return;
    setDeleteDialogOpen(true);
  };

  const confirmDeleteWorkspace = async () => {
    if (isPending) return;
    setDeleteDialogOpen(false);
    setPendingAction("deleting");
    try {
      await workspaceCommands.removeWorkspace(workspace.id);
    } catch (error) {
      setPendingAction(null);
      setDeleteErrorMessage(String(error));
    }
  };

  return (
    <>
      <Dialog
        open={deleteErrorMessage != null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteErrorMessage(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Couldn&apos;t delete workspace</DialogTitle>
            <DialogDescription>{deleteErrorMessage}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteErrorMessage(null)}>
              OK
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          if (!isPending) {
            setDeleteDialogOpen(open);
          }
        }}
      >
        <DialogContent showCloseButton={!isPending}>
          <DialogHeader>
            <DialogTitle>Delete workspace</DialogTitle>
            <DialogDescription>{deleteDialogDescription}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={isPending}
              onClick={() => setDeleteDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              loading={isPending && pendingAction === "deleting"}
              onClick={() => void confirmDeleteWorkspace()}
            >
              Delete Workspace
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ContextMenu>
        <ContextMenuTrigger className="block group">
          <HoverCard>
            <HoverCardTrigger delay={300} render={<div />}>
              <div
                role={isArchived ? undefined : "button"}
                tabIndex={isArchived ? -1 : 0}
                onClick={(event) => {
                  if (isPending || isArchived) return;
                  if (isRowActionTarget(event.target)) return;
                  workspaceCommands.selectWorkspace(workspace.id);
                  workspaceCommands.setNavigationArea("sidebar");
                }}
                onDoubleClick={(event) => {
                  if (isPending || isArchived) return;
                  if (isRowActionTarget(event.target)) return;
                  workspaceCommands.selectWorkspace(workspace.id);
                  workspaceCommands.setNavigationArea("workspace");
                }}
                onKeyDown={(event) => {
                  if (isPending || isArchived) return;
                  if (isRowActionTarget(event.target)) return;
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  workspaceCommands.selectWorkspace(workspace.id);
                  workspaceCommands.setNavigationArea("sidebar");
                }}
                className={cn(
                  "flex h-10 w-full select-none items-center gap-2 rounded-md border border-transparent px-2.5 text-left transition-colors outline-none focus-visible:border-[var(--theme-border)]",
                  {
                    "cursor-pointer": !isArchived,
                    "cursor-default": isArchived,
                    "bg-[var(--theme-panel-hover)]": !isArchived && (isActive || isSelected),
                    "hover:bg-[var(--theme-panel-hover)]": !isArchived && !isActive && !isSelected,
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
                {isRenaming ? (
                  <form
                    className="ml-1 min-w-0 flex-1"
                    onClick={(event) => event.stopPropagation()}
                    onSubmit={(event) => {
                      event.preventDefault();
                      submitRename();
                    }}
                  >
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(event) => setRenameValue(event.currentTarget.value)}
                      onBlur={cancelRename}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          event.stopPropagation();
                          submitRename();
                        }
                        if (event.key === "Escape") {
                          event.preventDefault();
                          event.stopPropagation();
                          cancelRename();
                        }
                      }}
                      className="h-6 w-full rounded border border-[var(--theme-border)] bg-[var(--theme-bg)] px-1.5 text-sm text-[var(--theme-text)] outline-none"
                    />
                  </form>
                ) : (
                  <span
                    className={cn("min-w-0 ml-1 flex-1 truncate text-sm", {
                      "text-[var(--theme-text)]": highlightName,
                      "text-[var(--theme-text-subtle)]": !highlightName,
                    })}
                  >
                    {workspace.name}
                  </span>
                )}
                {workspace.status === "creating" || isPending ? (
                  <DotGridLoader
                    variant="default"
                    gridSize={3}
                    sizeClassName="h-4 w-4"
                    className="mr-1 shrink-0 opacity-80"
                  />
                ) : null}
                {!isFailed && workspace.status !== "creating" && !isPending && (
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
                      data-workspace-row-action="true"
                      variant="ghost"
                      size="icon-xs"
                      disabled={isPending}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        requestDeleteWorkspace();
                      }}
                      className="absolute inset-y-0 right-0 my-auto h-4 w-4 p-0 opacity-0 transition-opacity text-[var(--theme-text-muted)] hover:text-red-400 active:not-aria-[haspopup]:translate-y-0 group-hover:opacity-100"
                      title="Delete workspace"
                      aria-label="Delete workspace"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                )}
                {isFailed && !isPending && (
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
                <div className="flex items-center gap-2">
                  <HugeiconsIcon
                    icon={GitBranchIcon}
                    strokeWidth={2}
                    className="h-3.5 w-3.5 shrink-0 text-[var(--theme-text-subtle)]"
                  />
                  <span className="min-w-0 truncate rounded bg-[var(--theme-bg)] px-1.5 py-0.5 font-mono text-xs text-[var(--theme-text-subtle)]">
                    {workspace.gitBranchName}
                  </span>
                  <span className={cn("ml-auto h-2 w-2 shrink-0 rounded-full", statusDotColor)} />
                </div>

                <span className="truncate text-sm font-semibold text-[var(--theme-text)]">
                  {workspace.name}
                </span>

                {workspace.status === "ready" &&
                  (addedCount > 0 || removedCount > 0 || filesChanged > 0) && (
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

                <div className="flex items-center gap-1.5 text-xs text-[var(--theme-text-muted)]">
                  <HugeiconsIcon icon={Clock01Icon} strokeWidth={2} className="h-3 w-3 shrink-0" />
                  <span>
                    {workspace.updatedAt !== workspace.createdAt
                      ? `Updated ${formatRelativeTime(workspace.updatedAt)}`
                      : `Created ${formatRelativeTime(workspace.createdAt)}`}
                  </span>
                </div>
              </div>

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
            <div className="px-7 pb-1 truncate text-[11px] text-red-400/80">
              {workspace.failureMessage}
            </div>
          )}
        </ContextMenuTrigger>
        <ContextMenuContent side="right" align="start" className="min-w-40">
          <ContextMenuItem
            disabled={workspace.status === "creating" || isPending || isArchived}
            onClick={startRename}
          >
            Rename
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            variant="destructive"
            disabled={isPending}
            onClick={requestDeleteWorkspace}
          >
            Delete Workspace
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </>
  );
}

export const MemoWorkspaceRow = memo(WorkspaceRow);
