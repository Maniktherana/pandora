import { describe, expect, test } from "bun:test";
import { createDaemonClientCallbacks } from "./daemon-gateway";

describe("createDaemonClientCallbacks", () => {
  test("maps daemon connection and snapshot callbacks into daemon events", () => {
    const events: unknown[] = [];
    const callbacks = createDaemonClientCallbacks((event) => {
      events.push(event);
    });

    callbacks.onConnectionStateChange("ws-1", "connected");
    callbacks.onSlotSnapshot("ws-1", [
      {
        id: "slot-1",
        kind: "terminal_slot",
        name: "Terminal",
        autostart: true,
        presentationMode: "single",
        primarySessionDefID: "def-1",
        sessionDefIDs: ["def-1"],
        persisted: false,
        sortOrder: 1,
        aggregateStatus: "running",
        sessionIDs: [],
        capabilities: {
          canFocus: true,
          canPause: false,
          canResume: false,
          canClear: true,
          canStop: true,
          canRestart: true,
        },
      },
    ]);
    callbacks.onError("ws-1", "boom");

    expect(events).toEqual([
      { type: "connection_state_changed", workspaceId: "ws-1", state: "connected" },
      {
        type: "slot_snapshot",
        workspaceId: "ws-1",
        slots: [
          expect.objectContaining({
            id: "slot-1",
            kind: "terminal_slot",
            sessionDefIDs: ["def-1"],
          }),
        ],
      },
      { type: "error", workspaceId: "ws-1", message: "boom" },
    ]);
  });

  test("publishes output chunk events with the raw payload", () => {
    const events: unknown[] = [];
    const callbacks = createDaemonClientCallbacks((event) => {
      events.push(event);
    });

    callbacks.onOutputChunk?.("ws-2", "session-1", "SGVsbG8=");

    expect(events).toEqual([
      {
        type: "output_chunk",
        workspaceId: "ws-2",
        sessionID: "session-1",
        data: "SGVsbG8=",
      },
    ]);
  });
});
