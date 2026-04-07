import { terminalDisplayForSlot } from "@/lib/terminal/terminal-identity";
import type {
  SessionState,
  SlotState,
  TerminalDisplayState,
} from "@/lib/shared/types";
import type { SessionMap, SidebarRow, SlotMap } from "./project-terminal.types";

export const PROJECT_TERMINAL_DRAG_THRESHOLD = 5;

export function createSlotMap(slots: SlotState[]): SlotMap {
  const map = new Map<string, SlotState>();
  for (const slot of slots) map.set(slot.id, slot);
  return map;
}

export function createSessionMap(sessions: SessionState[]): SessionMap {
  const map = new Map<string, SessionState>();
  for (const session of sessions) {
    if (!map.has(session.slotID) || session.status === "running") {
      map.set(session.slotID, session);
    }
  }
  return map;
}

export function buildSidebarRows(
  panel: { groups: { id: string; children: string[] }[] } | null | undefined,
  slotMap: SlotMap,
  sessionsMap: SessionMap,
  displayMap: Record<string, TerminalDisplayState>
): SidebarRow[] {
  if (!panel) return [];
  const rows: SidebarRow[] = [];
  for (const [groupIndex, group] of panel.groups.entries()) {
    for (const [slotIndex, slotId] of group.children.entries()) {
      rows.push({
        groupId: group.id,
        groupIndex,
        slotId,
        slotIndex,
        display: terminalDisplayForSlot(slotMap.get(slotId), sessionsMap.get(slotId), displayMap[slotId]),
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
  return rows;
}
