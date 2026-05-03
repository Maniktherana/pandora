import type { TerminalPanelState } from "@/lib/shared/shared.types";
import { isProjectTerminalKey } from "@/lib/services/terminal/project-key";
import {
  addTerminalGroup,
  addTerminalToGroup,
  createEmptyTerminalPanel,
  moveTerminalToGroup,
  moveTerminalToNewGroup,
  reorderTerminalGroupChildren,
  reorderTerminalGroups,
  removeTerminalFromPanel,
  setActiveTerminalGroup,
  setActiveTerminalSlot,
  setTerminalPanelVisible,
  terminalPanelContainsSlot,
} from "@/lib/shared/terminal/panel";
import { useTerminalScopeStore } from "@/lib/services/terminal/store";

export function createProjectTerminalPanelState(): TerminalPanelState {
  return createEmptyTerminalPanel();
}

function getEarliestGroupSlotOrder(
  group: TerminalPanelState["groups"][number],
  slotOrder: Map<string, number>,
): number {
  let earliestOrder = Number.POSITIVE_INFINITY;
  for (const child of group.children) {
    earliestOrder = Math.min(earliestOrder, slotOrder.get(child) ?? Number.POSITIVE_INFINITY);
  }
  return earliestOrder;
}

export function reconcileProjectTerminalPanelState(
  panel: TerminalPanelState | null | undefined,
  slotIds: Iterable<string>,
): TerminalPanelState {
  const slotIdArray = Array.from(slotIds);
  const liveSlotIds = new Set(slotIdArray);
  let terminalPanel = panel ?? createEmptyTerminalPanel();

  for (const slotId of liveSlotIds) {
    if (!terminalPanelContainsSlot(terminalPanel, slotId)) {
      terminalPanel = addTerminalGroup(terminalPanel, slotId, {
        activate: terminalPanel.groups.length === 0,
      });
    }
  }

  for (const group of terminalPanel.groups) {
    for (const child of group.children) {
      if (!liveSlotIds.has(child)) {
        terminalPanel = removeTerminalFromPanel(terminalPanel, child);
      }
    }
  }

  const slotOrder = new Map(slotIdArray.map((slotId, index) => [slotId, index]));
  const activeGroupId = terminalPanel.groups[terminalPanel.activeGroupIndex]?.id ?? null;
  const groups = [...terminalPanel.groups].sort((left, right) => {
    return getEarliestGroupSlotOrder(left, slotOrder) - getEarliestGroupSlotOrder(right, slotOrder);
  });
  const activeGroupIndex =
    activeGroupId == null
      ? 0
      : Math.max(
          0,
          groups.findIndex((group) => group.id === activeGroupId),
        );

  return {
    ...terminalPanel,
    groups,
    activeGroupIndex,
  };
}

function updatePanel(
  scopeId: string,
  updater: (panel: TerminalPanelState) => TerminalPanelState,
): void {
  if (!isProjectTerminalKey(scopeId)) return;
  const store = useTerminalScopeStore.getState();
  const scope = store.byScopeId[scopeId];
  const panel = scope?.terminalPanel ?? createEmptyTerminalPanel();
  store.setTerminalPanel(scopeId, updater(panel));
}

export function addProjectTerminalGroup(scopeId: string, slotId: string, index?: number): void {
  updatePanel(scopeId, (panel) =>
    addTerminalGroup(panel, slotId, index === undefined ? {} : { index }),
  );
}

export function splitProjectTerminalGroup(
  scopeId: string,
  groupId: string,
  slotId: string,
): void {
  updatePanel(scopeId, (panel) => addTerminalToGroup(panel, groupId, slotId));
}

export function closeProjectTerminal(scopeId: string, slotId: string): void {
  updatePanel(scopeId, (panel) => removeTerminalFromPanel(panel, slotId));
}

export function selectProjectTerminalGroup(
  scopeId: string,
  groupId: string,
  slotId?: string | null,
): void {
  updatePanel(scopeId, (panel) => setActiveTerminalGroup(panel, groupId, slotId));
}

export function focusProjectTerminal(scopeId: string, slotId: string | null): void {
  updatePanel(scopeId, (panel) => setActiveTerminalSlot(panel, slotId));
}

export function setProjectTerminalPanelVisible(scopeId: string, visible: boolean): void {
  updatePanel(scopeId, (panel) => setTerminalPanelVisible(panel, visible));
}

export function reorderProjectTerminalGroups(
  scopeId: string,
  fromIndex: number,
  toIndex: number,
): void {
  updatePanel(scopeId, (panel) => reorderTerminalGroups(panel, fromIndex, toIndex));
}

export function reorderProjectTerminalGroupChildren(
  scopeId: string,
  groupId: string,
  fromIndex: number,
  toIndex: number,
): void {
  updatePanel(scopeId, (panel) =>
    reorderTerminalGroupChildren(panel, groupId, fromIndex, toIndex),
  );
}

export function moveProjectTerminalToGroup(
  scopeId: string,
  slotId: string,
  targetGroupId: string,
  index?: number,
): void {
  updatePanel(scopeId, (panel) =>
    moveTerminalToGroup(panel, slotId, targetGroupId, index === undefined ? {} : { index }),
  );
}

export function moveProjectTerminalToNewGroup(
  scopeId: string,
  slotId: string,
  index: number,
): void {
  updatePanel(scopeId, (panel) => moveTerminalToNewGroup(panel, slotId, index));
}
