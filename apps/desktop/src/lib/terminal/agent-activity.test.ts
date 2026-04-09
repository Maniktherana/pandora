import { describe, expect, test } from "bun:test";
import type { AgentActivityState, WorkspaceRuntimeState } from "@/lib/shared/types";
import {
  acknowledgeTerminalAgentStatus,
  applySessionAgentActivityStatus,
  highestTerminalAgentStatus,
  rebuildTerminalAgentStatuses,
  shouldHighlightWorkspaceForTerminalAgent,
  terminalAgentStatusForActivity,
  workspaceTerminalAgentStatus,
} from "./agent-activity";

const finishedActivity: AgentActivityState = {
  vendor: "codex",
  phase: "finished",
  agentSessionID: null,
  updatedAt: "2026-04-09T00:00:00.000Z",
  message: null,
  title: null,
  toolName: null,
};

const workingActivity: AgentActivityState = {
  ...finishedActivity,
  phase: "working",
  updatedAt: "2026-04-09T00:01:00.000Z",
};

function runtimeWithStatuses(
  terminalAgentStatusBySlotId: WorkspaceRuntimeState["terminalAgentStatusBySlotId"],
): WorkspaceRuntimeState {
  return {
    workspaceId: "workspace-1",
    slots: Object.keys(terminalAgentStatusBySlotId).map((id, index) => ({
      id,
      kind: "terminal_slot",
      name: `Terminal ${index + 1}`,
      autostart: true,
      presentationMode: "single",
      primarySessionDefID: `def-${index + 1}`,
      sessionDefIDs: [`def-${index + 1}`],
      persisted: false,
      sortOrder: index + 1,
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
    })),
    sessions: [],
    terminalDisplayBySlotId: {},
    terminalAgentStatusBySlotId,
    connectionState: "connected",
    root: null,
    focusedPaneID: null,
    terminalPanel: null,
    layoutLoading: false,
    layoutLoaded: true,
  };
}

describe("terminal agent status", () => {
  test("does not highlight selected workspaces just because the sidebar is active", () => {
    expect(shouldHighlightWorkspaceForTerminalAgent({ isSelected: true, status: "idle" })).toBe(
      false,
    );
    expect(shouldHighlightWorkspaceForTerminalAgent({ isSelected: true, status: "review" })).toBe(
      false,
    );
    expect(shouldHighlightWorkspaceForTerminalAgent({ isSelected: false, status: "review" })).toBe(
      true,
    );
  });

  test("prioritizes permission over working over review", () => {
    expect(highestTerminalAgentStatus(["review", "working", "permission"])).toBe("permission");
    expect(workspaceTerminalAgentStatus(runtimeWithStatuses({ a: "review", b: "working" }))).toBe(
      "working",
    );
  });

  test("marks completed work as review only when the terminal is not selected", () => {
    expect(
      terminalAgentStatusForActivity(finishedActivity, {
        isSelectedTerminal: true,
      }),
    ).toBe("idle");
    expect(
      terminalAgentStatusForActivity(finishedActivity, {
        isSelectedTerminal: false,
      }),
    ).toBe("review");
  });

  test("acknowledges review without clearing active work or permission prompts", () => {
    const runtime = runtimeWithStatuses({
      review: "review",
      working: "working",
      permission: "permission",
    });

    acknowledgeTerminalAgentStatus(runtime, "review");
    acknowledgeTerminalAgentStatus(runtime, "working");
    acknowledgeTerminalAgentStatus(runtime, "permission");

    expect(runtime.terminalAgentStatusBySlotId).toEqual({
      review: "idle",
      working: "working",
      permission: "permission",
    });
  });

  test("projects session activity into the terminal slot status map", () => {
    const runtime = runtimeWithStatuses({ "slot-1": "idle" });
    const session = {
      id: "session-1",
      sessionDefID: "def-1",
      slotID: "slot-1",
      kind: "terminal",
      name: "Terminal",
      status: "running",
      pid: 1,
      exitCode: null,
      port: null,
      startedAt: null,
      lastOutputAt: null,
      foregroundProcess: null,
      agentActivity: workingActivity,
      capabilities: {
        canFocus: true,
        canPause: false,
        canResume: false,
        canClear: true,
        canStop: true,
        canRestart: true,
      },
    } satisfies WorkspaceRuntimeState["sessions"][number];

    applySessionAgentActivityStatus(runtime, session, { selectedWorkspaceId: null });
    expect(runtime.terminalAgentStatusBySlotId["slot-1"]).toBe("working");

    applySessionAgentActivityStatus(
      runtime,
      { ...session, agentActivity: finishedActivity },
      { selectedWorkspaceId: null },
    );
    expect(runtime.terminalAgentStatusBySlotId["slot-1"]).toBe("review");

    runtime.sessions = [{ ...session, agentActivity: workingActivity }];
    rebuildTerminalAgentStatuses(runtime, { selectedWorkspaceId: null });
    expect(runtime.terminalAgentStatusBySlotId["slot-1"]).toBe("working");
  });
});
