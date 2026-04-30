import type { DiffSource, LayoutAxis, LayoutNode } from "@/lib/shared/types";
import {
  getAllLeaves,
  getVisualLeaves,
  createLeaf,
  findLeaf,
  insertTabInPane,
  removeMatchingTabFromTree,
  removeTabAtIndexInTree,
  splitPaneAroundTab,
  splitPaneWithinLeaf,
  addTerminalTabToNode,
  getAllTerminalSlotIds,
  removeTerminalSlotFromTree,
} from "@/components/layout/workspace/layout-tree";
import { useLayoutStore, type WorkspaceLayoutState } from "@/services/workspace/layout-store";

type WorkspaceLayoutSnapshot = Pick<WorkspaceLayoutState, "root" | "focusedPaneID">;

function readWorkspaceLayout(workspaceId: string): WorkspaceLayoutState {
  return useLayoutStore.getState().getLayout(workspaceId);
}

function commitWorkspaceLayout(workspaceId: string, next: WorkspaceLayoutSnapshot) {
  useLayoutStore.getState().setLayout(workspaceId, {
    root: next.root,
    focusedPaneID: next.focusedPaneID,
  });
}

function ensureWorkspaceRoot(layout: WorkspaceLayoutSnapshot): WorkspaceLayoutSnapshot {
  if (layout.root) {
    const leaves = getAllLeaves(layout.root);
    const focusedPaneID =
      layout.focusedPaneID && findLeaf(layout.root, layout.focusedPaneID)
        ? layout.focusedPaneID
        : (leaves[0]?.id ?? null);
    return { root: layout.root, focusedPaneID };
  }

  const root = createLeaf([]);
  return { root, focusedPaneID: root.id };
}

function selectInsertionPane(root: LayoutNode, focusedPaneID: string | null): string | null {
  if (focusedPaneID && findLeaf(root, focusedPaneID)) return focusedPaneID;
  return getAllLeaves(root)[0]?.id ?? null;
}

function selectTabInLayout(root: LayoutNode, paneID: string, index: number): LayoutNode {
  if (root.type === "leaf") {
    if (root.id !== paneID) return root;
    return {
      ...root,
      selectedIndex:
        root.tabs.length === 0 ? 0 : Math.min(Math.max(0, index), root.tabs.length - 1),
    };
  }

  return {
    ...root,
    children: root.children.map((child) => selectTabInLayout(child, paneID, index)),
  };
}

function withWorkspaceLayoutSnapshot(
  workspaceId: string,
  transform: (snapshot: WorkspaceLayoutState) => WorkspaceLayoutSnapshot | null,
): boolean {
  const next = transform(readWorkspaceLayout(workspaceId));
  if (!next) return false;
  commitWorkspaceLayout(workspaceId, next);
  return true;
}

export function splitPaneInWorkspaceLayout(
  workspaceId: string,
  targetPaneID: string,
  sourcePaneID: string,
  sourceTabIndex: number,
  axis: LayoutAxis,
  position: "before" | "after",
) {
  return withWorkspaceLayoutSnapshot(workspaceId, (snapshot) => {
    if (!snapshot.root) return null;
    const srcLeaf = findLeaf(snapshot.root, sourcePaneID);
    const tab = srcLeaf?.tabs[sourceTabIndex];
    if (!tab) return null;
    if (targetPaneID !== sourcePaneID && !findLeaf(snapshot.root, targetPaneID)) return null;

    if (targetPaneID === sourcePaneID) {
      return {
        root: splitPaneWithinLeaf(snapshot.root, sourcePaneID, sourceTabIndex, axis, position),
        focusedPaneID: snapshot.focusedPaneID,
      };
    }

    let root: LayoutNode | null = removeTabAtIndexInTree(
      snapshot.root,
      sourcePaneID,
      sourceTabIndex,
    );
    if (!root) {
      root = createLeaf([tab]);
      return { root, focusedPaneID: root.type === "leaf" ? root.id : snapshot.focusedPaneID };
    }
    if (!findLeaf(root, targetPaneID)) return null;
    root = splitPaneAroundTab(root, targetPaneID, tab, axis, position);
    return { root, focusedPaneID: snapshot.focusedPaneID };
  });
}

