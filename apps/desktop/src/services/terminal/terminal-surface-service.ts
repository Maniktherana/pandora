import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Context, Effect, Layer } from "effect";
import { NativeSurfaceError } from "@/services/service-errors";

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
  onFocus?: () => void;
}

interface ManagedSurfaceEntry extends ManagedSurfaceRegistration {
  resizeObserver: ResizeObserver | null;
  created: boolean;
  lastSignature: string | null;
  rafId: number | null;
  syncInFlight: boolean;
  resyncRequested: boolean;
  pendingCreate: boolean;
}

interface NativeSyncPayload {
  rect: SurfaceRect;
  signature: string;
}

export interface TerminalSurfaceServiceApi {
  readonly isNativeSupported: () => Effect.Effect<boolean>;
  readonly upsertSurface: (
    input: ManagedSurfaceRegistration
  ) => Effect.Effect<void, NativeSurfaceError>;
  readonly removeSurface: (surfaceId: string) => Effect.Effect<void, NativeSurfaceError>;
  readonly beginWebOverlay: () => Effect.Effect<void, NativeSurfaceError>;
  readonly endWebOverlay: () => Effect.Effect<void, NativeSurfaceError>;
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

export const TerminalSurfaceServiceLive = Layer.effect(
  TerminalSurfaceService,
  Effect.sync(() => {
    const entries = new Map<string, ManagedSurfaceEntry>();
    let nativeSupportPromise: Promise<boolean> | null = null;

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

    const clearScheduledSync = (entry: ManagedSurfaceEntry) => {
      if (entry.rafId != null) {
        cancelAnimationFrame(entry.rafId);
        entry.rafId = null;
      }
    };

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
          await invoke("terminal_surface_create", {
            workspaceId: entry.workspaceId,
            sessionId: entry.sessionId,
            surfaceId: entry.surfaceId,
            rect: payload.rect,
          });
        } catch (cause) {
          entry.created = false;
          throw nativeSurfaceError(cause, entry.surfaceId);
        }
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

    const runSync = (entry: ManagedSurfaceEntry) => {
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

    const scheduleSync = (surfaceId: string, forceCreate = false) => {
      const entry = entries.get(surfaceId);
      if (!entry) return;
      if (forceCreate) entry.pendingCreate = true;
      console.debug("[terminal-surface]", "sync scheduled", {
        workspaceId: entry.workspaceId,
        sessionId: entry.sessionId,
        surfaceId,
        forceCreate,
      });
      if (entry.rafId != null) return;
      entry.rafId = requestAnimationFrame(() => {
        entry.rafId = null;
        runSync(entry);
      });
    };

    const syncAll = () => {
      for (const surfaceId of entries.keys()) {
        scheduleSync(surfaceId);
      }
    };

    const replaceObserver = (entry: ManagedSurfaceEntry, nextAnchor: HTMLElement | null) => {
      entry.resizeObserver?.disconnect();
      entry.resizeObserver = null;
      if (!nextAnchor) return;

      const observer = new ResizeObserver(() => {
        scheduleSync(entry.surfaceId);
      });
      observer.observe(nextAnchor);
      entry.resizeObserver = observer;
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
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        syncAll();
      }
    });

    const win = getCurrentWindow();
    void win.onScaleChanged(syncAll).catch(() => {});
    void win.onResized(syncAll).catch(() => {});
    void win.onMoved(syncAll).catch(() => {});

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
                rafId: null,
                syncInFlight: false,
                resyncRequested: false,
                pendingCreate: true,
              };
              entries.set(input.surfaceId, entry);
              replaceObserver(entry, input.anchorElement);
            } else {
              const anchorChanged = entry.anchorElement !== input.anchorElement;
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
              if (anchorChanged) {
                replaceObserver(entry, input.anchorElement);
                entry.pendingCreate = true;
              }
            }
            scheduleSync(input.surfaceId);
          },
          catch: (cause) => nativeSurfaceError(cause, input.surfaceId),
        }),
      removeSurface: (surfaceId) =>
        Effect.tryPromise({
          try: async () => {
            const entry = entries.get(surfaceId);
            if (!entry) return;
            clearScheduledSync(entry);
            entry.resizeObserver?.disconnect();
            entries.delete(surfaceId);
            if (!entry.created) return;
            await invoke("terminal_surface_destroy", { surfaceId });
          },
          catch: (cause) => nativeSurfaceError(cause, surfaceId),
        }),
      beginWebOverlay: () =>
        Effect.tryPromise({
          try: () => invoke("terminal_surfaces_begin_web_overlay"),
          catch: (cause) => nativeSurfaceError(cause, "web-overlay"),
        }),
      endWebOverlay: () =>
        Effect.tryPromise({
          try: () => invoke("terminal_surfaces_end_web_overlay"),
          catch: (cause) => nativeSurfaceError(cause, "web-overlay"),
        }),
    } satisfies TerminalSurfaceServiceApi;
  })
);
