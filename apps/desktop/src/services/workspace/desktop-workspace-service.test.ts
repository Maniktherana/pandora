import { describe, expect, test } from "bun:test";
import { findNearestWorkspaceInProject, shouldAutoOpenTerminalSlot } from "./desktop-workspace-service";

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
      }),
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
      }),
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
      }),
    ).toBe(false);
  });
});

describe("findNearestWorkspaceInProject", () => {
  test("prefers the next visible workspace in the same project", () => {
    expect(
      findNearestWorkspaceInProject(
        [
          { id: "a", projectId: "project-1", status: "ready" },
          { id: "b", projectId: "project-1", status: "ready" },
          { id: "c", projectId: "project-1", status: "ready" },
        ],
        "b",
      )?.id,
    ).toBe("c");
  });

  test("falls back to the previous visible workspace when archiving the last one", () => {
    expect(
      findNearestWorkspaceInProject(
        [
          { id: "a", projectId: "project-1", status: "ready" },
          { id: "b", projectId: "project-1", status: "ready" },
        ],
        "b",
      )?.id,
    ).toBe("a");
  });

  test("ignores archived workspaces and other projects", () => {
    expect(
      findNearestWorkspaceInProject(
        [
          { id: "a", projectId: "project-1", status: "ready" },
          { id: "b", projectId: "project-1", status: "ready" },
          { id: "c", projectId: "project-1", status: "archived" },
          { id: "d", projectId: "project-2", status: "ready" },
        ],
        "b",
      )?.id,
    ).toBe("a");
  });

  test("returns null when no other visible workspace exists in the project", () => {
    expect(
      findNearestWorkspaceInProject(
        [{ id: "a", projectId: "project-1", status: "ready" }],
        "a",
      ),
    ).toBeNull();
  });
});