export function addTabToPaneInWorkspaceLayout(
  workspaceId: string,
  targetPaneID: string,
  sourcePaneID: string,
  sourceTabIndex: number,
) {
  return withWorkspaceLayoutSnapshot(workspaceId, (snapshot) => {
    if (!snapshot.root) return null;
    const srcLeaf = findLeaf(snapshot.root, sourcePaneID);
    const tab = srcLeaf?.tabs[sourceTabIndex];
    if (!tab) return null;
    if (!findLeaf(snapshot.root, targetPaneID)) return null;

    let root: LayoutNode | null = removeMatchingTabFromTree(snapshot.root, tab);
    if (!root) {
      return { root: createLeaf([tab]), focusedPaneID: snapshot.focusedPaneID };
    }
    const destLeaf = findLeaf(root, targetPaneID);
    const insertAt = destLeaf?.tabs.length ?? 0;
    root = insertTabInPane(root, targetPaneID, tab, insertAt);
    return { root, focusedPaneID: snapshot.focusedPaneID };
  });
}

export function removeTabFromWorkspaceLayout(
  workspaceId: string,
  paneID: string,
  tabIndex: number,
) {
  return withWorkspaceLayoutSnapshot(workspaceId, (snapshot) => {
    if (!snapshot.root) return null;
    const newRoot = removeTabAtIndexInTree(snapshot.root, paneID, tabIndex);
    const leaves = newRoot ? getAllLeaves(newRoot) : [];
    const focusedOK =
      newRoot && snapshot.focusedPaneID ? findLeaf(newRoot, snapshot.focusedPaneID) : null;
    const focusedPaneID = focusedOK ? snapshot.focusedPaneID : (leaves[0]?.id ?? null);
    return { root: newRoot, focusedPaneID };
  });
}

export function selectTabInPaneInWorkspaceLayout(
  workspaceId: string,
  paneID: string,
  index: number,
) {
  return withWorkspaceLayoutSnapshot(workspaceId, (snapshot) => {
    if (!snapshot.root) return null;
    const leaf = findLeaf(snapshot.root, paneID);
    if (!leaf) return null;
    return { root: selectTabInLayout(snapshot.root, paneID, index), focusedPaneID: paneID };
  });
}

export function moveTabInWorkspaceLayout(
  workspaceId: string,
  fromPaneID: string,
  toPaneID: string,
  fromIndex: number,
  toIndex: number,
) {
  return withWorkspaceLayoutSnapshot(workspaceId, (snapshot) => {
    if (!snapshot.root) return null;
    const srcLeaf = findLeaf(snapshot.root, fromPaneID);
    const tab = srcLeaf?.tabs[fromIndex];
    if (!tab) return null;
    if (!findLeaf(snapshot.root, toPaneID)) return null;

    let root: LayoutNode | null = removeTabAtIndexInTree(snapshot.root, fromPaneID, fromIndex);
    if (!root) return null;
    if (!findLeaf(root, toPaneID)) return null;

    let insertIndex = toIndex;
    if (fromPaneID === toPaneID && fromIndex < toIndex) {
      insertIndex--;
    }
    root = insertTabInPane(root, toPaneID, tab, insertIndex);
    return { root, focusedPaneID: snapshot.focusedPaneID };
  });
}

export function reorderTabInWorkspaceLayout(
  workspaceId: string,
  paneID: string,
  fromIndex: number,
  toIndex: number,
) {
  return withWorkspaceLayoutSnapshot(workspaceId, (snapshot) => {
    if (!snapshot.root) return null;

    function reorder(node: LayoutNode): LayoutNode {
      if (node.type === "leaf" && node.id === paneID) {
        const tabs = [...node.tabs];
        const [moved] = tabs.splice(fromIndex, 1);
        tabs.splice(toIndex, 0, moved);
        let sel = node.selectedIndex;
        if (sel === fromIndex) sel = toIndex;
        else if (fromIndex < toIndex) {
          if (sel > fromIndex && sel <= toIndex) sel--;
        } else if (fromIndex > toIndex) {
          if (sel >= toIndex && sel < fromIndex) sel++;
        }
        return { ...node, tabs, selectedIndex: Math.max(0, Math.min(sel, tabs.length - 1)) };
      }
      if (node.type === "split") {
        return { ...node, children: node.children.map(reorder) };
      }
      return node;
    }

    return { root: reorder(snapshot.root), focusedPaneID: snapshot.focusedPaneID };
  });
}

