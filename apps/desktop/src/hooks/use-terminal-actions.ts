import { useMemo } from "react";
import { terminalCommandService } from "@/lib/services/terminal/commands";
import { projectTerminalActions } from "@/lib/services/terminal/project";

export function useTerminalActions() {
  return useMemo(
    () => ({
      newTerminal() {
        void terminalCommandService.newTerminal().catch(console.error);
      },
      closeFocusedTab() {
        void terminalCommandService.closeFocusedTab().catch(console.error);
      },
      toggleBottomPanel(currentlyOpen: boolean) {
        void terminalCommandService.toggleBottomPanel(currentlyOpen).catch(console.error);
      },
      createWorkspaceTerminal(scopeId: string) {
        void terminalCommandService.createWorkspaceTerminal(scopeId).catch(console.error);
      },
      closeTerminalSlot(scopeId: string, slotId: string) {
        void terminalCommandService.closeTerminalSlot(scopeId, slotId).catch(console.error);
      },
      async sendInput(scopeId: string, sessionId: string, text: string) {
        await terminalCommandService.sendInput(scopeId, sessionId, text);
      },
    }),
    [],
  );
}

export function useProjectTerminalActions() {
  return useMemo(
    () => ({
      createProjectTerminal: (workspaceId: string, index?: number) =>
        void terminalCommandService.createProjectTerminal(workspaceId, index).catch(console.error),
      splitProjectTerminalGroup: (workspaceId: string, groupId: string) =>
        void terminalCommandService
          .splitProjectTerminalGroup(workspaceId, groupId)
          .catch(console.error),
      closeProjectTerminal: (workspaceId: string, slotId: string) =>
        void terminalCommandService.closeTerminalSlot(workspaceId, slotId).catch(console.error),
      renameTerminal: (workspaceId: string, slotId: string, name: string) =>
        void terminalCommandService
          .renameTerminal(workspaceId, slotId, name)
          .catch(console.error),
      selectProjectTerminalGroup: (workspaceId: string, groupId: string, slotId?: string | null) =>
        projectTerminalActions.selectProjectTerminalGroup(workspaceId, groupId, slotId),
      focusProjectTerminal: (workspaceId: string, slotId: string | null) =>
        projectTerminalActions.focusProjectTerminal(workspaceId, slotId),
      setProjectTerminalPanelVisible: (workspaceId: string, visible: boolean) =>
        projectTerminalActions.setProjectTerminalPanelVisible(workspaceId, visible),
      reorderProjectTerminalGroups: (workspaceId: string, fromIndex: number, toIndex: number) =>
        projectTerminalActions.reorderProjectTerminalGroups(workspaceId, fromIndex, toIndex),
      reorderProjectTerminalGroupChildren: (
        workspaceId: string,
        groupId: string,
        fromIndex: number,
        toIndex: number,
      ) =>
        projectTerminalActions.reorderProjectTerminalGroupChildren(
          workspaceId,
          groupId,
          fromIndex,
          toIndex,
        ),
      moveProjectTerminalToGroup: (
        workspaceId: string,
        slotId: string,
        targetGroupId: string,
        index?: number,
      ) =>
        projectTerminalActions.moveProjectTerminalToGroup(
          workspaceId,
          slotId,
          targetGroupId,
          index,
        ),
      moveProjectTerminalToNewGroup: (workspaceId: string, slotId: string, index: number) =>
        projectTerminalActions.moveProjectTerminalToNewGroup(workspaceId, slotId, index),
    }),
    [],
  );
}
