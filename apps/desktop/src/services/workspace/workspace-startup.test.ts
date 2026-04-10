import { describe, expect, test } from "bun:test";
import { shouldStartWorkspaceStartup } from "./workspace-startup";

describe("shouldStartWorkspaceStartup", () => {
  test("starts when runtime is missing", () => {
    expect(shouldStartWorkspaceStartup(undefined)).toBe(true);
  });

  test("starts when layout is still loading or not yet loaded", () => {
    expect(
      shouldStartWorkspaceStartup({
        workspaceId: "workspace-1",
        slots: [],
        sessions: [],
        terminalDisplayBySlotId: {},
        terminalAgentStatusBySlotId: {},
        connectionState: "connected",
        root: null,
        focusedPaneID: null,
        terminalPanel: null,
        layoutLoading: true,
        layoutLoaded: false,
      }),
    ).toBe(true);

    expect(
      shouldStartWorkspaceStartup({
        workspaceId: "workspace-1",
        slots: [],
        sessions: [],
        terminalDisplayBySlotId: {},
        terminalAgentStatusBySlotId: {},
        connectionState: "connected",
        root: null,
        focusedPaneID: null,
        terminalPanel: null,
        layoutLoading: false,
        layoutLoaded: false,
      }),
    ).toBe(true);
  });

  test("starts when a saved layout exists but runtime is disconnected", () => {
    expect(
      shouldStartWorkspaceStartup({
        workspaceId: "workspace-1",
        slots: [],
        sessions: [],
        terminalDisplayBySlotId: {},
        terminalAgentStatusBySlotId: {},
        connectionState: "disconnected",
        root: null,
        focusedPaneID: null,
        terminalPanel: null,
        layoutLoading: false,
        layoutLoaded: true,
      }),
    ).toBe(true);
  });

  test("does not start again when layout is loaded and runtime is connected", () => {
    expect(
      shouldStartWorkspaceStartup({
        workspaceId: "workspace-1",
        slots: [],
        sessions: [],
        terminalDisplayBySlotId: {},
        terminalAgentStatusBySlotId: {},
        connectionState: "connected",
        root: null,
        focusedPaneID: null,
        terminalPanel: null,
        layoutLoading: false,
        layoutLoaded: true,
      }),
    ).toBe(false);
  });
});
