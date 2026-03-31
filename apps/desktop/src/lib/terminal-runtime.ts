import type { DaemonClient } from "./daemon-client";

const G = ((globalThis as any).__pandoraTerminalRuntime ??= {
  client: null as DaemonClient | null,
});

export function setTerminalDaemonClient(client: DaemonClient | null): void {
  G.client = client;
}

export function getTerminalDaemonClient(): DaemonClient | null {
  return G.client;
}
