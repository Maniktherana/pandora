import { IpcClient } from "@/services/ipc/ipc-client";
import { ipcEventBus } from "./ipc-event-queue";

let client: IpcClient | null = null;

export async function startIpcEventRouting(): Promise<void> {
  if (client) return;
  const created = new IpcClient((event) => ipcEventBus.publish(event));
  client = created;
  try {
    await created.connect();
  } catch (cause) {
    client = null;
    console.error("Failed to start IPC event routing:", cause);
  }
}

export function stopIpcEventRouting(): void {
  if (!client) return;
  client.disconnect();
  client = null;
}

export function getIpcClient(): IpcClient | null {
  return client;
}
