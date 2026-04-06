import { Context, Effect, Layer, Ref } from "effect";
import type { DaemonClient, DaemonClientCallbacks } from "@/lib/runtime/daemon-client";
import type { ConnectionState } from "@/lib/runtime/daemon-client";
import { DaemonClient as RawDaemonClient } from "@/lib/runtime/daemon-client";
import type { SessionState, SlotState } from "@/lib/shared/types";
import { DaemonEventQueue, type DaemonEvent } from "./daemon-event-queue";

export interface DaemonGatewayService {
  readonly client: Ref.Ref<DaemonClient | null>;
  readonly connect: () => Effect.Effect<void>;
  readonly disconnect: () => Effect.Effect<void>;
  readonly getClient: () => Effect.Effect<DaemonClient | null>;
}

export class DaemonGateway extends Context.Tag("pandora/DaemonGateway")<
  DaemonGateway,
  DaemonGatewayService
>() {}

export function createDaemonClientCallbacks(
  publish: (event: DaemonEvent) => void
): DaemonClientCallbacks {
  const emit = (event: DaemonEvent) => {
    try {
      publish(event);
    } catch (cause) {
      console.error("Failed to publish daemon event:", cause);
    }
  };

  return {
    onConnectionStateChange: (workspaceId: string, state: ConnectionState) => {
      emit({ type: "connection_state_changed", workspaceId, state });
    },
    onSlotSnapshot: (workspaceId: string, slots: SlotState[]) => {
      emit({ type: "slot_snapshot", workspaceId, slots });
    },
    onSessionSnapshot: (workspaceId: string, sessions: SessionState[]) => {
      emit({ type: "session_snapshot", workspaceId, sessions });
    },
    onSlotStateChanged: (workspaceId: string, slot: SlotState) => {
      emit({ type: "slot_state_changed", workspaceId, slot });
    },
    onSessionStateChanged: (workspaceId: string, session: SessionState) => {
      emit({ type: "session_state_changed", workspaceId, session });
    },
    onSlotAdded: (workspaceId: string, slot: SlotState) => {
      emit({ type: "slot_added", workspaceId, slot });
    },
    onSlotRemoved: (workspaceId: string, slotID: string) => {
      emit({ type: "slot_removed", workspaceId, slotID });
    },
    onSessionOpened: (workspaceId: string, session: SessionState) => {
      emit({ type: "session_opened", workspaceId, session });
    },
    onSessionClosed: (workspaceId: string, sessionID: string) => {
      emit({ type: "session_closed", workspaceId, sessionID });
    },
    onOutputChunk: (workspaceId: string, sessionID: string, data: string) => {
      emit({ type: "output_chunk", workspaceId, sessionID, data });
    },
    onError: (workspaceId: string, message: string) => {
      emit({ type: "error", workspaceId, message });
    },
  };
}

export const DaemonGatewayLive = Layer.effect(
  DaemonGateway,
  Effect.gen(function* () {
    const clientRef = yield* Ref.make<DaemonClient | null>(null);
    const eventQueue = yield* DaemonEventQueue;

    const connect = () =>
      Effect.gen(function* () {
        const client = yield* Ref.modify(clientRef, (existing) => {
          if (existing) {
            return [null, existing] as const;
          }

          const created = new RawDaemonClient(
            createDaemonClientCallbacks((event) => {
              void Effect.runPromise(eventQueue.publish(event));
            })
          );

          return [created, created] as const;
        });
        if (!client) return;

        yield* Effect.tryPromise(() => client.connect()).pipe(
          Effect.catchAll((error) =>
            Effect.gen(function* () {
              yield* Ref.set(clientRef, null);
              yield* Effect.sync(() => {
                console.error("Failed to connect daemon gateway:", error);
              });
            })
          )
        );
      });

    const disconnect = () =>
      Effect.gen(function* () {
        const existing = yield* Ref.get(clientRef);
        if (!existing) return;
        yield* Effect.sync(() => {
          existing.disconnect();
        });
        yield* Ref.set(clientRef, null);
      });

    return {
      client: clientRef,
      connect,
      disconnect,
      getClient: () => Ref.get(clientRef),
    } satisfies DaemonGatewayService;
  })
);
