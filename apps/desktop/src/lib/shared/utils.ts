import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { LayoutAxis, LayoutLeaf, LayoutNode, LayoutSplit, PaneTab } from "@/lib/shared/shared.types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function joinRel(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

export function getParentRelPath(relPath: string): string {
  const index = relPath.lastIndexOf("/");
  return index === -1 ? "" : relPath.slice(0, index);
}

export function joinAbsolutePath(workspaceRoot: string, relPath: string): string {
  return relPath ? `${workspaceRoot}/${relPath}` : workspaceRoot;
}

/**
 * Resize handle styling that keeps the layout footprint at 1px.
 */
export function panelResizeHandleClasses(
  direction: "horizontal" | "vertical",
  enabledOrOptions: boolean | { enabled?: boolean } = true,
): string {
  const enabled =
    typeof enabledOrOptions === "boolean" ? enabledOrOptions : (enabledOrOptions.enabled ?? true);
  return cn(
    // High z-index so terminal/editor surfaces can't steal the hit area.
    "relative z-50 shrink-0 border-0 bg-transparent p-0 outline-none pointer-events-auto touch-none",
    enabled ? "" : "hidden",
    direction === "horizontal"
      ? [
          // Wider hit target with a 1px visible divider centered inside it.
          "h-full w-3 -mx-[5.5px] cursor-col-resize",
          "before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2",
          "before:bg-[var(--theme-border)] before:transition-colors",
          "data-[resize-handle-state=hover]:before:bg-[var(--theme-text-subtle)]",
          "data-[resize-handle-state=drag]:before:bg-[var(--theme-border)]",
        ]
      : [
          "h-3 w-full -my-[5.5px] cursor-row-resize",
          "before:absolute before:inset-x-0 before:top-1/2 before:h-px before:-translate-y-1/2",
          "before:bg-[var(--theme-border)] before:transition-colors",
          "data-[resize-handle-state=hover]:before:bg-[var(--theme-text-subtle)]",
          "data-[resize-handle-state=drag]:before:bg-[var(--theme-border)]",
        ],
  );
}

export function formatRelativeTime(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;

  if (diffMs < 0) return "just now";

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;

  const years = Math.floor(months / 12);
  return `${years}y ago`;
}

export function formatCompactNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs < 1_000) {
    return `${value}`;
  }
  if (abs < 1_000_000) {
    return `${(value / 1_000).toFixed(2)}k`;
  }
  if (abs < 1_000_000_000) {
    return `${(value / 1_000_000).toFixed(2)}m`;
  }
  return `${(value / 1_000_000_000).toFixed(2)}b`;
}

export function findLeaf(node: LayoutNode, paneID: string): LayoutLeaf | null {
  if (node.type === "leaf") return node.id === paneID ? node : null;
  for (const child of node.children) {
    const found = findLeaf(child, paneID);
    if (found) return found;
  }
  return null;
}

export function tabKey(tab: PaneTab): string {
  switch (tab.kind) {
    case "terminal":
      return `t:${tab.slotId}`;
    case "diff":
      return `d:${tab.source}:${tab.path}`;
    case "editor":
      return `e:${tab.path}`;
    case "review":
      return "review";
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
  if (a.kind === "review" && b.kind === "review") {
    return true;
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
