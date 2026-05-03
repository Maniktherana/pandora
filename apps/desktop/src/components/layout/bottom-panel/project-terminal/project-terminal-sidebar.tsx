import { useCallback, useMemo, useRef, useState } from "react";
import { useTabDrag } from "@/components/dnd/tab-drag-provider";
import { useProjectTerminalActions } from "@/hooks/use-terminal-actions";
import { terminalDisplayForSlot } from "@/lib/shared/terminal/identity";
import DotGridLoader from "@/components/dot-grid-loader";
import type { SidebarRow } from "../project-terminal.types";
import {
  createSessionMap,
  createSlotMap,
  buildSidebarRows,
  PROJECT_TERMINAL_DRAG_THRESHOLD,
} from "../project-terminal.utils";
import { ProjectTab } from "./project-tab";
import { useTerminalScopeStore } from "@/lib/services/terminal/store";

type ProjectTerminalSidebarProps = {
  scopeId: string;
};

export default function ProjectTerminalSidebar({ scopeId }: ProjectTerminalSidebarProps) {
  const scope = useTerminalScopeStore((s) => s.byScopeId[scopeId]);
  const panel = scope?.terminalPanel ?? null;
  const slots = scope?.slots ?? [];
  const sessions = scope?.sessions ?? [];
  const displayMap = scope?.terminalDisplayBySlotId ?? {};

  const projectTerminalCommands = useProjectTerminalActions();
  const sessionsMap = useMemo(() => createSessionMap(sessions), [sessions]);
  const { startDrag, dragState } = useTabDrag();

  const slotMap = useMemo(() => createSlotMap(slots), [slots]);

  const rows = useMemo(
    () => buildSidebarRows(panel, slotMap, sessionsMap, displayMap),
    [displayMap, panel, sessionsMap, slotMap],
  );

  const pendingDragRef = useRef<{
    row: SidebarRow;
    startX: number;
    startY: number;
  } | null>(null);
  const [renameState, setRenameState] = useState<{ slotId: string; value: string } | null>(null);

  const onSelectRow = useCallback(
    (row: SidebarRow) => {
      projectTerminalCommands.selectProjectTerminalGroup(scopeId, row.groupId, row.slotId);
    },
    [projectTerminalCommands, scopeId],
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
        scopeId: scopeId,
        groupId: pending.row.groupId,
        groupIndex: pending.row.groupIndex,
        slotId: pending.row.slotId,
        slotIndex: pending.row.slotIndex,
        tabLabel: pending.row.display.label,
      });
      pendingDragRef.current = null;
    },
    [startDrag, scopeId],
  );

  const handlePointerUp = useCallback(
    (row: SidebarRow) => {
      if (!pendingDragRef.current) return;
      onSelectRow(row);
      pendingDragRef.current = null;
    },
    [onSelectRow],
  );

  const submitRename = useCallback(() => {
    if (!renameState) return;
    const slot = slotMap.get(renameState.slotId);
    const current = terminalDisplayForSlot(
      slot,
      sessionsMap.get(renameState.slotId),
      displayMap[renameState.slotId],
    ).label;
    const next = renameState.value.trim();
    setRenameState(null);
    if (!next || next === current) return;
    projectTerminalCommands.renameTerminal(scopeId, renameState.slotId, next);
  }, [displayMap, projectTerminalCommands, renameState, sessionsMap, slotMap, scopeId]);

  const handleRowKeyDown = useCallback(
    (event: React.KeyboardEvent, row: SidebarRow) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onSelectRow(row);
      }
    },
    [onSelectRow],
  );

  const handleRenameClick = useCallback(
    (event: React.MouseEvent, slotId: string) => {
      event.stopPropagation();
      const slot = slotMap.get(slotId);
      const current = terminalDisplayForSlot(
        slot,
        sessionsMap.get(slotId),
        displayMap[slotId],
      ).label;
      setRenameState({ slotId, value: current });
    },
    [displayMap, sessionsMap, slotMap],
  );

  const handleCloseClick = useCallback(
    (event: React.MouseEvent, slotId: string) => {
      event.stopPropagation();
      projectTerminalCommands.closeProjectTerminal(scopeId, slotId);
    },
    [projectTerminalCommands, scopeId],
  );

  if (!panel || panel.groups.length === 0) {
    return (
      <div className="flex h-full min-h-0 w-[140px] shrink-0 flex-col border-l border-r border-[var(--theme-border)] bg-[var(--theme-terminal-bg)]">
        <div className="flex min-h-0 flex-1 items-center justify-center px-4 text-center text-[var(--theme-text-muted)]">
          <div className="flex flex-col items-center">
            <DotGridLoader
              variant="default"
              gridSize={3}
              sizeClassName="h-6 w-6"
              className="opacity-85"
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      data-bottom-terminal-sidebar="true"
      className="flex h-full min-h-0 w-[140px] shrink-0 flex-col border-l border-r border-[var(--theme-border)] bg-[var(--theme-terminal-bg)]"
      onPointerMove={handlePointerMove}
      onPointerLeave={() => {
        pendingDragRef.current = null;
      }}
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        {panel.groups.map((group, groupIndex) => (
          <div
            key={group.id}
            data-bottom-terminal-scope-id={scopeId}
            data-bottom-terminal-group-id={group.id}
            data-bottom-terminal-group-index={groupIndex}
            data-bottom-terminal-group-block="true"
          >
            {rows
              .filter((row) => row.groupId === group.id)
              .map((row, rowIndex, groupRows) => {
                const active =
                  groupIndex === panel.activeGroupIndex && panel.activeSlotId === row.slotId;
                const isBeingDragged =
                  dragState?.kind === "bottom-terminal-slot" && dragState.slotId === row.slotId;
                return (
                  <ProjectTab
                    key={row.slotId}
                    row={row}
                    workspaceId={scopeId}
                    active={active}
                    isFirst={rowIndex === 0}
                    isLast={rowIndex === groupRows.length - 1}
                    isBeingDragged={isBeingDragged}
                    isRenaming={renameState?.slotId === row.slotId}
                    renameValue={renameState?.slotId === row.slotId ? renameState.value : ""}
                    onPointerDown={handlePointerDown}
                    onPointerUp={handlePointerUp}
                    onKeyDown={handleRowKeyDown}
                    onRenameClick={handleRenameClick}
                    onCloseClick={handleCloseClick}
                    onRenameValueChange={(value) => {
                      setRenameState((prev) =>
                        prev && prev.slotId === row.slotId ? { ...prev, value } : prev,
                      );
                    }}
                    onRenameSubmit={submitRename}
                    onRenameCancel={() => setRenameState(null)}
                  />
                );
              })}
          </div>
        ))}
      </div>
    </div>
  );
}
