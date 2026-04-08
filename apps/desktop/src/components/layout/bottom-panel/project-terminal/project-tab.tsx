import { Pencil, X } from "lucide-react";
import TerminalIdentityIcon from "@/components/terminal/terminal-identity-icon";
import { cn } from "@/lib/shared/utils";
import type { SidebarRow } from "../project-terminal.types";

type ProjectTabProps = {
  row: SidebarRow;
  workspaceId: string;
  active: boolean;
  isBeingDragged: boolean;
  onPointerDown: (event: React.PointerEvent, row: SidebarRow) => void;
  onPointerUp: (row: SidebarRow) => void;
  onKeyDown: (event: React.KeyboardEvent, row: SidebarRow) => void;
  onRenameClick: (event: React.MouseEvent, slotId: string) => void;
  onCloseClick: (event: React.MouseEvent, slotId: string) => void;
};

function TreeGutter({ treeState }: { treeState: SidebarRow["treeState"] }) {
  if (treeState === "none") return <span className="w-2 shrink-0" aria-hidden />;
  return (
    <span
      className="inline-block w-4 shrink-0 whitespace-pre font-mono text-[10px] leading-none text-neutral-600"
      aria-hidden
    >
      {treeState === "start"
        ? "\u250c\u2500"
        : treeState === "middle"
          ? "\u251c\u2500"
          : "\u2514\u2500"}
    </span>
  );
}

export function ProjectTab({
  row,
  workspaceId,
  active,
  isBeingDragged,
  onPointerDown,
  onPointerUp,
  onKeyDown,
  onRenameClick,
  onCloseClick,
}: ProjectTabProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      data-bottom-terminal-runtime-id={workspaceId}
      data-bottom-terminal-group-id={row.groupId}
      data-bottom-terminal-group-index={row.groupIndex}
      data-bottom-terminal-slot-id={row.slotId}
      data-bottom-terminal-slot-index={row.slotIndex}
      className={cn(
        "group/tab relative flex min-h-8 w-full cursor-default select-none items-center gap-1.5 border border-neutral-800 border-l-transparent border-b-2 border-b-transparent px-2 text-left text-[11px] outline-none",
        {
          "border-b-neutral-400 bg-neutral-900 text-neutral-100": active,
          "text-neutral-400 hover:bg-neutral-800/30 hover:text-neutral-200": !active,
          "opacity-30": isBeingDragged,
        },
      )}
      onPointerDown={(e) => onPointerDown(e, row)}
      onPointerUp={() => onPointerUp(row)}
      onKeyDown={(e) => onKeyDown(e, row)}
    >
      <TreeGutter treeState={row.treeState} />
      <TerminalIdentityIcon identity={row.display} className="size-4" />
      <span className="min-w-0 flex-1 truncate">{row.display.label}</span>
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute right-0 top-0 h-full w-16 opacity-0 transition-opacity group-hover/tab:opacity-100",
          "bg-gradient-to-l to-transparent",
          {
            "from-neutral-900": active,
            "from-neutral-800/30": !active,
          },
        )}
      />
      <div className="relative z-10 ml-1 flex h-full items-center pl-1">
        <button
          type="button"
          className="flex h-5 w-5 items-center justify-center rounded text-neutral-500 opacity-0 transition-[opacity,color,background-color] group-hover/tab:opacity-100 hover:bg-white/10 hover:text-neutral-100"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => onRenameClick(e, row.slotId)}
          title="Rename terminal"
        >
          <Pencil className="h-3 w-3" />
        </button>
        <button
          type="button"
          className="flex h-5 w-5 items-center justify-center rounded text-neutral-500 opacity-0 transition-[opacity,color,background-color] group-hover/tab:opacity-100 hover:bg-white/10 hover:text-neutral-100"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => onCloseClick(e, row.slotId)}
          title="Close terminal"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
