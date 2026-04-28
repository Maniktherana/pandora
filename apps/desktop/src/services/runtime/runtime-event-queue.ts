import type { ConnectionState } from "@/services/runtime/runtime-client";
import type { RuntimeEvent } from "@/lib/shared/types";

export type RuntimeQueueEvent =
  | { type: "connection_state_changed"; runtimeId: string; state: ConnectionState }
  | ({ runtimeId: string } & RuntimeEvent);

export type RuntimeEventListener = (event: RuntimeQueueEvent) => void;

function createRuntimeEventBus() {
  const listeners = new Set<RuntimeEventListener>();

  return {
    subscribe(listener: RuntimeEventListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publish(event: RuntimeQueueEvent): void {
      for (const listener of listeners) {
        try {
          listener(event);
        } catch (cause) {
          console.error("Runtime event listener threw:", cause);
        }
      }
    },
  };
}

export const runtimeEventBus = createRuntimeEventBus();

