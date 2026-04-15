import { memo } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { LayoutAlignLeftIcon, PlusSignIcon, Settings03Icon } from "@hugeicons/core-free-icons";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { useDesktopView } from "@/hooks/use-desktop-view";
import { useWorkspaceActions } from "@/hooks/use-workspace-actions";
import { ProjectRow } from "./project-row";
import DotGridLoader from "@/components/dot-grid-loader";

type LeftSidebarProps = {
  booting: boolean;
  onCollapse: () => void;
  onOpenSettings: () => void;
};

function SidebarBootLoader() {
  return (
    <div className="flex h-full min-h-0 items-center justify-center px-4">
      <div className="flex flex-col items-center text-center text-[var(--theme-text-faint)]">
        <DotGridLoader variant="default" gridSize={5} sizeClassName="h-8 w-8" className="opacity-90" />
      </div>
    </div>
  );
}

export default memo(function LeftSidebar({ booting, onCollapse, onOpenSettings }: LeftSidebarProps) {
  const projects = useDesktopView((view) => view.projects);
  const workspaceCommands = useWorkspaceActions();

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
      <div className="flex h-10 justify-end items-center px-3" data-tauri-drag-region>
        <Button
          onClick={onCollapse}
          variant="ghost"
          size="icon-sm"
          title="Hide Sidebar"
          style={{ marginLeft: 72 }}
        >
          <HugeiconsIcon icon={LayoutAlignLeftIcon} strokeWidth={1.25} className="size-5" />
        </Button>
      </div>

      <div className="flex items-center justify-between px-3 py-1">
        <span className="text-sm font-medium text-[var(--theme-text-subtle)]">Workspaces</span>
        <Button
          onClick={() => void handleAddProject()}
          variant="ghost"
          size="icon-sm"
          title="Add Project"
        >
          <HugeiconsIcon icon={PlusSignIcon} strokeWidth={1.5} className="size-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-1.5 py-1">
        {booting && projects.length === 0 ? <SidebarBootLoader /> : null}
        {projects.map((project) => (
          <ProjectRow key={project.id} project={project} />
        ))}

        {!booting && projects.length === 0 && (
          <button
            type="button"
            onClick={() => void handleAddProject()}
            className="flex h-10 w-full cursor-pointer select-none justify-center items-center gap-2 rounded-md border border-transparent px-2.5 text-left text-sm outline-none transition-colors focus-visible:border-[var(--theme-border)] hover:bg-[var(--theme-panel-hover)]"
          >
            <span className="min-w-0 ml-1 truncate text-[var(--theme-text-subtle)]">
              Add a project
            </span>
            <HugeiconsIcon
              icon={PlusSignIcon}
              strokeWidth={2}
              className="h-3.5 w-3.5 shrink-0 text-[var(--theme-text-subtle)]"
            />
          </button>
        )}
      </div>

      <div className="flex h-10 items-center px-3">
        <Button
          onClick={onOpenSettings}
          variant="ghost"
          size="icon-sm"
          title="Settings (Cmd+,)"
        >
          <HugeiconsIcon icon={Settings03Icon} strokeWidth={1.5} className="size-4" />
        </Button>
      </div>
    </div>
  );
});
