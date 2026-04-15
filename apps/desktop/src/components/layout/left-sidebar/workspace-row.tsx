import { memo, useMemo, useState } from "react";
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
import { invoke } from "@tauri-apps/api/core";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/preview-card";
import { useDesktopView, useRuntimeState } from "@/hooks/use-desktop-view";
import { useWorkspaceActions } from "@/hooks/use-workspace-actions";
import { cn, formatCompactNumber, formatRelativeTime } from "@/lib/shared/utils";
import type { WorkspaceRecord } from "@/lib/shared/types";
import { useSettingsStore } from "@/state/settings-store";
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

function isRowActionTarget(target: EventTarget | null) {
  return target instanceof Element && target.closest("[data-workspace-row-action='true']") != null;
}

type WorkspaceRowProps = {
  workspace: WorkspaceRecord;
};

type CanArchiveResult = {
  canArchive: boolean;
  message: string | null;
  hasUncommittedChanges: boolean;
  hasUntrackedFiles: boolean;
  hasUnpushedCommits: boolean;
  hasRemoteBranch: boolean;
};

function WorkspaceRow({ workspace }: WorkspaceRowProps) {
  const selectedWorkspaceID = useDesktopView((view) => view.selectedWorkspaceID);
  const navigationArea = useDesktopView((view) => view.navigationArea);
  const workspaceCommands = useWorkspaceActions();
  const archivePushBehavior = useSettingsStore((s) => s.archivePushBehavior);
  const setArchivePushBehavior = useSettingsStore((s) => s.setArchivePushBehavior);
  const [renameValue, setRenameValue] = useState<string | null>(null);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [rememberArchiveChoice, setRememberArchiveChoice] = useState(false);
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
  const isRenaming = renameValue !== null;
  const isArchived = workspace.status === "archived";

  const startRename = () => {
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

  const restoreWorkspace = () => {
    workspaceCommands.restoreWorkspace(workspace.id);
  };

  const pushAndArchiveWorkspace = async (rememberChoice: boolean) => {
    setArchiveBusy(true);
    try {
      await invoke<string>("scm_push", { worktreePath: workspace.worktreePath });
      if (rememberChoice) {
        setArchivePushBehavior("always");
      }
      setArchiveDialogOpen(false);
      setRememberArchiveChoice(false);
      workspaceCommands.archiveWorkspace(workspace.id);
    } catch (error) {
      window.alert(String(error));
    } finally {
      setArchiveBusy(false);
    }
  };

  const archiveWorkspace = async () => {
    if (archiveBusy) return;
    try {
      const result = await invoke<CanArchiveResult>("can_archive_workspace", {
        workspaceId: workspace.id,
      });
      if (!result.canArchive) {
        const canFixByPushing =
          typeof result.message === "string" && result.message.toLowerCase().startsWith("push");
        if (canFixByPushing) {
          if (archivePushBehavior === "always") {
            await pushAndArchiveWorkspace(false);
            return;
          }
          setArchiveDialogOpen(true);
          return;
        }
        window.alert(result.message ?? "Workspace is not safe to archive.");
        return;
      }
      workspaceCommands.archiveWorkspace(workspace.id);
    } catch (error) {
      window.alert(String(error));
    }
  };

  const removeWorkspace = () => {
    if (!window.confirm("This action is unrecoverable and all changes will be lost.")) {
      return;
    }
    workspaceCommands.removeWorkspace(workspace.id);
  };

  const statusDotColor = useMemo(() => {
    if (workspace.status === "creating") return "bg-yellow-400";
    if (workspace.status === "archived") return "bg-[var(--theme-text-muted)]";
    if (workspace.status === "ready" && hasChanges) return "bg-green-400";
    return "bg-[var(--theme-text-muted)]";
  }, [workspace.status, hasChanges]);

  const prIcon = useMemo(() => {
    if (prState === "merged") return { icon: GitMergeIcon, className: "text-purple-400" };
    if (prState === "closed") return { icon: GitPullRequestClosedIcon, className: "text-red-400" };
    if (prState === "draft")
      return { icon: GitPullRequestDraftIcon, className: "text-[var(--theme-text-muted)]" };
    return { icon: GitPullRequestIcon, className: "text-green-400" };
  }, [prState]);

  return (
    <>
      <Dialog
        open={archiveDialogOpen}
        onOpenChange={(open) => {
          if (!archiveBusy) {
            setArchiveDialogOpen(open);
            if (!open) {
              setRememberArchiveChoice(false);
            }
          }
        }}
      >
        <DialogContent showCloseButton={!archiveBusy}>
          <DialogHeader>
            <DialogTitle>Push before archiving</DialogTitle>
            <DialogDescription>
              Archive removes this worktree checkout. Push the branch first so it can be restored
              later.
            </DialogDescription>
          </DialogHeader>
          <div className="px-6 pb-2">
            <label className="flex items-center gap-3 text-sm text-[var(--theme-text)]">
              <Checkbox
                checked={rememberArchiveChoice}
                disabled={archiveBusy}
                onCheckedChange={(checked) => setRememberArchiveChoice(checked === true)}
              />
              <span>Remember my choice</span>
            </label>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={archiveBusy}
              onClick={() => {
                setArchiveDialogOpen(false);
                setRememberArchiveChoice(false);
              }}
            >
              Cancel
            </Button>
            <Button
              loading={archiveBusy}
              onClick={() => void pushAndArchiveWorkspace(rememberArchiveChoice)}
            >
              Push and Archive
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ContextMenu>
        <ContextMenuTrigger className="block group">
          <HoverCard>
            <HoverCardTrigger delay={300} render={<div />}>
              <div
                role="button"
                tabIndex={0}
                onClick={(event) => {
                  if (isRowActionTarget(event.target)) return;
                  if (isArchived) {
                    restoreWorkspace();
                    return;
                  }
                  workspaceCommands.selectWorkspace(workspace.id);
                  workspaceCommands.setNavigationArea("sidebar");
                }}
                onDoubleClick={(event) => {
                  if (isRowActionTarget(event.target)) return;
                  if (isArchived) {
                    restoreWorkspace();
                    return;
                  }
                  workspaceCommands.selectWorkspace(workspace.id);
                  workspaceCommands.setNavigationArea("workspace");
                }}
                onKeyDown={(event) => {
                  if (isRowActionTarget(event.target)) return;
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  if (isArchived) {
                    restoreWorkspace();
                    return;
                  }
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
                    {isArchived ? (
                      <span className="absolute inset-y-0 right-0 my-auto flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <Button
                          data-workspace-row-action="true"
                          variant="ghost"
                          size="icon-xs"
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation();
                            restoreWorkspace();
                          }}
                          className="h-4 w-4 p-0 active:not-aria-[haspopup]:translate-y-0"
                          title="Restore workspace"
                          aria-label="Restore workspace"
                        >
                          <HugeiconsIcon icon={Refresh01Icon} strokeWidth={2} className="size-4" />
                        </Button>
                        <Button
                          data-workspace-row-action="true"
                          variant="ghost"
                          size="icon-xs"
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation();
                            removeWorkspace();
                          }}
                          className="h-4 w-4 p-0 text-[var(--theme-text-muted)] hover:text-red-400 active:not-aria-[haspopup]:translate-y-0"
                          title="Delete workspace record"
                          aria-label="Delete workspace record"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </span>
                    ) : (
                      <Button
                        data-workspace-row-action="true"
                        variant="ghost"
                        size="icon-xs"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          void archiveWorkspace();
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
                {isFailed && <span className="font-mono text-[11px] text-red-400/80">failed</span>}
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
                  <span className={cn("ml-auto h-2 w-2 shrink-0 rounded-full", statusDotColor)} />
                </div>

                {/* Workspace name */}
                <span className="truncate text-sm font-semibold text-[var(--theme-text)]">
                  {workspace.name}
                </span>

                {/* Stats line */}
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

                {/* Time */}
                <div className="flex items-center gap-1.5 text-xs text-[var(--theme-text-muted)]">
                  <HugeiconsIcon icon={Clock01Icon} strokeWidth={2} className="h-3 w-3 shrink-0" />
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
        </ContextMenuTrigger>
        <ContextMenuContent side="right" align="start" className="min-w-40">
          <ContextMenuItem disabled={workspace.status === "creating"} onClick={startRename}>
            Rename
          </ContextMenuItem>
          <ContextMenuSeparator />
          {isArchived ? (
            <ContextMenuItem onClick={restoreWorkspace}>Restore</ContextMenuItem>
          ) : (
            <ContextMenuItem onClick={() => void archiveWorkspace()}>Archive</ContextMenuItem>
          )}
          {isArchived ? (
            <ContextMenuItem variant="destructive" onClick={removeWorkspace}>
              Delete Workspace
            </ContextMenuItem>
          ) : null}
        </ContextMenuContent>
      </ContextMenu>
    </>
  );
}

export const MemoWorkspaceRow = memo(WorkspaceRow);
