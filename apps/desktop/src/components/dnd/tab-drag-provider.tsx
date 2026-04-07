import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { Effect } from "effect";
import { useDesktopRuntime } from "@/hooks/use-bootstrap-desktop";
import { TerminalSurfaceService } from "@/services/terminal/terminal-surface-service";
import { TabDragOverlay } from "./tab-drag-overlay";
import type { DragState } from "./tab-drag.types";

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

export function TabDragProvider({ children }: { children: ReactNode }) {
  const [dragState, setDragState] = useState<DragState | null>(null);
  const runtime = useDesktopRuntime();

  useEffect(() => {
    if (!dragState) return;
    void runtime.runPromise(
      Effect.flatMap(TerminalSurfaceService, (manager) => manager.beginWebOverlay()).pipe(
        Effect.catchAll(() => Effect.void),
      ),
    );
    return () => {
      void runtime.runPromise(
        Effect.flatMap(TerminalSurfaceService, (manager) => manager.endWebOverlay()).pipe(
          Effect.catchAll(() => Effect.void),
        ),
      );
    };
  }, [dragState, runtime]);

  const startDrag = useCallback((state: DragState) => {
    setDragState(state);
  }, []);

  const endDrag = useCallback(() => {
    setDragState(null);
  }, []);

  return (
    <TabDragContext.Provider value={{ dragState, startDrag }}>
      {children}
      {dragState && <TabDragOverlay dragState={dragState} onDone={endDrag} />}
    </TabDragContext.Provider>
  );
}
