import {
  addProjectTerminalGroup,
  closeProjectTerminal,
  focusProjectTerminal,
  moveProjectTerminalToGroup,
  moveProjectTerminalToNewGroup,
  reorderProjectTerminalGroupChildren,
  reorderProjectTerminalGroups,
  selectProjectTerminalGroup,
  setProjectTerminalPanelVisible,
  splitProjectTerminalGroup,
} from "@/lib/services/terminal/project-panel";
import { useTerminalScopeStore } from "@/lib/services/terminal/store";
import { persistProjectTerminalPanel } from "@/lib/services/preferences/project-terminal";
import { terminalStartup } from "@/lib/services/workspace/startup";

function afterProjectTerminalMutation(scopeId: string): void {
  const panel = useTerminalScopeStore.getState().byScopeId[scopeId]?.terminalPanel ?? null;
  persistProjectTerminalPanel(scopeId, panel).catch((error) =>
    console.warn("Failed to persist project terminal panel:", error),
  );
  terminalStartup
    .refreshScopeTerminalStartup(scopeId, { rebuildHiddenQueue: true })
    .catch((error) => console.warn("Failed to refresh scope terminal startup:", error));
}

export const projectTerminalActions = {
  addProjectTerminalGroup(scopeId: string, slotId: string, index?: number): void {
    addProjectTerminalGroup(scopeId, slotId, index);
    afterProjectTerminalMutation(scopeId);
  },

  splitProjectTerminalGroup(scopeId: string, groupId: string, slotId: string): void {
    splitProjectTerminalGroup(scopeId, groupId, slotId);
    afterProjectTerminalMutation(scopeId);
  },

  closeProjectTerminal(scopeId: string, slotId: string): void {
    closeProjectTerminal(scopeId, slotId);
    afterProjectTerminalMutation(scopeId);
  },

  selectProjectTerminalGroup(scopeId: string, groupId: string, slotId?: string | null): void {
    selectProjectTerminalGroup(scopeId, groupId, slotId);
    afterProjectTerminalMutation(scopeId);
  },

  focusProjectTerminal(scopeId: string, slotId: string | null): void {
    focusProjectTerminal(scopeId, slotId);
    afterProjectTerminalMutation(scopeId);
  },

  setProjectTerminalPanelVisible(scopeId: string, visible: boolean): void {
    setProjectTerminalPanelVisible(scopeId, visible);
    afterProjectTerminalMutation(scopeId);
  },

  reorderProjectTerminalGroups(scopeId: string, fromIndex: number, toIndex: number): void {
    reorderProjectTerminalGroups(scopeId, fromIndex, toIndex);
    afterProjectTerminalMutation(scopeId);
  },

  reorderProjectTerminalGroupChildren(
    scopeId: string,
    groupId: string,
    fromIndex: number,
    toIndex: number,
  ): void {
    reorderProjectTerminalGroupChildren(scopeId, groupId, fromIndex, toIndex);
    afterProjectTerminalMutation(scopeId);
  },

  moveProjectTerminalToGroup(
    scopeId: string,
    slotId: string,
    targetGroupId: string,
    index?: number,
  ): void {
    moveProjectTerminalToGroup(scopeId, slotId, targetGroupId, index);
    afterProjectTerminalMutation(scopeId);
  },

  moveProjectTerminalToNewGroup(scopeId: string, slotId: string, index: number): void {
    moveProjectTerminalToNewGroup(scopeId, slotId, index);
    afterProjectTerminalMutation(scopeId);
  },
};
