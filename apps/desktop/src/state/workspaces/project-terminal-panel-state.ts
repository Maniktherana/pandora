import type { TerminalPanelState, WorkspaceRuntimeState } from "@/lib/shared/types";
import { isProjectRuntimeKey } from "@/lib/runtime/runtime-keys";
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
} from "@/lib/terminal/bottom-terminal-panel";

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

function updateProjectTerminalPanel(
  runtime: WorkspaceRuntimeState,
  updater: (panel: TerminalPanelState) => TerminalPanelState,
) {
  if (!isProjectRuntimeKey(runtime.workspaceId)) return;
  runtime.terminalPanel = updater(runtime.terminalPanel ?? createEmptyTerminalPanel());
}

export function addProjectTerminalGroupInRuntime(
  runtime: WorkspaceRuntimeState,
  slotId: string,
  index?: number,
) {
  updateProjectTerminalPanel(runtime, (panel) => addTerminalGroup(panel, slotId, { index }));
}

export function splitProjectTerminalGroupInRuntime(
  runtime: WorkspaceRuntimeState,
  groupId: string,
  slotId: string,
) {
  updateProjectTerminalPanel(runtime, (panel) => addTerminalToGroup(panel, groupId, slotId));
}

export function closeProjectTerminalInRuntime(runtime: WorkspaceRuntimeState, slotId: string) {
  updateProjectTerminalPanel(runtime, (panel) => removeTerminalFromPanel(panel, slotId));
}

export function selectProjectTerminalGroupInRuntime(
  runtime: WorkspaceRuntimeState,
  groupId: string,
  slotId?: string | null,
) {
  updateProjectTerminalPanel(runtime, (panel) => setActiveTerminalGroup(panel, groupId, slotId));
}

export function focusProjectTerminalInRuntime(
  runtime: WorkspaceRuntimeState,
  slotId: string | null,
) {
  updateProjectTerminalPanel(runtime, (panel) => setActiveTerminalSlot(panel, slotId));
}

export function setProjectTerminalPanelVisibleInRuntime(
  runtime: WorkspaceRuntimeState,
  visible: boolean,
) {
  updateProjectTerminalPanel(runtime, (panel) => setTerminalPanelVisible(panel, visible));
}

export function reorderProjectTerminalGroupsInRuntime(
  runtime: WorkspaceRuntimeState,
  fromIndex: number,
  toIndex: number,
) {
  updateProjectTerminalPanel(runtime, (panel) => reorderTerminalGroups(panel, fromIndex, toIndex));
}

export function reorderProjectTerminalGroupChildrenInRuntime(
  runtime: WorkspaceRuntimeState,
  groupId: string,
  fromIndex: number,
  toIndex: number,
) {
  updateProjectTerminalPanel(runtime, (panel) =>
    reorderTerminalGroupChildren(panel, groupId, fromIndex, toIndex),
  );
}

export function moveProjectTerminalToGroupInRuntime(
  runtime: WorkspaceRuntimeState,
  slotId: string,
  targetGroupId: string,
  index?: number,
) {
  updateProjectTerminalPanel(runtime, (panel) =>
    moveTerminalToGroup(panel, slotId, targetGroupId, { index }),
  );
}

export function moveProjectTerminalToNewGroupInRuntime(
  runtime: WorkspaceRuntimeState,
  slotId: string,
  index: number,
) {
  updateProjectTerminalPanel(runtime, (panel) => moveTerminalToNewGroup(panel, slotId, index));
}
