import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { NativeSurfaceError } from "../errors";
import type { NativeSurfaceManagerService, SurfaceAnchorRegistration, SurfaceReleaseKey } from "./contracts";
import { NativeSurfaceManager } from "./contracts";

function surfaceKey(input: SurfaceReleaseKey) {
  return `${input.workspaceId}:${input.sessionId}:${input.surfaceId}`;
}

function makeInitialView() {
  return {
    surfaces: {},
  } as const;
}

export function makeNativeSurfaceManagerLive() {
  return Layer.effect(
    NativeSurfaceManager,
    Effect.gen(function* () {
      const view = yield* SubscriptionRef.make(makeInitialView());
      const surfaces = yield* Ref.make(new Map<string, SurfaceAnchorRegistration>());

      const updateView = Effect.sync(() => {
        const next: Record<string, SurfaceAnchorRegistration> = {};
        for (const [key, value] of Ref.unsafeGet(surfaces).entries()) {
          next[key] = value;
        }
        void SubscriptionRef.set(view, { surfaces: next });
      });

      const service: NativeSurfaceManagerService = {
        view,
        registerAnchor: (input: SurfaceAnchorRegistration) =>
          Effect.gen(function* () {
            const key = surfaceKey(input);
            yield* Ref.set(surfaces, new Map(Ref.unsafeGet(surfaces)).set(key, input));
            yield* updateView;
            return {
              workspaceId: input.workspaceId,
              sessionId: input.sessionId,
              surfaceId: input.surfaceId,
            } satisfies SurfaceReleaseKey;
          }),
        updateVisibility: (key: SurfaceReleaseKey, input) =>
          Effect.gen(function* () {
            const lookup = surfaceKey(key);
            const current = Ref.unsafeGet(surfaces).get(lookup);
            if (!current) {
              throw new NativeSurfaceError({
                workspaceId: key.workspaceId,
                sessionId: key.sessionId,
                cause: new Error("surface not registered"),
              });
            }
            yield* Ref.set(
              surfaces,
              new Map(Ref.unsafeGet(surfaces)).set(lookup, {
                ...current,
                ...input,
              })
            );
            yield* updateView;
          }),
        releaseSurface: (key: SurfaceReleaseKey) =>
          Effect.gen(function* () {
            const lookup = surfaceKey(key);
            const next = new Map(Ref.unsafeGet(surfaces));
            next.delete(lookup);
            yield* Ref.set(surfaces, next);
            yield* updateView;
          }),
      };

      return service;
    })
  );
}
