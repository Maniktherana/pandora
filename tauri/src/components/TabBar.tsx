import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/stores/workspace-store";

interface TabBarProps {
  paneID: string;
  slotIDs: string[];
  selectedIndex: number;
  isFocused: boolean;
}

export default function TabBar({ paneID, slotIDs, selectedIndex, isFocused }: TabBarProps) {
  const { selectTabInPane, removeTabFromPane, setFocusedPane, slotsByID } = useWorkspaceStore();
  const slotsMap = slotsByID();

  if (slotIDs.length <= 1) return null;

  return (
    <div
      className={cn(
        "flex items-center h-8 bg-neutral-900/80 border-b overflow-x-auto scrollbar-none",
        isFocused ? "border-blue-500/30" : "border-neutral-800"
      )}
    >
      {slotIDs.map((slotID, index) => {
        const slot = slotsMap[slotID];
        const isActive = index === selectedIndex;

        return (
          <button
            key={slotID}
            onClick={() => {
              selectTabInPane(paneID, index);
              setFocusedPane(paneID);
            }}
            className={cn(
              "flex items-center gap-1.5 px-3 h-full text-xs border-r border-neutral-800 shrink-0 transition-colors group",
              isActive
                ? "bg-neutral-800/60 text-neutral-200"
                : "text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800/30"
            )}
          >
            <span className="truncate max-w-[120px]">{slot?.name ?? slotID.slice(0, 8)}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                removeTabFromPane(paneID, slotID);
              }}
              className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-neutral-700 transition-opacity"
            >
              <X className="w-3 h-3" />
            </button>
          </button>
        );
      })}
    </div>
  );
}
