import { describe, expect, test } from "bun:test";
import { encodeTerminalInput, resolveNewTerminalScopeId } from "./commands";

describe("terminal command helpers", () => {
  test("encodeTerminalInput preserves command text through base64 encoding", () => {
    const input = "echo hello\n";
    expect(atob(encodeTerminalInput(input))).toBe(input);
  });

  test("resolveNewTerminalScopeId prefers the layout target runtime", () => {
    const scopeId = resolveNewTerminalScopeId({
      effectiveLayoutScopeId: () => "project:123",
      selectedWorkspaceID: "workspace-1",
    });

    expect(scopeId).toBe("project:123");
  });
});
