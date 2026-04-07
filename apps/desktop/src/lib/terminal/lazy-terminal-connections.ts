import { getAllTerminalSlotIds, getVisualLeaves } from "@/components/layout/workspace/layout-tree";
import type { LayoutNode, TerminalPanelState } from "@/lib/shared/types";

export function getVisibleWorkspaceTerminalSlotIds(root: LayoutNode | null): string[] {
  if (!root) return [];

  const slotIds = new Set<string>();
  for (const leaf of getVisualLeaves(root)) {
    const activeTab = leaf.tabs[leaf.selectedIndex] ?? leaf.tabs[0];
    if (activeTab?.kind === "terminal") {
      slotIds.add(activeTab.slotId);
    }
  }

  return [...slotIds];
}

export function getOrderedWorkspaceTerminalSlotIds(root: LayoutNode | null): string[] {
  if (!root) return [];
  return [...new Set(getAllTerminalSlotIds(root))];
}

export function getVisibleProjectTerminalSlotIds(panel: TerminalPanelState | null): string[] {
  if (!panel?.visible || panel.groups.length === 0) return [];

  const activeGroup = panel.groups[panel.activeGroupIndex] ?? panel.groups[0];
  if (!activeGroup) return [];

  return [...new Set(activeGroup.children)];
}

export function getOrderedProjectTerminalSlotIds(panel: TerminalPanelState | null): string[] {
  if (!panel) return [];
  return [...new Set(panel.groups.flatMap((group) => group.children))];
}

export function mergeConnectedTerminalSlotIds(
  connectedSlotIds: Iterable<string>,
  visibleSlotIds: Iterable<string>,
  liveSlotIds: Iterable<string>,
): Set<string> {
  const next = new Set<string>();
  const liveSlotIdSet = new Set(liveSlotIds);

  for (const slotId of connectedSlotIds) {
    if (liveSlotIdSet.has(slotId)) {
      next.add(slotId);
    }
  }

  for (const slotId of visibleSlotIds) {
    next.add(slotId);
  }

  return next;
}

export function areStringSetsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) return false;

  for (const value of left) {
    if (!right.has(value)) return false;
  }

  return true;
}
