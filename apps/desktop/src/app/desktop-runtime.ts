import { Layer, ManagedRuntime } from "effect";
import { DesktopWorkspaceServiceLive } from "@/services/workspace/desktop-workspace-service";
import { UiPreferencesServiceLive } from "@/services/preferences/ui-preferences-service";
import { DaemonGatewayLive } from "@/services/daemon/daemon-gateway";
import { TerminalSurfaceServiceLive } from "@/services/terminal/terminal-surface-service";
import { DaemonEventQueueLive } from "@/services/daemon/daemon-event-queue";
import { TerminalCommandServiceLive } from "@/services/terminal/terminal-command-service";

const daemonGatewayLayer = Layer.provide(DaemonGatewayLive, DaemonEventQueueLive);
const desktopWorkspaceLayer = Layer.provide(
  DesktopWorkspaceServiceLive,
  Layer.mergeAll(DaemonEventQueueLive, daemonGatewayLayer, TerminalSurfaceServiceLive),
);
const terminalCommandLayer = Layer.provide(
  TerminalCommandServiceLive,
  Layer.mergeAll(daemonGatewayLayer, desktopWorkspaceLayer, TerminalSurfaceServiceLive),
);

const DesktopLayer = Layer.mergeAll(
  daemonGatewayLayer,
  desktopWorkspaceLayer,
  terminalCommandLayer,
  UiPreferencesServiceLive,
  TerminalSurfaceServiceLive,
);

let desktopRuntime: ManagedRuntime.ManagedRuntime<
  Layer.Layer.Success<typeof DesktopLayer>,
  Layer.Layer.Error<typeof DesktopLayer>
> | null = null;

export function getDesktopRuntime() {
  if (!desktopRuntime) {
    desktopRuntime = ManagedRuntime.make(DesktopLayer);
  }
  return desktopRuntime;
}

export type PandoraDesktopRuntime = ReturnType<typeof getDesktopRuntime>;
