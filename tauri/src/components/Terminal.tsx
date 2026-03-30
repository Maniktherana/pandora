import { useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { TerminalSurfaceRect } from "@/lib/types";

interface NativeTerminalSurfaceProps {
  surfaceId: string;
  sessionID: string;
  workspaceId: string;
  visible: boolean;
  focused: boolean;
  onFocus?: () => void;
}

export default function NativeTerminalSurface({
  surfaceId,
  sessionID,
  workspaceId,
  visible,
  focused,
  onFocus,
}: NativeTerminalSurfaceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const createdRef = useRef(false);
  const lastRectRef = useRef<string>("");

  // Measure the container and get its position relative to the window
  const measureRect = useCallback((): TerminalSurfaceRect | null => {
    const el = containerRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
      scaleFactor: window.devicePixelRatio || 1,
    };
  }, []);

  const syncSurface = useCallback((forceCreate = false) => {
    const rect = measureRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;

    if (!createdRef.current || forceCreate) {
      createdRef.current = true;
      void invoke("terminal_surface_create", {
        surfaceId,
        workspaceId,
        sessionId: sessionID,
        rect,
      }).catch((e) => console.error("Failed to create native surface:", e));
    }

    const key = JSON.stringify({ rect, visible, focused });
    if (key === lastRectRef.current) return;
    lastRectRef.current = key;

    void invoke("terminal_surface_update", {
      surfaceId,
      rect,
      visible,
      focused,
    }).catch(() => {});
  }, [focused, measureRect, sessionID, surfaceId, visible, workspaceId]);

  // Create surface on mount
  useEffect(() => {
    if (!sessionID) return;
    syncSurface(true);

    return () => {
      if (createdRef.current) {
        createdRef.current = false;
        void invoke("terminal_surface_destroy", { surfaceId }).catch(() => {});
      }
    };
  }, [sessionID, surfaceId, syncSurface]);

  // Update surface geometry on resize
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver(() => {
      syncSurface();
    });

    observer.observe(el);
    window.addEventListener("resize", syncSurface);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", syncSurface);
    };
  }, [syncSurface]);

  // Update visibility and focus
  useEffect(() => {
    syncSurface();
  }, [visible, focused, syncSurface]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      onClick={onFocus}
      style={{
        // Transparent placeholder - native surface renders above
        background: "transparent",
      }}
    />
  );
}
