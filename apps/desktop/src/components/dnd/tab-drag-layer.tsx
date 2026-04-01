/**
 * Pointer-event-based tab drag system.
 *
 * HTML5 Drag-and-Drop is broken in Tauri webviews. This module uses raw
 * pointer events instead (the same approach VS Code uses).
 *
 * Architecture:
 *   TabDragProvider          — React context holding drag state + actions
 *   <TabDragOverlay />       — Full-screen overlay rendered while dragging;
 *                              does hit-testing against data-pane-id /
 *                              data-tab-slot elements, renders ghost +
 *                              drop-zone highlights, executes store
 *                              actions on pointer-up.
 *
 * Panes add  data-pane-id={leaf.id}  to their root div.
 * Tabs  add  data-tab-pane={paneID} data-tab-index={i}.
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { findLeaf } from "@/lib/layout/layout-migrate";
import { tabsEqual } from "@/lib/layout/layout-tree";
import { isProjectRuntimeKey } from "@/lib/runtime/runtime-keys";
import type { LayoutAxis } from "@/lib/shared/types";
import { cn } from "@/lib/shared/utils";

// ── Types ──────────────────────────────────────────────────────────────

export interface DragState {
  kind: "pane-tab" | "bottom-terminal-group" | "bottom-terminal-slot";
  tabLabel: string;
  sourcePaneID?: string;
  sourceIndex?: number;
  runtimeId?: string;
  groupId?: string;
  groupIndex?: number;
  slotId?: string;
  slotIndex?: number;
}

type DropZone = "center" | "left" | "right" | "top" | "bottom";

interface PaneDropTarget {
  kind: "pane";
  paneID: string;
  zone: DropZone;
  rect: DOMRect;
}

interface TabDropTarget {
  kind: "tab";
  paneID: string;
  insertIndex: number;
  /** x position to draw the insertion line (horizontal tab bar) */
  lineX: number;
  /** rect of the tab bar for vertical positioning */
  barRect: DOMRect;
  /** Bottom terminal sidebar: list is vertical; draw a horizontal insertion line */
  tabBarVertical?: boolean;
  /** y position for horizontal insertion line when tabBarVertical */
  lineY?: number;
}

interface BottomTerminalGroupDropTarget {
  kind: "bottom-terminal-group";
  runtimeId: string;
  groupId: string;
  groupIndex: number;
  rect: DOMRect;
}

interface BottomTerminalInsertDropTarget {
  kind: "bottom-terminal-insert";
  runtimeId: string;
  insertIndex: number;
  barRect: DOMRect;
  lineY: number;
}

interface BottomTerminalSlotDropTarget {
  kind: "bottom-terminal-slot";
  runtimeId: string;
  groupId: string;
  groupIndex: number;
  insertIndex: number;
  barRect: DOMRect;
  lineY: number;
}

interface BottomTerminalPaneDropTarget {
  kind: "bottom-terminal-pane";
  runtimeId: string;
  groupId: string;
  slotId: string;
  zone: "center" | "left" | "right";
  rect: DOMRect;
}

type DropTarget =
  | PaneDropTarget
  | TabDropTarget
  | BottomTerminalGroupDropTarget
  | BottomTerminalInsertDropTarget
  | BottomTerminalSlotDropTarget
  | BottomTerminalPaneDropTarget;

interface TabDragContextValue {
  dragState: DragState | null;
  startDrag: (state: DragState) => void;
}

const TabDragContext = createContext<TabDragContextValue | null>(null);

export function useTabDrag() {
  const ctx = useContext(TabDragContext);
  if (!ctx) throw new Error("useTabDrag must be used within TabDragProvider");
  return ctx;
}

// ── Hit testing ────────────────────────────────────────────────────────

