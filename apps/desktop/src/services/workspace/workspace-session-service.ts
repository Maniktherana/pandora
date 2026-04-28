import type { DiffSource } from "@/lib/shared/types";
import {
  addDiffTabToWorkspaceRuntime,
  addEditorTabToWorkspaceRuntime,
  addEditorTabToPaneInWorkspaceRuntime,
  addTerminalTabToWorkspaceRuntime,
  splitPaneWithEditorInWorkspaceRuntime,
} from "@/services/workspace/workspace-tab-model";
import {
  addTabToPaneInWorkspaceRuntime,
  cycleRuntimeTabs,
  moveTabInWorkspaceRuntime,
  openReviewTabInWorkspaceRuntime,
  removeTabFromWorkspaceRuntime,
  reorderTabInWorkspaceRuntime,
  selectTabInPaneInWorkspaceRuntime,
  setFocusedPaneInWorkspaceRuntime,
  splitPaneInWorkspaceRuntime,
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

type UpdateWorkspaceRuntimeFn = (
  workspaceId: string,
  mutate: (runtime: Parameters<typeof setFocusedPaneInWorkspaceRuntime>[0]) => boolean | void,
) => void;

type MutateRuntimeStateFn = <T>(
  workspaceId: string,
  mutate: (runtime: Parameters<typeof cycleRuntimeTabs>[0]) => T,
) => T;

export function createWorkspaceSessionService(
  workspaceId: string,
  updateWorkspaceRuntime: UpdateWorkspaceRuntimeFn,
  mutateRuntimeState: MutateRuntimeStateFn,
): WorkspaceSessionService {
  return {
    workspaceId,
    commands: {
      focusPane: (paneId) =>
        updateWorkspaceRuntime(workspaceId, (runtime) =>
          setFocusedPaneInWorkspaceRuntime(runtime, paneId),
        ),
      addTabToPane: (targetPaneID, sourcePaneID, sourceTabIndex) =>
        updateWorkspaceRuntime(workspaceId, (runtime) =>
          addTabToPaneInWorkspaceRuntime(runtime, targetPaneID, sourcePaneID, sourceTabIndex),
        ),
      removeTab: (paneID, tabIndex) =>
        updateWorkspaceRuntime(workspaceId, (runtime) =>
          removeTabFromWorkspaceRuntime(runtime, paneID, tabIndex),
        ),
      selectTabInPane: (paneID, index) =>
        updateWorkspaceRuntime(workspaceId, (runtime) =>
          selectTabInPaneInWorkspaceRuntime(runtime, paneID, index),
        ),
      splitPane: (targetPaneID, sourcePaneID, sourceTabIndex, axis, position) =>
        updateWorkspaceRuntime(workspaceId, (runtime) =>
          splitPaneInWorkspaceRuntime(
            runtime,
            targetPaneID,
            sourcePaneID,
            sourceTabIndex,
            axis,
            position,
          ),
        ),
      moveTab: (fromPaneID, toPaneID, fromIndex, toIndex) =>
        updateWorkspaceRuntime(workspaceId, (runtime) =>
          moveTabInWorkspaceRuntime(runtime, fromPaneID, toPaneID, fromIndex, toIndex),
        ),
      reorderTab: (paneID, fromIndex, toIndex) =>
        updateWorkspaceRuntime(workspaceId, (runtime) =>
          reorderTabInWorkspaceRuntime(runtime, paneID, fromIndex, toIndex),
        ),
      closeTab: (paneID, tabIndex) =>
        updateWorkspaceRuntime(workspaceId, (runtime) =>
          removeTabFromWorkspaceRuntime(runtime, paneID, tabIndex),
        ),
      addEditorTab: (relativePath) =>
        updateWorkspaceRuntime(workspaceId, (runtime) =>
          addEditorTabToWorkspaceRuntime(runtime, relativePath),
        ),
      addEditorTabToPane: (paneID, relativePath, insertIndex) =>
        updateWorkspaceRuntime(workspaceId, (runtime) =>
          addEditorTabToPaneInWorkspaceRuntime(runtime, paneID, relativePath, insertIndex),
        ),
      splitPaneWithEditor: (targetPaneID, relativePath, axis, position) =>
        updateWorkspaceRuntime(workspaceId, (runtime) =>
          splitPaneWithEditorInWorkspaceRuntime(runtime, targetPaneID, relativePath, axis, position),
        ),
      addDiffTab: (relativePath, source) =>
        updateWorkspaceRuntime(workspaceId, (runtime) =>
          addDiffTabToWorkspaceRuntime(runtime, relativePath, source),
        ),
      addReviewTab: () =>
        updateWorkspaceRuntime(workspaceId, (runtime) =>
          openReviewTabInWorkspaceRuntime(runtime),
        ),
      addTerminalTab: (slotId) =>
        updateWorkspaceRuntime(workspaceId, (runtime) =>
          addTerminalTabToWorkspaceRuntime(runtime, slotId),
        ),
      seedTerminal: () => {},
      cycleTab: (direction) =>
        mutateRuntimeState(workspaceId, (runtime) => cycleRuntimeTabs(runtime, direction)),
    },
  };
}

const workspaceSessions = new Map<string, WorkspaceSessionService>();

export function getWorkspaceSession(
  workspaceId: string,
  updateWorkspaceRuntime: UpdateWorkspaceRuntimeFn,
  mutateRuntimeState: MutateRuntimeStateFn,
): WorkspaceSessionService {
  let session = workspaceSessions.get(workspaceId);
  if (!session) {
    session = createWorkspaceSessionService(workspaceId, updateWorkspaceRuntime, mutateRuntimeState);
    workspaceSessions.set(workspaceId, session);
  }
  return session;
}

export function clearWorkspaceSessions(): void {
  workspaceSessions.clear();
}
