import { useMemo } from "react";
import { terminalCommandService } from "@/services/terminal/terminal-command-service";
import { desktopWorkspaceService } from "@/services/workspace/desktop-workspace-service";

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
        desktopWorkspaceService.selectProjectTerminalGroup(workspaceId, groupId, slotId),
      focusProjectTerminal: (workspaceId: string, slotId: string | null) =>
        desktopWorkspaceService.focusProjectTerminal(workspaceId, slotId),
      setProjectTerminalPanelVisible: (workspaceId: string, visible: boolean) =>
        desktopWorkspaceService.setProjectTerminalPanelVisible(workspaceId, visible),
      reorderProjectTerminalGroups: (workspaceId: string, fromIndex: number, toIndex: number) =>
        desktopWorkspaceService.reorderProjectTerminalGroups(workspaceId, fromIndex, toIndex),
      reorderProjectTerminalGroupChildren: (
        workspaceId: string,
        groupId: string,
        fromIndex: number,
        toIndex: number,
      ) =>
        desktopWorkspaceService.reorderProjectTerminalGroupChildren(
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
        desktopWorkspaceService.moveProjectTerminalToGroup(
          workspaceId,
          slotId,
          targetGroupId,
          index,
        ),
      moveProjectTerminalToNewGroup: (workspaceId: string, slotId: string, index: number) =>
        desktopWorkspaceService.moveProjectTerminalToNewGroup(workspaceId, slotId, index),
    }),
    [],
  );
}
