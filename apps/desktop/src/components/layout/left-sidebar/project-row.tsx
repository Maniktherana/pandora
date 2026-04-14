import { useMemo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon, ArrowRight01Icon, ExternalDriveIcon, Settings03Icon, SplitIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useDesktopView } from "@/hooks/use-desktop-view";
import { useWorkspaceActions } from "@/hooks/use-workspace-actions";
import { cn } from "@/lib/shared/utils";
import type { ProjectRecord } from "@/lib/shared/types";
import { MemoWorkspaceRow } from "./workspace-row";
import { NewWorkspaceSplitButton } from "./new-workspace-split-button";

type ProjectRowProps = {
  project: ProjectRecord;
  onOpenProjectSettings?: (projectId: string) => void;
};

export function ProjectRow({ project, onOpenProjectSettings }: ProjectRowProps) {
  const allWorkspaces = useDesktopView((view) => view.workspaces);
  const workspaceCommands = useWorkspaceActions();
  const [archivedExpanded, setArchivedExpanded] = useState(false);
  const projectWorkspaces = useMemo(
    () => allWorkspaces.filter((workspace) => workspace.projectId === project.id),
    [allWorkspaces, project.id],
  );
  const workspaces = useMemo(
    () =>
      projectWorkspaces.filter((workspace) => workspace.status !== "archived"),
    [projectWorkspaces],
  );
  const archivedWorkspaces = useMemo(
    () =>
      projectWorkspaces.filter((workspace) => workspace.status === "archived"),
    [projectWorkspaces],
  );
  const [lastWorkspaceKind, setLastWorkspaceKind] = useState<"worktree" | "linked">("linked");
  const createWorktree = () => {
    setLastWorkspaceKind("worktree");
    workspaceCommands.createWorkspace(project.id, "worktree");
  };
  const createLinked = () => {
    setLastWorkspaceKind("linked");
    workspaceCommands.createWorkspace(project.id, "linked");
  };

  return (
    <div className="mb-1">
      <div
        className={cn(
          "group flex h-10 select-none cursor-pointer items-center gap-1.5 rounded-md px-2 hover:bg-[var(--theme-panel-hover)]",
        )}
        onClick={() => {
          workspaceCommands.selectProject(project.id);
          workspaceCommands.toggleProject(project.id);
        }}
      >
        <div className="relative h-5 w-5 shrink-0">
          <div className="absolute inset-0 rounded bg-[var(--theme-panel-elevated)] flex items-center justify-center text-[10px] font-bold text-[var(--theme-text)] transition-opacity group-hover:opacity-0">
            {project.displayName.charAt(0).toUpperCase()}
          </div>
          <div className="absolute inset-0 flex items-center justify-center text-[var(--theme-text-subtle)] opacity-0 transition-opacity group-hover:opacity-100">
            {project.isExpanded ? (
              <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} className="size-4" />
            ) : (
              <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} className="size-4" />
            )}
          </div>
        </div>
        <span className="ml-1 text-sm font-medium text-[var(--theme-text-subtle)] truncate flex-1">
          {project.displayName}
        </span>
        <TooltipProvider>
          <div
            className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100"
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <Tooltip>
              <TooltipTrigger
                render={<Button type="button" variant="ghost" size="icon-sm" aria-label="Project Settings" />}
                onClick={() => onOpenProjectSettings?.(project.id)}
              >
                <HugeiconsIcon icon={Settings03Icon} strokeWidth={1.5} className="size-4" />
              </TooltipTrigger>
              <TooltipContent>Project Settings</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={<Button type="button" variant="ghost" size="icon-sm" aria-label="New Worktree" />}
                onClick={createWorktree}
              >
                <HugeiconsIcon icon={SplitIcon} strokeWidth={1.5} className="size-4" />
              </TooltipTrigger>
              <TooltipContent>New Worktree</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button type="button" variant="ghost" size="icon-sm" aria-label="New Local Workspace" />
                }
                onClick={createLinked}
              >
                <HugeiconsIcon icon={ExternalDriveIcon} strokeWidth={1.5} className="size-4" />
              </TooltipTrigger>
              <TooltipContent>New Local Workspace</TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      </div>

      {project.isExpanded && (
        <div className="mt-0.5 space-y-0.5">
          {workspaces.map((workspace) => (
            <MemoWorkspaceRow key={workspace.id} workspace={workspace} />
          ))}
          {workspaces.length === 0 && (
            <NewWorkspaceSplitButton
              fullWidth
              label="New Local Workspace"
              defaultKind={lastWorkspaceKind}
              onCreateWorktree={createWorktree}
              onCreateLinked={createLinked}
            />
          )}
          {archivedWorkspaces.length > 0 && (
            <div className="mt-1 space-y-0.5">
              <div
                className="flex h-7 select-none cursor-pointer items-center gap-1.5 rounded-md px-2.5 hover:bg-[var(--theme-panel-hover)]"
                onClick={() => setArchivedExpanded(!archivedExpanded)}
              >
                <HugeiconsIcon
                  icon={archivedExpanded ? ArrowDown01Icon : ArrowRight01Icon}
                  strokeWidth={2}
                  className="size-3 shrink-0 text-[var(--theme-text-subtle)]"
                />
                <span className="text-xs text-[var(--theme-text-subtle)]">
                  Archived ({archivedWorkspaces.length})
                </span>
              </div>
              {archivedExpanded && (
                <div className="space-y-0.5">
                  {archivedWorkspaces.map((workspace) => (
                    <MemoWorkspaceRow key={workspace.id} workspace={workspace} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

