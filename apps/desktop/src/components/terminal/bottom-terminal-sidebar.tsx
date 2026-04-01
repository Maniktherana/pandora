import { useCallback, useMemo, useRef } from "react";
import { Pencil, X } from "lucide-react";
import { useTabDrag } from "@/components/dnd/tab-drag-layer";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { SlotState, WorkspaceRuntimeState } from "@/lib/shared/types";
import { cn } from "@/lib/shared/utils";
import { terminalShellAppearance } from "@/lib/terminal/terminal-shell";
import { getTerminalDaemonClient } from "@/lib/terminal/terminal-runtime";

const DRAG_THRESHOLD = 5;

type SidebarRow = {
  groupId: string;
  groupIndex: number;
  slotId: string;
  slotIndex: number;
  label: string;
  treeState: "none" | "start" | "middle" | "last";
};

function ShellBadge({ name }: { name: string }) {
  const shell = terminalShellAppearance(name);
  return (
    <span
      className={cn(
        "flex h-4 min-w-4 shrink-0 items-center justify-center rounded-sm px-1 text-[9px] font-semibold ring-1",
        shell.className
      )}
      title={shell.label}
      aria-hidden
    >
      {shell.badge}
    </span>
  );
}

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

function slotLabel(slot: SlotState | undefined, fallback = "zsh"): string {
  return slot?.name?.trim() || fallback;
}

export default function BottomTerminalSidebar({
  runtime,
  workspaceId,
}: {
  runtime: WorkspaceRuntimeState;
  workspaceId: string;
}) {
  const panel = runtime.terminalPanel;
  const slots = useWorkspaceStore((s) => s.runtimes[workspaceId]?.slots ?? []);
  const selectProjectTerminalGroup = useWorkspaceStore((s) => s.selectProjectTerminalGroup);
  const closeProjectTerminal = useWorkspaceStore((s) => s.closeProjectTerminal);
  const { startDrag, dragState } = useTabDrag();

  const slotMap = useMemo(() => {
    const map = new Map<string, SlotState>();
    for (const slot of slots) map.set(slot.id, slot);
    return map;
  }, [slots]);

  const rows = useMemo(() => {
    if (!panel) return [] as SidebarRow[];
    const next: SidebarRow[] = [];
    for (const [groupIndex, group] of panel.groups.entries()) {
      for (const [slotIndex, slotId] of group.children.entries()) {
        next.push({
          groupId: group.id,
          groupIndex,
          slotId,
          slotIndex,
          label: slotLabel(slotMap.get(slotId)),
          treeState:
            group.children.length === 1
              ? "none"
              : slotIndex === 0
                ? "start"
              : slotIndex === group.children.length - 1
                ? "last"
                : "middle",
        });
      }
    }
    return next;
  }, [panel, slotMap]);

  const pendingDragRef = useRef<{
    row: SidebarRow;
    startX: number;
    startY: number;
  } | null>(null);

  const onSelectRow = useCallback(
    (row: SidebarRow) => {
      selectProjectTerminalGroup(workspaceId, row.groupId, row.slotId);
    },
    [selectProjectTerminalGroup, workspaceId]
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
      if (Math.abs(dx) + Math.abs(dy) <= DRAG_THRESHOLD) return;
      startDrag({
        kind: "bottom-terminal-slot",
        runtimeId: workspaceId,
        groupId: pending.row.groupId,
        groupIndex: pending.row.groupIndex,
        slotId: pending.row.slotId,
        slotIndex: pending.row.slotIndex,
        tabLabel: pending.row.label,
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
      const current = slotLabel(slot);
      const next = window.prompt("Rename terminal", current)?.trim();
      if (!next || next === current) return;
      const client = getTerminalDaemonClient();
      client?.send(workspaceId, {
        type: "update_slot",
        slot: { id: slotId, name: next },
      });
      const sessionDefId = slot?.sessionDefIDs[0];
      if (sessionDefId) {
        client?.send(workspaceId, {
          type: "update_session_def",
          session: { id: sessionDefId, name: next },
        });
      }
    },
    [slotMap, workspaceId]
  );

  if (!panel || panel.groups.length === 0) {
    return (
      <div className="flex h-full min-h-0 w-[188px] shrink-0 flex-col border-l border-neutral-800 bg-neutral-900/90">
        <div className="border-b border-neutral-800 px-3 py-2 text-[10px] uppercase tracking-[0.14em] text-neutral-500">
          Terminals
        </div>
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
      <div className="border-b border-neutral-800 px-3 py-2 text-[10px] uppercase tracking-[0.14em] text-neutral-500">
        Terminals
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {panel.groups.map((group, groupIndex) => (
          <div
            key={group.id}
            data-bottom-terminal-runtime-id={workspaceId}
            data-bottom-terminal-group-id={group.id}
            data-bottom-terminal-group-index={groupIndex}
            data-bottom-terminal-group-block="true"
            className="px-1.5 pb-0.5"
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
                      "flex min-h-7 w-full cursor-default items-center gap-1.5 rounded-md px-2 text-left text-[11px] outline-none",
                      active
                        ? "bg-[#1e3a5f] text-neutral-100"
                        : "text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-200",
                      isBeingDragged && "opacity-30"
                    )}
                    onPointerDown={(e) => handlePointerDown(e, row)}
                    onPointerUp={() => handlePointerUp(row)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelectRow(row);
                      }
                    }}
                  >
                    <TreeGutter treeState={row.treeState} />
                    <ShellBadge name={row.label} />
                    <span className="min-w-0 flex-1 truncate">{row.label}</span>
                    <button
                      type="button"
                      className="flex h-5 w-5 items-center justify-center rounded text-neutral-500 hover:bg-white/10 hover:text-neutral-100"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        promptRename(row.slotId);
                      }}
                      title="Rename terminal"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      className="flex h-5 w-5 items-center justify-center rounded text-neutral-500 hover:bg-white/10 hover:text-neutral-100"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        closeProjectTerminal(workspaceId, row.slotId);
                      }}
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
