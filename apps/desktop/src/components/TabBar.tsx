import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { getTerminalDaemonClient } from "@/lib/terminal-runtime";
import { useRef, useCallback } from "react";
import { X } from "lucide-react";

interface TabBarProps {
  paneID: string;
  slotIDs: string[];
  selectedIndex: number;
  workspaceId: string;
}

export default function TabBar({ paneID, slotIDs, selectedIndex, workspaceId }: TabBarProps) {
  const { selectTabInPane, setFocusedPane, slotsByID, reorderTab } = useWorkspaceStore();
  const slotsMap = slotsByID(workspaceId);
  const dragIndexRef = useRef<number | null>(null);

  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    dragIndexRef.current = index;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", slotIDs[index]);
    e.dataTransfer.setData("application/x-pane-id", paneID);
  }, [slotIDs, paneID]);

  const handleDrop = useCallback((e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    const sourcePaneID = e.dataTransfer.getData("application/x-pane-id");
    const slotID = e.dataTransfer.getData("text/plain");

    if (sourcePaneID === paneID && dragIndexRef.current !== null) {
      // Reorder within same pane
      reorderTab(paneID, dragIndexRef.current, targetIndex);
    } else if (slotID) {
      // Cross-pane tab move
      const { moveTab } = useWorkspaceStore.getState();
      moveTab(sourcePaneID, paneID, slotID);
    }
    dragIndexRef.current = null;
  }, [paneID, reorderTab]);

  if (slotIDs.length === 0) return null;

  return (
    <div className="flex items-center h-8 bg-neutral-900/80 border-b border-neutral-800 overflow-x-auto scrollbar-none">
      {slotIDs.map((slotID, index) => {
        const slot = slotsMap[slotID];
        const isActive = index === selectedIndex;

        return (
          <button
            key={slotID}
            draggable
            onDragStart={(e) => handleDragStart(e, index)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => handleDrop(e, index)}
            onClick={() => {
              selectTabInPane(paneID, index);
              setFocusedPane(paneID);
            }}
            className={cn(
              "relative flex items-center gap-1.5 pl-3 pr-1.5 h-full text-xs border-r border-neutral-800 shrink-0 transition-colors group",
              isActive
                ? "bg-neutral-900 text-neutral-200"
                : "text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800/30"
            )}
          >
            <span className="truncate max-w-[120px]">{slot?.name ?? slotID.slice(0, 8)}</span>
            <button
              type="button"
              aria-label={`Close ${slot?.name ?? "tab"}`}
              onClick={(e) => {
                e.stopPropagation();
                getTerminalDaemonClient()?.send(workspaceId, {
                  type: "remove_slot",
                  slotID,
                });
              }}
              className={cn(
                "ml-1 flex h-4 w-4 items-center justify-center rounded-sm transition-colors",
                isActive
                  ? "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
                  : "text-neutral-600 hover:bg-neutral-800 hover:text-neutral-200"
              )}
            >
              <X className="h-3 w-3" />
            </button>
            <span
              className={cn(
                "pointer-events-none absolute inset-x-2 bottom-0 h-px transition-colors",
                isActive ? "bg-neutral-200" : "bg-transparent"
              )}
            />
          </button>
        );
      })}
    </div>
  );
}
