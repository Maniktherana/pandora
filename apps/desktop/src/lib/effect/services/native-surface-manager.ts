import { Context, Effect, Layer } from "effect";
import { invoke } from "@tauri-apps/api/core";
import { NativeSurfaceError } from "../errors";

export interface SurfaceRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly scaleFactor: number;
}

export interface SurfaceAnchorRegistration {
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly surfaceId: string;
}

export interface NativeSurfaceManagerService {
  readonly registerAnchor: (input: SurfaceAnchorRegistration) => Effect.Effect<string>;
  readonly beginWebOverlay: () => Effect.Effect<void, NativeSurfaceError>;
  readonly endWebOverlay: () => Effect.Effect<void, NativeSurfaceError>;
  readonly createSurface: (
    workspaceId: string,
    sessionId: string,
    surfaceId: string,
    rect: SurfaceRect
  ) => Effect.Effect<void, NativeSurfaceError>;
  readonly updateSurface: (
    surfaceId: string,
    rect: SurfaceRect,
    visible: boolean,
    focused: boolean
  ) => Effect.Effect<void, NativeSurfaceError>;
  readonly releaseSurface: (surfaceId: string) => Effect.Effect<void, NativeSurfaceError>;
}

export class NativeSurfaceManager extends Context.Tag("pandora/NativeSurfaceManager")<
  NativeSurfaceManager,
  NativeSurfaceManagerService
>() {}

export const NativeSurfaceManagerLive = Layer.succeed(NativeSurfaceManager, {
  registerAnchor: (input) => Effect.succeed(`${input.workspaceId}:${input.sessionId}`),
  beginWebOverlay: () =>
    Effect.tryPromise({
      try: () => invoke("terminal_surfaces_begin_web_overlay"),
      catch: (cause) => new NativeSurfaceError({ cause, surfaceId: "web-overlay" }),
    }),
  endWebOverlay: () =>
    Effect.tryPromise({
      try: () => invoke("terminal_surfaces_end_web_overlay"),
      catch: (cause) => new NativeSurfaceError({ cause, surfaceId: "web-overlay" }),
    }),
  createSurface: (workspaceId, sessionId, surfaceId, rect) =>
    Effect.tryPromise({
      try: () =>
        invoke("terminal_surface_create", {
          workspaceId,
          sessionId,
          surfaceId,
          rect,
        }),
      catch: (cause) => new NativeSurfaceError({ cause, surfaceId }),
    }),
  updateSurface: (surfaceId, rect, visible, focused) =>
    Effect.tryPromise({
      try: () =>
        invoke("terminal_surface_update", {
          surfaceId,
          rect,
          visible,
          focused,
        }),
      catch: (cause) => new NativeSurfaceError({ cause, surfaceId }),
    }),
  releaseSurface: (surfaceId) =>
    Effect.tryPromise({
      try: () => invoke("terminal_surface_destroy", { surfaceId }),
      catch: (cause) => new NativeSurfaceError({ cause, surfaceId }),
    }),
} satisfies NativeSurfaceManagerService);
