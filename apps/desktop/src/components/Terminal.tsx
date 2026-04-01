import { invoke } from "@tauri-apps/api/core";
import { TauriEvent } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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
    // Guard: detached or hidden anchors can report a 0x0 rect; skip sync so we do not
    // position the native terminal at (0,0). The next valid anchor measurement will catch up.
    if (r.width <= 0 || r.height <= 0) return;

    // Layout only from the webview (CSS pixels / points). Scale is applied on the native side
    // (Rust + NSView backing) — same idea as a normal AppKit terminal, not devicePixelRatio here.
    const rect: TerminalSurfaceRect = {
      x: r.left,
      y: r.top,
      width: r.width,
      height: r.height,
      scaleFactor: 1,
    };

    const { sessionID: sid, workspaceId: wid, surfaceId: sfid, visible: vis, focused: foc } =
      ctxRef.current;

    if (!createdRef.current || forceCreate) {
      createdRef.current = true;
      void invoke("terminal_surface_create", {
        surfaceId: sfid,
        workspaceId: wid,
        sessionId: sid,
        rect,
      }).catch((e) => console.error("Failed to create native surface:", e));
    }

    // Rust overwrites scale from the NSWindow; the terminal NSView also syncs Ghostty on
    // viewDidChangeBackingProperties when the window moves between displays.
    void invoke("terminal_surface_update", {
      surfaceId: sfid,
      rect,
      visible: vis,
      focused: foc,
    }).catch(() => {});
  }, []);

  const performSyncRef = useRef(performSync);
  performSyncRef.current = performSync;

  const rafSyncRef = useRef<number | null>(null);
  const scheduleSync = useCallback(() => {
    if (rafSyncRef.current != null) return;
    rafSyncRef.current = requestAnimationFrame(() => {
      rafSyncRef.current = null;
      performSyncRef.current(false);
    });
  }, []);

  // Create once per (session, surface); destroy only when this effect cleans up — not on focus/visibility/sync churn.
  useEffect(() => {
    if (nativeOk !== true || !sessionID) return;

    let cancelled = false;
    let innerRaf = 0;
    let outerRaf = 0;

    queueMicrotask(() => {
      if (!cancelled) performSyncRef.current(true);
    });
    outerRaf = requestAnimationFrame(() => {
      innerRaf = requestAnimationFrame(() => {
        if (!cancelled) performSyncRef.current(true);
      });
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(outerRaf);
      cancelAnimationFrame(innerRaf);
      createdRef.current = false;
      void invoke("terminal_surface_destroy", { surfaceId }).catch(() => {});
    };
  }, [nativeOk, sessionID, surfaceId]);

  // Window-level scale/geometry sync: must not depend on a mounted anchor — hoisted surfaces can mount
  // before anchorElement exists; Wry may also deliver tauri://move / tauri://scale-change more reliably than onMoved.
  useEffect(() => {
    if (nativeOk !== true) return;

    const syncNow = () => {
      performSyncRef.current(false);
    };

    const onWinResize = () => scheduleSync();
    window.addEventListener("resize", onWinResize);

    const onVis = () => {
      if (document.visibilityState === "visible") syncNow();
    };
    document.addEventListener("visibilitychange", onVis);

    let cancelled = false;
    const unlisteners: Array<() => void> = [];
    const win = getCurrentWindow();
    const push = (p: Promise<() => void>) => {
      void p
        .then((u) => {
          if (!cancelled) unlisteners.push(u);
        })
        .catch(() => {});
    };
    push(win.onScaleChanged(() => syncNow()));
    push(win.onResized(() => scheduleSync()));
    push(win.onMoved(() => syncNow()));
    push(win.listen(TauriEvent.WINDOW_MOVED, () => syncNow()));
    push(win.listen(TauriEvent.WINDOW_RESIZED, () => scheduleSync()));
    push(win.listen(TauriEvent.WINDOW_SCALE_FACTOR_CHANGED, () => syncNow()));

    const scalePoll = window.setInterval(() => {
      scheduleSync();
    }, 2000);

    return () => {
      cancelled = true;
      if (rafSyncRef.current != null) {
        cancelAnimationFrame(rafSyncRef.current);
        rafSyncRef.current = null;
      }
      window.removeEventListener("resize", onWinResize);
      document.removeEventListener("visibilitychange", onVis);
      window.clearInterval(scalePoll);
      for (const u of unlisteners) u();
    };
  }, [nativeOk, scheduleSync]);

  // Layout changes inside the webview (pane resize, file tree) — coalesce to one native update per frame.
  useEffect(() => {
    if (nativeOk !== true) return;
    const el = anchorElement ?? containerRef.current;
    if (!el) return;

    const ro = new ResizeObserver(() => scheduleSync());
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (rafSyncRef.current != null) {
        cancelAnimationFrame(rafSyncRef.current);
        rafSyncRef.current = null;
      }
    };
  }, [nativeOk, surfaceId, anchorElement, scheduleSync]);

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

  // Native terminal surfaces are hosted outside the React tree, so layout changes can leave them
  // with stale geometry for a frame if we only rely on resize events. Sync again after every render.
  useLayoutEffect(() => {
    if (nativeOk !== true) return;
    performSyncRef.current(false);
    let rafA = 0;
    let rafB = 0;
    rafA = requestAnimationFrame(() => {
      performSyncRef.current(false);
      rafB = requestAnimationFrame(() => {
        performSyncRef.current(false);
      });
    });
    return () => {
      cancelAnimationFrame(rafA);
      cancelAnimationFrame(rafB);
    };
  });

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
