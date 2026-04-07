import { useMemo } from "react";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useDesktopView } from "@/hooks/use-desktop-view";
import { useWorkspaceActions } from "@/hooks/use-workspace-actions";
import { cn } from "@/lib/shared/utils";
import type { ProjectRecord } from "@/lib/shared/types";
import { MemoWorkspaceRow } from "./workspace-row";

type ProjectRowProps = {
  project: ProjectRecord;
};

export function ProjectRow({ project }: ProjectRowProps) {
  const selectedProjectID = useDesktopView((view) => view.selectedProjectID);
  const allWorkspaces = useDesktopView((view) => view.workspaces);
  const workspaceCommands = useWorkspaceActions();
  const workspaces = useMemo(
    () =>
      allWorkspaces.filter(
        (workspace) => workspace.projectId === project.id && workspace.status !== "archived"
      ),
    [allWorkspaces, project.id]
  );

  const isSelected = project.id === selectedProjectID;

  return (
    <div className="mb-1">
      <div
        className={cn(
          "group flex select-none cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5",
          isSelected ? "bg-[var(--theme-panel-hover)]" : "hover:bg-[var(--theme-panel-hover)]"
        )}
        onClick={() => {
          workspaceCommands.selectProject(project.id);
          workspaceCommands.toggleProject(project.id);
        }}
      >
        {project.isExpanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-[var(--theme-text-subtle)] shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-[var(--theme-text-subtle)] shrink-0" />
        )}
        <div className="w-5 h-5 rounded bg-[var(--theme-panel-elevated)] flex items-center justify-center text-[10px] font-bold text-[var(--theme-text)] shrink-0">
          {project.displayName.charAt(0).toUpperCase()}
        </div>
        <span className="text-sm font-medium text-[var(--theme-text)] truncate flex-1">
          {project.displayName}
        </span>
        <div
          className="shrink-0"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon-xs" className="text-muted-foreground" />}
              title="Add workspace — worktree or local"
              aria-label="Add workspace"
            >
              <Plus />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              <DropdownMenuGroup>
                <DropdownMenuItem
                  className="flex flex-col items-start gap-0.5 py-2"
                  onClick={() => workspaceCommands.createWorkspace(project.id, "worktree")}
                >
                  <span className="font-medium text-foreground">Worktree</span>
                  <span className="text-[10px] font-normal text-muted-foreground">
                    New branch, ~/.pandora/workspaces/...
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="flex flex-col items-start gap-0.5 py-2"
                  onClick={() => workspaceCommands.createWorkspace(project.id, "linked")}
                >
                  <span className="font-medium text-foreground">Local workspace</span>
                  <span className="text-[10px] font-normal text-muted-foreground">
                    Same folder as project (no extra worktree)
                  </span>
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {project.isExpanded && (
        <div className="mt-0.5 space-y-0.5">
          {workspaces.map((workspace) => (
            <MemoWorkspaceRow key={workspace.id} workspace={workspace} />
          ))}
          {workspaces.length === 0 && (
            <div className="flex flex-col gap-1.5 px-2.5 py-1.5">
              <p className="text-[11px] text-muted-foreground">No workspaces yet</p>
              <div className="flex flex-col items-start gap-1">
                <Button
                  variant="link"
                  className="h-auto p-0 text-left text-[11px] font-normal"
                  onClick={() => workspaceCommands.createWorkspace(project.id, "worktree")}
                >
                  + Worktree workspace
                </Button>
                <Button
                  variant="link"
                  className="h-auto p-0 text-left text-[11px] font-normal"
                  onClick={() => workspaceCommands.createWorkspace(project.id, "linked")}
                >
                  + Local workspace
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

