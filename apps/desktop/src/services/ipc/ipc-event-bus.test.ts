import { describe, expect, test } from "bun:test";
import { ipcEventBus, type IpcQueueEvent } from "./ipc-event-queue";

describe("ipcEventBus", () => {
  test("delivers published events to subscribers", () => {
    const received: IpcQueueEvent[] = [];
    const unlisten = ipcEventBus.subscribe((event) => received.push(event));

    ipcEventBus.publish({ type: "error", scopeId: "ws-1", message: "boom" });

    expect(received).toEqual([
      { type: "error", scopeId: "ws-1", message: "boom" },
    ]);

    unlisten();
  });

  test("does not deliver events after unsubscribe", () => {
    const received: IpcQueueEvent[] = [];
    const unlisten = ipcEventBus.subscribe((event) => received.push(event));
    unlisten();

    ipcEventBus.publish({ type: "error", scopeId: "ws-1", message: "boom" });

    expect(received).toHaveLength(0);
  });

  test("delivers slot_snapshot events with the full slot payload", () => {
    const received: IpcQueueEvent[] = [];
    const unlisten = ipcEventBus.subscribe((event) => received.push(event));

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

    ipcEventBus.publish({ type: "slot_snapshot", scopeId: "ws-1", slots: [slot] });

    expect(received).toEqual([
      { type: "slot_snapshot", scopeId: "ws-1", slots: [expect.objectContaining({ id: "slot-1" })] },
    ]);

    unlisten();
  });
});
