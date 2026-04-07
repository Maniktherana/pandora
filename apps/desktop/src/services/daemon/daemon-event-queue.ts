import { Context, Effect, Layer, Queue } from "effect";
import type { ConnectionState } from "@/lib/runtime/daemon-client";
import type { SessionState, SlotState } from "@/lib/shared/types";

export type DaemonEvent =
  | {
      readonly type: "connection_state_changed";
      readonly workspaceId: string;
      readonly state: ConnectionState;
    }
  | {
      readonly type: "slot_snapshot";
      readonly workspaceId: string;
      readonly slots: SlotState[];
    }
  | {
      readonly type: "session_snapshot";
      readonly workspaceId: string;
      readonly sessions: SessionState[];
    }
  | {
      readonly type: "slot_state_changed";
      readonly workspaceId: string;
      readonly slot: SlotState;
    }
  | {
      readonly type: "session_state_changed";
      readonly workspaceId: string;
      readonly session: SessionState;
    }
  | {
      readonly type: "slot_added";
      readonly workspaceId: string;
      readonly slot: SlotState;
    }
  | {
      readonly type: "slot_removed";
      readonly workspaceId: string;
      readonly slotID: string;
    }
  | {
      readonly type: "session_opened";
      readonly workspaceId: string;
      readonly session: SessionState;
    }
  | {
      readonly type: "session_closed";
      readonly workspaceId: string;
      readonly sessionID: string;
    }
  | {
      readonly type: "output_chunk";
      readonly workspaceId: string;
      readonly sessionID: string;
      readonly data: string;
    }
  | {
      readonly type: "error";
      readonly workspaceId: string;
      readonly message: string;
    };

export interface DaemonEventQueueService {
  readonly publish: (event: DaemonEvent) => Effect.Effect<void>;
  readonly take: () => Effect.Effect<DaemonEvent>;
}

export class DaemonEventQueue extends Context.Tag("pandora/DaemonEventQueue")<
  DaemonEventQueue,
  DaemonEventQueueService
>() {}

export const DaemonEventQueueLive = Layer.effect(
  DaemonEventQueue,
  Effect.gen(function* () {
    const queue = yield* Queue.unbounded<DaemonEvent>();

    return {
      publish: (event) => Queue.offer(queue, event),
      take: () => Queue.take(queue),
    } satisfies DaemonEventQueueService;
  }),
);
