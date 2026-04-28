import { describe, expect, test, afterEach } from "bun:test";
import { runtimeEventBus, type RuntimeQueueEvent } from "./runtime-event-queue";
import { runtimeGateway } from "./runtime-gateway";

afterEach(() => {
  runtimeGateway.disconnect();
});

describe("runtimeEventBus", () => {
  test("delivers published events to subscribers", () => {
    const received: RuntimeQueueEvent[] = [];
    const unlisten = runtimeEventBus.subscribe((event) => received.push(event));

    runtimeEventBus.publish({ type: "connection_state_changed", runtimeId: "ws-1", state: "connected" });
    runtimeEventBus.publish({ type: "error", runtimeId: "ws-1", message: "boom" });

    expect(received).toEqual([
      { type: "connection_state_changed", runtimeId: "ws-1", state: "connected" },
      { type: "error", runtimeId: "ws-1", message: "boom" },
    ]);

    unlisten();
  });

  test("does not deliver events after unsubscribe", () => {
    const received: RuntimeQueueEvent[] = [];
    const unlisten = runtimeEventBus.subscribe((event) => received.push(event));
    unlisten();

    runtimeEventBus.publish({ type: "connection_state_changed", runtimeId: "ws-1", state: "connected" });

    expect(received).toHaveLength(0);
  });

  test("delivers slot_snapshot events with the full slot payload", () => {
    const received: RuntimeQueueEvent[] = [];
    const unlisten = runtimeEventBus.subscribe((event) => received.push(event));

    const slot = {
      id: "slot-1",
      kind: "terminal_slot" as const,
      name: "Terminal",
      autostart: true,
      presentationMode: "single" as const,
      primarySessionDefID: "def-1",
      sessionDefIDs: ["def-1"],
      persisted: false,
      sortOrder: 1,
      aggregateStatus: "running" as const,
      sessionIDs: [],
      capabilities: {
        canFocus: true,
        canPause: false,
        canResume: false,
        canClear: true,
        canStop: true,
        canRestart: true,
      },
    };

    runtimeEventBus.publish({ type: "slot_snapshot", runtimeId: "ws-1", slots: [slot] });

    expect(received).toEqual([
      { type: "slot_snapshot", runtimeId: "ws-1", slots: [expect.objectContaining({ id: "slot-1" })] },
    ]);

    unlisten();
  });
});
