import { describe, expect, test } from "bun:test";
import { shouldAutoOpenTerminalSlot } from "./desktop-workspace-service";

describe("shouldAutoOpenTerminalSlot", () => {
  test("returns true for terminal slots that have defs but no running sessions", () => {
    expect(
      shouldAutoOpenTerminalSlot({
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
      })
    ).toBe(true);
  });

  test("returns false for non-terminal or already-open slots", () => {
    expect(
      shouldAutoOpenTerminalSlot({
        id: "slot-2",
        kind: "agent_slot",
        name: "Agent",
        autostart: true,
        presentationMode: "single",
        primarySessionDefID: "def-2",
        sessionDefIDs: ["def-2"],
        persisted: false,
        sortOrder: 2,
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
      })
    ).toBe(false);

    expect(
      shouldAutoOpenTerminalSlot({
        id: "slot-3",
        kind: "terminal_slot",
        name: "Terminal",
        autostart: true,
        presentationMode: "single",
        primarySessionDefID: "def-3",
        sessionDefIDs: ["def-3"],
        persisted: false,
        sortOrder: 3,
        aggregateStatus: "running",
        sessionIDs: ["session-3"],
        capabilities: {
          canFocus: true,
          canPause: false,
          canResume: false,
          canClear: true,
          canStop: true,
          canRestart: true,
        },
      })
    ).toBe(false);
  });
});