function hitTestPanes(x: number, y: number): { paneID: string; rect: DOMRect; zone: DropZone } | null {
  const panes = document.querySelectorAll<HTMLElement>("[data-pane-id]");
  for (const pane of panes) {
    const rect = pane.getBoundingClientRect();
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
      const rx = (x - rect.left) / rect.width;
      const ry = (y - rect.top) / rect.height;
      const edge = 0.25;
      let zone: DropZone;
      if (rx < edge) zone = "left";
      else if (rx > 1 - edge) zone = "right";
      else if (ry < edge) zone = "top";
      else if (ry > 1 - edge) zone = "bottom";
      else zone = "center";
      return { paneID: pane.dataset.paneId!, rect, zone };
    }
  }
  return null;
}

function unionRects(elements: HTMLElement[]): DOMRect {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const el of elements) {
    const r = el.getBoundingClientRect();
    left = Math.min(left, r.left);
    top = Math.min(top, r.top);
    right = Math.max(right, r.right);
    bottom = Math.max(bottom, r.bottom);
  }
  return new DOMRect(left, top, right - left, bottom - top);
}

function hitTestBottomTerminalSidebar(
  x: number,
  y: number,
  dragState: DragState
): BottomTerminalGroupDropTarget | BottomTerminalInsertDropTarget | BottomTerminalSlotDropTarget | null {
  const groupRows = [
    ...document.querySelectorAll<HTMLElement>("[data-bottom-terminal-group-block='true']"),
  ].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);

  if (groupRows.length === 0) return null;

  const sidebar = document.querySelector<HTMLElement>("[data-bottom-terminal-sidebar='true']");
  const barRect = sidebar?.getBoundingClientRect() ?? unionRects(groupRows);
  const pad = 8;
  if (x < barRect.left - pad || x > barRect.right + pad || y < barRect.top - pad || y > barRect.bottom + pad) {
    return null;
  }

  if (dragState.kind === "bottom-terminal-slot") {
    const slotRows = [
      ...document.querySelectorAll<HTMLElement>("[data-bottom-terminal-slot-index]"),
    ];
    for (const slotRow of slotRows) {
      const rect = slotRow.getBoundingClientRect();
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;
      const midY = rect.top + rect.height / 2;
      return {
        kind: "bottom-terminal-slot",
        runtimeId: slotRow.dataset.bottomTerminalRuntimeId!,
        groupId: slotRow.dataset.bottomTerminalGroupId!,
        groupIndex: Number.parseInt(slotRow.dataset.bottomTerminalGroupIndex ?? "0", 10),
        insertIndex: Number.parseInt(slotRow.dataset.bottomTerminalSlotIndex ?? "0", 10) + (y >= midY ? 1 : 0),
        barRect,
        lineY: y >= midY ? rect.bottom : rect.top,
      };
    }

    for (const groupRow of groupRows) {
      const rect = groupRow.getBoundingClientRect();
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;
    }
  }

  for (const groupRow of groupRows) {
    const rect = groupRow.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    if (y < midY) {
      return {
        kind: "bottom-terminal-insert",
        runtimeId: groupRow.dataset.bottomTerminalRuntimeId!,
        insertIndex: Number.parseInt(groupRow.dataset.bottomTerminalGroupIndex ?? "0", 10),
        barRect,
        lineY: rect.top,
      };
    }
  }

  const last = groupRows[groupRows.length - 1];
  const lastRect = last.getBoundingClientRect();
  return {
    kind: "bottom-terminal-insert",
    runtimeId: last.dataset.bottomTerminalRuntimeId!,
    insertIndex: Number.parseInt(last.dataset.bottomTerminalGroupIndex ?? "0", 10) + 1,
    barRect,
    lineY: lastRect.bottom,
  };
}

function hitTestBottomTerminalPanes(x: number, y: number): BottomTerminalPaneDropTarget | null {
  const panes = document.querySelectorAll<HTMLElement>("[data-bottom-terminal-pane-id]");
  for (const pane of panes) {
    const rect = pane.getBoundingClientRect();
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;
    const rx = (x - rect.left) / rect.width;
    let zone: "center" | "left" | "right" = "center";
    if (rx < 0.25) zone = "left";
    else if (rx > 0.75) zone = "right";
    return {
      kind: "bottom-terminal-pane",
      runtimeId: pane.dataset.bottomTerminalRuntimeId!,
      groupId: pane.dataset.bottomTerminalGroupId!,
      slotId: pane.dataset.bottomTerminalPaneId!,
      zone,
      rect,
    };
  }
  return null;
}

