import { describe, expect, test } from "bun:test";
import { reconcileProjectTerminalPanelState } from "./project-panel";
import type { TerminalPanelState } from "@/lib/shared/shared.types";

function makePanel(
  groups: Array<{ id: string; children: string[] }>,
  activeGroupIndex = 0,
  activeSlotId?: string | null,
): TerminalPanelState {
  return {
    groups,
    activeGroupIndex,
    activeSlotId: activeSlotId ?? groups[activeGroupIndex]?.children[0] ?? null,
    visible: true,
  };
}

describe("project terminal panel reconciliation", () => {
  test("realigns groups after a removed terminal is re-added and slots later return to canonical order", () => {
    const initialSlots = ["terminal-a", "terminal-b", "terminal-c"];
    let panel = reconcileProjectTerminalPanelState(null, initialSlots);

    const afterRemoval = ["terminal-a", "terminal-c"];
    panel = reconcileProjectTerminalPanelState(panel, afterRemoval);

    const afterReAdd = ["terminal-a", "terminal-c", "terminal-b"];
    panel = reconcileProjectTerminalPanelState(panel, afterReAdd);
    expect(panel.groups.map((g) => g.children)).toEqual([
      ["terminal-a"],
      ["terminal-c"],
      ["terminal-b"],
    ]);

    const canonical = ["terminal-a", "terminal-b", "terminal-c"];
    panel = reconcileProjectTerminalPanelState(panel, canonical);
    expect(panel.groups.map((g) => g.children)).toEqual([
      ["terminal-a"],
      ["terminal-b"],
      ["terminal-c"],
    ]);
  });

  test("realigns terminal groups to the slot order and preserves the active group", () => {
    const corrupted = makePanel(
      [
        { id: "group-a", children: ["terminal-a"] },
        { id: "group-c", children: ["terminal-c"] },
        { id: "group-b", children: ["terminal-b"] },
      ],
      1,
      "terminal-c",
    );

    const slots = ["terminal-a", "terminal-b", "terminal-c"];
    const result = reconcileProjectTerminalPanelState(corrupted, slots);

    expect(result).toEqual({
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

  test("hides the panel when the last terminal disappears", () => {
    const panel = makePanel([{ id: "group-a", children: ["terminal-a"] }], 0, "terminal-a");
    const result = reconcileProjectTerminalPanelState(panel, []);

    expect(result).toEqual({
      groups: [],
      activeGroupIndex: 0,
      activeSlotId: null,
      visible: false,
    });
  });
});
