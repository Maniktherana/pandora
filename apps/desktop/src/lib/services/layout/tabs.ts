import type { DiffSource, LayoutNode, PaneTab } from "@/lib/shared/shared.types";
import { createLeaf, findLeaf, getAllLeaves, insertTabInPane, splitPaneAroundTab, tabsEqual } from "@/lib/shared/utils";
import { useLayoutStore } from "@/lib/services/layout/store";

function readLayout(workspaceId: string) {
  return useLayoutStore.getState().getLayout(workspaceId);
}

function commitLayout(workspaceId: string, root: LayoutNode | null, focusedPaneID: string | null) {
  useLayoutStore.getState().setLayout(workspaceId, { root, focusedPaneID });
}

function ensureWorkspaceRoot(workspaceId: string) {
  const layout = readLayout(workspaceId);
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

function insertTab(
  workspaceId: string,
  tab: PaneTab,
  matchesExisting: (candidate: PaneTab) => boolean,
): boolean {
  const layout = ensureWorkspaceRoot(workspaceId);
  const paneID = selectInsertionPane(layout.root, layout.focusedPaneID);
  if (!paneID) return false;

  const leaf = findLeaf(layout.root, paneID);
  if (!leaf) return false;

  const dupIndex = leaf.tabs.findIndex(matchesExisting);
  if (dupIndex >= 0) {
    commitLayout(workspaceId, selectTabInLayout(layout.root, paneID, dupIndex), paneID);
    return false;
  }

  const insertAt = leaf.tabs.length;
  commitLayout(workspaceId, insertTabInPane(layout.root, paneID, tab, insertAt), paneID);
  return true;
}

export function addEditorTabToWorkspaceLayout(
  workspaceId: string,
  relativePath: string,
): boolean {
  return insertTab(
    workspaceId,
    { kind: "editor", path: relativePath },
    (candidate) => candidate.kind === "editor" && candidate.path === relativePath,
  );
}

export function addDiffTabToWorkspaceLayout(
  workspaceId: string,
  relativePath: string,
  source: DiffSource,
): boolean {
  return insertTab(
    workspaceId,
    { kind: "diff", path: relativePath, source },
    (candidate) =>
      candidate.kind === "diff" && candidate.path === relativePath && candidate.source === source,
  );
}

export function addTerminalTabToWorkspaceLayout(
  workspaceId: string,
  slotId: string,
): boolean {
  const layout = readLayout(workspaceId);
  if (!layout.root) {
    const root = createLeaf([{ kind: "terminal", slotId }]);
    commitLayout(workspaceId, root, root.id);
    return true;
  }

  const paneID = selectInsertionPane(layout.root, layout.focusedPaneID);
  if (!paneID) {
    const root = createLeaf([{ kind: "terminal", slotId }]);
    commitLayout(workspaceId, root, root.id);
    return true;
  }

  const existingLeaf = findLeaf(layout.root, paneID);
  if (!existingLeaf) return false;
  if (existingLeaf.tabs.some((tab) => tab.kind === "terminal" && tab.slotId === slotId)) {
    commitLayout(workspaceId, layout.root, paneID);
    return false;
  }

  commitLayout(workspaceId, insertTabInPane(layout.root, paneID, { kind: "terminal", slotId }, existingLeaf.tabs.length), paneID);
  return true;
}

function addTabToSpecificPane(
  workspaceId: string,
  paneID: string,
  tab: PaneTab,
  insertIndex?: number,
): boolean {
  const layout = ensureWorkspaceRoot(workspaceId);
  const leaf = findLeaf(layout.root, paneID);
  if (!leaf) return false;

  const dupIndex = leaf.tabs.findIndex((candidate) => tabsEqual(candidate, tab));
  if (dupIndex >= 0) {
    commitLayout(workspaceId, selectTabInLayout(layout.root, paneID, dupIndex), paneID);
    return false;
  }

  commitLayout(
    workspaceId,
    insertTabInPane(layout.root, paneID, tab, insertIndex ?? leaf.tabs.length),
    paneID,
  );
  return true;
}

export function addEditorTabToPaneInWorkspaceLayout(
  workspaceId: string,
  paneID: string,
  relativePath: string,
  insertIndex?: number,
): boolean {
  return addTabToSpecificPane(workspaceId, paneID, { kind: "editor", path: relativePath }, insertIndex);
}

export function splitPaneWithEditorInWorkspaceLayout(
  workspaceId: string,
  targetPaneID: string,
  relativePath: string,
  axis: "horizontal" | "vertical",
  position: "before" | "after",
): boolean {
  const layout = readLayout(workspaceId);
  if (!layout.root) return false;
  if (!findLeaf(layout.root, targetPaneID)) return false;

  const tab: PaneTab = { kind: "editor", path: relativePath };
  const previousLeafIds = new Set(getAllLeaves(layout.root).map((leaf) => leaf.id));
  const nextRoot = splitPaneAroundTab(layout.root, targetPaneID, tab, axis, position);
  const insertedLeaf = getAllLeaves(nextRoot).find(
    (leaf) =>
      !previousLeafIds.has(leaf.id) && leaf.tabs.some((candidate) => tabsEqual(candidate, tab)),
  );

  commitLayout(workspaceId, nextRoot, insertedLeaf?.id ?? targetPaneID);
  return true;
}
