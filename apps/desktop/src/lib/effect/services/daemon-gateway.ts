import { Context, Effect, Layer, Ref } from "effect";
import type { DaemonClient, DaemonClientCallbacks } from "@/lib/runtime/daemon-client";
import { DaemonClient as RawDaemonClient } from "@/lib/runtime/daemon-client";
import { setTerminalDaemonClient } from "@/lib/terminal/terminal-runtime";
import { useWorkspaceStore } from "@/stores/workspace-store";

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

function makeCallbacks(client: RawDaemonClient): DaemonClientCallbacks {
  return {
    onConnectionStateChange: (workspaceId, state) => {
      useWorkspaceStore.getState().setRuntimeConnectionState(workspaceId, state);
    },
    onSlotSnapshot: (workspaceId, slots) => {
      useWorkspaceStore.getState().setRuntimeSlots(workspaceId, slots);
      if (slots.length === 0) return;
      for (const slot of slots) {
        if (
          slot.kind === "terminal_slot" &&
          slot.sessionIDs.length === 0 &&
          slot.sessionDefIDs.length > 0
        ) {
          client.openSessionInstance(workspaceId, slot.sessionDefIDs[0]);
        }
      }
    },
    onSessionSnapshot: (workspaceId, sessions) => {
      useWorkspaceStore.getState().setRuntimeSessions(workspaceId, sessions);
    },
    onSlotStateChanged: (workspaceId, slot) => {
      useWorkspaceStore.getState().updateRuntimeSlot(workspaceId, slot);
    },
    onSessionStateChanged: (workspaceId, session) => {
      useWorkspaceStore.getState().updateRuntimeSession(workspaceId, session);
    },
    onSlotAdded: (workspaceId, slot) => {
      useWorkspaceStore.getState().addRuntimeSlot(workspaceId, slot);
    },
    onSlotRemoved: (workspaceId, slotID) => {
      useWorkspaceStore.getState().removeRuntimeSlot(workspaceId, slotID);
    },
    onSessionOpened: (workspaceId, session) => {
      useWorkspaceStore.getState().addRuntimeSession(workspaceId, session);
    },
    onSessionClosed: (workspaceId, sessionID) => {
      useWorkspaceStore.getState().removeRuntimeSession(workspaceId, sessionID);
    },
    onOutputChunk: (workspaceId, sessionID, data) => {
      const decoded = (() => {
        try {
          return atob(data);
        } catch {
          return data;
        }
      })();
      useWorkspaceStore.getState().noteTerminalOutput(workspaceId, sessionID, decoded);
    },
    onError: (workspaceId, message) => {
      console.error(`Daemon error [${workspaceId}]:`, message);
    },
  };
}

export const DaemonGatewayLive = Layer.effect(
  DaemonGateway,
  Effect.gen(function* () {
    const clientRef = yield* Ref.make<DaemonClient | null>(null);

    const connect = () =>
      Effect.gen(function* () {
        const existing = yield* Ref.get(clientRef);
        if (existing) return;

        let wiredClient: RawDaemonClient | null = null;
        wiredClient = new RawDaemonClient(
          makeCallbacks({
            openSessionInstance: (...args) => wiredClient?.openSessionInstance(...args),
          } as RawDaemonClient)
        );
        yield* Effect.tryPromise(() => wiredClient.connect()).pipe(
          Effect.catchAll((error) =>
            Effect.sync(() => {
              console.error("Failed to connect daemon gateway:", error);
            })
          )
        );
        yield* Ref.set(clientRef, wiredClient);
        yield* Effect.sync(() => {
          setTerminalDaemonClient(wiredClient);
          (window as { __daemonClient?: DaemonClient | null }).__daemonClient = wiredClient;
        });
      });

    const disconnect = () =>
      Effect.gen(function* () {
        const existing = yield* Ref.get(clientRef);
        if (!existing) return;
        yield* Effect.sync(() => {
          existing.disconnect();
          setTerminalDaemonClient(null);
          (window as { __daemonClient?: DaemonClient | null }).__daemonClient = null;
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
