import { memo, useMemo } from "react";
import {
  Search,
  Plus,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  FolderPlus,
  GitPullRequest,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useAppView, useWorkspaceCommands } from "@/hooks/use-app-view";
import type {
  ProjectRecord,
  WorkspaceKind,
  WorkspaceRecord,
  WorkspaceStatus,
} from "@/lib/shared/types";
import { cn } from "@/lib/shared/utils";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const WORKSPACE_KIND_LABEL: Record<WorkspaceKind, string> = {
  worktree: "Worktree",
  linked: "Local",
};

const WORKSPACE_KIND_TITLE: Record<WorkspaceKind, string> = {
  worktree:
    "Separate git worktree (own branch and folder under ~/.pandora/workspaces). Editor and workspace terminals use this path.",
  linked:
    "Linked to the project folder on disk — same checkout as the repo root. No extra worktree.",
};

function StatusDot({ status }: { status: WorkspaceStatus }) {
  const colors: Record<WorkspaceStatus, string> = {
    ready: "bg-[var(--oc-success)]",
    creating: "bg-[var(--oc-warning)] animate-pulse",
    failed: "bg-[var(--oc-error)]",
    deleting: "bg-[var(--oc-text-faint)]",
    archived: "bg-[var(--oc-text-faint)]",
  };
  return <div className={cn("w-2 h-2 rounded-full shrink-0", colors[status])} />;
}

function WorkspaceRow({ workspace }: { workspace: WorkspaceRecord }) {
  const selectedWorkspaceID = useAppView((view) => view.selectedWorkspaceID);
  const navigationArea = useAppView((view) => view.navigationArea);
  const workspaceCommands = useWorkspaceCommands();

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
            ? "bg-[var(--oc-panel-interactive)] border border-[var(--oc-interactive)]/35"
            : isSelected
            ? "bg-[var(--oc-panel-hover)] border border-[var(--oc-border)]"
            : "hover:bg-[var(--oc-panel-hover)] border border-transparent"
        )}
      >
        <StatusDot status={workspace.status} />
        <span className="text-[13px] text-[var(--oc-text)] truncate min-w-0 flex-1">{workspace.name}</span>
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
              onClick={(e) => {
                e.stopPropagation();
                workspaceCommands.retryWorkspace(workspace.id);
              }}
              className="p-0.5 rounded hover:bg-[var(--oc-panel-hover)]"
              title="Retry"
            >
              <RotateCcw className="w-3 h-3 text-[var(--oc-text-muted)]" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                workspaceCommands.removeWorkspace(workspace.id);
              }}
              className="p-0.5 rounded hover:bg-[var(--oc-panel-hover)]"
              title="Remove"
            >
              <Trash2 className="w-3 h-3 text-[var(--oc-text-muted)]" />
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

const MemoWorkspaceRow = memo(WorkspaceRow);

function ProjectRow({ project }: { project: ProjectRecord }) {
  const selectedProjectID = useAppView((view) => view.selectedProjectID);
  const allWorkspaces = useAppView((view) => view.workspaces);
  const workspaceCommands = useWorkspaceCommands();
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
      {/* Project header */}
      <div
        className={cn(
          "group flex select-none cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5",
          isSelected ? "bg-[var(--oc-panel-hover)]" : "hover:bg-[var(--oc-panel-hover)]"
        )}
        onClick={() => {
          workspaceCommands.selectProject(project.id);
          workspaceCommands.toggleProject(project.id);
        }}
      >
        {project.isExpanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-[var(--oc-text-subtle)] shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-[var(--oc-text-subtle)] shrink-0" />
        )}
        <div
          className="w-5 h-5 rounded bg-[var(--oc-panel-elevated)] flex items-center justify-center text-[10px] font-bold text-[var(--oc-text)] shrink-0"
        >
          {project.displayName.charAt(0).toUpperCase()}
        </div>
        <span className="text-sm font-medium text-[var(--oc-text)] truncate flex-1">
          {project.displayName}
        </span>
        <div
          className="shrink-0"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
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
                    New branch, ~/.pandora/workspaces/…
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

      {/* Workspace children */}
      {project.isExpanded && (
        <div className="mt-0.5 space-y-0.5">
          {workspaces.map((ws) => (
            <MemoWorkspaceRow key={ws.id} workspace={ws} />
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

interface SidebarProps {
  onCollapse: () => void;
}

export default function Sidebar({ onCollapse }: SidebarProps) {
  const projects = useAppView((view) => view.projects);
  const searchText = useAppView((view) => view.searchText);
  const workspaceCommands = useWorkspaceCommands();
  const filteredProjects = useMemo(
    () =>
      projects.filter((project) =>
        searchText
          ? project.displayName.toLowerCase().includes(searchText.toLowerCase())
          : true
      ),
    [projects, searchText]
  );

  const handleAddProject = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Add Project — Choose a folder inside a Git repository",
    });
    if (selected) {
      workspaceCommands.addProject(selected);
    }
  };

  return (
    <div className="flex h-full flex-col bg-transparent">
      {/* Header — pt-11 clears macOS traffic lights in overlay titlebar */}
      <div className="flex items-center gap-2 px-3 pt-11 pb-2" data-tauri-drag-region>
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--oc-text-subtle)]" />
          <input
            type="text"
            placeholder="Search..."
            value={searchText}
            onChange={(e) => workspaceCommands.setSearchText(e.target.value)}
            className="w-full rounded-md border border-[var(--oc-border)] bg-transparent pl-7 pr-2 py-1 text-xs text-[var(--oc-text)] placeholder:text-[var(--oc-text-subtle)] focus:border-[var(--oc-interactive)] focus:outline-none"
          />
        </div>
        <button
          onClick={() => void handleAddProject()}
          className="p-1.5 rounded-md text-[var(--oc-text-muted)] transition-colors hover:bg-[var(--oc-panel-hover)] hover:text-[var(--oc-text)]"
          title="Add Project"
        >
          <FolderPlus className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onCollapse}
          className="p-1.5 rounded-md text-[var(--oc-text-muted)] transition-colors hover:bg-[var(--oc-panel-hover)] hover:text-[var(--oc-text)]"
          title="Hide Sidebar"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Project/workspace list */}
      <div className="flex-1 overflow-y-auto px-1.5 py-1">
        {filteredProjects.map((project) => (
          <ProjectRow key={project.id} project={project} />
        ))}

        {filteredProjects.length === 0 && (
          <div className="mt-8 px-4 text-center text-xs text-[var(--oc-text-faint)]">
            {searchText ? (
              "No matching projects"
            ) : (
              <div className="space-y-2">
                <p>No projects yet</p>
                <button
                  onClick={() => void handleAddProject()}
                  className="text-[var(--oc-interactive)] transition-colors hover:opacity-80"
                >
                  Add a project
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
