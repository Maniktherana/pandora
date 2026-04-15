import { memo } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Files02Icon,
  GitCompareIcon,
  LayoutAlignBottomIcon,
  LayoutAlignLeftIcon,
} from "@hugeicons/core-free-icons";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { WorkspaceRecord } from "@/lib/shared/types";
import type { LeftPanelMode } from "@/components/layout/right-sidebar/files/files.types";
import { cn } from "@/lib/shared/utils";
import OpenInDropdown from "@/components/layout/app-header-open-in";

interface AppHeaderProps {
  booting: boolean;
  sidebarVisible: boolean;
  selectedWorkspace: WorkspaceRecord | null;
  bottomPanelOpen: boolean;
  fileTreeOpen: boolean;
  rightSidebarMode: LeftPanelMode;
  onToggleSidebar: () => void;
  onToggleBottomPanel: () => void;
  onSelectRightSidebarMode: (mode: LeftPanelMode) => void;
}

export default memo(function AppHeader({
  booting,
  sidebarVisible,
  selectedWorkspace,
  bottomPanelOpen,
  fileTreeOpen,
  rightSidebarMode,
  onToggleSidebar,
  onToggleBottomPanel,
  onSelectRightSidebarMode,
}: AppHeaderProps) {
  const showBranchLabel =
    selectedWorkspace != null &&
    selectedWorkspace.gitBranchName !== selectedWorkspace.name;

  return (
    <div className="h-10 flex items-center shrink-0 border-b border-[var(--theme-border)] bg-[var(--theme-bg)]">
      {!sidebarVisible && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onToggleSidebar}
          className="ml-20"
        >
          <HugeiconsIcon icon={LayoutAlignLeftIcon} strokeWidth={1} className="size-5" />
        </Button>
      )}

      {selectedWorkspace ? (
        <div className="ml-3 flex min-w-0 items-center" data-tauri-drag-region>
          <Breadcrumb className="min-w-0">
            <BreadcrumbList className="flex-nowrap gap-1 overflow-hidden text-sm text-[var(--theme-text-subtle)]">
              <BreadcrumbItem className="min-w-0 max-w-[min(260px,34vw)]">
                <BreadcrumbPage className="truncate text-xs font-normal text-[var(--theme-text)]">
                  {selectedWorkspace.name}
                </BreadcrumbPage>
              </BreadcrumbItem>
              {showBranchLabel && (
                <BreadcrumbItem className="min-w-0 max-w-[min(200px,25vw)]">
                  <span className="truncate font-mono text-[11px] text-[var(--theme-text-faint)]">
                    {selectedWorkspace.gitBranchName}
                  </span>
                </BreadcrumbItem>
              )}
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      ) : booting ? (
        <div className="ml-3 flex min-w-0 items-center gap-3 text-[var(--theme-text-subtle)]">
          <div className="h-5 w-5 rounded bg-[var(--theme-panel-elevated)]" />
          <div className="h-2.5 w-28 rounded-full bg-[var(--theme-panel-hover)]" />
          <div className="h-2.5 w-20 rounded-full bg-[var(--theme-panel-hover)] opacity-70" />
        </div>
      ) : null}

      {selectedWorkspace?.status === "ready" && selectedWorkspace.worktreePath && (
        <div className="ml-2 flex items-center">
          <OpenInDropdown
            worktreePath={selectedWorkspace.worktreePath}
            workspaceName={selectedWorkspace.name}
          />
        </div>
      )}

      <div className="flex-1 min-w-8 self-stretch" data-tauri-drag-region />

      {selectedWorkspace?.status === "ready" && (
        <div className="mr-3 flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onToggleBottomPanel}
            className={cn(
              "h-7 w-7 rounded-sm border border-transparent px-0",
              bottomPanelOpen && "bg-[var(--theme-panel-hover)] text-[var(--theme-text)] hover:bg-[var(--theme-panel-hover)]",
            )}
            title="Toggle terminal panel (Ctrl+`)"
          >
            <HugeiconsIcon icon={LayoutAlignBottomIcon} strokeWidth={1.25} className="size-5" />
          </Button>
          <ToggleGroup
            value={fileTreeOpen ? [rightSidebarMode] : []}
            onValueChange={(values) => {
              const value = values[0];
              if (value === "files" || value === "changes") {
                onSelectRightSidebarMode(value);
              } else if (values.length === 0) {
                onSelectRightSidebarMode(rightSidebarMode);
              }
            }}
            className="border-transparent bg-transparent"
            size="sm"
          >
            <ToggleGroupItem
              value="files"
              className="h-7 w-7 px-0 data-[state=on]:border-transparent data-[state=on]:bg-[var(--theme-panel-hover)] data-[state=on]:text-[var(--theme-text)]"
              title="Toggle file tree"
              aria-label="Toggle file tree"
            >
              <HugeiconsIcon icon={Files02Icon} strokeWidth={1.25} className="size-5" />
            </ToggleGroupItem>
            <ToggleGroupItem
              value="changes"
              className="h-7 w-7 px-0 data-[state=on]:border-transparent data-[state=on]:bg-[var(--theme-panel-hover)] data-[state=on]:text-[var(--theme-text)]"
              title="Toggle source control"
              aria-label="Toggle source control"
            >
              <HugeiconsIcon icon={GitCompareIcon} strokeWidth={1.25} className="size-5" />
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      )}
    </div>
  );
});
