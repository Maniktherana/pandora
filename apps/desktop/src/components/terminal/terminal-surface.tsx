import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { terminalSurfaceService } from "@/lib/services/terminal/surface";

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
    void terminalSurfaceService
      .upsertSurface({
        workspaceId,
        sessionId: sessionID,
        surfaceId,
        anchorElement: currentAnchor,
        visible,
        focused,
        overlayExempt,
        onFocus: handleFocus,
      })
      .catch((error) => {
        console.error("Failed to register native terminal surface:", error);
      });
  }, [
    anchorElement,
    focused,
    handleFocus,
    overlayExempt,
    sessionID,
    surfaceId,
    visible,
    workspaceId,
  ]);

  useEffect(() => {
    if (!sessionID) return;
    return () => {
      void terminalSurfaceService.parkSurface(surfaceId).catch(() => {});
    };
  }, [sessionID, surfaceId]);

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
