import { Effect } from "effect";
import { useMemo } from "react";
import { TerminalCommandService } from "@/services/terminal/terminal-command-service";
import { DesktopWorkspaceService } from "@/services/workspace/desktop-workspace-service";
import { useDesktopEffectRunner } from "./use-bootstrap-desktop";

export function useTerminalActions() {
  const { run, runPromise } = useDesktopEffectRunner();

  return useMemo(
    () => ({
      newTerminal() {
        run(Effect.flatMap(TerminalCommandService, (service) => service.newTerminal()));
      },
      closeFocusedTab() {
        run(Effect.flatMap(TerminalCommandService, (service) => service.closeFocusedTab()));
      },
      toggleBottomPanel(currentlyOpen: boolean) {
        run(
          Effect.flatMap(TerminalCommandService, (service) =>
            service.toggleBottomPanel(currentlyOpen)
          )
        );
      },
      createWorkspaceTerminal(runtimeId: string) {
        run(
          Effect.flatMap(TerminalCommandService, (service) =>
            service.createWorkspaceTerminal(runtimeId)
          )
        );
      },
      closeTerminalSlot(runtimeId: string, slotId: string) {
        run(
          Effect.flatMap(TerminalCommandService, (service) =>
            service.closeTerminalSlot(runtimeId, slotId)
          )
        );
      },
      async sendInput(runtimeId: string, sessionId: string, text: string) {
        await runPromise(
          Effect.flatMap(TerminalCommandService, (service) =>
            service.sendInput(runtimeId, sessionId, text)
          )
        );
      },
    }),
    [run, runPromise]
  );
}

export function useProjectTerminalActions() {
  const { run } = useDesktopEffectRunner();

  return useMemo(
    () => ({
      createProjectTerminal: (workspaceId: string, index?: number) =>
        run(
          Effect.flatMap(TerminalCommandService, (service) =>
            service.createProjectTerminal(workspaceId, index)
          )
        ),
      splitProjectTerminalGroup: (workspaceId: string, groupId: string) =>
        run(
          Effect.flatMap(TerminalCommandService, (service) =>
            service.splitProjectTerminalGroup(workspaceId, groupId)
          )
        ),
      closeProjectTerminal: (workspaceId: string, slotId: string) =>
        run(
          Effect.flatMap(TerminalCommandService, (service) =>
            service.closeTerminalSlot(workspaceId, slotId)
          )
        ),
      renameTerminal: (workspaceId: string, slotId: string, name: string) =>
        run(
          Effect.flatMap(TerminalCommandService, (service) =>
            service.renameTerminal(workspaceId, slotId, name)
          )
        ),
      selectProjectTerminalGroup: (workspaceId: string, groupId: string, slotId?: string | null) =>
        run(
          Effect.flatMap(DesktopWorkspaceService, (service) =>
            service.selectProjectTerminalGroup(workspaceId, groupId, slotId)
          )
        ),
      focusProjectTerminal: (workspaceId: string, slotId: string | null) =>
        run(
          Effect.flatMap(DesktopWorkspaceService, (service) =>
            service.focusProjectTerminal(workspaceId, slotId)
          )
        ),
      setProjectTerminalPanelVisible: (workspaceId: string, visible: boolean) =>
        run(
          Effect.flatMap(DesktopWorkspaceService, (service) =>
            service.setProjectTerminalPanelVisible(workspaceId, visible)
          )
        ),
      reorderProjectTerminalGroups: (workspaceId: string, fromIndex: number, toIndex: number) =>
        run(
          Effect.flatMap(DesktopWorkspaceService, (service) =>
            service.reorderProjectTerminalGroups(workspaceId, fromIndex, toIndex)
          )
        ),
      reorderProjectTerminalGroupChildren: (
        workspaceId: string,
        groupId: string,
        fromIndex: number,
        toIndex: number
      ) =>
        run(
          Effect.flatMap(DesktopWorkspaceService, (service) =>
            service.reorderProjectTerminalGroupChildren(workspaceId, groupId, fromIndex, toIndex)
          )
        ),
      moveProjectTerminalToGroup: (
        workspaceId: string,
        slotId: string,
        targetGroupId: string,
        index?: number
      ) =>
        run(
          Effect.flatMap(DesktopWorkspaceService, (service) =>
            service.moveProjectTerminalToGroup(workspaceId, slotId, targetGroupId, index)
          )
        ),
      moveProjectTerminalToNewGroup: (workspaceId: string, slotId: string, index: number) =>
        run(
          Effect.flatMap(DesktopWorkspaceService, (service) =>
            service.moveProjectTerminalToNewGroup(workspaceId, slotId, index)
          )
        ),
    }),
    [run]
  );
}