function hitTestTabs(x: number, y: number): TabDropTarget | null {
  const tabs = document.querySelectorAll<HTMLElement>("[data-tab-pane][data-tab-index]");
  if (tabs.length === 0) return null;

  // Group tabs by pane (exclude vertical sidebar — already handled)
  const byPane = new Map<string, HTMLElement[]>();
  for (const tab of tabs) {
    if (tab.dataset.terminalSidebar === "true") continue;
    const paneID = tab.dataset.tabPane!;
    if (!byPane.has(paneID)) byPane.set(paneID, []);
    byPane.get(paneID)!.push(tab);
  }

  for (const [paneID, paneTabs] of byPane) {
    // Sort left-to-right for stable first/last rects
    const sorted = [...paneTabs].sort(
      (a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left
    );
    const firstRect = sorted[0].getBoundingClientRect();
    const lastRect = sorted[sorted.length - 1].getBoundingClientRect();
    const barTop = Math.min(...sorted.map((t) => t.getBoundingClientRect().top));
    const barBottom = Math.max(...sorted.map((t) => t.getBoundingClientRect().bottom));
    if (y < barTop || y > barBottom) continue;

    const barLeft = firstRect.left;
    const barRight = lastRect.right + 60;

    if (x < barLeft || x > barRight) continue;

    for (let i = 0; i < sorted.length; i++) {
      const rect = sorted[i].getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      if (x < midX) {
        return {
          kind: "tab",
          paneID,
          insertIndex: i,
          lineX: rect.left,
          barRect: new DOMRect(barLeft, barTop, barRight - barLeft, barBottom - barTop),
        };
      }
    }

    return {
      kind: "tab",
      paneID,
      insertIndex: sorted.length,
      lineX: lastRect.right,
      barRect: new DOMRect(barLeft, barTop, barRight - barLeft, barBottom - barTop),
    };
  }

  return null;
}

// ── Overlay ────────────────────────────────────────────────────────────

function TabDragOverlay({
  dragState,
  onDone,
}: {
  dragState: DragState;
  onDone: () => void;
}) {
  const [cursor, setCursor] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [target, setTarget] = useState<DropTarget | null>(null);
  const targetRef = useRef<DropTarget | null>(null);
  const {
    splitPane,
    addTabToPane,
    reorderTab,
    moveTab,
    moveProjectTerminalToGroup,
    moveProjectTerminalToNewGroup,
    selectProjectTerminalGroup,
    focusProjectTerminal,
    reorderProjectTerminalGroupChildren,
    reorderProjectTerminalGroups,
  } = useWorkspaceStore();

  useEffect(() => {
    function onPointerMove(e: PointerEvent) {
      setCursor({ x: e.clientX, y: e.clientY });

      if (dragState.kind !== "pane-tab") {
        const bottomPaneHit = hitTestBottomTerminalPanes(e.clientX, e.clientY);
        if (bottomPaneHit) {
          targetRef.current = bottomPaneHit;
          setTarget(bottomPaneHit);
          return;
        }
      }

      const bottomSidebarHit = hitTestBottomTerminalSidebar(e.clientX, e.clientY, dragState);
      if (bottomSidebarHit) {
        targetRef.current = bottomSidebarHit;
        setTarget(bottomSidebarHit);
        return;
      }

      if (dragState.kind !== "pane-tab") {
        targetRef.current = null;
        setTarget(null);
        return;
      }

      // Tab bar hit test takes priority over pane hit test
      const tabHit = hitTestTabs(e.clientX, e.clientY);
      if (tabHit) {
        targetRef.current = tabHit;
        setTarget(tabHit);
        return;
      }

      const paneHit = hitTestPanes(e.clientX, e.clientY);
      if (paneHit) {
        const t: PaneDropTarget = {
          kind: "pane",
          paneID: paneHit.paneID,
          zone: paneHit.zone,
          rect: paneHit.rect,
        };
        targetRef.current = t;
        setTarget(t);
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
      const st = useWorkspaceStore.getState();
      const rid = st.effectiveLayoutRuntimeId();
      const runtime = rid ? st.runtimes[rid] : null;
      const terminalPanel = drag.runtimeId ? st.runtimes[drag.runtimeId]?.terminalPanel : null;

      if (drag.kind === "bottom-terminal-group") {
        if (tgt.kind === "bottom-terminal-pane" && drag.runtimeId === tgt.runtimeId) {
          if (tgt.zone === "center") {
            selectProjectTerminalGroup(tgt.runtimeId, drag.groupId!, null);
          } else {
            const toIndex = terminalPanel?.groups.findIndex((group) => group.id === tgt.groupId) ?? -1;
            const fromIndex = drag.groupIndex ?? -1;
            if (toIndex >= 0 && fromIndex >= 0) {
              const insertIndex = tgt.zone === "left" ? toIndex : toIndex + 1;
              reorderProjectTerminalGroups(
                tgt.runtimeId,
                fromIndex,
                fromIndex < insertIndex ? insertIndex - 1 : insertIndex
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
          reorderProjectTerminalGroups(tgt.runtimeId, fromIndex, toIndex);
        }
        return;
      }

      if (drag.kind === "bottom-terminal-slot") {
        if (!drag.runtimeId || !drag.slotId || !terminalPanel) return;
        if (tgt.kind === "bottom-terminal-pane" && tgt.runtimeId === drag.runtimeId) {
          if (tgt.zone === "center") {
            selectProjectTerminalGroup(tgt.runtimeId, drag.groupId!, drag.slotId);
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
              reorderProjectTerminalGroupChildren(tgt.runtimeId, tgt.groupId, fromIndex, toIndex);
            }
          } else {
            moveProjectTerminalToGroup(tgt.runtimeId, drag.slotId, tgt.groupId, insertIndex);
          }
          selectProjectTerminalGroup(tgt.runtimeId, tgt.groupId, drag.slotId);
          return;
        }
        if (tgt.kind === "bottom-terminal-slot" && tgt.runtimeId === drag.runtimeId) {
          const fromIndex = drag.slotIndex ?? -1;
          let toIndex = tgt.insertIndex;
          if (drag.groupId === tgt.groupId && fromIndex < toIndex) {
            toIndex -= 1;
          }
          if (drag.groupId === tgt.groupId && fromIndex >= 0 && fromIndex !== toIndex) {
            reorderProjectTerminalGroupChildren(tgt.runtimeId, tgt.groupId, fromIndex, toIndex);
          } else if (drag.groupId !== tgt.groupId) {
            moveProjectTerminalToGroup(tgt.runtimeId, drag.slotId, tgt.groupId, tgt.insertIndex);
          }
          return;
        }

        if (tgt.kind === "bottom-terminal-group" && tgt.runtimeId === drag.runtimeId) {
          if (drag.groupId !== tgt.groupId) {
            moveProjectTerminalToGroup(tgt.runtimeId, drag.slotId, tgt.groupId);
          }
          return;
        }

        if (tgt.kind === "bottom-terminal-insert" && tgt.runtimeId === drag.runtimeId) {
          let insertIndex = tgt.insertIndex;
          const sourceGroup = terminalPanel.groups[drag.groupIndex ?? -1];
          if (sourceGroup && sourceGroup.children.length === 1 && (drag.groupIndex ?? -1) < insertIndex) {
            insertIndex -= 1;
          }
          moveProjectTerminalToNewGroup(tgt.runtimeId, drag.slotId, insertIndex);
        }
        return;
      }

      if (!runtime?.root || drag.kind !== "pane-tab") return;

      if (tgt.kind === "tab") {
        if (tgt.paneID === drag.sourcePaneID) {
          const fromIndex = drag.sourceIndex ?? -1;
          let toIndex = tgt.insertIndex;
          if (fromIndex < toIndex) toIndex--;
          if (fromIndex !== toIndex) {
            reorderTab(tgt.paneID, fromIndex, toIndex);
          }
        } else {
          moveTab(drag.sourcePaneID!, tgt.paneID, drag.sourceIndex!, tgt.insertIndex);
        }
      } else {
        if (tgt.kind !== "pane") return;
        const { zone, paneID } = tgt;
        if (zone === "center") {
          const leaf = findLeaf(runtime.root, paneID);
          const srcLeaf = findLeaf(runtime.root, drag.sourcePaneID!);
          const moving = srcLeaf?.tabs[drag.sourceIndex!];
          if (!moving) return;
          if (leaf?.tabs.some((t) => tabsEqual(t, moving))) return;
          addTabToPane(paneID, drag.sourcePaneID!, drag.sourceIndex!);
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
          splitPane(paneID, drag.sourcePaneID!, drag.sourceIndex!, axis, position);
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
  }, [
    dragState,
    onDone,
    splitPane,
    addTabToPane,
    reorderTab,
    moveTab,
    moveProjectTerminalToGroup,
    moveProjectTerminalToNewGroup,
    selectProjectTerminalGroup,
    focusProjectTerminal,
    reorderProjectTerminalGroupChildren,
    reorderProjectTerminalGroups,
  ]);

  return createPortal(
    <div
      className="fixed inset-0 z-[9999]"
      style={{ cursor: "grabbing" }}
    >
      {/* Ghost preview following cursor */}
      <div
        className="fixed pointer-events-none z-[10001] px-3 py-1.5 rounded bg-neutral-800 border border-neutral-600 text-xs text-neutral-200 shadow-xl whitespace-nowrap"
        style={{
          left: cursor.x + 12,
          top: cursor.y - 10,
        }}
      >
        {dragState.tabLabel}
      </div>

      {/* Pane drop zone highlight */}
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
              "absolute border-2 border-blue-500/60 bg-blue-500/10 rounded transition-all duration-75",
              target.zone === "center" && "inset-1",
              target.zone === "left" && "top-1 bottom-1 left-1 w-[calc(50%-4px)]",
              target.zone === "right" && "top-1 bottom-1 right-1 w-[calc(50%-4px)]",
              target.zone === "top" && "left-1 right-1 top-1 h-[calc(50%-4px)]",
              target.zone === "bottom" && "left-1 right-1 bottom-1 h-[calc(50%-4px)]"
            )}
          />
        </div>
      )}

      {/* Tab insertion indicator line */}
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
              target.zone === "right" && "right-1 top-1 bottom-1 w-[calc(50%-4px)]"
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
          className="fixed pointer-events-none z-[10000] h-[3px] bg-blue-500 rounded-full"
          style={{
            left: target.barRect.left + 4,
            top: (target.lineY ?? target.barRect.top) - 1,
            width: Math.max(0, target.barRect.width - 8),
          }}
        />
      ) : target?.kind === "tab" ? (
        <div
          className="fixed pointer-events-none z-[10000] w-[3px] bg-blue-500 rounded-full"
          style={{
            left: target.lineX - 1,
            top: target.barRect.top + 4,
            height: target.barRect.height - 8,
          }}
        />
      ) : null}
    </div>,
    document.body
  );
}

// ── Helpers ────────────────────────────────────────────────────────────

// ── Provider ───────────────────────────────────────────────────────────

export function TabDragProvider({ children }: { children: ReactNode }) {
  const [dragState, setDragState] = useState<DragState | null>(null);

  useEffect(() => {
    if (!dragState) return;
    void invoke("terminal_surfaces_begin_web_overlay").catch(() => {});
    return () => {
      void invoke("terminal_surfaces_end_web_overlay").catch(() => {});
    };
  }, [dragState]);

  const startDrag = useCallback((state: DragState) => {
    setDragState(state);
  }, []);

  const endDrag = useCallback(() => {
    setDragState(null);
  }, []);

  return (
    <TabDragContext.Provider value={{ dragState, startDrag }}>
      {children}
      {dragState && (
        <TabDragOverlay dragState={dragState} onDone={endDrag} />
      )}
    </TabDragContext.Provider>
  );
}
