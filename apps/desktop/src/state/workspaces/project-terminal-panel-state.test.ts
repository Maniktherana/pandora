import { describe, expect, test } from "bun:test";
import { projectRuntimeKey } from "@/lib/runtime/runtime-keys";
import type { SlotState, WorkspaceRuntimeState } from "@/lib/shared/types";
import { cycleRuntimeTabs } from "./layout-state";
import {
  createWorkspaceRuntimeState,
  ensureProjectTerminalPanel,
  replaceRuntimeSlots,
} from "./runtime-state";

function createTerminalSlot(id: string, sortOrder: number): SlotState {
  return {
    id,
    kind: "terminal_slot",
    name: id,
    autostart: false,
    presentationMode: "single",
    primarySessionDefID: null,
    sessionDefIDs: [],
    persisted: false,
    sortOrder,
    aggregateStatus: "stopped",
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
}

function createCorruptedProjectRuntime(): WorkspaceRuntimeState {
  const runtime = createWorkspaceRuntimeState(projectRuntimeKey("project-1"));
  replaceRuntimeSlots(runtime, [
    createTerminalSlot("terminal-a", 1),
    createTerminalSlot("terminal-b", 2),
    createTerminalSlot("terminal-c", 3),
  ]);
  runtime.terminalPanel = {
    groups: [
      { id: "group-a", children: ["terminal-a"] },
      { id: "group-c", children: ["terminal-c"] },
      { id: "group-b", children: ["terminal-b"] },
    ],
    activeGroupIndex: 1,
    activeSlotId: "terminal-c",
    visible: true,
  };
  return runtime;
}

describe("project terminal panel reconciliation", () => {
  test("realigns groups after a removed terminal is re-added and slots later return to canonical order", () => {
    const runtime = createWorkspaceRuntimeState(projectRuntimeKey("project-1"));

    replaceRuntimeSlots(runtime, [
      createTerminalSlot("terminal-a", 1),
      createTerminalSlot("terminal-b", 2),
      createTerminalSlot("terminal-c", 3),
    ]);
    ensureProjectTerminalPanel(runtime);

    replaceRuntimeSlots(runtime, [
      createTerminalSlot("terminal-a", 1),
      createTerminalSlot("terminal-c", 3),
    ]);
    ensureProjectTerminalPanel(runtime);

    replaceRuntimeSlots(runtime, [
      createTerminalSlot("terminal-a", 1),
      createTerminalSlot("terminal-c", 3),
      createTerminalSlot("terminal-b", 2),
    ]);
    ensureProjectTerminalPanel(runtime);
    expect(runtime.terminalPanel?.groups.map((group) => group.children)).toEqual([
      ["terminal-a"],
      ["terminal-c"],
      ["terminal-b"],
    ]);

    replaceRuntimeSlots(runtime, [
      createTerminalSlot("terminal-a", 1),
      createTerminalSlot("terminal-b", 2),
      createTerminalSlot("terminal-c", 3),
    ]);
    ensureProjectTerminalPanel(runtime);

    expect(runtime.terminalPanel?.groups.map((group) => group.children)).toEqual([
      ["terminal-a"],
      ["terminal-b"],
      ["terminal-c"],
    ]);
  });

  test("realigns terminal groups to the runtime slot order and preserves the active group", () => {
    const runtime = createCorruptedProjectRuntime();

    ensureProjectTerminalPanel(runtime);

    expect(runtime.terminalPanel).toEqual({
      groups: [
        { id: "group-a", children: ["terminal-a"] },
        { id: "group-b", children: ["terminal-b"] },
        { id: "group-c", children: ["terminal-c"] },
      ],
      activeGroupIndex: 2,
      activeSlotId: "terminal-c",
      visible: true,
    });
  });

  test("cycles project terminals in the reconciled slot order", () => {
    const runtime = createCorruptedProjectRuntime();

    ensureProjectTerminalPanel(runtime);

    expect(cycleRuntimeTabs(runtime, 1)).toBe(true);
    expect(runtime.terminalPanel?.activeSlotId).toBe("terminal-a");
    expect(runtime.terminalPanel?.activeGroupIndex).toBe(0);

    expect(cycleRuntimeTabs(runtime, 1)).toBe(true);
    expect(runtime.terminalPanel?.activeSlotId).toBe("terminal-b");
    expect(runtime.terminalPanel?.activeGroupIndex).toBe(1);

    expect(cycleRuntimeTabs(runtime, -1)).toBe(true);
    expect(runtime.terminalPanel?.activeSlotId).toBe("terminal-a");
    expect(runtime.terminalPanel?.activeGroupIndex).toBe(0);
  });
});
