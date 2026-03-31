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
 * Tabs  add  data-tab-slot={slotID} data-tab-pane={paneID} data-tab-index={i}.
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
import { cn } from "@/lib/utils";
import type { LayoutAxis } from "@/lib/types";

// ── Types ──────────────────────────────────────────────────────────────

export interface DragState {
  slotID: string;
  sourcePaneID: string;
  slotName: string;
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
  /** x position to draw the insertion line */
  lineX: number;
  /** rect of the tab bar for vertical positioning */
  barRect: DOMRect;
}

type DropTarget = PaneDropTarget | TabDropTarget;

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

function hitTestTabs(x: number, y: number): TabDropTarget | null {
  const tabs = document.querySelectorAll<HTMLElement>("[data-tab-slot]");
  if (tabs.length === 0) return null;

  // Group tabs by pane
  const byPane = new Map<string, HTMLElement[]>();
  for (const tab of tabs) {
    const paneID = tab.dataset.tabPane!;
    if (!byPane.has(paneID)) byPane.set(paneID, []);
    byPane.get(paneID)!.push(tab);
  }

  for (const [paneID, paneTabs] of byPane) {
    // Check if cursor is in the tab bar vertical band (any tab's top/bottom)
    const firstRect = paneTabs[0].getBoundingClientRect();
    if (y < firstRect.top || y > firstRect.bottom) continue;

    // Check if cursor is horizontally within or near the tab bar
    const lastRect = paneTabs[paneTabs.length - 1].getBoundingClientRect();
    // Allow dropping past the last tab
    const barLeft = firstRect.left;
    const barRight = lastRect.right + 60; // extend a bit past last tab

    if (x < barLeft || x > barRight) continue;

    // Find insertion point
    for (let i = 0; i < paneTabs.length; i++) {
      const rect = paneTabs[i].getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      if (x < midX) {
        return {
          kind: "tab",
          paneID,
          insertIndex: i,
          lineX: rect.left,
          barRect: firstRect,
        };
      }
    }

    // Past all tabs — insert at end
    return {
      kind: "tab",
      paneID,
      insertIndex: paneTabs.length,
      lineX: lastRect.right,
      barRect: firstRect,
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
  const { splitPane, addTabToPane, reorderTab, moveTab } = useWorkspaceStore();

  useEffect(() => {
    function onPointerMove(e: PointerEvent) {
      setCursor({ x: e.clientX, y: e.clientY });

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
      if (tgt.kind === "tab") {
        if (tgt.paneID === drag.sourcePaneID) {
          // Reorder within same pane — find current index of this slot
          const runtime = useWorkspaceStore.getState().activeRuntime();
          if (!runtime?.root) return;
          const leaf = findLeafInTree(runtime.root, tgt.paneID);
          if (!leaf) return;
          const fromIndex = leaf.slotIDs.indexOf(drag.slotID);
          if (fromIndex === -1) return;
          let toIndex = tgt.insertIndex;
          if (fromIndex < toIndex) toIndex--;
          if (fromIndex !== toIndex) {
            reorderTab(tgt.paneID, fromIndex, toIndex);
          }
        } else {
          // Move to another pane
          moveTab(drag.sourcePaneID, tgt.paneID, drag.slotID);
        }
      } else {
        // Pane drop
        const { zone, paneID } = tgt;
        if (zone === "center") {
          // Don't add if already there
          const runtime = useWorkspaceStore.getState().activeRuntime();
          const leaf = runtime?.root ? findLeafInTree(runtime.root, paneID) : null;
          if (leaf?.slotIDs.includes(drag.slotID)) return;
          addTabToPane(paneID, drag.slotID);
        } else {
          // Prevent splitting a single-tab pane onto itself
          if (
            drag.sourcePaneID === paneID
          ) {
            const runtime = useWorkspaceStore.getState().activeRuntime();
            const leaf = runtime?.root ? findLeafInTree(runtime.root, paneID) : null;
            if (leaf && leaf.slotIDs.length === 1) return;
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
          splitPane(paneID, drag.slotID, axisMap[zone], posMap[zone]);
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
  }, [dragState, onDone, splitPane, addTabToPane, reorderTab, moveTab]);

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
        {dragState.slotName}
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
      {target?.kind === "tab" && (
        <div
          className="fixed pointer-events-none z-[10000] w-[3px] bg-blue-500 rounded-full"
          style={{
            left: target.lineX - 1,
            top: target.barRect.top + 4,
            height: target.barRect.height - 8,
          }}
        />
      )}
    </div>,
    document.body
  );
}

// ── Helpers ────────────────────────────────────────────────────────────

function findLeafInTree(
  node: { type: string; id: string; slotIDs?: string[]; children?: any[] },
  paneID: string
): { slotIDs: string[] } | null {
  if (node.type === "leaf" && node.id === paneID) return node as any;
  if (node.type === "split" && node.children) {
    for (const child of node.children) {
      const found = findLeafInTree(child, paneID);
      if (found) return found;
    }
  }
  return null;
}

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
