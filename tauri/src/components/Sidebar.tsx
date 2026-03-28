import { Search, Plus, ChevronLeft } from "lucide-react";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { cn } from "@/lib/utils";
import type { SlotState, AggregateStatus } from "@/lib/types";

function StatusDot({ status }: { status: AggregateStatus }) {
  const colors: Record<AggregateStatus, string> = {
    running: "bg-green-500",
    restarting: "bg-yellow-500",
    crashed: "bg-red-500",
    stopped: "bg-neutral-500",
  };
  return <div className={cn("w-2 h-2 rounded-full shrink-0", colors[status])} />;
}

interface SidebarProps {
  onCollapse: () => void;
  onNewTerminal: () => void;
}

export default function Sidebar({ onCollapse, onNewTerminal }: SidebarProps) {
  const {
    filteredWorkspaces,
    selectedSidebarWorkspaceID,
    selectWorkspace,
    searchText,
    setSearchText,
    slotsByID,
    navigationArea,
    setNavigationArea,
  } = useWorkspaceStore();

  const workspaces = filteredWorkspaces();
  const slotsMap = slotsByID();

  function getWorkspaceSlots(workspaceId: string) {
    const workspace = useWorkspaceStore.getState().workspaces.find((w) => w.id === workspaceId);
    if (!workspace) return [];
    const slotIDs = getAllSlotIDs(workspace.root);
    return slotIDs.map((id) => slotsMap[id]).filter(Boolean) as SlotState[];
  }

  function getAllSlotIDs(node: any): string[] {
    if (node.type === "leaf") return node.slotIDs;
    return node.children.flatMap(getAllSlotIDs);
  }

  function getAggregateStatus(slots: SlotState[]): AggregateStatus {
    if (slots.some((s) => s.aggregateStatus === "crashed")) return "crashed";
    if (slots.some((s) => s.aggregateStatus === "restarting")) return "restarting";
    if (slots.some((s) => s.aggregateStatus === "running")) return "running";
    return "stopped";
  }

  return (
    <div className="flex flex-col h-full bg-neutral-900/40 backdrop-blur-2xl border-r border-white/5">
      {/* Header — pt-11 clears macOS traffic lights in overlay titlebar */}
      <div className="flex items-center gap-2 px-3 pt-11 pb-2" data-tauri-drag-region>
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-500" />
          <input
            type="text"
            placeholder="Search..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="w-full bg-neutral-900 border border-neutral-800 rounded-md pl-7 pr-2 py-1 text-xs text-neutral-300 placeholder-neutral-600 focus:outline-none focus:border-neutral-600"
          />
        </div>
        <button
          onClick={onNewTerminal}
          className="p-1.5 rounded-md hover:bg-neutral-800 text-neutral-400 hover:text-neutral-200 transition-colors"
          title="New Terminal"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onCollapse}
          className="p-1.5 rounded-md hover:bg-neutral-800 text-neutral-400 hover:text-neutral-200 transition-colors"
          title="Hide Sidebar"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Workspace list */}
      <div className="flex-1 overflow-y-auto px-1.5 py-1">
        {workspaces.map((workspace) => {
          const slots = getWorkspaceSlots(workspace.id);
          const status = getAggregateStatus(slots);
          const isSelected = workspace.id === selectedSidebarWorkspaceID;
          const isActive = navigationArea === "sidebar" && isSelected;

          return (
            <button
              key={workspace.id}
              onClick={() => {
                selectWorkspace(workspace.id);
                setNavigationArea("sidebar");
              }}
              onDoubleClick={() => {
                selectWorkspace(workspace.id);
                setNavigationArea("workspace");
              }}
              className={cn(
                "w-full text-left px-2.5 py-2 rounded-md mb-0.5 transition-colors group",
                isActive
                  ? "bg-blue-600/20 border border-blue-500/30"
                  : isSelected
                  ? "bg-neutral-800/60 border border-transparent"
                  : "hover:bg-neutral-800/40 border border-transparent"
              )}
            >
              <div className="flex items-center gap-2">
                <StatusDot status={status} />
                <span className="text-sm font-medium text-neutral-200 truncate flex-1">
                  {workspace.title}
                </span>
                <span className="text-[10px] font-medium text-neutral-500 uppercase tracking-wider">
                  {slots.length > 1 ? "workspace" : slots[0]?.kind === "terminal_slot" ? "term" : "proc"}
                </span>
              </div>
              {slots.length > 1 && (
                <div className="text-[11px] text-neutral-500 mt-0.5 ml-4">
                  {slots.length} panes
                </div>
              )}
            </button>
          );
        })}

        {workspaces.length === 0 && (
          <div className="text-center text-neutral-600 text-xs mt-8 px-4">
            {searchText ? "No matching workspaces" : "No workspaces yet"}
          </div>
        )}
      </div>
    </div>
  );
}
