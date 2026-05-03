import { describe, expect, test } from "bun:test";
import type { AgentActivityState, SessionState, TerminalAgentStatus } from "@/lib/shared/shared.types";
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

function statusContext(statuses: Record<string, TerminalAgentStatus>) {
  return {
    workspaceId: "workspace-1",
    slots: Object.keys(statuses).map((id) => ({ id })),
    sessions: [] as SessionState[],
    terminalAgentStatusBySlotId: { ...statuses },
    root: null,
    focusedPaneID: null,
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
    expect(
      workspaceTerminalAgentStatus(statusContext({ a: "review", b: "working" })),
    ).toBe("working");
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
    const ctx = statusContext({
      review: "review",
      working: "working",
      permission: "permission",
    });

    acknowledgeTerminalAgentStatus(ctx, "review");
    acknowledgeTerminalAgentStatus(ctx, "working");
    acknowledgeTerminalAgentStatus(ctx, "permission");

    expect(ctx.terminalAgentStatusBySlotId).toEqual({
      review: "idle",
      working: "working",
      permission: "permission",
    });
  });

  test("projects session activity into the terminal slot status map", () => {
    const ctx = statusContext({ "slot-1": "idle" });
    const session: SessionState = {
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
      ptyForegroundProcess: null,
      agentActivity: workingActivity,
      capabilities: {
        canFocus: true,
        canPause: false,
        canResume: false,
        canClear: true,
        canStop: true,
        canRestart: true,
      },
    };

    applySessionAgentActivityStatus(ctx, session, { selectedWorkspaceId: null });
    expect(ctx.terminalAgentStatusBySlotId["slot-1"]).toBe("working");

    applySessionAgentActivityStatus(
      ctx,
      { ...session, agentActivity: finishedActivity },
      { selectedWorkspaceId: null },
    );
    expect(ctx.terminalAgentStatusBySlotId["slot-1"]).toBe("review");

    ctx.sessions = [{ ...session, agentActivity: workingActivity }];
    rebuildTerminalAgentStatuses(ctx, { selectedWorkspaceId: null });
    expect(ctx.terminalAgentStatusBySlotId["slot-1"]).toBe("working");
  });
});
