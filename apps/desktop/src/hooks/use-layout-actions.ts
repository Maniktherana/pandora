import { useMemo } from "react";
import { useSelectedWorkspaceId } from "@/hooks/use-navigation";
import { getWorkspaceSession } from "@/lib/services/layout/session";
import { useNavigationStore } from "@/lib/services/navigation/store";
import {
  mutateWorkspaceLayout,
  terminalStartup,
  updateWorkspaceLayout,
} from "@/lib/services/workspace/startup";

function layoutSession(workspaceId: string) {
  return getWorkspaceSession(workspaceId, updateWorkspaceLayout, mutateWorkspaceLayout);
}

export function useLayoutActions() {
  const selectedWorkspaceID = useSelectedWorkspaceId();

  return useMemo(
    () => ({
      cycleTab: (direction: -1 | 1) => {
        const nav = useNavigationStore.getState();
        const workspaceId = nav.layoutTargetScopeId ?? nav.selectedWorkspaceID;
        if (!workspaceId) return;
        layoutSession(workspaceId).commands.cycleTab(direction);
        terminalStartup
          .refreshScopeTerminalStartup(workspaceId, { rebuildHiddenQueue: true })
          .catch((error) => console.warn("Failed to refresh scope terminal startup:", error));
      },
      splitPane: (
        targetPaneID: string,
        sourcePaneID: string,
        sourceTabIndex: number,
        axis: "horizontal" | "vertical",
        position: "before" | "after",
      ) => {
        if (!selectedWorkspaceID) return;
        const session = layoutSession(selectedWorkspaceID);
        session.commands.splitPane(targetPaneID, sourcePaneID, sourceTabIndex, axis, position);
      },
      addTabToPane: (targetPaneID: string, sourcePaneID: string, sourceTabIndex: number) => {
        if (!selectedWorkspaceID) return;
        const session = layoutSession(selectedWorkspaceID);
        session.commands.addTabToPane(targetPaneID, sourcePaneID, sourceTabIndex);
      },
      removePaneTabByIndex: (paneID: string, tabIndex: number) => {
        if (!selectedWorkspaceID) return;
        const session = layoutSession(selectedWorkspaceID);
        session.commands.removeTab(paneID, tabIndex);
      },
      selectTabInPane: (paneID: string, index: number) => {
        if (!selectedWorkspaceID) return;
        const session = layoutSession(selectedWorkspaceID);
        session.commands.selectTabInPane(paneID, index);
      },
      setFocusedPane: (paneId: string) => {
        if (!selectedWorkspaceID) return;
        const session = layoutSession(selectedWorkspaceID);
        session.commands.focusPane(paneId);
      },
      addEditorTabToPane: (paneID: string, relativePath: string, insertIndex?: number) => {
        if (!selectedWorkspaceID) return;
        const session = layoutSession(selectedWorkspaceID);
        session.commands.addEditorTabToPane(paneID, relativePath, insertIndex);
      },
      splitPaneWithEditor: (
        targetPaneID: string,
        relativePath: string,
        axis: "horizontal" | "vertical",
        position: "before" | "after",
      ) => {
        if (!selectedWorkspaceID) return;
        const session = layoutSession(selectedWorkspaceID);
        session.commands.splitPaneWithEditor(targetPaneID, relativePath, axis, position);
      },
      moveTab: (fromPaneID: string, toPaneID: string, fromIndex: number, toIndex: number) => {
        if (!selectedWorkspaceID) return;
        const session = layoutSession(selectedWorkspaceID);
        session.commands.moveTab(fromPaneID, toPaneID, fromIndex, toIndex);
      },
      reorderTab: (paneID: string, fromIndex: number, toIndex: number) => {
        if (!selectedWorkspaceID) return;
        const session = layoutSession(selectedWorkspaceID);
        session.commands.reorderTab(paneID, fromIndex, toIndex);
      },
      addDiffTabForPath: (relativePath: string, source: "working" | "staged") => {
        if (!selectedWorkspaceID) return;
        layoutSession(selectedWorkspaceID).commands.addDiffTab(relativePath, source);
      },
      addReviewTab: () => {
        if (!selectedWorkspaceID) return;
        layoutSession(selectedWorkspaceID).commands.addReviewTab();
      },
    }),
    [selectedWorkspaceID],
  );
}
