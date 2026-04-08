import { describe, expect, test } from "bun:test";
import { ProcessManager } from "../process-manager";
import type { SessionDefinition, SlotDefinition } from "../types";

function createSlot(overrides: Partial<SlotDefinition> = {}): SlotDefinition {
  return {
    id: "slot-1",
    kind: "terminal_slot",
    name: "Terminal",
    autostart: false,
    presentationMode: "single",
    primarySessionDefID: "session-def-1",
    sessionDefIDs: ["session-def-1"],
    persisted: true,
    sortOrder: 1,
    ...overrides,
  };
}

function createSessionDefinition(
  overrides: Partial<SessionDefinition> = {},
): SessionDefinition {
  return {
    id: "session-def-1",
    slotID: "slot-1",
    kind: "terminal",
    name: "Terminal",
    command: "zsh",
    cwd: "/tmp",
    port: null,
    envOverrides: {},
    restartPolicy: "manual",
    pauseSupported: false,
    resumeSupported: false,
    ...overrides,
  };
}

describe("ProcessManager updates", () => {
  test("uses updated slot names in subsequent slot state snapshots", () => {
    const manager = new ProcessManager([createSlot()], [createSessionDefinition()], () => {}, () => {});

    manager.updateSlotDefinition({ id: "slot-1", name: "API Shell" });

    expect(manager.listSlotStates()).toEqual([
      expect.objectContaining({
        id: "slot-1",
        name: "API Shell",
      }),
    ]);
  });

  test("updates stored session definitions", () => {
    const manager = new ProcessManager([createSlot()], [createSessionDefinition()], () => {}, () => {});

    manager.updateSessionDefinition({ id: "session-def-1", name: "API Shell" });

    const sessionDefinitions = (
      manager as unknown as { sessionDefinitions: Map<string, SessionDefinition> }
    ).sessionDefinitions;

    expect(sessionDefinitions.get("session-def-1")).toEqual(
      expect.objectContaining({
        id: "session-def-1",
        name: "API Shell",
      }),
    );
  });
});
