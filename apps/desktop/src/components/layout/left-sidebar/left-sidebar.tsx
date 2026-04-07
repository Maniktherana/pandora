import { useMemo } from "react";
import { Search, ChevronLeft, FolderPlus } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useDesktopView } from "@/hooks/use-desktop-view";
import { useWorkspaceActions } from "@/hooks/use-workspace-actions";
import { ProjectRow } from "./project-row";

type LeftSidebarProps = {
  onCollapse: () => void;
};

export default function LeftSidebar({ onCollapse }: LeftSidebarProps) {
  const projects = useDesktopView((view) => view.projects);
  const searchText = useDesktopView((view) => view.searchText);
  const workspaceCommands = useWorkspaceActions();
  const filteredProjects = useMemo(
    () =>
      projects.filter((project) =>
        searchText ? project.displayName.toLowerCase().includes(searchText.toLowerCase()) : true,
      ),
    [projects, searchText],
  );

  const handleAddProject = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Add Project - Choose a folder inside a Git repository",
    });
    if (selected) {
      workspaceCommands.addProject(selected);
    }
  };

  return (
    <div className="flex h-full flex-col bg-transparent">
      <div className="flex items-center gap-2 px-3 pt-11 pb-2" data-tauri-drag-region>
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--theme-text-subtle)]" />
          <input
            type="text"
            placeholder="Search..."
            value={searchText}
            onChange={(event) => workspaceCommands.setSearchText(event.target.value)}
            className="w-full rounded-md border border-[var(--theme-border)] bg-transparent pl-7 pr-2 py-1 text-xs text-[var(--theme-text)] placeholder:text-[var(--theme-text-subtle)] focus:border-[var(--theme-interactive)] focus:outline-none"
          />
        </div>
        <button
          onClick={() => void handleAddProject()}
          className="p-1.5 rounded-md text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-panel-hover)] hover:text-[var(--theme-text)]"
          title="Add Project"
        >
          <FolderPlus className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onCollapse}
          className="p-1.5 rounded-md text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-panel-hover)] hover:text-[var(--theme-text)]"
          title="Hide Sidebar"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-1.5 py-1">
        {filteredProjects.map((project) => (
          <ProjectRow key={project.id} project={project} />
        ))}

        {filteredProjects.length === 0 && (
          <div className="mt-8 px-4 text-center text-xs text-[var(--theme-text-faint)]">
            {searchText ? (
              "No matching projects"
            ) : (
              <div className="space-y-2">
                <p>No projects yet</p>
                <button
                  onClick={() => void handleAddProject()}
                  className="text-[var(--theme-interactive)] transition-colors hover:opacity-80"
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