export function setFocusedPaneInWorkspaceLayout(workspaceId: string, paneID: string) {
  return withWorkspaceLayoutSnapshot(workspaceId, (snapshot) => {
    if (!snapshot.root) return null;
    if (!findLeaf(snapshot.root, paneID)) return null;
    return { root: snapshot.root, focusedPaneID: paneID };
  });
}

export function cycleWorkspaceTabs(workspaceId: string, direction: -1 | 1) {
  return withWorkspaceLayoutSnapshot(workspaceId, (snapshot) => {
    if (!snapshot.root || !snapshot.focusedPaneID) return null;

    const leaves = getVisualLeaves(snapshot.root).filter((leaf) => leaf.tabs.length > 0);
    if (leaves.length === 0) return null;

    const currentLeaf = leaves.find((leaf) => leaf.id === snapshot.focusedPaneID);
    if (!currentLeaf) return null;

    const nextIndex = currentLeaf.selectedIndex + direction;
    if (nextIndex >= 0 && nextIndex < currentLeaf.tabs.length) {
      const root = selectTabInLayout(snapshot.root, currentLeaf.id, nextIndex);
      return { root, focusedPaneID: currentLeaf.id };
    }

    const paneIdx = leaves.indexOf(currentLeaf);
    const nextPaneIdx = paneIdx + direction;
    if (nextPaneIdx < 0 || nextPaneIdx >= leaves.length) {
      const wrapPane = direction === 1 ? leaves[0] : leaves[leaves.length - 1];
      const wrapTabIdx = direction === 1 ? 0 : Math.max(0, wrapPane.tabs.length - 1);
      const root = selectTabInLayout(snapshot.root, wrapPane.id, wrapTabIdx);
      return { root, focusedPaneID: wrapPane.id };
    }

    const nextPane = leaves[nextPaneIdx];
    const targetIndex = direction === 1 ? 0 : Math.max(0, nextPane.tabs.length - 1);
    const root = selectTabInLayout(snapshot.root, nextPane.id, targetIndex);
    return { root, focusedPaneID: nextPane.id };
  });
}

export function openEditorTabInWorkspaceLayout(workspaceId: string, relativePath: string) {
  const snapshot = ensureWorkspaceRoot(readWorkspaceLayout(workspaceId));
  if (!snapshot.root) return false;
  const leaves = getAllLeaves(snapshot.root);
  let paneID = snapshot.focusedPaneID;
  if (!paneID || !findLeaf(snapshot.root, paneID)) {
    paneID = leaves[0]?.id ?? null;
  }
  if (!paneID) return false;

  const leaf = findLeaf(snapshot.root, paneID);
  if (!leaf) return false;
  const dup = leaf.tabs.findIndex((tab) => tab.kind === "editor" && tab.path === relativePath);
  if (dup >= 0) {
    return selectTabInPaneInWorkspaceLayout(workspaceId, paneID, dup);
  }

  return withWorkspaceLayoutSnapshot(workspaceId, (current) => {
    if (!current.root) return null;
    const pl = findLeaf(current.root, paneID!);
    const at = pl?.tabs.length ?? 0;
    const root = insertTabInPane(current.root, paneID!, { kind: "editor", path: relativePath }, at);
    return { root, focusedPaneID: paneID };
  });
}

export function openDiffTabInWorkspaceLayout(
  workspaceId: string,
  relativePath: string,
  source: DiffSource,
) {
  const snapshot = ensureWorkspaceRoot(readWorkspaceLayout(workspaceId));
  if (!snapshot.root) return false;
  const leaves = getAllLeaves(snapshot.root);
  let paneID = snapshot.focusedPaneID;
  if (!paneID || !findLeaf(snapshot.root, paneID)) {
    paneID = leaves[0]?.id ?? null;
  }
  if (!paneID) return false;

  const leaf = findLeaf(snapshot.root, paneID);
  if (!leaf) return false;
  const dup = leaf.tabs.findIndex(
    (tab) => tab.kind === "diff" && tab.path === relativePath && tab.source === source,
  );
  if (dup >= 0) {
    return selectTabInPaneInWorkspaceLayout(workspaceId, paneID, dup);
  }

  return withWorkspaceLayoutSnapshot(workspaceId, (current) => {
    if (!current.root) return null;
    const pl = findLeaf(current.root, paneID!);
    const at = pl?.tabs.length ?? 0;
    const root = insertTabInPane(
      current.root,
      paneID!,
      { kind: "diff", path: relativePath, source },
      at,
    );
    return { root, focusedPaneID: paneID };
  });
}

