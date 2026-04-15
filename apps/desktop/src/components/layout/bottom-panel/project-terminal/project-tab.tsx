import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import TerminalIdentityIcon from "@/components/terminal/terminal-identity-icon";
import { cn } from "@/lib/shared/utils";
import type { SidebarRow } from "../project-terminal.types";

type ProjectTabProps = {
  row: SidebarRow;
  workspaceId: string;
  active: boolean;
  isFirst: boolean;
  isLast: boolean;
  isBeingDragged: boolean;
  isRenaming: boolean;
  renameValue: string;
  onPointerDown: (event: React.PointerEvent, row: SidebarRow) => void;
  onPointerUp: (row: SidebarRow) => void;
  onKeyDown: (event: React.KeyboardEvent, row: SidebarRow) => void;
  onRenameClick: (event: React.MouseEvent, slotId: string) => void;
  onCloseClick: (event: React.MouseEvent, slotId: string) => void;
  onRenameValueChange: (value: string) => void;
  onRenameSubmit: () => void;
  onRenameCancel: () => void;
};

function TreeGutter({ treeState }: { treeState: SidebarRow["treeState"] }) {
  if (treeState === "none") return null;
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
  isFirst,
  isLast,
  isBeingDragged,
  isRenaming,
  renameValue,
  onPointerDown,
  onPointerUp,
  onKeyDown,
  onCloseClick,
  onRenameValueChange,
  onRenameSubmit,
  onRenameCancel,
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
        "group/tab relative flex h-8 w-full cursor-default select-none items-center gap-1.5 pl-3 pr-1.5 text-left text-xs outline-none",
        {
          "border-t border-[var(--theme-border)]": !isFirst,
          "border-b border-[var(--theme-border)]": isLast,
          "bg-[var(--theme-panel-hover)] text-[var(--theme-text)]": active,
          "text-[var(--theme-text-muted)] hover:bg-[var(--theme-panel-hover)] hover:text-[var(--theme-text)]":
            !active,
          "opacity-30": isBeingDragged,
        },
      )}
      onPointerDown={(e) => onPointerDown(e, row)}
      onPointerUp={() => onPointerUp(row)}
      onKeyDown={(e) => onKeyDown(e, row)}
    >
      <TreeGutter treeState={row.treeState} />
      <TerminalIdentityIcon identity={row.display} className="size-3.5" />
      {isRenaming ? (
        <Input
          type="text"
          value={renameValue}
          className="h-6 min-w-0 flex-1 border-neutral-700 bg-neutral-950 px-1.5 text-[11px] text-neutral-100 focus-visible:border-neutral-500 focus-visible:ring-0"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => onRenameValueChange(event.target.value)}
          onBlur={onRenameSubmit}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter") {
              event.preventDefault();
              onRenameSubmit();
              return;
            }
            if (event.key === "Escape") {
              event.preventDefault();
              onRenameCancel();
            }
          }}
          autoFocus
        />
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate">{row.display.label}</span>
          <div
            aria-hidden
            className={cn(
              "pointer-events-none absolute right-0 top-0 h-full w-14 opacity-0 transition-opacity group-hover/tab:opacity-100",
              "bg-gradient-to-l to-transparent",
              {
                "from-[var(--theme-panel-hover)]": active,
                "from-[var(--theme-panel-hover)]/40": !active,
              },
            )}
          />
          <div className="relative z-10 ml-1 flex h-full items-center pl-1">
            <div
              role="button"
              tabIndex={-1}
              aria-label="Close terminal"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => onCloseClick(e, row.slotId)}
              className={cn(
                "flex h-4 w-4 items-center justify-center rounded-sm opacity-0 transition-[opacity,color,background-color] group-hover/tab:opacity-100",
                {
                  "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100": active,
                  "text-neutral-600 hover:bg-neutral-800 hover:text-neutral-200": !active,
                },
              )}
            >
              <X className="h-3 w-3" aria-hidden />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
