import { useMemo } from "react";
import { useDesktopView } from "./use-desktop-view";
import { desktopWorkspaceService } from "@/services/workspace/desktop-workspace-service";

export function useLayoutActions() {
  const selectedWorkspaceID = useDesktopView((view) => view.selectedWorkspaceID);

  return useMemo(
    () => ({
      cycleTab: (direction: -1 | 1) => desktopWorkspaceService.cycleTab(direction),
      splitPane: (
        targetPaneID: string,
        sourcePaneID: string,
        sourceTabIndex: number,
        axis: "horizontal" | "vertical",
        position: "before" | "after",
      ) => {
        if (!selectedWorkspaceID) return;
        const session = desktopWorkspaceService.getWorkspaceSession(selectedWorkspaceID);
        session.commands.splitPane(targetPaneID, sourcePaneID, sourceTabIndex, axis, position);
      },
      addTabToPane: (targetPaneID: string, sourcePaneID: string, sourceTabIndex: number) => {
        if (!selectedWorkspaceID) return;
        const session = desktopWorkspaceService.getWorkspaceSession(selectedWorkspaceID);
        session.commands.addTabToPane(targetPaneID, sourcePaneID, sourceTabIndex);
      },
      removePaneTabByIndex: (paneID: string, tabIndex: number) => {
        if (!selectedWorkspaceID) return;
        const session = desktopWorkspaceService.getWorkspaceSession(selectedWorkspaceID);
        session.commands.removeTab(paneID, tabIndex);
      },
      selectTabInPane: (paneID: string, index: number) => {
        if (!selectedWorkspaceID) return;
        const session = desktopWorkspaceService.getWorkspaceSession(selectedWorkspaceID);
        session.commands.selectTabInPane(paneID, index);
      },
      setFocusedPane: (paneId: string) => {
        if (!selectedWorkspaceID) return;
        const session = desktopWorkspaceService.getWorkspaceSession(selectedWorkspaceID);
        session.commands.focusPane(paneId);
      },
      addEditorTabToPane: (paneID: string, relativePath: string, insertIndex?: number) => {
        if (!selectedWorkspaceID) return;
        const session = desktopWorkspaceService.getWorkspaceSession(selectedWorkspaceID);
        session.commands.addEditorTabToPane(paneID, relativePath, insertIndex);
      },
      splitPaneWithEditor: (
        targetPaneID: string,
        relativePath: string,
        axis: "horizontal" | "vertical",
        position: "before" | "after",
      ) => {
        if (!selectedWorkspaceID) return;
        const session = desktopWorkspaceService.getWorkspaceSession(selectedWorkspaceID);
        session.commands.splitPaneWithEditor(targetPaneID, relativePath, axis, position);
      },
      moveTab: (fromPaneID: string, toPaneID: string, fromIndex: number, toIndex: number) => {
        if (!selectedWorkspaceID) return;
        const session = desktopWorkspaceService.getWorkspaceSession(selectedWorkspaceID);
        session.commands.moveTab(fromPaneID, toPaneID, fromIndex, toIndex);
      },
      reorderTab: (paneID: string, fromIndex: number, toIndex: number) => {
        if (!selectedWorkspaceID) return;
        const session = desktopWorkspaceService.getWorkspaceSession(selectedWorkspaceID);
        session.commands.reorderTab(paneID, fromIndex, toIndex);
      },
      addDiffTabForPath: (relativePath: string, source: "working" | "staged") =>
        desktopWorkspaceService.addDiffTabForPath(relativePath, source),
      addReviewTab: () => desktopWorkspaceService.addReviewTab(),
    }),
    [selectedWorkspaceID],
  );
}
