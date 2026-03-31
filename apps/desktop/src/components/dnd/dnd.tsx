/**
 * Pointer-event drag-and-drop primitives.
 *
 * HTML5 Drag-and-Drop is broken in Tauri webviews. These primitives use
 * raw pointer events instead (same approach as VS Code).
 *
 * Hit-testing is driven by data attributes on the DOM:
 *   data-dnd-pane={id}       — pane containers (drop targets for splits)
 *   data-dnd-tab={id}        — individual tabs  (drop targets for reorder)
 *   data-dnd-tab-pane={id}   — on tabs, identifies the owning pane
 *
 * Usage:
 *   <DndProvider onDrop={handleDrop}>
 *     <Pane data-dnd-pane={paneId}>
 *       <Tab data-dnd-tab={tabId} data-dnd-tab-pane={paneId} />
 *     </Pane>
 *   </DndProvider>
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
import { cn } from "@/lib/utils";

// ── Public types ───────────────────────────────────────────────────────

export interface DragItem {
  /** Unique id of the thing being dragged (e.g. slotID) */
  id: string;
  /** Id of the source pane */
  sourceId: string;
  /** Display label shown in drag ghost */
  label: string;
}

export type DropZone = "center" | "left" | "right" | "top" | "bottom";

export interface PaneDrop {
  kind: "pane";
  paneId: string;
  zone: DropZone;
}

export interface TabDrop {
  kind: "tab";
  paneId: string;
  index: number;
}

export type DropResult = PaneDrop | TabDrop;

// ── Context ────────────────────────────────────────────────────────────

interface DndContextValue {
  /** The item currently being dragged, or null. */
  dragItem: DragItem | null;
  /** Begin a drag operation. Call from pointerdown after a movement threshold. */
  startDrag: (item: DragItem) => void;
}

const DndContext = createContext<DndContextValue | null>(null);

/**
 * Access the current drag state and `startDrag` action.
 * Must be called inside a `<DndProvider>`.
 */
export function useDnd() {
  const ctx = useContext(DndContext);
  if (!ctx) throw new Error("useDnd must be used within <DndProvider>");
  return ctx;
}

// ── Hit-testing (reads data-dnd-* attributes) ──────────────────────────

function hitTestPanes(
  x: number,
  y: number
): { paneId: string; rect: DOMRect; zone: DropZone } | null {
  const panes = document.querySelectorAll<HTMLElement>("[data-dnd-pane]");
  for (const el of panes) {
    const r = el.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
    const rx = (x - r.left) / r.width;
    const ry = (y - r.top) / r.height;
    const e = 0.25;
    let zone: DropZone;
    if (rx < e) zone = "left";
    else if (rx > 1 - e) zone = "right";
    else if (ry < e) zone = "top";
    else if (ry > 1 - e) zone = "bottom";
    else zone = "center";
    return { paneId: el.dataset.dndPane!, rect: r, zone };
  }
  return null;
}

interface TabHit {
  paneId: string;
  index: number;
  lineX: number;
  barRect: DOMRect;
}

function hitTestTabs(x: number, y: number): TabHit | null {
  const tabs = document.querySelectorAll<HTMLElement>("[data-dnd-tab]");
  if (tabs.length === 0) return null;

  // Group by pane
  const byPane = new Map<string, HTMLElement[]>();
  for (const t of tabs) {
    const pid = t.dataset.dndTabPane!;
    let list = byPane.get(pid);
    if (!list) {
      list = [];
      byPane.set(pid, list);
    }
    list.push(t);
  }

  for (const [paneId, els] of byPane) {
    const first = els[0].getBoundingClientRect();
    if (y < first.top || y > first.bottom) continue;

    const last = els[els.length - 1].getBoundingClientRect();
    if (x < first.left || x > last.right + 60) continue;

    for (let i = 0; i < els.length; i++) {
      const r = els[i].getBoundingClientRect();
      if (x < r.left + r.width / 2) {
        return { paneId, index: i, lineX: r.left, barRect: first };
      }
    }
    return { paneId, index: els.length, lineX: last.right, barRect: first };
  }
  return null;
}

// ── Internal drop target types (includes rects for overlay positioning) ─

interface PaneDropTarget {
  kind: "pane";
  paneId: string;
  zone: DropZone;
  rect: DOMRect;
}

interface TabDropTarget {
  kind: "tab";
  paneId: string;
  index: number;
  lineX: number;
  barRect: DOMRect;
}

type InternalDropTarget = PaneDropTarget | TabDropTarget;

function toDropResult(t: InternalDropTarget): DropResult {
  return t.kind === "pane"
    ? { kind: "pane", paneId: t.paneId, zone: t.zone }
    : { kind: "tab", paneId: t.paneId, index: t.index };
}

// ── Overlay ────────────────────────────────────────────────────────────

function DndOverlay({
  item,
  onDrop,
  onCancel,
}: {
  item: DragItem;
  onDrop: (item: DragItem, target: DropResult) => void;
  onCancel: () => void;
}) {
  const [cursor, setCursor] = useState({ x: 0, y: 0 });
  const [target, setTarget] = useState<InternalDropTarget | null>(null);
  const targetRef = useRef<InternalDropTarget | null>(null);

  useEffect(() => {
    function onMove(e: PointerEvent) {
      setCursor({ x: e.clientX, y: e.clientY });

      const tabHit = hitTestTabs(e.clientX, e.clientY);
      if (tabHit) {
        const t: TabDropTarget = { kind: "tab", ...tabHit };
        targetRef.current = t;
        setTarget(t);
        return;
      }

      const paneHit = hitTestPanes(e.clientX, e.clientY);
      if (paneHit) {
        const t: PaneDropTarget = { kind: "pane", ...paneHit };
        targetRef.current = t;
        setTarget(t);
      } else {
        targetRef.current = null;
        setTarget(null);
      }
    }

    function onUp() {
      const t = targetRef.current;
      if (t) {
        onDrop(item, toDropResult(t));
      }
      onCancel();
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("keydown", onKey);
    };
  }, [item, onDrop, onCancel]);

  return createPortal(
    <div className="fixed inset-0 z-[9999]" style={{ cursor: "grabbing" }}>
      {/* Ghost preview */}
      <div
        className="fixed pointer-events-none z-[10001] px-3 py-1.5 rounded bg-neutral-800 border border-neutral-600 text-xs text-neutral-200 shadow-xl whitespace-nowrap"
        style={{ left: cursor.x + 12, top: cursor.y - 10 }}
      >
        {item.label}
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

      {/* Tab insertion line */}
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

// ── Provider ───────────────────────────────────────────────────────────

interface DndProviderProps {
  children: ReactNode;
  /** Called when a drag item is released over a valid target. */
  onDrop: (item: DragItem, target: DropResult) => void;
}

/**
 * Provides drag-and-drop context for descendant components.
 * Renders a full-screen pointer-event overlay during active drags.
 */
function DndProvider({ children, onDrop }: DndProviderProps) {
  const [dragItem, setDragItem] = useState<DragItem | null>(null);

  const startDrag = useCallback((item: DragItem) => {
    setDragItem(item);
  }, []);

  const endDrag = useCallback(() => {
    setDragItem(null);
  }, []);

  return (
    <DndContext.Provider value={{ dragItem, startDrag }}>
      {children}
      {dragItem && <DndOverlay item={dragItem} onDrop={onDrop} onCancel={endDrag} />}
    </DndContext.Provider>
  );
}

export { DndProvider };
