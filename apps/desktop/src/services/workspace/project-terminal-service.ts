import type { WritableDraft } from "immer";
import type { WorkspaceRuntimeState } from "@/lib/shared/types";
import {
  addProjectTerminalGroupInRuntime,
  closeProjectTerminalInRuntime,
  focusProjectTerminalInRuntime,
  moveProjectTerminalToGroupInRuntime,
  moveProjectTerminalToNewGroupInRuntime,
  reorderProjectTerminalGroupChildrenInRuntime,
  reorderProjectTerminalGroupsInRuntime,
  selectProjectTerminalGroupInRuntime,
  setProjectTerminalPanelVisibleInRuntime,
  splitProjectTerminalGroupInRuntime,
} from "@/services/terminal/project-terminal-panel-model";

// ─── context ──────────────────────────────────────────────────────────────────

export type ProjectTerminalServiceContext = {
  mutateAndRefreshTerminal: (
    workspaceId: string,
    fn: (runtime: WritableDraft<WorkspaceRuntimeState>) => void,
  ) => void;
};

// ─── factory ─────────────────────────────────────────────────────────────────

export function createProjectTerminalService(ctx: ProjectTerminalServiceContext) {
  const { mutateAndRefreshTerminal } = ctx;

  return {
    addProjectTerminalGroup(workspaceId: string, slotId: string, index?: number): void {
      mutateAndRefreshTerminal(workspaceId, (r) =>
        addProjectTerminalGroupInRuntime(r, slotId, index),
      );
    },

    splitProjectTerminalGroup(workspaceId: string, groupId: string, slotId: string): void {
      mutateAndRefreshTerminal(workspaceId, (r) =>
        splitProjectTerminalGroupInRuntime(r, groupId, slotId),
      );
    },

    closeProjectTerminal(workspaceId: string, slotId: string): void {
      mutateAndRefreshTerminal(workspaceId, (r) =>
        closeProjectTerminalInRuntime(r, slotId),
      );
    },

    selectProjectTerminalGroup(
      workspaceId: string,
      groupId: string,
      slotId?: string | null,
    ): void {
      mutateAndRefreshTerminal(workspaceId, (r) =>
        selectProjectTerminalGroupInRuntime(r, groupId, slotId),
      );
    },

    focusProjectTerminal(workspaceId: string, slotId: string | null): void {
      mutateAndRefreshTerminal(workspaceId, (r) =>
        focusProjectTerminalInRuntime(r, slotId),
      );
    },

    setProjectTerminalPanelVisible(workspaceId: string, visible: boolean): void {
      mutateAndRefreshTerminal(workspaceId, (r) =>
        setProjectTerminalPanelVisibleInRuntime(r, visible),
      );
    },

    reorderProjectTerminalGroups(
      workspaceId: string,
      fromIndex: number,
      toIndex: number,
    ): void {
      mutateAndRefreshTerminal(workspaceId, (r) =>
        reorderProjectTerminalGroupsInRuntime(r, fromIndex, toIndex),
      );
    },

    reorderProjectTerminalGroupChildren(
      workspaceId: string,
      groupId: string,
      fromIndex: number,
      toIndex: number,
    ): void {
      mutateAndRefreshTerminal(workspaceId, (r) =>
        reorderProjectTerminalGroupChildrenInRuntime(r, groupId, fromIndex, toIndex),
      );
    },

    moveProjectTerminalToGroup(
      workspaceId: string,
      slotId: string,
      targetGroupId: string,
      index?: number,
    ): void {
      mutateAndRefreshTerminal(workspaceId, (r) =>
        moveProjectTerminalToGroupInRuntime(r, slotId, targetGroupId, index),
      );
    },

    moveProjectTerminalToNewGroup(workspaceId: string, slotId: string, index: number): void {
      mutateAndRefreshTerminal(workspaceId, (r) =>
        moveProjectTerminalToNewGroupInRuntime(r, slotId, index),
      );
    },
  };
}

export type ProjectTerminalService = ReturnType<typeof createProjectTerminalService>;
