import type { DaemonClient } from "./daemon-client";

type OutputListener = (data: string) => void;

const listeners = new Map<string, Set<OutputListener>>();
let currentClient: DaemonClient | null = null;

export function setTerminalDaemonClient(client: DaemonClient | null): void {
  currentClient = client;
}

export function getTerminalDaemonClient(): DaemonClient | null {
  return currentClient;
}

export function publishTerminalOutput(sessionId: string, data: string): void {
  const sessionListeners = listeners.get(sessionId);
  if (!sessionListeners) return;

  for (const listener of sessionListeners) {
    listener(data);
  }
}

export function subscribeTerminalOutput(
  sessionId: string,
  listener: OutputListener
): () => void {
  const sessionListeners = listeners.get(sessionId) ?? new Set<OutputListener>();
  sessionListeners.add(listener);
  listeners.set(sessionId, sessionListeners);

  return () => {
    const activeListeners = listeners.get(sessionId);
    if (!activeListeners) return;
    activeListeners.delete(listener);
    if (activeListeners.size === 0) {
      listeners.delete(sessionId);
    }
  };
}
