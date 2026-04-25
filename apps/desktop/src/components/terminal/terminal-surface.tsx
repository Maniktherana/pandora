import { Effect } from "effect";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { useDesktopRuntime } from "@/hooks/use-bootstrap-desktop";
import { TerminalSurfaceService } from "@/services/terminal/terminal-surface-service";

export interface TerminalSurfaceProps {
  sessionID: string;
  workspaceId: string;
  surfaceId: string;
  visible: boolean;
  focused: boolean;
  overlayExempt?: boolean;
  onFocus?: (() => void) | undefined;
  anchorElement?: HTMLElement | null;
}

export default function TerminalSurface({
  sessionID,
  workspaceId,
  surfaceId,
  visible,
  focused,
  overlayExempt = false,
  onFocus,
  anchorElement = null,
}: TerminalSurfaceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onFocusRef = useRef(onFocus);
  const runtime = useDesktopRuntime();

  useEffect(() => {
    onFocusRef.current = onFocus;
  }, [onFocus]);

  const handleFocus = useCallback(() => {
    onFocusRef.current?.();
  }, []);

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

    void runtime
      .runPromise(
        Effect.flatMap(TerminalSurfaceService, (manager) =>
          manager.upsertSurface({
            workspaceId,
            sessionId: sessionID,
            surfaceId,
            anchorElement: currentAnchor,
            visible,
            focused,
            overlayExempt,
            onFocus: handleFocus,
          }),
        ),
      )
      .catch((error) => {
        console.error("Failed to register native terminal surface:", error);
      });
  }, [
    anchorElement,
    focused,
    handleFocus,
    overlayExempt,
    runtime,
    sessionID,
    surfaceId,
    visible,
    workspaceId,
  ]);

  useEffect(() => {
    if (!sessionID) return;
    return () => {
      void runtime
        .runPromise(
          Effect.flatMap(TerminalSurfaceService, (manager) => manager.parkSurface(surfaceId)),
        )
        .catch(() => {});
    };
  }, [runtime, sessionID, surfaceId]);

  if (anchorElement) {
    return null;
  }

  return (
    <div
      className="relative h-full w-full overflow-hidden"
      style={{ background: "var(--theme-terminal-bg, var(--theme-bg))" }}
    >
      <div
        ref={containerRef}
        className="h-full w-full"
        onMouseDown={handleFocus}
        style={{ background: "transparent" }}
      />
    </div>
  );
}
