import { FolderTree, PanelBottom, PanelLeft, Plus } from "lucide-react";
import type { WorkspaceRecord } from "@/lib/shared/types";
import { cn } from "@/lib/shared/utils";

interface AppToolbarProps {
  sidebarVisible: boolean;
  selectedWorkspace: WorkspaceRecord | null;
  bottomPanelOpen: boolean;
  fileTreeOpen: boolean;
  onToggleSidebar: () => void;
  onNewTerminal: () => void;
  onToggleBottomPanel: () => void;
  onToggleFileTree: () => void;
}

export default function AppToolbar({
  sidebarVisible,
  selectedWorkspace,
  bottomPanelOpen,
  fileTreeOpen,
  onToggleSidebar,
  onNewTerminal,
  onToggleBottomPanel,
  onToggleFileTree,
}: AppToolbarProps) {
  return (
    <div className="h-10 flex items-center shrink-0 border-b border-[var(--oc-border)] bg-[#121212]">
      {!sidebarVisible && (
        <button
          type="button"
          onClick={onToggleSidebar}
          className="ml-20 rounded-md p-1.5 text-[var(--oc-text-muted)] transition-colors hover:bg-[var(--oc-panel-hover)] hover:text-[var(--oc-text)]"
        >
          <PanelLeft className="w-4 h-4" />
        </button>
      )}

      {selectedWorkspace && (
        <div className="flex items-center gap-2 ml-3" data-tauri-drag-region>
          <span className="text-sm text-[var(--oc-text-muted)]" data-tauri-drag-region>
            {selectedWorkspace.name}
          </span>
          {selectedWorkspace.status === "ready" && (
            <button
              type="button"
              onClick={onNewTerminal}
              className="rounded p-1 text-[var(--oc-text-subtle)] transition-colors hover:bg-[var(--oc-panel-hover)] hover:text-[var(--oc-text-muted)]"
              title="New Terminal (Cmd+Shift+T)"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      <div className="flex-1 min-w-8 self-stretch" data-tauri-drag-region />

      {selectedWorkspace?.status === "ready" && (
        <div className="mr-3 flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onToggleBottomPanel}
            className={cn(
              "rounded-md p-1.5 text-[var(--oc-text-muted)] transition-colors hover:bg-[var(--oc-panel-hover)] hover:text-[var(--oc-text)]",
              bottomPanelOpen && "bg-[var(--oc-panel-elevated)] text-[var(--oc-text)]"
            )}
            title="Toggle terminal panel (Ctrl+`)"
          >
            <PanelBottom className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onToggleFileTree}
            className={cn(
              "rounded-md p-1.5 text-[var(--oc-text-muted)] transition-colors hover:bg-[var(--oc-panel-hover)] hover:text-[var(--oc-text)]",
              fileTreeOpen && "bg-[var(--oc-panel-elevated)] text-[var(--oc-text)]"
            )}
            title="Toggle file tree"
          >
            <FolderTree className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
