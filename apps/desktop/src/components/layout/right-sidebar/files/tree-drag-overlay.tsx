import { createPortal } from "react-dom";
import type { InternalTreeDragSession } from "./files.types";

export function TreeDragOverlay({ session }: { session: InternalTreeDragSession }) {
  return createPortal(
    <div
      className="pointer-events-none fixed z-[10001] rounded border border-[var(--theme-border)] bg-[var(--theme-panel-elevated)] px-2.5 py-1 text-xs text-[var(--theme-text)] shadow-lg"
      style={{
        left: Math.min(session.pointer.x + 14, window.innerWidth - 220),
        top: Math.min(session.pointer.y + 16, window.innerHeight - 40),
      }}
    >
      {session.label}
    </div>,
    document.body
  );
}

