import { useCallback, useMemo, useRef } from "react";
import { Pencil, X } from "lucide-react";
import { useTabDrag } from "@/components/dnd/tab-drag-layer";
import TerminalIdentityIcon from "@/components/terminal/terminal-identity-icon";
import { useProjectTerminalActions } from "@/hooks/use-terminal-actions";
import type { WorkspaceRuntimeState } from "@/lib/shared/types";
import { cn } from "@/lib/shared/utils";
import { terminalDisplayForSlot } from "@/lib/terminal/terminal-identity";
import { TerminalTreeState, SidebarRow } from "../project-terminal.types";
import { createSessionMap, createSlotMap, buildSidebarRows, PROJECT_TERMINAL_DRAG_THRESHOLD } from "../project-terminal.utils";

type ProjectTerminalSidebarProps = {
  runtime: WorkspaceRuntimeState;
  workspaceId: string;
};


function TreeGutter({ treeState }: { treeState: TerminalTreeState }) {
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

export default function ProjectTerminalSidebar({
  runtime,
  workspaceId,
}: ProjectTerminalSidebarProps) {
  const panel = runtime.terminalPanel;
  const slots = runtime.slots;
  const displayMap = runtime.terminalDisplayBySlotId ?? {};
  const projectTerminalCommands = useProjectTerminalActions();
  const sessionsMap = useMemo(() => createSessionMap(runtime.sessions), [runtime.sessions]);
  const { startDrag, dragState } = useTabDrag();

  const slotMap = useMemo(() => createSlotMap(slots), [slots]);

  const rows = useMemo(
    () => buildSidebarRows(panel, slotMap, sessionsMap, displayMap),
    [displayMap, panel, sessionsMap, slotMap]
  );

  const pendingDragRef = useRef<{
    row: SidebarRow;
    startX: number;
    startY: number;
  } | null>(null);

  const onSelectRow = useCallback(
    (row: SidebarRow) => {
      projectTerminalCommands.selectProjectTerminalGroup(workspaceId, row.groupId, row.slotId);
    },
    [projectTerminalCommands, workspaceId]
  );

  const handlePointerDown = useCallback((e: React.PointerEvent, row: SidebarRow) => {
    if (e.button !== 0) return;
    e.preventDefault();
    pendingDragRef.current = {
      row,
      startX: e.clientX,
      startY: e.clientY,
    };
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const pending = pendingDragRef.current;
      if (!pending) return;
      const dx = e.clientX - pending.startX;
      const dy = e.clientY - pending.startY;
      if (Math.abs(dx) + Math.abs(dy) <= PROJECT_TERMINAL_DRAG_THRESHOLD) return;
      startDrag({
        kind: "bottom-terminal-slot",
        runtimeId: workspaceId,
        groupId: pending.row.groupId,
        groupIndex: pending.row.groupIndex,
        slotId: pending.row.slotId,
        slotIndex: pending.row.slotIndex,
        tabLabel: pending.row.display.label,
      });
      pendingDragRef.current = null;
    },
    [startDrag, workspaceId]
  );

  const handlePointerUp = useCallback((row: SidebarRow) => {
    if (!pendingDragRef.current) return;
    onSelectRow(row);
    pendingDragRef.current = null;
  }, [onSelectRow]);

  const promptRename = useCallback(
    (slotId: string) => {
      const slot = slotMap.get(slotId);
      const current = terminalDisplayForSlot(slot, sessionsMap.get(slotId), displayMap[slotId]).label;
      const next = window.prompt("Rename terminal", current)?.trim();
      if (!next || next === current) return;
      projectTerminalCommands.renameTerminal(workspaceId, slotId, next);
    },
    [displayMap, projectTerminalCommands, sessionsMap, slotMap, workspaceId]
  );

  const handleRowKeyDown = useCallback(
    (event: React.KeyboardEvent, row: SidebarRow) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onSelectRow(row);
      }
    },
    [onSelectRow]
  );

  const handleRenameClick = useCallback(
    (event: React.MouseEvent, slotId: string) => {
      event.stopPropagation();
      promptRename(slotId);
    },
    [promptRename]
  );

  const handleCloseClick = useCallback(
    (event: React.MouseEvent, slotId: string) => {
      event.stopPropagation();
      projectTerminalCommands.closeProjectTerminal(workspaceId, slotId);
    },
    [projectTerminalCommands, workspaceId]
  );

  if (!panel || panel.groups.length === 0) {
    return (
      <div className="flex h-full min-h-0 w-[188px] shrink-0 flex-col border-l border-neutral-800 bg-neutral-900/90">
        <div className="flex min-h-0 flex-1 items-center justify-center px-4 text-center text-xs text-neutral-500">
          No terminals
        </div>
      </div>
    );
  }

  return (
    <div
      data-bottom-terminal-sidebar="true"
      className="flex h-full min-h-0 w-[188px] shrink-0 flex-col border-l border-neutral-800 bg-neutral-900/90"
      onPointerMove={handlePointerMove}
      onPointerLeave={() => {
        pendingDragRef.current = null;
      }}
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        {panel.groups.map((group, groupIndex) => (
          <div
            key={group.id}
            data-bottom-terminal-runtime-id={workspaceId}
            data-bottom-terminal-group-id={group.id}
            data-bottom-terminal-group-index={groupIndex}
            data-bottom-terminal-group-block="true"
          >
            {rows
              .filter((row) => row.groupId === group.id)
              .map((row) => {
                const active = groupIndex === panel.activeGroupIndex && panel.activeSlotId === row.slotId;
                const isBeingDragged =
                  dragState?.kind === "bottom-terminal-slot" && dragState.slotId === row.slotId;
                return (
                  <div
                    key={row.slotId}
                    role="button"
                    tabIndex={0}
                    data-bottom-terminal-runtime-id={workspaceId}
                    data-bottom-terminal-group-id={row.groupId}
                    data-bottom-terminal-group-index={row.groupIndex}
                    data-bottom-terminal-slot-id={row.slotId}
                    data-bottom-terminal-slot-index={row.slotIndex}
                    className={cn(
                      "relative flex min-h-8 w-full cursor-default select-none items-center gap-1.5 border border-neutral-800 border-l-transparent border-b-2 border-b-transparent px-2 text-left text-[11px] outline-none",
                      active
                        ? "border-b-neutral-400 bg-neutral-900 text-neutral-100"
                        : "text-neutral-400 hover:bg-neutral-800/30 hover:text-neutral-200",
                      isBeingDragged && "opacity-30"
                    )}
                    onPointerDown={(e) => handlePointerDown(e, row)}
                    onPointerUp={() => handlePointerUp(row)}
                    onKeyDown={(e) => handleRowKeyDown(e, row)}
                  >
                    <TreeGutter treeState={row.treeState} />
                    <TerminalIdentityIcon identity={row.display} className="size-4" />
                    <span className="min-w-0 flex-1 truncate">{row.display.label}</span>
                    <button
                      type="button"
                      className="flex h-5 w-5 items-center justify-center rounded text-neutral-500 hover:bg-white/10 hover:text-neutral-100"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => handleRenameClick(e, row.slotId)}
                      title="Rename terminal"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      className="flex h-5 w-5 items-center justify-center rounded text-neutral-500 hover:bg-white/10 hover:text-neutral-100"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => handleCloseClick(e, row.slotId)}
                      title="Close terminal"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
          </div>
        ))}
      </div>
    </div>
  );
}
