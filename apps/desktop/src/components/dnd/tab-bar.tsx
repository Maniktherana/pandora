/**
 * Tab bar primitives with built-in pointer-event drag support.
 *
 * Adds `data-dnd-tab` / `data-dnd-tab-pane` attributes so the DndProvider
 * overlay can hit-test tabs during a drag.
 *
 * Usage:
 *   <TabBar>
 *     <Tab tabId="t1" paneId="p1" label="Shell" active onSelect={...}>
 *       Shell
 *       <TabClose onClick={...} />
 *     </Tab>
 *   </TabBar>
 */

import { useRef, useCallback, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useDnd } from "./dnd";
import { X } from "lucide-react";

const DRAG_THRESHOLD = 5;

// ── TabBar ─────────────────────────────────────────────────────────────

interface TabBarProps extends React.HTMLAttributes<HTMLDivElement> {}

function TabBar({ className, children, ...props }: TabBarProps) {
  return (
    <div
      className={cn(
        "flex items-center h-8 bg-neutral-900/80 border-b border-neutral-800 overflow-x-auto scrollbar-none",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

// ── Tab ────────────────────────────────────────────────────────────────

interface TabProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onSelect"> {
  /** Unique id for this tab (used in drag data + data attribute). */
  tabId: string;
  /** The pane this tab belongs to. */
  paneId: string;
  /** Display label shown in the drag ghost. */
  label: string;
  /** Whether this tab is currently selected. */
  active?: boolean;
  /** Called when the tab is clicked (not dragged). */
  onSelect?: () => void;
  children?: ReactNode;
}

function Tab({
  tabId,
  paneId,
  label,
  active,
  onSelect,
  className,
  children,
  ...props
}: TabProps) {
  const { startDrag, dragItem } = useDnd();
  const pendingRef = useRef<{ x: number; y: number } | null>(null);
  const isDragging = dragItem?.id === tabId;

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      pendingRef.current = { x: e.clientX, y: e.clientY };
    },
    []
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const p = pendingRef.current;
      if (!p) return;
      if (Math.abs(e.clientX - p.x) + Math.abs(e.clientY - p.y) > DRAG_THRESHOLD) {
        startDrag({ id: tabId, sourceId: paneId, label });
        pendingRef.current = null;
      }
    },
    [tabId, paneId, label, startDrag]
  );

  const onPointerUp = useCallback(() => {
    if (pendingRef.current) {
      onSelect?.();
      pendingRef.current = null;
    }
  }, [onSelect]);

  return (
    <div
      data-dnd-tab={tabId}
      data-dnd-tab-pane={paneId}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => { pendingRef.current = null; }}
      className={cn(
        "relative flex items-center gap-1.5 pl-3 pr-1.5 h-full text-xs border-r border-neutral-800 shrink-0 cursor-default select-none",
        active
          ? "bg-neutral-900 text-neutral-200"
          : "text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800/30",
        isDragging && "opacity-30",
        className
      )}
      {...props}
    >
      {children}
      {active && (
        <span className="pointer-events-none absolute inset-x-2 bottom-0 h-px bg-neutral-500" />
      )}
    </div>
  );
}

// ── TabLabel ───────────────────────────────────────────────────────────

interface TabLabelProps extends React.HTMLAttributes<HTMLSpanElement> {}

function TabLabel({ className, ...props }: TabLabelProps) {
  return (
    <span
      className={cn("truncate max-w-[120px] pointer-events-none", className)}
      {...props}
    />
  );
}

// ── TabClose ───────────────────────────────────────────────────────────

interface TabCloseProps extends React.HTMLAttributes<HTMLDivElement> {
  active?: boolean;
}

function TabClose({ active, className, ...props }: TabCloseProps) {
  return (
    <div
      role="button"
      tabIndex={-1}
      onPointerDown={(e) => e.stopPropagation()}
      className={cn(
        "ml-1 flex h-4 w-4 items-center justify-center rounded-sm transition-colors",
        active
          ? "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
          : "text-neutral-600 hover:bg-neutral-800 hover:text-neutral-200",
        className
      )}
      {...props}
    >
      <X className="h-3 w-3" />
    </div>
  );
}

export { TabBar, Tab, TabLabel, TabClose };
