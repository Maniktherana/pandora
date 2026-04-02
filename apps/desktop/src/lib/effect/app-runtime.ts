import { Layer, ManagedRuntime } from "effect";
import { WorkspaceRegistryLive } from "./services/workspace-registry";
import { UiPreferencesLive } from "./services/ui-preferences";
import { DaemonGatewayLive } from "./services/daemon-gateway";
import { NativeSurfaceManagerLive } from "./services/native-surface-manager";

const AppLayer = Layer.mergeAll(
  WorkspaceRegistryLive,
  UiPreferencesLive,
  DaemonGatewayLive,
  NativeSurfaceManagerLive
);

let appRuntime: ManagedRuntime.ManagedRuntime<
  Layer.Layer.Success<typeof AppLayer>,
  Layer.Layer.Error<typeof AppLayer>
> | null = null;

export function getAppRuntime() {
  if (!appRuntime) {
    appRuntime = ManagedRuntime.make(AppLayer);
  }
  return appRuntime;
}

export type PandoraAppRuntime = ReturnType<typeof getAppRuntime>;
