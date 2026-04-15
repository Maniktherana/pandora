import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Context, Effect, Layer } from "effect";
import { NativeSurfaceError } from "@/services/service-errors";
import { useSettingsStore } from "@/state/settings-store";

export interface SurfaceRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly scaleFactor: number;
}

export interface ManagedSurfaceRegistration {
  workspaceId: string;
  sessionId: string;
  surfaceId: string;
  anchorElement: HTMLElement | null;
  visible: boolean;
  focused: boolean;
  overlayExempt?: boolean;
  onFocus?: () => void;
}

interface ManagedSurfaceEntry extends ManagedSurfaceRegistration {
  resizeObserver: ResizeObserver | null;
  created: boolean;
  lastSignature: string | null;
  lastRect: SurfaceRect | null;
  rafId: number | null;
  syncInFlight: boolean;
  resyncRequested: boolean;
  pendingCreate: boolean;
}

interface NativeSyncPayload {
  rect: SurfaceRect;
  signature: string;
}

export type NativeTerminalOverlayMode = "opaque" | "semi-transparent";

export interface TerminalSurfaceServiceApi {
  readonly isNativeSupported: () => Effect.Effect<boolean>;
  readonly upsertSurface: (
    input: ManagedSurfaceRegistration,
  ) => Effect.Effect<void, NativeSurfaceError>;
  readonly setAllSurfaceFontSizes: (fontSize: number) => Effect.Effect<void, NativeSurfaceError>;
  readonly parkSurface: (surfaceId: string) => Effect.Effect<void, NativeSurfaceError>;
  readonly removeSurface: (surfaceId: string) => Effect.Effect<void, NativeSurfaceError>;
  readonly removeWorkspaceSurfaces: (
    workspaceId: string,
  ) => Effect.Effect<void, NativeSurfaceError>;
  readonly removeAllSurfaces: () => Effect.Effect<void, NativeSurfaceError>;
  readonly refreshAllSurfaces: () => Effect.Effect<void, NativeSurfaceError>;
  readonly beginWebOverlay: (
    mode: NativeTerminalOverlayMode,
  ) => Effect.Effect<void, NativeSurfaceError>;
  readonly endWebOverlay: (
    mode: NativeTerminalOverlayMode,
  ) => Effect.Effect<void, NativeSurfaceError>;
  readonly setWebOcclusionRect: (
    id: string,
    rect: SurfaceRect | null,
  ) => Effect.Effect<void, NativeSurfaceError>;
}

export class TerminalSurfaceService extends Context.Tag("pandora/TerminalSurfaceService")<
  TerminalSurfaceService,
  TerminalSurfaceServiceApi
>() {}

function nativeSurfaceError(cause: unknown, surfaceId: string) {
  return new NativeSurfaceError({ cause, surfaceId });
}

function snapRect(el: HTMLElement): NativeSyncPayload | null {
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;

  const snap = (value: number) => Math.round(value * 4) / 4;

  const nativeRect: SurfaceRect = {
    x: snap(rect.left),
    y: snap(rect.top),
    width: snap(rect.width),
    height: snap(rect.height),
    scaleFactor: 1,
  };

  return {
    rect: nativeRect,
    signature: JSON.stringify({
      rect: nativeRect,
      visible: el.isConnected,
    }),
  };
}

function getObservedElements(anchor: HTMLElement): HTMLElement[] {
  const elements: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();
  let current: HTMLElement | null = anchor;

  while (current) {
    if (!seen.has(current)) {
      elements.push(current);
      seen.add(current);
    }
    current = current.parentElement;
  }

  return elements;
}

