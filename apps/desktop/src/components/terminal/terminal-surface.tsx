import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Effect } from "effect";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAppRuntime } from "@/hooks/use-app-runtime";
import { NativeSurfaceManager } from "@/lib/effect/services/native-surface-manager";
import { terminalTheme } from "@/lib/terminal/terminal-theme";

interface TerminalSurfaceRect {
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
}

interface NativeSyncPayload {
  rect: TerminalSurfaceRect;
  signature: string;
}

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
  const runtime = useAppRuntime();
  const createdRef = useRef(false);
  const [nativeOk, setNativeOk] = useState<boolean | null>(null);
  const lastSignatureRef = useRef<string | null>(null);
  const rafSyncRef = useRef<number | null>(null);
  const pendingCreateRef = useRef(false);
  const syncInFlightRef = useRef(false);
  const resyncRequestedRef = useRef(false);

  const nativeOkRef = useRef<boolean | null>(null);
  nativeOkRef.current = nativeOk;
  const onFocusRef = useRef(onFocus);
  onFocusRef.current = onFocus;

  const ctxRef = useRef({ sessionID, workspaceId, surfaceId, visible, focused, anchorElement });
  ctxRef.current = { sessionID, workspaceId, surfaceId, visible, focused, anchorElement };

  useEffect(() => {
    void invoke<boolean>("native_terminal_supported")
      .then(setNativeOk)
      .catch(() => setNativeOk(false));
  }, []);

  useEffect(() => {
    if (!sessionID) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void listen<string>("native-terminal-focus", (event) => {
      if (!cancelled && event.payload === sessionID) {
        onFocusRef.current?.();
      }
    }).then((fn) => {
      if (cancelled) {
        fn();
        return;
      }
      unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [sessionID]);

  const buildPayload = useCallback((): NativeSyncPayload | null => {
    const el = ctxRef.current.anchorElement ?? containerRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;

    const snap = (value: number) => Math.round(value * 4) / 4;

    const rect: TerminalSurfaceRect = {
      x: snap(r.left),
      y: snap(r.top),
      width: snap(r.width),
      height: snap(r.height),
      scaleFactor: 1,
    };

    return {
      rect,
      signature: JSON.stringify({
        rect,
        visible: ctxRef.current.visible,
        focused: ctxRef.current.focused,
      }),
    };
  }, []);

  const syncNative = useCallback(async (forceCreate: boolean) => {
    if (nativeOkRef.current !== true) return;
    const payload = buildPayload();
    if (!payload) return;

    const { sessionID: sid, workspaceId: wid, surfaceId: sfid, visible: vis, focused: foc } =
      ctxRef.current;

    if (!createdRef.current || forceCreate) {
      lastSignatureRef.current = null;
      pendingCreateRef.current = false;
      createdRef.current = true;
      await runtime.runPromise(
        Effect.flatMap(NativeSurfaceManager, (manager) =>
          manager.createSurface(wid, sid, sfid, payload.rect)
        )
      ).catch((e) => {
        createdRef.current = false;
        throw e;
      });
    }

    if (lastSignatureRef.current === payload.signature) return;
    lastSignatureRef.current = payload.signature;

    await runtime.runPromise(
      Effect.flatMap(NativeSurfaceManager, (manager) =>
        manager.updateSurface(sfid, payload.rect, vis, foc)
      )
    ).catch((error) => {
      lastSignatureRef.current = null;
      throw error;
    });
  }, [buildPayload, runtime]);

  const runSync = useCallback(async () => {
    if (syncInFlightRef.current) {
      resyncRequestedRef.current = true;
      return;
    }

    syncInFlightRef.current = true;
    try {
      do {
        const forceCreate = pendingCreateRef.current;
        pendingCreateRef.current = false;
        resyncRequestedRef.current = false;
        await syncNative(forceCreate);
      } while (resyncRequestedRef.current);
    } catch (error) {
      console.error("Failed to sync native terminal surface:", error);
    } finally {
      syncInFlightRef.current = false;
    }
  }, [syncNative]);

  const scheduleSync = useCallback((forceCreate = false) => {
    if (nativeOkRef.current !== true) return;
    if (forceCreate) pendingCreateRef.current = true;
    if (rafSyncRef.current != null) return;
    rafSyncRef.current = requestAnimationFrame(() => {
      rafSyncRef.current = null;
      void runSync();
    });
  }, [runSync]);

  useEffect(() => {
    if (nativeOk !== true || !sessionID) return;

    createdRef.current = false;
    lastSignatureRef.current = null;
    scheduleSync(true);

    return () => {
      if (rafSyncRef.current != null) {
        cancelAnimationFrame(rafSyncRef.current);
        rafSyncRef.current = null;
      }
      pendingCreateRef.current = false;
      resyncRequestedRef.current = false;
      createdRef.current = false;
      lastSignatureRef.current = null;
      void runtime.runPromise(
        Effect.flatMap(NativeSurfaceManager, (manager) =>
          manager.releaseSurface(surfaceId)
        )
      ).catch(() => {});
    };
  }, [nativeOk, runtime, sessionID, surfaceId, scheduleSync]);

  useEffect(() => {
    if (nativeOk !== true) return;
    const onWinResize = () => scheduleSync();
    window.addEventListener("resize", onWinResize);

    const onVis = () => {
      if (document.visibilityState === "visible") scheduleSync();
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
    push(win.onScaleChanged(() => scheduleSync()));
    push(win.onResized(() => scheduleSync()));
    push(win.onMoved(() => scheduleSync()));

    return () => {
      cancelled = true;
      if (rafSyncRef.current != null) {
        cancelAnimationFrame(rafSyncRef.current);
        rafSyncRef.current = null;
      }
      window.removeEventListener("resize", onWinResize);
      document.removeEventListener("visibilitychange", onVis);
      for (const u of unlisteners) u();
    };
  }, [nativeOk, scheduleSync]);

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

  useLayoutEffect(() => {
    if (nativeOk !== true || !sessionID) return;
    scheduleSync();
  }, [nativeOk, sessionID, surfaceId, anchorElement, visible, focused, scheduleSync]);

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
