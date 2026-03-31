import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { getTerminalDaemonClient } from "@/lib/terminal-runtime";
import { useRef, useCallback } from "react";
import { useTabDrag } from "./TabDragLayer";
import { X } from "lucide-react";

interface TabBarProps {
  paneID: string;
  slotIDs: string[];
  selectedIndex: number;
  workspaceId: string;
  isFocused: boolean;
}

const DRAG_THRESHOLD = 5; // px movement before drag activates

export default function TabBar({ paneID, slotIDs, selectedIndex, workspaceId, isFocused }: TabBarProps) {
  const { selectTabInPane, setFocusedPane, slotsByID } = useWorkspaceStore();
  const { startDrag, dragState } = useTabDrag();
  const slotsMap = slotsByID(workspaceId);
  const pendingDragRef = useRef<{
    slotID: string;
    slotName: string;
    startX: number;
    startY: number;
    index: number;
  } | null>(null);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent, index: number) => {
      // Ignore right-click or if already dragging
      if (e.button !== 0) return;
      e.preventDefault();
      const slotID = slotIDs[index];
      const slot = slotsMap[slotID];
      pendingDragRef.current = {
        slotID,
        slotName: slot?.name ?? slotID.slice(0, 8),
        startX: e.clientX,
        startY: e.clientY,
        index,
      };
    },
    [slotIDs, slotsMap]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const pending = pendingDragRef.current;
      if (!pending) return;
      const dx = e.clientX - pending.startX;
      const dy = e.clientY - pending.startY;
      if (Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD) {
        // Threshold exceeded — start drag
        startDrag({
          slotID: pending.slotID,
          sourcePaneID: paneID,
          slotName: pending.slotName,
        });
        pendingDragRef.current = null;
      }
    },
    [paneID, startDrag]
  );

  const handlePointerUp = useCallback(
    (_e: React.PointerEvent, index: number) => {
      if (pendingDragRef.current) {
        // Didn't exceed threshold — treat as click
        selectTabInPane(paneID, index);
        setFocusedPane(paneID);
        pendingDragRef.current = null;
      }
    },
    [paneID, selectTabInPane, setFocusedPane]
  );

  if (slotIDs.length === 0) return null;

  return (
    <div
      className="flex items-center h-8 bg-neutral-900/80 border-b border-neutral-800 overflow-x-auto scrollbar-none"
      onPointerMove={handlePointerMove}
      onPointerLeave={() => { pendingDragRef.current = null; }}
    >
      {slotIDs.map((slotID, index) => {
        const slot = slotsMap[slotID];
        const isActive = index === selectedIndex;
        const isBeingDragged = dragState?.slotID === slotID;

        return (
          <div
            key={slotID}
            data-tab-slot={slotID}
            data-tab-pane={paneID}
            data-tab-index={index}
            onPointerDown={(e) => handlePointerDown(e, index)}
            onPointerUp={(e) => handlePointerUp(e, index)}
            className={cn(
              "relative flex items-center gap-1.5 pl-3 pr-1.5 h-full text-xs border-r border-neutral-800 shrink-0 cursor-default select-none",
              isActive && isFocused
                ? "bg-neutral-900 text-neutral-200"
                : isActive
                  ? "bg-neutral-900 text-neutral-500"
                  : "text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800/30",
              isBeingDragged && "opacity-30"
            )}
          >
            <span className="truncate max-w-[120px] pointer-events-none">
              {slot?.name ?? slotID.slice(0, 8)}
            </span>

            <div
              role="button"
              tabIndex={-1}
              aria-label={`Close ${slot?.name ?? "tab"}`}
              onPointerDown={(e) => e.stopPropagation()}
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
            </div>

            {isActive && isFocused && (
              <span className="pointer-events-none absolute inset-x-2 bottom-0 h-px bg-neutral-500" />
            )}
          </div>
        );
      })}
    </div>
  );
}