export function openReviewTabInWorkspaceLayout(workspaceId: string) {
  const snapshot = ensureWorkspaceRoot(readWorkspaceLayout(workspaceId));
  if (!snapshot.root) return false;

  for (const leaf of getAllLeaves(snapshot.root)) {
    const reviewIndex = leaf.tabs.findIndex((tab) => tab.kind === "review");
    if (reviewIndex >= 0) {
      return selectTabInPaneInWorkspaceLayout(workspaceId, leaf.id, reviewIndex);
    }
  }

  const leaves = getAllLeaves(snapshot.root);
  let paneID = snapshot.focusedPaneID;
  if (!paneID || !findLeaf(snapshot.root, paneID)) {
    paneID = leaves[0]?.id ?? null;
  }
  if (!paneID) return false;

  return withWorkspaceLayoutSnapshot(workspaceId, (current) => {
    if (!current.root) return null;
    const leaf = findLeaf(current.root, paneID!);
    const insertAt = leaf?.tabs.length ?? 0;
    const root = insertTabInPane(current.root, paneID!, { kind: "review" }, insertAt);
    return { root, focusedPaneID: paneID };
  });
}

export function sanitizeWorkspaceTerminalLayout(
  root: LayoutNode | null,
  focusedPaneID: string | null,
  liveSlotIds: Set<string>,
): { root: LayoutNode | null; focusedPaneID: string | null } {
  if (!root) {
    return { root: null, focusedPaneID: null };
  }

  let nextRoot: LayoutNode | null = root;
  for (const slotId of new Set(getAllTerminalSlotIds(root))) {
    if (!liveSlotIds.has(slotId)) {
      nextRoot = nextRoot ? removeTerminalSlotFromTree(nextRoot, slotId) : null;
    }
  }

  if (!nextRoot) {
    return { root: null, focusedPaneID: null };
  }

  const nextFocusedPaneID =
    focusedPaneID && findLeaf(nextRoot, focusedPaneID)
      ? focusedPaneID
      : (getAllLeaves(nextRoot)[0]?.id ?? null);

  return { root: nextRoot, focusedPaneID: nextFocusedPaneID };
}

export function removeTerminalSlotFromWorkspaceLayout(workspaceId: string, slotId: string) {
  withWorkspaceLayoutSnapshot(workspaceId, (snapshot) => {
    if (!snapshot.root) return null;
    const newRoot = removeTerminalSlotFromTree(snapshot.root, slotId);
    const leaves = newRoot ? getAllLeaves(newRoot) : [];
    const focusedOK =
      newRoot && snapshot.focusedPaneID ? findLeaf(newRoot, snapshot.focusedPaneID) : null;
    const focusedPaneID = focusedOK ? snapshot.focusedPaneID : (leaves[0]?.id ?? null);
    return { root: newRoot, focusedPaneID };
  });
}

export function ensureWorkspaceTerminalLayout(workspaceId: string, slotIds: string[]) {
  if (slotIds.length === 0) return;
  withWorkspaceLayoutSnapshot(workspaceId, (snapshot) => {
    if (snapshot.layoutLoading) return null;

    const existingSlotIds = snapshot.root
      ? new Set(getAllTerminalSlotIds(snapshot.root))
      : new Set<string>();
    const newSlotIds = slotIds.filter((id) => !existingSlotIds.has(id));
    if (newSlotIds.length === 0) return null;

    let root: LayoutNode = snapshot.root ?? createLeaf([]);
    let focusedPaneID = snapshot.focusedPaneID ?? (root.type === "leaf" ? root.id : null);

    for (const slotId of newSlotIds) {
      if (focusedPaneID) {
        root = addTerminalTabToNode(root, focusedPaneID, slotId);
      } else {
        const leaf = createLeaf([{ kind: "terminal", slotId }]);
        root = leaf;
        focusedPaneID = leaf.id;
      }
    }

    return { root, focusedPaneID };
  });
}
