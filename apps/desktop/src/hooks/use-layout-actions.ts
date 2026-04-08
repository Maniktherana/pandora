import { Effect } from "effect";
import { useMemo } from "react";
import { useDesktopView } from "./use-desktop-view";
import { useDesktopEffectRunner } from "./use-bootstrap-desktop";
import { DesktopWorkspaceService } from "@/services/workspace/desktop-workspace-service";

export function useLayoutActions() {
  const { run } = useDesktopEffectRunner();
  const selectedWorkspaceID = useDesktopView((view) => view.selectedWorkspaceID);

  return useMemo(
    () => ({
      cycleTab: (direction: -1 | 1) =>
        run(Effect.flatMap(DesktopWorkspaceService, (service) => service.cycleTab(direction))),
      splitPane: (
        targetPaneID: string,
        sourcePaneID: string,
        sourceTabIndex: number,
        axis: "horizontal" | "vertical",
        position: "before" | "after",
      ) =>
        run(
          Effect.flatMap(DesktopWorkspaceService, (service) =>
            selectedWorkspaceID
              ? Effect.flatMap(service.getWorkspaceSession(selectedWorkspaceID), (session) =>
                  session.commands.splitPane(
                    targetPaneID,
                    sourcePaneID,
                    sourceTabIndex,
                    axis,
                    position,
                  ),
                )
              : Effect.void,
          ),
        ),
      addTabToPane: (targetPaneID: string, sourcePaneID: string, sourceTabIndex: number) =>
        run(
          Effect.flatMap(DesktopWorkspaceService, (service) =>
            selectedWorkspaceID
              ? Effect.flatMap(service.getWorkspaceSession(selectedWorkspaceID), (session) =>
                  session.commands.addTabToPane(targetPaneID, sourcePaneID, sourceTabIndex),
                )
              : Effect.void,
          ),
        ),
      removePaneTabByIndex: (paneID: string, tabIndex: number) =>
        run(
          Effect.flatMap(DesktopWorkspaceService, (service) =>
            selectedWorkspaceID
              ? Effect.flatMap(service.getWorkspaceSession(selectedWorkspaceID), (session) =>
                  session.commands.removeTab(paneID, tabIndex),
                )
              : Effect.void,
          ),
        ),
      selectTabInPane: (paneID: string, index: number) =>
        run(
          Effect.flatMap(DesktopWorkspaceService, (service) =>
            selectedWorkspaceID
              ? Effect.flatMap(service.getWorkspaceSession(selectedWorkspaceID), (session) =>
                  session.commands.selectTabInPane(paneID, index),
                )
              : Effect.void,
          ),
        ),
      setFocusedPane: (paneId: string) =>
        run(
          Effect.flatMap(DesktopWorkspaceService, (service) =>
            selectedWorkspaceID
              ? Effect.flatMap(service.getWorkspaceSession(selectedWorkspaceID), (session) =>
                  session.commands.focusPane(paneId),
                )
              : Effect.void,
          ),
        ),
      addEditorTabToPane: (paneID: string, relativePath: string, insertIndex?: number) =>
        run(
          Effect.flatMap(DesktopWorkspaceService, (service) =>
            selectedWorkspaceID
              ? Effect.flatMap(service.getWorkspaceSession(selectedWorkspaceID), (session) =>
                  session.commands.addEditorTabToPane(paneID, relativePath, insertIndex),
                )
              : Effect.void,
          ),
        ),
      splitPaneWithEditor: (
        targetPaneID: string,
        relativePath: string,
        axis: "horizontal" | "vertical",
        position: "before" | "after",
      ) =>
        run(
          Effect.flatMap(DesktopWorkspaceService, (service) =>
            selectedWorkspaceID
              ? Effect.flatMap(service.getWorkspaceSession(selectedWorkspaceID), (session) =>
                  session.commands.splitPaneWithEditor(targetPaneID, relativePath, axis, position),
                )
              : Effect.void,
          ),
        ),
      moveTab: (fromPaneID: string, toPaneID: string, fromIndex: number, toIndex: number) =>
        run(
          Effect.flatMap(DesktopWorkspaceService, (service) =>
            selectedWorkspaceID
              ? Effect.flatMap(service.getWorkspaceSession(selectedWorkspaceID), (session) =>
                  session.commands.moveTab(fromPaneID, toPaneID, fromIndex, toIndex),
                )
              : Effect.void,
          ),
        ),
      reorderTab: (paneID: string, fromIndex: number, toIndex: number) =>
        run(
          Effect.flatMap(DesktopWorkspaceService, (service) =>
            selectedWorkspaceID
              ? Effect.flatMap(service.getWorkspaceSession(selectedWorkspaceID), (session) =>
                  session.commands.reorderTab(paneID, fromIndex, toIndex),
                )
              : Effect.void,
          ),
        ),
      addDiffTabForPath: (relativePath: string, source: "working" | "staged") =>
        run(
          Effect.flatMap(DesktopWorkspaceService, (service) =>
            service.addDiffTabForPath(relativePath, source),
          ),
        ),
      addReviewTab: () =>
        run(Effect.flatMap(DesktopWorkspaceService, (service) => service.addReviewTab())),
    }),
    [run, selectedWorkspaceID],
  );
}
