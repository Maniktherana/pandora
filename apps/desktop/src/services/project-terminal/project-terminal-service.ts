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
} from "@/services/terminal/project-terminal-panel-model";

export type ProjectTerminalServiceContext = {
  onMutated: (scopeId: string) => void;
};

export function createProjectTerminalService(ctx: ProjectTerminalServiceContext) {
  const { onMutated } = ctx;

  return {
    addProjectTerminalGroup(scopeId: string, slotId: string, index?: number): void {
      addProjectTerminalGroup(scopeId, slotId, index);
      onMutated(scopeId);
    },

    splitProjectTerminalGroup(scopeId: string, groupId: string, slotId: string): void {
      splitProjectTerminalGroup(scopeId, groupId, slotId);
      onMutated(scopeId);
    },

    closeProjectTerminal(scopeId: string, slotId: string): void {
      closeProjectTerminal(scopeId, slotId);
      onMutated(scopeId);
    },

    selectProjectTerminalGroup(scopeId: string, groupId: string, slotId?: string | null): void {
      selectProjectTerminalGroup(scopeId, groupId, slotId);
      onMutated(scopeId);
    },

    focusProjectTerminal(scopeId: string, slotId: string | null): void {
      focusProjectTerminal(scopeId, slotId);
      onMutated(scopeId);
    },

    setProjectTerminalPanelVisible(scopeId: string, visible: boolean): void {
      setProjectTerminalPanelVisible(scopeId, visible);
      onMutated(scopeId);
    },

    reorderProjectTerminalGroups(scopeId: string, fromIndex: number, toIndex: number): void {
      reorderProjectTerminalGroups(scopeId, fromIndex, toIndex);
      onMutated(scopeId);
    },

    reorderProjectTerminalGroupChildren(
      scopeId: string,
      groupId: string,
      fromIndex: number,
      toIndex: number,
    ): void {
      reorderProjectTerminalGroupChildren(scopeId, groupId, fromIndex, toIndex);
      onMutated(scopeId);
    },

    moveProjectTerminalToGroup(
      scopeId: string,
      slotId: string,
      targetGroupId: string,
      index?: number,
    ): void {
      moveProjectTerminalToGroup(scopeId, slotId, targetGroupId, index);
      onMutated(scopeId);
    },

    moveProjectTerminalToNewGroup(scopeId: string, slotId: string, index: number): void {
      moveProjectTerminalToNewGroup(scopeId, slotId, index);
      onMutated(scopeId);
    },
  };
}

export type ProjectTerminalService = ReturnType<typeof createProjectTerminalService>;
