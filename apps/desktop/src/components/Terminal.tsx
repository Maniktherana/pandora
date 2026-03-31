import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { terminalTheme } from "@/lib/theme";

interface TerminalSurfaceRect {
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
}

export interface TerminalSurfaceProps {
  sessionID: string;
  workspaceId: string;
  surfaceId: string;
  visible: boolean;
  focused: boolean;
  onFocus?: () => void;
  /** When set, geometry comes from this element and the instance can stay mounted across layout tree moves (split/merge). */
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
  const createdRef = useRef(false);
  const lastRectRef = useRef("");
  const lastDprRef = useRef(typeof window !== "undefined" ? window.devicePixelRatio : 1);
  const [nativeOk, setNativeOk] = useState<boolean | null>(null);

  const nativeOkRef = useRef<boolean | null>(null);
  nativeOkRef.current = nativeOk;

  const ctxRef = useRef({ sessionID, workspaceId, surfaceId, visible, focused, anchorElement });
  ctxRef.current = { sessionID, workspaceId, surfaceId, visible, focused, anchorElement };

  useEffect(() => {
    void invoke<boolean>("native_terminal_supported")
      .then(setNativeOk)
      .catch(() => setNativeOk(false));
  }, []);

  const performSync = useCallback((forceCreate: boolean) => {
    if (nativeOkRef.current !== true) return;
    const el = ctxRef.current.anchorElement ?? containerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (r.width <= 0 || r.height <= 0) return;

    const rect: TerminalSurfaceRect = {
      x: r.left,
      y: r.top,
      width: r.width,
      height: r.height,
      scaleFactor: dpr,
    };

    const { sessionID: sid, workspaceId: wid, surfaceId: sfid, visible: vis, focused: foc } =
      ctxRef.current;

    if (!createdRef.current || forceCreate) {
      createdRef.current = true;
      lastRectRef.current = "";
      void invoke("terminal_surface_create", {
        surfaceId: sfid,
        workspaceId: wid,
        sessionId: sid,
        rect,
      }).catch((e) => console.error("Failed to create native surface:", e));
    }

    const key = JSON.stringify({ rect, visible: vis, focused: foc });
    if (!forceCreate && key === lastRectRef.current) return;
    lastRectRef.current = key;

    void invoke("terminal_surface_update", {
      surfaceId: sfid,
      rect,
      visible: vis,
      focused: foc,
    }).catch(() => {});
  }, []);

  const performSyncRef = useRef(performSync);
  performSyncRef.current = performSync;

  // Create once per (session, surface); destroy only when this effect cleans up — not on focus/visibility/sync churn.
  useEffect(() => {
    if (nativeOk !== true || !sessionID) return;

    const bootstrap = () => performSyncRef.current(true);
    bootstrap();
    let innerRaf = 0;
    const outerRaf = requestAnimationFrame(() => {
      innerRaf = requestAnimationFrame(bootstrap);
    });

    return () => {
      cancelAnimationFrame(outerRaf);
      cancelAnimationFrame(innerRaf);
      createdRef.current = false;
      lastRectRef.current = "";
      void invoke("terminal_surface_destroy", { surfaceId }).catch(() => {});
    };
  }, [nativeOk, sessionID, surfaceId]);

  // Geometry + scale: ResizeObserver, window resize, Tauri scale/window move, DPR poll (monitor changes).
  useEffect(() => {
    if (nativeOk !== true) return;
    const el = anchorElement ?? containerRef.current;
    if (!el) return;

    const sync = () => performSyncRef.current(false);

    const ro = new ResizeObserver(sync);
    ro.observe(el);

    const onWinResize = () => sync();
    window.addEventListener("resize", onWinResize);

    let cancelled = false;
    const unlisteners: Array<() => void> = [];
    void getCurrentWindow()
      .onScaleChanged(() => {
        lastDprRef.current = window.devicePixelRatio || 1;
        sync();
      })
      .then((u) => {
        if (!cancelled) unlisteners.push(u);
      })
      .catch(() => {});
    void getCurrentWindow()
      .onResized(() => sync())
      .then((u) => {
        if (!cancelled) unlisteners.push(u);
      })
      .catch(() => {});

    const dprTimer = window.setInterval(() => {
      const d = window.devicePixelRatio || 1;
      if (Math.abs(d - lastDprRef.current) > 0.001) {
        lastDprRef.current = d;
        sync();
      }
    }, 200);

    return () => {
      cancelled = true;
      ro.disconnect();
      window.removeEventListener("resize", onWinResize);
      window.clearInterval(dprTimer);
      for (const u of unlisteners) u();
    };
  }, [nativeOk, surfaceId, anchorElement]);

  // Visibility / focus — update native surface without destroy/recreate.
  useEffect(() => {
    if (nativeOk !== true) return;
    performSyncRef.current(false);
    if (!visible) return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => performSyncRef.current(false));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [nativeOk, visible, focused]);

  const errorUi = (
    <div
      className="flex h-full w-full items-center justify-center px-4 text-center text-sm text-amber-200/90"
      style={{ background: terminalTheme.background ?? "#0a0a0a" }}
    >
      <div>
        <div>Native Ghostty runs only in the desktop app on Apple Silicon.</div>
        <div className="mt-1 text-xs text-neutral-500">
          Use <code className="text-neutral-400">bun run desktop:dev</code> on an arm64 Mac.
        </div>
      </div>
    </div>
  );

  if (nativeOk === false) {
    if (anchorElement) {
      return createPortal(
        <div className="absolute inset-0 overflow-hidden">{errorUi}</div>,
        anchorElement
      );
    }
    return errorUi;
  }

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
