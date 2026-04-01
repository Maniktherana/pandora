import type { LayoutAxis, LayoutLeaf, LayoutNode, LayoutSplit, PaneTab } from "@/lib/types";
import { findLeaf } from "@/lib/layout-migrate";

export { findLeaf };

export function tabKey(tab: PaneTab): string {
  if (tab.kind === "terminal") return `t:${tab.slotId}`;
  if (tab.kind === "diff") return `d:${tab.source}:${tab.path}`;
  return `e:${tab.path}`;
}

export function tabsEqual(a: PaneTab, b: PaneTab): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "terminal") return a.slotId === b.slotId;
  if (a.kind === "diff") return a.path === b.path && a.source === b.source;
  return a.path === b.path;
}

export function getAllLeaves(node: LayoutNode): LayoutLeaf[] {
  if (node.type === "leaf") return [node];
  return node.children.flatMap(getAllLeaves);
}

export function getAllTerminalSlotIds(node: LayoutNode): string[] {
  if (node.type === "leaf") {
    return node.tabs.filter((t): t is { kind: "terminal"; slotId: string } => t.kind === "terminal").map((t) => t.slotId);
  }
  return node.children.flatMap(getAllTerminalSlotIds);
}

export function createLeaf(tabs: PaneTab[]): LayoutLeaf {
  return { type: "leaf", id: crypto.randomUUID(), tabs, selectedIndex: 0 };
}

/** Remove the first tab equal to `tab` from each pane that contains it (typically one pane). */
export function removeMatchingTabFromTree(node: LayoutNode, tab: PaneTab): LayoutNode | null {
  if (node.type === "leaf") {
    const removedIndex = node.tabs.findIndex((t) => tabsEqual(t, tab));
    const tabs = node.tabs.filter((t) => !tabsEqual(t, tab));
    if (tabs.length === 0) {
      return null;
    }
    let sel = node.selectedIndex;
    if (removedIndex >= 0) {
      if (removedIndex < sel) sel--;
      else if (removedIndex === sel) sel = Math.min(sel, tabs.length - 1);
    }
    return { ...node, tabs, selectedIndex: Math.max(0, sel) };
  }
  const newChildren: LayoutNode[] = [];
  for (const child of node.children) {
    const r = removeMatchingTabFromTree(child, tab);
    if (r) newChildren.push(r);
  }
  if (newChildren.length === 0) return null;
  if (newChildren.length === 1) return newChildren[0];
  return { ...node, children: newChildren, ratios: newChildren.map(() => 1 / newChildren.length) } as LayoutSplit;
}

export function removeTerminalSlotFromTree(node: LayoutNode, slotId: string): LayoutNode | null {
  return removeMatchingTabFromTree(node, { kind: "terminal", slotId });
}

export function removeTabAtIndexInTree(node: LayoutNode, paneID: string, tabIndex: number): LayoutNode | null {
  if (node.type === "leaf" && node.id === paneID) {
    const tabs = node.tabs.filter((_, i) => i !== tabIndex);
    if (tabs.length === 0) {
      return null;
    }
    let sel = node.selectedIndex;
    if (tabIndex < sel) sel--;
    else if (tabIndex === sel) sel = Math.min(sel, tabs.length - 1);
    return { ...node, tabs, selectedIndex: Math.max(0, sel) };
  }
  if (node.type === "split") {
    const newChildren: LayoutNode[] = [];
    for (const child of node.children) {
      const r = removeTabAtIndexInTree(child, paneID, tabIndex);
      if (r) newChildren.push(r);
    }
    if (newChildren.length === 0) return null;
    if (newChildren.length === 1) return newChildren[0];
    return {
      ...node,
      children: newChildren,
      ratios: newChildren.map(() => 1 / newChildren.length),
    } as LayoutSplit;
  }
  return node;
}

export function insertTabInPane(
  node: LayoutNode,
  paneID: string,
  tab: PaneTab,
  insertIndex: number
): LayoutNode {
  if (node.type === "leaf" && node.id === paneID) {
    const dupIdx = node.tabs.findIndex((t) => tabsEqual(t, tab));
    if (dupIdx >= 0) {
      return { ...node, selectedIndex: dupIdx };
    }
    const tabs = [...node.tabs];
    const idx = Math.max(0, Math.min(insertIndex, tabs.length));
    tabs.splice(idx, 0, tab);
    return { ...node, tabs, selectedIndex: idx };
  }
  if (node.type === "split") {
    return { ...node, children: node.children.map((c) => insertTabInPane(c, paneID, tab, insertIndex)) };
  }
  return node;
}

export function addTerminalTabToNode(node: LayoutNode, paneID: string, slotId: string): LayoutNode {
  const leaf = findLeaf(node, paneID);
  const at = leaf ? leaf.tabs.length : 0;
  return insertTabInPane(node, paneID, { kind: "terminal", slotId }, at);
}

function uuid(): string {
  return crypto.randomUUID();
}

export function splitPaneAroundTab(
  root: LayoutNode,
  targetPaneID: string,
  tab: PaneTab,
  axis: LayoutAxis,
  position: "before" | "after"
): LayoutNode {
  const newLeaf = createLeaf([tab]);

  function splitNode(node: LayoutNode): LayoutNode {
    if (node.type === "leaf" && node.id === targetPaneID) {
      const children = position === "before" ? [newLeaf, node] : [node, newLeaf];
      return {
        type: "split",
        id: uuid(),
        axis,
        children,
        ratios: [0.5, 0.5],
      } as LayoutSplit;
    }
    if (node.type === "split") {
      return { ...node, children: node.children.map(splitNode) };
    }
    return node;
  }

  return splitNode(root);
}
