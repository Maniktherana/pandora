import {
  Search,
  Plus,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  FolderPlus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useWorkspaceStore } from "@/stores/workspace-store";
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
    ready: "bg-green-500",
    creating: "bg-yellow-500 animate-pulse",
    failed: "bg-red-500",
    deleting: "bg-neutral-500",
  };
  return <div className={cn("w-2 h-2 rounded-full shrink-0", colors[status])} />;
}

function WorkspaceRow({ workspace }: { workspace: WorkspaceRecord }) {
  const {
    selectedWorkspaceID,
    selectWorkspace,
    retryWorkspace,
    removeWorkspace,
    setNavigationArea,
    navigationArea,
  } = useWorkspaceStore();

  const isSelected = workspace.id === selectedWorkspaceID;
  const isActive = navigationArea === "sidebar" && isSelected;

  return (
    <div className="group">
      <button
        onClick={() => {
          selectWorkspace(workspace);
          setNavigationArea("sidebar");
        }}
        onDoubleClick={() => {
          selectWorkspace(workspace);
          setNavigationArea("workspace");
        }}
        className={cn(
          "w-full text-left px-2.5 py-1.5 rounded-md transition-colors flex items-center gap-2",
          isActive
            ? "bg-blue-500/25 border border-blue-400/35"
            : isSelected
            ? "bg-white/[0.08] border border-white/[0.06]"
            : "hover:bg-white/[0.06] border border-transparent"
        )}
      >
        <StatusDot status={workspace.status} />
        <span className="text-[13px] text-neutral-300 truncate min-w-0 flex-1">{workspace.name}</span>
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
        {workspace.status === "failed" && (
          <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={(e) => {
                e.stopPropagation();
                void retryWorkspace(workspace.id);
              }}
              className="p-0.5 rounded hover:bg-white/10"
              title="Retry"
            >
              <RotateCcw className="w-3 h-3 text-neutral-400" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                void removeWorkspace(workspace.id);
              }}
              className="p-0.5 rounded hover:bg-white/10"
              title="Remove"
            >
              <Trash2 className="w-3 h-3 text-neutral-400" />
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

function ProjectRow({ project }: { project: ProjectRecord }) {
  const {
    workspacesForProject,
    toggleProject,
    createWorkspace,
    selectedProjectID,
    selectProject,
  } = useWorkspaceStore();

  const workspaces = workspacesForProject(project.id);
  const isSelected = project.id === selectedProjectID;

  return (
    <div className="mb-1">
      {/* Project header */}
      <div
        className={cn(
          "flex items-center gap-1.5 px-2 py-1.5 rounded-md cursor-pointer group",
          isSelected ? "bg-white/[0.07]" : "hover:bg-white/[0.05]"
        )}
        onClick={() => {
          selectProject(project.id);
          void toggleProject(project.id);
        }}
      >
        {project.isExpanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
        )}
        <div
          className="w-5 h-5 rounded bg-white/10 flex items-center justify-center text-[10px] font-bold text-neutral-200 shrink-0"
        >
          {project.displayName.charAt(0).toUpperCase()}
        </div>
        <span className="text-sm font-medium text-neutral-200 truncate flex-1">
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
                  onClick={() => void createWorkspace(project.id, "worktree")}
                >
                  <span className="font-medium text-foreground">Worktree</span>
                  <span className="text-[10px] font-normal text-muted-foreground">
                    New branch, ~/.pandora/workspaces/…
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="flex flex-col items-start gap-0.5 py-2"
                  onClick={() => void createWorkspace(project.id, "linked")}
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
            <WorkspaceRow key={ws.id} workspace={ws} />
          ))}
          {workspaces.length === 0 && (
            <div className="flex flex-col gap-1.5 px-2.5 py-1.5">
              <p className="text-[11px] text-muted-foreground">No workspaces yet</p>
              <div className="flex flex-col items-start gap-1">
                <Button
                  variant="link"
                  className="h-auto p-0 text-left text-[11px] font-normal"
                  onClick={() => void createWorkspace(project.id, "worktree")}
                >
                  + Worktree workspace
                </Button>
                <Button
                  variant="link"
                  className="h-auto p-0 text-left text-[11px] font-normal"
                  onClick={() => void createWorkspace(project.id, "linked")}
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
  const {
    filteredProjects,
    searchText,
    setSearchText,
    addProject,
  } = useWorkspaceStore();

  const projects = filteredProjects();

  const handleAddProject = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Add Project — Choose a folder inside a Git repository",
    });
    if (selected) {
      await addProject(selected);
    }
  };

  return (
    <div className="flex flex-col h-full bg-transparent border-r border-white/[0.08]">
      {/* Header — pt-11 clears macOS traffic lights in overlay titlebar */}
      <div className="flex items-center gap-2 px-3 pt-11 pb-2" data-tauri-drag-region>
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-500" />
          <input
            type="text"
            placeholder="Search..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="w-full bg-transparent border border-white/10 rounded-md pl-7 pr-2 py-1 text-xs text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-white/20"
          />
        </div>
        <button
          onClick={() => void handleAddProject()}
          className="p-1.5 rounded-md hover:bg-white/10 text-neutral-400 hover:text-neutral-200 transition-colors"
          title="Add Project"
        >
          <FolderPlus className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onCollapse}
          className="p-1.5 rounded-md hover:bg-white/10 text-neutral-400 hover:text-neutral-200 transition-colors"
          title="Hide Sidebar"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Project/workspace list */}
      <div className="flex-1 overflow-y-auto px-1.5 py-1">
        {projects.map((project) => (
          <ProjectRow key={project.id} project={project} />
        ))}

        {projects.length === 0 && (
          <div className="text-center text-neutral-600 text-xs mt-8 px-4">
            {searchText ? (
              "No matching projects"
            ) : (
              <div className="space-y-2">
                <p>No projects yet</p>
                <button
                  onClick={() => void handleAddProject()}
                  className="text-blue-400 hover:text-blue-300 transition-colors"
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
