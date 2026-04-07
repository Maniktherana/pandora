import { describe, expect, test } from "bun:test";
import type { LayoutNode, TerminalPanelState } from "@/lib/shared/types";
import {
  areStringSetsEqual,
  getOrderedProjectTerminalSlotIds,
  getOrderedWorkspaceTerminalSlotIds,
  getVisibleProjectTerminalSlotIds,
  getVisibleWorkspaceTerminalSlotIds,
  mergeConnectedTerminalSlotIds,
} from "./lazy-terminal-connections";

describe("getVisibleWorkspaceTerminalSlotIds", () => {
  test("returns only terminal slots from selected tabs in each visible pane", () => {
    const root: LayoutNode = {
      type: "split",
      id: "root",
      axis: "horizontal",
      ratios: [0.5, 0.5],
      children: [
        {
          type: "leaf",
          id: "left",
          selectedIndex: 1,
          tabs: [
            { kind: "editor", path: "README.md" },
            { kind: "terminal", slotId: "slot-a" },
          ],
        },
        {
          type: "leaf",
          id: "right",
          selectedIndex: 0,
          tabs: [
            { kind: "diff", path: "src/app.ts", source: "working" },
            { kind: "terminal", slotId: "slot-b" },
          ],
        },
      ],
    };

    expect(getVisibleWorkspaceTerminalSlotIds(root)).toEqual(["slot-a"]);
  });

  test("returns all workspace terminal slots in layout order", () => {
    const root: LayoutNode = {
      type: "split",
      id: "root",
      axis: "horizontal",
      ratios: [0.5, 0.5],
      children: [
        {
          type: "leaf",
          id: "left",
          selectedIndex: 0,
          tabs: [
            { kind: "terminal", slotId: "slot-a" },
            { kind: "editor", path: "README.md" },
            { kind: "terminal", slotId: "slot-b" },
          ],
        },
        {
          type: "leaf",
          id: "right",
          selectedIndex: 0,
          tabs: [
            { kind: "diff", path: "src/app.ts", source: "working" },
            { kind: "terminal", slotId: "slot-c" },
          ],
        },
      ],
    };

    expect(getOrderedWorkspaceTerminalSlotIds(root)).toEqual(["slot-a", "slot-b", "slot-c"]);
  });
});

describe("getVisibleProjectTerminalSlotIds", () => {
  test("returns only the slots in the active visible group", () => {
    const panel: TerminalPanelState = {
      visible: true,
      activeGroupIndex: 1,
      activeSlotId: "slot-c",
      groups: [
        { id: "group-a", children: ["slot-a", "slot-b"] },
        { id: "group-b", children: ["slot-c", "slot-d"] },
      ],
    };

    expect(getVisibleProjectTerminalSlotIds(panel)).toEqual(["slot-c", "slot-d"]);
  });

  test("returns no slots when the panel is hidden", () => {
    const panel: TerminalPanelState = {
      visible: false,
      activeGroupIndex: 0,
      activeSlotId: "slot-a",
      groups: [{ id: "group-a", children: ["slot-a"] }],
    };

    expect(getVisibleProjectTerminalSlotIds(panel)).toEqual([]);
  });

  test("returns all project slots in panel order", () => {
    const panel: TerminalPanelState = {
      visible: true,
      activeGroupIndex: 0,
      activeSlotId: "slot-a",
      groups: [
        { id: "group-a", children: ["slot-a", "slot-b"] },
        { id: "group-b", children: ["slot-b", "slot-c"] },
      ],
    };

    expect(getOrderedProjectTerminalSlotIds(panel)).toEqual(["slot-a", "slot-b", "slot-c"]);
  });
});

describe("mergeConnectedTerminalSlotIds", () => {
  test("keeps visited live slots and adds newly visible ones", () => {
    const merged = mergeConnectedTerminalSlotIds(
      ["slot-a", "slot-b", "slot-stale"],
      ["slot-c"],
      ["slot-a", "slot-b", "slot-c"],
    );

    expect([...merged]).toEqual(["slot-a", "slot-b", "slot-c"]);
  });
});

describe("areStringSetsEqual", () => {
  test("compares set contents regardless of insertion order", () => {
    expect(areStringSetsEqual(new Set(["a", "b"]), new Set(["b", "a"]))).toBe(true);
    expect(areStringSetsEqual(new Set(["a"]), new Set(["a", "b"]))).toBe(false);
  });
});
