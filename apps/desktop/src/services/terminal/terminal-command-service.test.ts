import { describe, expect, test } from "bun:test";
import { encodeTerminalInput, resolveNewTerminalRuntimeId } from "./terminal-command-service";

describe("terminal-command-service helpers", () => {
  test("encodeTerminalInput preserves command text through base64 encoding", () => {
    const input = "echo hello\n";
    expect(atob(encodeTerminalInput(input))).toBe(input);
  });

  test("resolveNewTerminalRuntimeId prefers the layout target runtime", () => {
    const runtimeId = resolveNewTerminalRuntimeId({
      effectiveLayoutRuntimeId: () => "project:123",
      selectedWorkspaceID: "workspace-1",
    });

    expect(runtimeId).toBe("project:123");
  });
});
