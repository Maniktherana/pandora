import { Effect } from "effect";
import { useEffect, useLayoutEffect, useRef } from "react";
import { useDesktopRuntime } from "@/hooks/use-bootstrap-desktop";
import { TerminalSurfaceService } from "@/services/terminal/terminal-surface-service";
import { terminalTheme } from "@/lib/terminal/terminal-theme";

export interface TerminalSurfaceProps {
  sessionID: string;
  workspaceId: string;
  surfaceId: string;
  visible: boolean;
  focused: boolean;
  onFocus?: () => void;
  anchorElement?: HTMLElement | null;
}

export default function TerminalSurface({
  sessionID,
  workspaceId,
  surfaceId,
  visible,
  focused,
  onFocus,
  anchorElement = null,
}: TerminalSurfaceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const runtime = useDesktopRuntime();

  useLayoutEffect(() => {
    if (!sessionID) return;
    const currentAnchor = anchorElement ?? containerRef.current;
    if (!currentAnchor) return;
    console.debug("[terminal-surface]", "upsertSurface", {
      workspaceId,
      sessionID,
      surfaceId,
      visible,
      focused,
      hasAnchorElement: Boolean(anchorElement),
    });

    void runtime.runPromise(
      Effect.flatMap(TerminalSurfaceService, (manager) =>
        manager.upsertSurface({
          workspaceId,
          sessionId: sessionID,
          surfaceId,
          anchorElement: currentAnchor,
          visible,
          focused,
          onFocus,
        })
      )
    ).catch((error) => {
      console.error("Failed to register native terminal surface:", error);
    });
  }, [anchorElement, focused, onFocus, runtime, sessionID, surfaceId, visible, workspaceId]);

  useEffect(() => {
    if (!sessionID) return;
    return () => {
      void runtime.runPromise(
        Effect.flatMap(TerminalSurfaceService, (manager) => manager.parkSurface(surfaceId))
      ).catch(() => {});
    };
  }, [runtime, sessionID, surfaceId]);

  if (anchorElement) {
    return null;
  }

  return (
    <div
      className="relative h-full w-full overflow-hidden"
      style={{ background: terminalTheme.background ?? "#0a0a0a" }}
    >
      <div
        ref={containerRef}
        className="h-full w-full"
        onMouseDown={onFocus}
        style={{ background: "transparent" }}
      />
    </div>
  );
}
