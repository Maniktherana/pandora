import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { makeDaemonGatewayLive } from "./daemon-gateway";
import { makeNativeSurfaceManagerLive } from "./native-surface-manager";
import { makeUiPreferencesLive } from "./ui-preferences";
import { makeWorkspaceRegistryLive } from "./workspace-registry";

export function makeDesktopEffectLayer() {
  return Layer.mergeAll(
    makeWorkspaceRegistryLive(),
    makeUiPreferencesLive(),
    makeDaemonGatewayLive(),
    makeNativeSurfaceManagerLive()
  );
}

export function makeDesktopEffectRuntime() {
  return Effect.succeed({
    layer: makeDesktopEffectLayer(),
  });
}