export const TerminalSurfaceServiceLive = Layer.effect(
  TerminalSurfaceService,
  Effect.sync(() => {
    const entries = new Map<string, ManagedSurfaceEntry>();
    let nativeSupportPromise: Promise<boolean> | null = null;
    let createQueue: Promise<void> = Promise.resolve();
    const webOverlayDepth = {
      opaque: 0,
      "semi-transparent": 0,
    } satisfies Record<NativeTerminalOverlayMode, number>;
    const webOcclusionRects = new Map<string, SurfaceRect>();
    let webOcclusionQueue: Promise<void> = Promise.resolve();
    let needsSyncAfterOverlay = false;

    const getNativeSupport = () => {
      if (!nativeSupportPromise) {
        nativeSupportPromise = invoke<boolean>("native_terminal_supported").catch(() => false);
      }
      return nativeSupportPromise;
    };

    const ensureNativeSupport = () =>
      Effect.tryPromise({
        try: () => getNativeSupport(),
        catch: (cause) => nativeSurfaceError(cause, "native-terminal-support"),
      });

    const waitForNextFrame = () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });

    const enqueueSurfaceCreate = async (surfaceId: string, task: () => Promise<void>) => {
      const queued = createQueue.then(async () => {
        console.debug("[terminal-surface]", "create queued", { surfaceId });
        await waitForNextFrame();
        await task();
      });
      createQueue = queued.catch(() => {});
      await queued;
    };

    const clearScheduledSync = (entry: ManagedSurfaceEntry) => {
      if (entry.rafId != null) {
        cancelAnimationFrame(entry.rafId);
        entry.rafId = null;
      }
    };

    const clearAllScheduledSyncs = () => {
      for (const entry of entries.values()) {
        clearScheduledSync(entry);
      }
    };

    const isWebOverlayActive = () => Object.values(webOverlayDepth).some((depth) => depth > 0);
    const shouldDeferForOverlay = (entry: ManagedSurfaceEntry, ignoreOverlay: boolean) =>
      isWebOverlayActive() && !ignoreOverlay && !entry.overlayExempt;

    const buildPayload = (entry: ManagedSurfaceEntry) => {
      if (!entry.anchorElement) {
        console.debug("[terminal-surface]", "payload skipped", {
          workspaceId: entry.workspaceId,
          sessionId: entry.sessionId,
          surfaceId: entry.surfaceId,
          reason: "missing anchor element",
        });
        return null;
      }
      const payload = snapRect(entry.anchorElement);
      if (!payload) {
        console.debug("[terminal-surface]", "payload skipped", {
          workspaceId: entry.workspaceId,
          sessionId: entry.sessionId,
          surfaceId: entry.surfaceId,
          reason: "anchor rect has zero width or height",
        });
        return null;
      }

      return {
        rect: payload.rect,
        signature: JSON.stringify({
          rect: payload.rect,
          visible: entry.visible,
          focused: entry.focused,
        }),
      } satisfies NativeSyncPayload;
    };

    const syncSurface = async (entry: ManagedSurfaceEntry, forceCreate: boolean) => {
      const supported = await getNativeSupport();
      if (!supported) {
        console.debug("[terminal-surface]", "create skipped", {
          workspaceId: entry.workspaceId,
          sessionId: entry.sessionId,
          surfaceId: entry.surfaceId,
          reason: "native terminal unsupported",
        });
        return;
      }

      const payload = buildPayload(entry);
      if (!payload) {
        console.debug("[terminal-surface]", "sync skipped", {
          surfaceId: entry.surfaceId,
          reason: "no payload",
        });
        return;
      }

      if (!entry.created || forceCreate) {
        await enqueueSurfaceCreate(entry.surfaceId, async () => {
          if (entries.get(entry.surfaceId) !== entry) return;

          const createPayload = buildPayload(entry);
          if (!createPayload) return;
          if (entry.created && !forceCreate) return;

          console.debug("[terminal-surface]", "create attempted", {
            workspaceId: entry.workspaceId,
            sessionId: entry.sessionId,
            surfaceId: entry.surfaceId,
            forceCreate,
          });
          entry.lastSignature = null;
          entry.pendingCreate = false;
          entry.created = true;
          try {
            const termFontSize = useSettingsStore.getState().terminalFontSize;
            await invoke("terminal_surface_create", {
              workspaceId: entry.workspaceId,
              sessionId: entry.sessionId,
              surfaceId: entry.surfaceId,
              rect: createPayload.rect,
              fontSize: termFontSize > 0 ? termFontSize : null,
              overlayExempt: entry.overlayExempt,
            });
          } catch (cause) {
            entry.created = false;
            throw nativeSurfaceError(cause, entry.surfaceId);
          }
        });
        if (!entry.created) return;
      } else {
        console.debug("[terminal-surface]", "create skipped", {
          workspaceId: entry.workspaceId,
          sessionId: entry.sessionId,
          surfaceId: entry.surfaceId,
          reason: "surface already created",
        });
      }

      if (entry.lastSignature === payload.signature) return;
      entry.lastSignature = payload.signature;
      entry.lastRect = payload.rect;

      try {
        await invoke("terminal_surface_update", {
          surfaceId: entry.surfaceId,
          rect: payload.rect,
          visible: entry.visible,
          focused: entry.focused,
        });
      } catch (cause) {
        entry.lastSignature = null;
        throw nativeSurfaceError(cause, entry.surfaceId);
      }
    };

    const runSync = (entry: ManagedSurfaceEntry, ignoreOverlay = false) => {
      if (shouldDeferForOverlay(entry, ignoreOverlay)) {
        needsSyncAfterOverlay = true;
        return;
      }

      if (entry.syncInFlight) {
        entry.resyncRequested = true;
        return;
      }

      entry.syncInFlight = true;
      void (async () => {
        try {
          do {
            const forceCreate = entry.pendingCreate;
            entry.pendingCreate = false;
            entry.resyncRequested = false;
            await syncSurface(entry, forceCreate);
          } while (entry.resyncRequested);
        } catch (error) {
          console.error("Failed to sync native terminal surface:", error);
        } finally {
          entry.syncInFlight = false;
        }
      })();
    };

    const scheduleSync = (surfaceId: string, forceCreate = false, ignoreOverlay = false) => {
      const entry = entries.get(surfaceId);
      if (!entry) return;
      if (forceCreate) entry.pendingCreate = true;
      if (shouldDeferForOverlay(entry, ignoreOverlay)) {
        needsSyncAfterOverlay = true;
        clearScheduledSync(entry);
        return;
      }
      console.debug("[terminal-surface]", "sync scheduled", {
        workspaceId: entry.workspaceId,
        sessionId: entry.sessionId,
        surfaceId,
        forceCreate,
      });
      if (entry.rafId != null) return;
      entry.rafId = requestAnimationFrame(() => {
        entry.rafId = null;
        runSync(entry, ignoreOverlay);
      });
    };

    const scheduleSettledSyncs = (
      surfaceId: string,
      frames = 3,
      forceCreate = false,
      ignoreOverlay = false,
    ) => {
      if (frames <= 0) {
        scheduleSync(surfaceId, forceCreate, ignoreOverlay);
        return;
      }

      let remainingFrames = frames;
      const tick = () => {
        scheduleSync(surfaceId, forceCreate, ignoreOverlay);
        remainingFrames -= 1;
        if (remainingFrames > 0) {
          requestAnimationFrame(tick);
        }
      };
      requestAnimationFrame(tick);
    };

    const syncAll = () => {
      for (const surfaceId of entries.keys()) {
        scheduleSync(surfaceId);
      }
    };

    const syncWebOcclusionRects = async () => {
      const rects = Array.from(webOcclusionRects.values());
      const queued = webOcclusionQueue.then(() =>
        invoke("terminal_surfaces_set_web_occlusion_rects", { rects }),
      );
      webOcclusionQueue = queued.then(
        () => undefined,
        () => undefined,
      );
      await queued;
    };

    const replaceObserver = (entry: ManagedSurfaceEntry, nextAnchor: HTMLElement | null) => {
      entry.resizeObserver?.disconnect();
      entry.resizeObserver = null;
      if (!nextAnchor) return;

      const observer = new ResizeObserver(() => {
        scheduleSettledSyncs(entry.surfaceId, 3);
      });
      for (const element of getObservedElements(nextAnchor)) {
        observer.observe(element);
      }
      entry.resizeObserver = observer;
    };

    const destroySurfaceEntry = async (surfaceId: string) => {
      const entry = entries.get(surfaceId);
      if (!entry) return;
      clearScheduledSync(entry);
      entry.resizeObserver?.disconnect();
      entries.delete(surfaceId);
      if (!entry.created) return;
      try {
        await invoke("terminal_surface_destroy", { surfaceId });
      } catch {
        // Vite HMR / webview reload can tear down the IPC bridge while teardown runs.
      }
    };

    const parkSurfaceEntry = async (surfaceId: string) => {
      const entry = entries.get(surfaceId);
      if (!entry) return;
      clearScheduledSync(entry);
      entry.resizeObserver?.disconnect();
      entry.resizeObserver = null;
      entry.anchorElement = null;
      entry.visible = false;
      entry.focused = false;
      entry.onFocus = undefined;
      entry.lastSignature = null;
      if (!entry.created || !entry.lastRect) return;
      try {
        await invoke("terminal_surface_update", {
          surfaceId,
          rect: entry.lastRect,
          visible: false,
          focused: false,
        });
      } catch {
        // Same as destroy: reload can invalidate IPC mid-flight.
      }
    };

    const destroyWorkspaceSurfaces = async (workspaceId: string) => {
      const surfaceIds = Array.from(entries.values())
        .filter((entry) => entry.workspaceId === workspaceId)
        .map((entry) => entry.surfaceId);
      for (const surfaceId of surfaceIds) {
        await destroySurfaceEntry(surfaceId);
      }
    };

    const destroyAllSurfaces = async () => {
      const surfaceIds = Array.from(entries.keys());
      for (const surfaceId of surfaceIds) {
        await destroySurfaceEntry(surfaceId);
      }
    };

    void listen<string>("native-terminal-focus", (event) => {
      const payload = event.payload;
      for (const entry of entries.values()) {
        if (entry.sessionId === payload) {
          entry.onFocus?.();
        }
      }
    }).catch(() => {});

    window.addEventListener("resize", syncAll);
    document.addEventListener("scroll", syncAll, true);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        syncAll();
      }
    });

    const win = getCurrentWindow();
    void win.onScaleChanged(syncAll).catch(() => {});
    void win.onResized(syncAll).catch(() => {});
    void win.onMoved(syncAll).catch(() => {});
    void win
      .onCloseRequested(() => {
        void destroyAllSurfaces().catch((error) => {
          console.error("Failed to destroy terminal surfaces on app close:", error);
        });
      })
      .catch(() => {});

    return {
      isNativeSupported: () =>
        ensureNativeSupport().pipe(Effect.catchAll(() => Effect.succeed(false))),
      upsertSurface: (input) =>
        Effect.tryPromise({
          try: async () => {
            let entry = entries.get(input.surfaceId);
            if (!entry) {
              console.debug("[terminal-surface]", "surface inserted", {
                workspaceId: input.workspaceId,
                sessionId: input.sessionId,
                surfaceId: input.surfaceId,
                visible: input.visible,
                focused: input.focused,
                hasAnchorElement: Boolean(input.anchorElement),
              });
              entry = {
                ...input,
                resizeObserver: null,
                created: false,
                lastSignature: null,
                lastRect: null,
                rafId: null,
                syncInFlight: false,
                resyncRequested: false,
                pendingCreate: true,
                overlayExempt: input.overlayExempt ?? false,
              };
              entries.set(input.surfaceId, entry);
              replaceObserver(entry, input.anchorElement);
              scheduleSettledSyncs(input.surfaceId, 4);
            } else {
              const anchorChanged = entry.anchorElement !== input.anchorElement;
              const overlayExempt = input.overlayExempt ?? false;
              const overlayChanged = entry.overlayExempt !== overlayExempt;
              if (anchorChanged) {
                console.debug("[terminal-surface]", "anchor changed", {
                  workspaceId: input.workspaceId,
                  sessionId: input.sessionId,
                  surfaceId: input.surfaceId,
                  hadAnchorElement: Boolean(entry.anchorElement),
                  hasAnchorElement: Boolean(input.anchorElement),
                });
              }
              entry.workspaceId = input.workspaceId;
              entry.sessionId = input.sessionId;
              entry.anchorElement = input.anchorElement;
              entry.visible = input.visible;
              entry.focused = input.focused;
              entry.onFocus = input.onFocus;
              entry.overlayExempt = overlayExempt;
              if (anchorChanged) {
                replaceObserver(entry, input.anchorElement);
                scheduleSettledSyncs(input.surfaceId, 4);
              }
              if (overlayChanged) {
                entry.pendingCreate = true;
              }
            }
            scheduleSync(input.surfaceId);
          },
          catch: (cause) => nativeSurfaceError(cause, input.surfaceId),
        }),
      setAllSurfaceFontSizes: (fontSize) =>
        Effect.tryPromise({
          try: async () => {
            const supported = await getNativeSupport();
            if (!supported) return;

            for (const entry of entries.values()) {
              if (!entry.created) continue;
              await invoke("terminal_surface_set_font_size", {
                surfaceId: entry.surfaceId,
                fontSize,
              });
            }
          },
          catch: (cause) => nativeSurfaceError(cause, "set-all-surface-font-sizes"),
        }),
      parkSurface: (surfaceId) =>
        Effect.tryPromise({
          try: () => parkSurfaceEntry(surfaceId),
          catch: (cause) => nativeSurfaceError(cause, surfaceId),
        }),
      removeSurface: (surfaceId) =>
        Effect.tryPromise({
          try: () => destroySurfaceEntry(surfaceId),
          catch: (cause) => nativeSurfaceError(cause, surfaceId),
        }),
      removeWorkspaceSurfaces: (workspaceId) =>
        Effect.tryPromise({
          try: () => destroyWorkspaceSurfaces(workspaceId),
          catch: (cause) => nativeSurfaceError(cause, workspaceId),
        }),
      removeAllSurfaces: () =>
        Effect.tryPromise({
          try: () => destroyAllSurfaces(),
          catch: (cause) => nativeSurfaceError(cause, "all-surfaces"),
        }),
      refreshAllSurfaces: () =>
        Effect.tryPromise({
          try: async () => {
            for (const entry of entries.values()) {
              clearScheduledSync(entry);
              if (entry.syncInFlight) {
                entry.pendingCreate = true;
                entry.resyncRequested = true;
                continue;
              }
              await syncSurface(entry, true);
            }
          },
          catch: (cause) => nativeSurfaceError(cause, "refresh-all-surfaces"),
        }),
      beginWebOverlay: (mode) =>
        Effect.tryPromise({
          try: async () => {
            const wasActive = isWebOverlayActive();
            webOverlayDepth[mode] += 1;
            if (!wasActive) {
              needsSyncAfterOverlay = false;
              clearAllScheduledSyncs();
            }
            await invoke("terminal_surfaces_begin_web_overlay", { mode });
          },
          catch: (cause) => nativeSurfaceError(cause, "web-overlay"),
        }),
      endWebOverlay: (mode) =>
        Effect.tryPromise({
          try: async () => {
            webOverlayDepth[mode] = Math.max(0, webOverlayDepth[mode] - 1);
            await invoke("terminal_surfaces_end_web_overlay", { mode });
            if (Object.values(webOverlayDepth).every((depth) => depth === 0)) {
              if (needsSyncAfterOverlay) {
                needsSyncAfterOverlay = false;
                syncAll();
              }
            }
          },
          catch: (cause) => nativeSurfaceError(cause, "web-overlay"),
        }),
      setWebOcclusionRect: (id, rect) =>
        Effect.tryPromise({
          try: async () => {
            if (rect) {
              webOcclusionRects.set(id, rect);
            } else {
              webOcclusionRects.delete(id);
            }
            await syncWebOcclusionRects();
          },
          catch: (cause) => nativeSurfaceError(cause, "web-occlusion"),
        }),
    } satisfies TerminalSurfaceServiceApi;
  }),
);
