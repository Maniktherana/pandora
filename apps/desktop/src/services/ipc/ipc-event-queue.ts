import type { RuntimeEvent } from "@/lib/shared/types";

export type IpcQueueEvent = { scopeId: string } & RuntimeEvent;

export type IpcEventListener = (event: IpcQueueEvent) => void;

function createIpcEventBus() {
  const listeners = new Set<IpcEventListener>();

  return {
    subscribe(listener: IpcEventListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publish(event: IpcQueueEvent): void {
      for (const listener of listeners) {
        try {
          listener(event);
        } catch (cause) {
          console.error("IPC event listener threw:", cause);
        }
      }
    },
  };
}

export const ipcEventBus = createIpcEventBus();
