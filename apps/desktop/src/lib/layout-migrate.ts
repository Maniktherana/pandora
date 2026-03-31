import type { LayoutAxis, LayoutLeaf, LayoutNode, LayoutSplit, PaneTab } from "@/lib/types";

export function findLeaf(node: LayoutNode, paneID: string): LayoutLeaf | null {
  if (node.type === "leaf") return node.id === paneID ? node : null;
  for (const child of node.children) {
    const found = findLeaf(child, paneID);
    if (found) return found;
  }
  return null;
}

function migratePaneTab(t: unknown): PaneTab | null {
  if (!t || typeof t !== "object") return null;
  const o = t as Record<string, unknown>;
  const k = o.kind ?? o.type;
  if (k === "terminal") {
    const slotId = String(o.slotId ?? o.slotID ?? "");
    return slotId ? { kind: "terminal", slotId } : null;
  }
  if (k === "editor") {
    const path = String(o.path ?? "");
    return path ? { kind: "editor", path } : null;
  }
  return null;
}

export function migrateLayoutNode(node: unknown): LayoutNode | null {
  if (!node || typeof node !== "object") return null;
  const n = node as Record<string, unknown>;
  if (n.type === "split" && Array.isArray(n.children)) {
    const children = n.children
      .map((c) => migrateLayoutNode(c))
      .filter((c): c is LayoutNode => c !== null);
    if (children.length === 0) return null;
    const axis = (n.axis === "vertical" ? "vertical" : "horizontal") as LayoutAxis;
    const ratios = Array.isArray(n.ratios)
      ? (n.ratios as unknown[]).map((x) => Number(x))
      : children.map(() => 1 / children.length);
    return {
      type: "split",
      id: String(n.id ?? ""),
      axis,
      children,
      ratios: ratios.length === children.length ? ratios : children.map(() => 1 / children.length),
    } as LayoutSplit;
  }
  if (n.type === "leaf") {
    const id = String(n.id ?? "");
    const selectedIndex = Number(n.selectedIndex ?? 0);
    let tabs: PaneTab[];
    if (Array.isArray(n.tabs)) {
      tabs = (n.tabs as unknown[]).map(migratePaneTab).filter((t): t is PaneTab => t !== null);
    } else if (Array.isArray(n.slotIDs)) {
      tabs = (n.slotIDs as string[]).map((slotId) => ({ kind: "terminal", slotId }));
    } else {
      tabs = [];
    }
    if (tabs.length === 0) return null;
    return {
      type: "leaf",
      id,
      tabs,
      selectedIndex: Math.min(Math.max(0, selectedIndex), tabs.length - 1),
    };
  }
  return null;
}

export function migratePersistedLayout(raw: unknown): {
  root: LayoutNode;
  focusedPaneID: string | null;
} | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const root = migrateLayoutNode(o.root);
  if (!root) return null;
  const fp = o.focusedPaneID;
  return {
    root,
    focusedPaneID: typeof fp === "string" ? fp : null,
  };
}
