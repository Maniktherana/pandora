/**
 * Pane layout primitives.
 *
 * `Pane` sets `data-dnd-pane` so the DndProvider overlay can hit-test
 * this container as a split/tab drop target.
 *
 * Usage:
 *   <Pane paneId="p1">
 *     <TabBar>…</TabBar>
 *     <PaneContent style={{ background }}>
 *       <terminal />
 *     </PaneContent>
 *   </Pane>
 */

import { cn } from "@/lib/utils";

// ── Pane ───────────────────────────────────────────────────────────────

interface PaneProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Unique pane id — written to `data-dnd-pane` for drop-zone hit-testing. */
  paneId: string;
}

function Pane({ paneId, className, ...props }: PaneProps) {
  return (
    <div
      data-dnd-pane={paneId}
      className={cn("flex flex-col h-full overflow-hidden rounded-sm relative", className)}
      {...props}
    />
  );
}

// ── PaneContent ────────────────────────────────────────────────────────

interface PaneContentProps extends React.HTMLAttributes<HTMLDivElement> {}

function PaneContent({ className, ...props }: PaneContentProps) {
  return <div className={cn("flex-1 min-h-0 relative", className)} {...props} />;
}

export { Pane, PaneContent };
