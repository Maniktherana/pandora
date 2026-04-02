import type { TerminalPanelState } from "@/lib/shared/types";
import { isProjectRuntimeKey } from "@/lib/runtime/runtime-keys";
import { getTerminalDaemonClient } from "@/lib/terminal/terminal-runtime";
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
} from "@/lib/terminal/bottom-terminal-panel";
import type { ImmerSet, Get } from "./types";

function updateProjectTerminalPanel(
  set: ImmerSet,
  workspaceId: string,
  updater: (panel: TerminalPanelState) => TerminalPanelState
) {
  if (!isProjectRuntimeKey(workspaceId)) return;
  set((s) => {
    const runtime = s.runtimes[workspaceId];
    if (!runtime) return;
    runtime.terminalPanel = updater(
      runtime.terminalPanel ?? createEmptyTerminalPanel()
    ) as WritableDraft<TerminalPanelState>;
  });
}

export function createTerminalPanelActions(set: ImmerSet, get: Get) {
  return {
    addProjectTerminalGroup: (workspaceId: string, slotId: string, index?: number) => {
      updateProjectTerminalPanel(set, workspaceId, (panel) =>
        addTerminalGroup(panel, slotId, { index })
      );
    },

    splitProjectTerminalGroup: (workspaceId: string, groupId: string, slotId: string) => {
      updateProjectTerminalPanel(set, workspaceId, (panel) =>
        addTerminalToGroup(panel, groupId, slotId)
      );
    },

    closeProjectTerminal: (workspaceId: string, slotId: string) => {
      if (!isProjectRuntimeKey(workspaceId)) return;
      getTerminalDaemonClient()?.send(workspaceId, { type: "remove_slot", slotID: slotId });
      updateProjectTerminalPanel(set, workspaceId, (panel) =>
        removeTerminalFromPanel(panel, slotId)
      );
    },

    selectProjectTerminalGroup: (workspaceId: string, groupId: string, slotId?: string | null) => {
      updateProjectTerminalPanel(set, workspaceId, (panel) =>
        setActiveTerminalGroup(panel, groupId, slotId)
      );
    },

    focusProjectTerminal: (workspaceId: string, slotId: string | null) => {
      updateProjectTerminalPanel(set, workspaceId, (panel) =>
        setActiveTerminalSlot(panel, slotId)
      );
    },

    setProjectTerminalPanelVisible: (workspaceId: string, visible: boolean) => {
      updateProjectTerminalPanel(set, workspaceId, (panel) =>
        setTerminalPanelVisible(panel, visible)
      );
    },

    reorderProjectTerminalGroups: (workspaceId: string, fromIndex: number, toIndex: number) => {
      updateProjectTerminalPanel(set, workspaceId, (panel) =>
        reorderTerminalGroups(panel, fromIndex, toIndex)
      );
    },

    reorderProjectTerminalGroupChildren: (
      workspaceId: string,
      groupId: string,
      fromIndex: number,
      toIndex: number
    ) => {
      updateProjectTerminalPanel(set, workspaceId, (panel) =>
        reorderTerminalGroupChildren(panel, groupId, fromIndex, toIndex)
      );
    },

    moveProjectTerminalToGroup: (
      workspaceId: string,
      slotId: string,
      targetGroupId: string,
      index?: number
    ) => {
      updateProjectTerminalPanel(set, workspaceId, (panel) =>
        moveTerminalToGroup(panel, slotId, targetGroupId, { index })
      );
    },

    moveProjectTerminalToNewGroup: (workspaceId: string, slotId: string, index: number) => {
      updateProjectTerminalPanel(set, workspaceId, (panel) =>
        moveTerminalToNewGroup(panel, slotId, index)
      );
    },
  };
}
