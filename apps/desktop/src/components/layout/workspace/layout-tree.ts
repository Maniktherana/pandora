import type { LayoutAxis, LayoutLeaf, LayoutNode, LayoutSplit, PaneTab } from "@/lib/shared/types";
import { findLeaf } from "./layout-migrate";

export { findLeaf };

export function tabKey(tab: PaneTab): string {
  switch (tab.kind) {
    case "terminal":
      return `t:${tab.slotId}`;
    case "diff":
      return `d:${tab.source}:${tab.path}`;
    case "editor":
      return `e:${tab.path}`;
  }
}

export function tabsEqual(a: PaneTab, b: PaneTab): boolean {
  if (a.kind === "terminal" && b.kind === "terminal") {
    return a.slotId === b.slotId;
  }
  if (a.kind === "diff" && b.kind === "diff") {
    return a.path === b.path && a.source === b.source;
  }
  if (a.kind === "editor" && b.kind === "editor") {
    return a.path === b.path;
  }
  return false;
}

export function getAllLeaves(node: LayoutNode): LayoutLeaf[] {
  if (node.type === "leaf") return [node];
  return node.children.flatMap(getAllLeaves);
}

type NormalizedRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type PositionedLeaf = {
  leaf: LayoutLeaf;
  rect: NormalizedRect;
};

function normalizeRatios(ratios: number[], length: number): number[] {
  if (length === 0) return [];
  if (ratios.length !== length) {
    return Array.from({ length }, () => 1 / length);
  }
  const total = ratios.reduce((sum, ratio) => sum + (Number.isFinite(ratio) ? ratio : 0), 0);
  if (total <= 0) {
    return Array.from({ length }, () => 1 / length);
  }
  return ratios.map((ratio) => (Number.isFinite(ratio) ? ratio / total : 0));
}

function collectPositionedLeaves(node: LayoutNode, rect: NormalizedRect): PositionedLeaf[] {
  if (node.type === "leaf") {
    return [{ leaf: node, rect }];
  }

  const ratios = normalizeRatios(node.ratios, node.children.length);
  let offset = 0;

  return node.children.flatMap((child, index) => {
    const ratio = ratios[index] ?? 0;
    const childRect: NormalizedRect =
      node.axis === "horizontal"
        ? {
            x: rect.x + rect.width * offset,
            y: rect.y,
            width: rect.width * ratio,
            height: rect.height,
          }
        : {
            x: rect.x,
            y: rect.y + rect.height * offset,
            width: rect.width,
            height: rect.height * ratio,
          };
    offset += ratio;
    return collectPositionedLeaves(child, childRect);
  });
}

export function getVisualLeaves(node: LayoutNode): LayoutLeaf[] {
  return collectPositionedLeaves(node, { x: 0, y: 0, width: 1, height: 1 })
    .sort((a, b) => {
      const rowDelta = a.rect.y - b.rect.y;
      if (Math.abs(rowDelta) > 0.001) return rowDelta;

      const columnDelta = a.rect.x - b.rect.x;
      if (Math.abs(columnDelta) > 0.001) return columnDelta;

      const heightDelta = b.rect.height - a.rect.height;
      if (Math.abs(heightDelta) > 0.001) return heightDelta;

      return a.leaf.id.localeCompare(b.leaf.id);
    })
    .map((entry) => entry.leaf);
}

export function getAllTerminalSlotIds(node: LayoutNode): string[] {
  if (node.type === "leaf") {
    return node.tabs
      .filter((t): t is { kind: "terminal"; slotId: string } => t.kind === "terminal")
      .map((t) => t.slotId);
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
  return {
    ...node,
    children: newChildren,
    ratios: newChildren.map(() => 1 / newChildren.length),
  } as LayoutSplit;
}

export function removeTerminalSlotFromTree(node: LayoutNode, slotId: string): LayoutNode | null {
  return removeMatchingTabFromTree(node, { kind: "terminal", slotId });
}

export function removeTabAtIndexInTree(
  node: LayoutNode,
  paneID: string,
  tabIndex: number,
): LayoutNode | null {
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
  insertIndex: number,
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
    return {
      ...node,
      children: node.children.map((c) => insertTabInPane(c, paneID, tab, insertIndex)),
    };
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
  position: "before" | "after",
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

export function splitPaneWithinLeaf(
  root: LayoutNode,
  paneID: string,
  tabIndex: number,
  axis: LayoutAxis,
  position: "before" | "after",
): LayoutNode {
  function splitNode(node: LayoutNode): LayoutNode {
    if (node.type === "leaf" && node.id === paneID) {
      const tab = node.tabs[tabIndex];
      if (!tab) return node;

      const remainingTabs = node.tabs.filter((_, index) => index !== tabIndex);
      if (remainingTabs.length === 0) return node;

      let selectedIndex = node.selectedIndex;
      if (tabIndex < selectedIndex) selectedIndex--;
      else if (tabIndex === selectedIndex) {
        selectedIndex = Math.min(selectedIndex, remainingTabs.length - 1);
      }

      const remainingLeaf: LayoutLeaf = {
        ...node,
        tabs: remainingTabs,
        selectedIndex: Math.max(0, selectedIndex),
      };
      const movedLeaf = createLeaf([tab]);
      const children =
        position === "before" ? [movedLeaf, remainingLeaf] : [remainingLeaf, movedLeaf];

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
