import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDesktopView } from "@/hooks/use-desktop-view";
import { useLayoutActions } from "@/hooks/use-layout-actions";
import { useProjectTerminalActions } from "@/hooks/use-terminal-actions";
import { useDesktopViewStore } from "@/state/desktop-view-store";
import { useEditorStore } from "@/state/editor-store";
import { findLeaf } from "@/components/layout/workspace/layout-migrate";
import { tabsEqual } from "@/components/layout/workspace/layout-tree";
import { isProjectRuntimeKey } from "@/lib/runtime/runtime-keys";
import type { LayoutAxis } from "@/lib/shared/types";
import { cn } from "@/lib/shared/utils";
import {
  hitTestBottomTerminalPanes,
  hitTestBottomTerminalSidebar,
  hitTestPanes,
  hitTestTabs,
} from "./tab-drag-hit-test";
import type { DragState, DropTarget, PaneDropTarget } from "./tab-drag.types";

export function TabDragOverlay({
  dragState,
  onDone,
}: {
  dragState: DragState;
  onDone: () => void;
}) {
  const [cursor, setCursor] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [target, setTarget] = useState<DropTarget | null>(null);
  const targetRef = useRef<DropTarget | null>(null);
  const selectedWorkspaceID = useDesktopView((view) => view.selectedWorkspaceID);
  const layoutCommands = useLayoutActions();
  const projectTerminalCommands = useProjectTerminalActions();

  useEffect(() => {
    function onPointerMove(e: PointerEvent) {
      setCursor({ x: e.clientX, y: e.clientY });
      const canDropIntoWorkspace =
        dragState.kind === "pane-tab" || dragState.kind === "file-tree-file";

      if (!canDropIntoWorkspace) {
        const bottomPaneHit = hitTestBottomTerminalPanes(e.clientX, e.clientY);
        if (bottomPaneHit) {
          targetRef.current = bottomPaneHit;
          setTarget(bottomPaneHit);
          return;
        }
        const bottomSidebarHit = hitTestBottomTerminalSidebar(e.clientX, e.clientY, dragState);
        if (bottomSidebarHit) {
          targetRef.current = bottomSidebarHit;
          setTarget(bottomSidebarHit);
          return;
        }
        targetRef.current = null;
        setTarget(null);
        return;
      }

      const tabHit = hitTestTabs(e.clientX, e.clientY, selectedWorkspaceID);
      if (tabHit) {
        targetRef.current = tabHit;
        setTarget(tabHit);
        return;
      }

      const paneHit = hitTestPanes(e.clientX, e.clientY, selectedWorkspaceID);
      if (paneHit) {
        const paneTarget: PaneDropTarget = {
          kind: "pane",
          paneID: paneHit.paneID,
          zone: paneHit.zone,
          rect: paneHit.rect,
        };
        targetRef.current = paneTarget;
        setTarget(paneTarget);
      } else {
        targetRef.current = null;
        setTarget(null);
      }
    }

    function onPointerUp() {
      const currentTarget = targetRef.current;
      if (currentTarget) {
        executeDrop(dragState, currentTarget);
      }
      onDone();
    }

    function executeDrop(drag: DragState, tgt: DropTarget) {
      const desktopView = useDesktopViewStore.getState().desktopView;
      const rid = desktopView.layoutTargetRuntimeId ?? desktopView.selectedWorkspaceID;
      const runtime = rid ? desktopView.runtimes[rid] : null;
      const terminalPanel = drag.runtimeId
        ? desktopView.runtimes[drag.runtimeId]?.terminalPanel
        : null;
      const ensureDraggedFileLoaded = (afterLoad: () => void) => {
        if (
          drag.kind !== "file-tree-file" ||
          !drag.workspaceId ||
          !drag.workspaceRoot ||
          !drag.relativePath
        ) {
          return;
        }
        void useEditorStore
          .getState()
          .ensureFileLoaded(drag.workspaceId, drag.workspaceRoot, drag.relativePath)
          .then((ok) => {
            if (ok) afterLoad();
          })
          .catch(console.error);
      };

      if (drag.kind === "bottom-terminal-group") {
        if (tgt.kind === "bottom-terminal-pane" && drag.runtimeId === tgt.runtimeId) {
          if (tgt.zone === "center") {
            projectTerminalCommands.selectProjectTerminalGroup(tgt.runtimeId, drag.groupId!, null);
          } else {
            const toIndex =
              terminalPanel?.groups.findIndex((group) => group.id === tgt.groupId) ?? -1;
            const fromIndex = drag.groupIndex ?? -1;
            if (toIndex >= 0 && fromIndex >= 0) {
              const insertIndex = tgt.zone === "left" ? toIndex : toIndex + 1;
              projectTerminalCommands.reorderProjectTerminalGroups(
                tgt.runtimeId,
                fromIndex,
                fromIndex < insertIndex ? insertIndex - 1 : insertIndex,
              );
            }
          }
          return;
        }
        if (tgt.kind !== "bottom-terminal-insert" || drag.runtimeId !== tgt.runtimeId) return;
        const fromIndex = drag.groupIndex ?? -1;
        let toIndex = tgt.insertIndex;
        if (fromIndex < toIndex) toIndex -= 1;
        if (fromIndex >= 0 && toIndex >= 0 && fromIndex !== toIndex) {
          projectTerminalCommands.reorderProjectTerminalGroups(tgt.runtimeId, fromIndex, toIndex);
        }
        return;
      }

      if (drag.kind === "bottom-terminal-slot") {
        if (!drag.runtimeId || !drag.slotId || !terminalPanel) return;
        if (tgt.kind === "bottom-terminal-pane" && tgt.runtimeId === drag.runtimeId) {
          if (tgt.zone === "center") {
            projectTerminalCommands.selectProjectTerminalGroup(
              tgt.runtimeId,
              drag.groupId!,
              drag.slotId,
            );
            return;
          }
          const targetGroup = terminalPanel.groups.find((group) => group.id === tgt.groupId);
          const targetSlotIndex = targetGroup?.children.indexOf(tgt.slotId) ?? -1;
          if (targetSlotIndex < 0) return;
          const insertIndex = tgt.zone === "left" ? targetSlotIndex : targetSlotIndex + 1;
          if (drag.groupId === tgt.groupId) {
            const fromIndex = drag.slotIndex ?? -1;
            let toIndex = insertIndex;
            if (fromIndex < toIndex) toIndex -= 1;
            if (fromIndex !== toIndex && fromIndex >= 0) {
              projectTerminalCommands.reorderProjectTerminalGroupChildren(
                tgt.runtimeId,
                tgt.groupId,
                fromIndex,
                toIndex,
              );
            }
          } else {
            projectTerminalCommands.moveProjectTerminalToGroup(
              tgt.runtimeId,
              drag.slotId,
              tgt.groupId,
              insertIndex,
            );
          }
          projectTerminalCommands.selectProjectTerminalGroup(
            tgt.runtimeId,
            tgt.groupId,
            drag.slotId,
          );
          return;
        }
        if (tgt.kind === "bottom-terminal-slot" && tgt.runtimeId === drag.runtimeId) {
          const fromIndex = drag.slotIndex ?? -1;
          let toIndex = tgt.insertIndex;
          if (drag.groupId === tgt.groupId && fromIndex < toIndex) {
            toIndex -= 1;
          }
          if (drag.groupId === tgt.groupId && fromIndex >= 0 && fromIndex !== toIndex) {
            projectTerminalCommands.reorderProjectTerminalGroupChildren(
              tgt.runtimeId,
              tgt.groupId,
              fromIndex,
              toIndex,
            );
          } else if (drag.groupId !== tgt.groupId) {
            projectTerminalCommands.moveProjectTerminalToGroup(
              tgt.runtimeId,
              drag.slotId,
              tgt.groupId,
              tgt.insertIndex,
            );
          }
          return;
        }

        if (tgt.kind === "bottom-terminal-group" && tgt.runtimeId === drag.runtimeId) {
          if (drag.groupId !== tgt.groupId) {
            projectTerminalCommands.moveProjectTerminalToGroup(
              tgt.runtimeId,
              drag.slotId,
              tgt.groupId,
            );
          }
          return;
        }

        if (tgt.kind === "bottom-terminal-insert" && tgt.runtimeId === drag.runtimeId) {
          let insertIndex = tgt.insertIndex;
          const sourceGroup = terminalPanel.groups[drag.groupIndex ?? -1];
          if (
            sourceGroup &&
            sourceGroup.children.length === 1 &&
            (drag.groupIndex ?? -1) < insertIndex
          ) {
            insertIndex -= 1;
          }
          projectTerminalCommands.moveProjectTerminalToNewGroup(
            tgt.runtimeId,
            drag.slotId,
            insertIndex,
          );
        }
        return;
      }

      if (drag.kind === "file-tree-file") {
        if (!drag.relativePath) return;

        if (tgt.kind === "tab") {
          ensureDraggedFileLoaded(() => {
            layoutCommands.addEditorTabToPane(tgt.paneID, drag.relativePath!, tgt.insertIndex);
          });
          return;
        }

        if (tgt.kind !== "pane") return;
        const { zone, paneID } = tgt;
        if (zone === "center") {
          ensureDraggedFileLoaded(() => {
            layoutCommands.addEditorTabToPane(paneID, drag.relativePath!);
          });
          return;
        }

        const axisMap: Record<string, LayoutAxis> = {
          left: "horizontal",
          right: "horizontal",
          top: "vertical",
          bottom: "vertical",
        };
        const posMap: Record<string, "before" | "after"> = {
          left: "before",
          right: "after",
          top: "before",
          bottom: "after",
        };
        let axis: LayoutAxis = axisMap[zone];
        let position: "before" | "after" = posMap[zone];
        if (rid && isProjectRuntimeKey(rid) && (zone === "top" || zone === "bottom")) {
          axis = "horizontal";
          position = zone === "top" ? "before" : "after";
        }
        ensureDraggedFileLoaded(() => {
          layoutCommands.splitPaneWithEditor(paneID, drag.relativePath!, axis, position);
        });
        return;
      }

      if (!runtime?.root || drag.kind !== "pane-tab") return;

      if (tgt.kind === "tab") {
        if (tgt.paneID === drag.sourcePaneID) {
          const fromIndex = drag.sourceIndex ?? -1;
          let toIndex = tgt.insertIndex;
          if (fromIndex < toIndex) toIndex--;
          if (fromIndex !== toIndex) {
            layoutCommands.reorderTab(tgt.paneID, fromIndex, toIndex);
          }
        } else {
          layoutCommands.moveTab(
            drag.sourcePaneID!,
            tgt.paneID,
            drag.sourceIndex!,
            tgt.insertIndex,
          );
        }
      } else {
        if (tgt.kind !== "pane") return;
        const { zone, paneID } = tgt;
        if (zone === "center") {
          const leaf = findLeaf(runtime.root, paneID);
          const srcLeaf = findLeaf(runtime.root, drag.sourcePaneID!);
          const moving = srcLeaf?.tabs[drag.sourceIndex!];
          if (!moving) return;
          if (leaf?.tabs.some((tab) => tabsEqual(tab, moving))) return;
          layoutCommands.addTabToPane(paneID, drag.sourcePaneID!, drag.sourceIndex!);
        } else {
          if (drag.sourcePaneID === paneID) {
            const leaf = findLeaf(runtime.root, paneID);
            if (leaf && leaf.tabs.length === 1) return;
          }
          const axisMap: Record<string, LayoutAxis> = {
            left: "horizontal",
            right: "horizontal",
            top: "vertical",
            bottom: "vertical",
          };
          const posMap: Record<string, "before" | "after"> = {
            left: "before",
            right: "after",
            top: "before",
            bottom: "after",
          };
          let axis: LayoutAxis = axisMap[zone];
          let position: "before" | "after" = posMap[zone];
          if (rid && isProjectRuntimeKey(rid) && (zone === "top" || zone === "bottom")) {
            axis = "horizontal";
            position = zone === "top" ? "before" : "after";
          }
          layoutCommands.splitPane(paneID, drag.sourcePaneID!, drag.sourceIndex!, axis, position);
        }
      }
    }

    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
    return () => {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
    };
    // target is intentionally read from closure at pointerup time
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragState, layoutCommands, onDone, projectTerminalCommands, selectedWorkspaceID]);

  return createPortal(
    <div className="fixed inset-0 z-[9999]" style={{ cursor: "grabbing" }}>
      <div
        className="fixed pointer-events-none z-[10001] whitespace-nowrap rounded border border-neutral-600 bg-neutral-800 px-3 py-1.5 text-xs text-neutral-200 shadow-xl"
        style={{
          left: cursor.x + 12,
          top: cursor.y - 10,
        }}
      >
        {dragState.tabLabel}
      </div>

      {target?.kind === "pane" && (
        <div
          className="fixed pointer-events-none z-[10000]"
          style={{
            left: target.rect.left,
            top: target.rect.top,
            width: target.rect.width,
            height: target.rect.height,
          }}
        >
          <div
            className={cn(
              "absolute rounded border-2 border-blue-500/60 bg-blue-500/10 transition-all duration-75",
              target.zone === "center" && "inset-1",
              target.zone === "left" && "bottom-1 left-1 top-1 w-[calc(50%-4px)]",
              target.zone === "right" && "bottom-1 right-1 top-1 w-[calc(50%-4px)]",
              target.zone === "top" && "left-1 right-1 top-1 h-[calc(50%-4px)]",
              target.zone === "bottom" && "bottom-1 left-1 right-1 h-[calc(50%-4px)]",
            )}
          />
        </div>
      )}

      {target?.kind === "bottom-terminal-pane" ? (
        <div
          className="fixed pointer-events-none z-[10000]"
          style={{
            left: target.rect.left,
            top: target.rect.top,
            width: target.rect.width,
            height: target.rect.height,
          }}
        >
          <div
            className={cn(
              "absolute rounded border-2 border-blue-500/70 bg-blue-500/10",
              target.zone === "center" && "inset-1",
              target.zone === "left" && "left-1 top-1 bottom-1 w-[calc(50%-4px)]",
              target.zone === "right" && "right-1 top-1 bottom-1 w-[calc(50%-4px)]",
            )}
          />
        </div>
      ) : target?.kind === "bottom-terminal-group" ? (
        <div
          className="fixed pointer-events-none z-[10000] rounded border-2 border-blue-500/70 bg-blue-500/10"
          style={{
            left: target.rect.left + 2,
            top: target.rect.top + 2,
            width: Math.max(0, target.rect.width - 4),
            height: Math.max(0, target.rect.height - 4),
          }}
        />
      ) : target?.kind === "bottom-terminal-slot" || target?.kind === "bottom-terminal-insert" ? (
        <div
          className="fixed pointer-events-none z-[10000] h-[3px] rounded-full bg-blue-500"
          style={{
            left: target.barRect.left + 6,
            top: target.lineY - 1,
            width: Math.max(0, target.barRect.width - 12),
          }}
        />
      ) : target?.kind === "tab" && target.tabBarVertical ? (
        <div
          className="fixed pointer-events-none z-[10000] h-[3px] rounded-full bg-blue-500"
          style={{
            left: target.barRect.left + 4,
            top: (target.lineY ?? target.barRect.top) - 1,
            width: Math.max(0, target.barRect.width - 8),
          }}
        />
      ) : target?.kind === "tab" ? (
        <div
          className="fixed pointer-events-none z-[10000] w-[3px] rounded-full bg-blue-500"
          style={{
            left: target.lineX - 1,
            top: target.barRect.top + 4,
            height: target.barRect.height - 8,
          }}
        />
      ) : null}
    </div>,
    document.body,
  );
}
