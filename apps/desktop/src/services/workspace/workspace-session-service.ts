import type { DiffSource } from "@/lib/shared/types";
import {
  addDiffTabToWorkspaceLayout,
  addEditorTabToWorkspaceLayout,
  addEditorTabToPaneInWorkspaceLayout,
  addTerminalTabToWorkspaceLayout,
  splitPaneWithEditorInWorkspaceLayout,
} from "@/services/workspace/workspace-tab-model";
import {
  addTabToPaneInWorkspaceLayout,
  cycleWorkspaceTabs,
  moveTabInWorkspaceLayout,
  openReviewTabInWorkspaceLayout,
  removeTabFromWorkspaceLayout,
  reorderTabInWorkspaceLayout,
  selectTabInPaneInWorkspaceLayout,
  setFocusedPaneInWorkspaceLayout,
  splitPaneInWorkspaceLayout,
} from "@/services/workspace/workspace-layout-model";

export interface WorkspaceSessionService {
  readonly workspaceId: string;
  readonly commands: {
    readonly focusPane: (paneId: string) => void;
    readonly addTabToPane: (
      targetPaneID: string,
      sourcePaneID: string,
      sourceTabIndex: number,
    ) => void;
    readonly removeTab: (paneID: string, tabIndex: number) => void;
    readonly selectTabInPane: (paneID: string, index: number) => void;
    readonly splitPane: (
      targetPaneID: string,
      sourcePaneID: string,
      sourceTabIndex: number,
      axis: "horizontal" | "vertical",
      position: "before" | "after",
    ) => void;
    readonly moveTab: (
      fromPaneID: string,
      toPaneID: string,
      fromIndex: number,
      toIndex: number,
    ) => void;
    readonly reorderTab: (paneID: string, fromIndex: number, toIndex: number) => void;
    readonly closeTab: (paneID: string, tabIndex: number) => void;
    readonly addEditorTab: (relativePath: string) => void;
    readonly addEditorTabToPane: (
      paneID: string,
      relativePath: string,
      insertIndex?: number,
    ) => void;
    readonly splitPaneWithEditor: (
      targetPaneID: string,
      relativePath: string,
      axis: "horizontal" | "vertical",
      position: "before" | "after",
    ) => void;
    readonly addDiffTab: (relativePath: string, source: DiffSource) => void;
    readonly addReviewTab: () => void;
    readonly addTerminalTab: (slotId: string) => void;
    readonly seedTerminal: () => void;
    readonly cycleTab: (direction: -1 | 1) => void;
  };
}

type UpdateWorkspaceLayoutFn = (
  workspaceId: string,
  mutate: () => boolean | void,
) => void;

type MutateWorkspaceLayoutFn = <T>(workspaceId: string, mutate: () => T) => T;

export function createWorkspaceSessionService(
  workspaceId: string,
  updateWorkspaceLayout: UpdateWorkspaceLayoutFn,
  mutateWorkspaceLayout: MutateWorkspaceLayoutFn,
): WorkspaceSessionService {
  return {
    workspaceId,
    commands: {
      focusPane: (paneId) =>
        updateWorkspaceLayout(workspaceId, () => setFocusedPaneInWorkspaceLayout(workspaceId, paneId)),
      addTabToPane: (targetPaneID, sourcePaneID, sourceTabIndex) =>
        updateWorkspaceLayout(workspaceId, () =>
          addTabToPaneInWorkspaceLayout(workspaceId, targetPaneID, sourcePaneID, sourceTabIndex),
        ),
      removeTab: (paneID, tabIndex) =>
        updateWorkspaceLayout(workspaceId, () => removeTabFromWorkspaceLayout(workspaceId, paneID, tabIndex)),
      selectTabInPane: (paneID, index) =>
        updateWorkspaceLayout(workspaceId, () =>
          selectTabInPaneInWorkspaceLayout(workspaceId, paneID, index),
        ),
      splitPane: (targetPaneID, sourcePaneID, sourceTabIndex, axis, position) =>
        updateWorkspaceLayout(workspaceId, () =>
          splitPaneInWorkspaceLayout(
            workspaceId,
            targetPaneID,
            sourcePaneID,
            sourceTabIndex,
            axis,
            position,
          ),
        ),
      moveTab: (fromPaneID, toPaneID, fromIndex, toIndex) =>
        updateWorkspaceLayout(workspaceId, () =>
          moveTabInWorkspaceLayout(workspaceId, fromPaneID, toPaneID, fromIndex, toIndex),
        ),
      reorderTab: (paneID, fromIndex, toIndex) =>
        updateWorkspaceLayout(workspaceId, () =>
          reorderTabInWorkspaceLayout(workspaceId, paneID, fromIndex, toIndex),
        ),
      closeTab: (paneID, tabIndex) =>
        updateWorkspaceLayout(workspaceId, () => removeTabFromWorkspaceLayout(workspaceId, paneID, tabIndex)),
      addEditorTab: (relativePath) =>
        updateWorkspaceLayout(workspaceId, () => addEditorTabToWorkspaceLayout(workspaceId, relativePath)),
      addEditorTabToPane: (paneID, relativePath, insertIndex) =>
        updateWorkspaceLayout(workspaceId, () =>
          addEditorTabToPaneInWorkspaceLayout(workspaceId, paneID, relativePath, insertIndex),
        ),
      splitPaneWithEditor: (targetPaneID, relativePath, axis, position) =>
        updateWorkspaceLayout(workspaceId, () =>
          splitPaneWithEditorInWorkspaceLayout(
            workspaceId,
            targetPaneID,
            relativePath,
            axis,
            position,
          ),
        ),
      addDiffTab: (relativePath, source) =>
        updateWorkspaceLayout(workspaceId, () => addDiffTabToWorkspaceLayout(workspaceId, relativePath, source)),
      addReviewTab: () =>
        updateWorkspaceLayout(workspaceId, () => openReviewTabInWorkspaceLayout(workspaceId)),
      addTerminalTab: (slotId) =>
        updateWorkspaceLayout(workspaceId, () => addTerminalTabToWorkspaceLayout(workspaceId, slotId)),
      seedTerminal: () => {},
      cycleTab: (direction) =>
        mutateWorkspaceLayout(workspaceId, () => cycleWorkspaceTabs(workspaceId, direction)),
    },
  };
}

const workspaceSessions = new Map<string, WorkspaceSessionService>();

export function getWorkspaceSession(
  workspaceId: string,
  updateWorkspaceLayout: UpdateWorkspaceLayoutFn,
  mutateWorkspaceLayout: MutateWorkspaceLayoutFn,
): WorkspaceSessionService {
  let session = workspaceSessions.get(workspaceId);
  if (!session) {
    session = createWorkspaceSessionService(workspaceId, updateWorkspaceLayout, mutateWorkspaceLayout);
    workspaceSessions.set(workspaceId, session);
  }
  return session;
}

export function clearWorkspaceSessions(): void {
  workspaceSessions.clear();
}
