import { describe, expect, test } from "bun:test";
import type { TerminalAgentStatus } from "@/lib/shared/shared.types";
import {
  acknowledgeTerminalAgentStatus,
  highestTerminalAgentStatus,
  shouldHighlightWorkspaceForTerminalAgent,
  workspaceTerminalAgentStatus,
} from "./agent-activity";

function statusContext(statuses: Record<string, TerminalAgentStatus>) {
  return {
    workspaceId: "workspace-1",
    slots: Object.keys(statuses).map((id) => ({ id })),
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
});
