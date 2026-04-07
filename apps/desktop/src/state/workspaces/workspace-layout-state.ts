import type { DiffSource, LayoutNode, PaneTab, WorkspaceRuntimeState } from "@/lib/shared/types";
import {
  addTerminalTabToNode,
  createLeaf,
  findLeaf,
  getAllLeaves,
  insertTabInPane,
  splitPaneAroundTab,
  tabsEqual,
} from "@/components/layout/workspace/layout-tree";

type RuntimeLayoutSnapshot = {
  root: LayoutNode;
  focusedPaneID: string;
};

function ensureWorkspaceRoot(runtime: WorkspaceRuntimeState): RuntimeLayoutSnapshot {
  if (runtime.root) {
    const leaves = getAllLeaves(runtime.root);
    const focusedPaneID =
      runtime.focusedPaneID && findLeaf(runtime.root, runtime.focusedPaneID)
        ? runtime.focusedPaneID
        : (leaves[0]?.id ?? (runtime.root.type === "leaf" ? runtime.root.id : ""));
    return {
      root: runtime.root,
      focusedPaneID,
    };
  }

  const root = createLeaf([]);
  return {
    root,
    focusedPaneID: root.id,
  };
}

function selectInsertionPane(root: LayoutNode, focusedPaneID: string | null): string | null {
  if (focusedPaneID && findLeaf(root, focusedPaneID)) return focusedPaneID;
  const leaves = getAllLeaves(root);
  return leaves[0]?.id ?? null;
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
  runtime: WorkspaceRuntimeState,
  tab: PaneTab,
  matchesExisting: (candidate: PaneTab) => boolean
): boolean {
  const layout = ensureWorkspaceRoot(runtime);
  const paneID = selectInsertionPane(layout.root, runtime.focusedPaneID ?? layout.focusedPaneID);
  if (!paneID) return false;

  const leaf = findLeaf(layout.root, paneID);
  if (!leaf) return false;

  const dupIndex = leaf.tabs.findIndex(matchesExisting);
  if (dupIndex >= 0) {
    runtime.root = selectTabInLayout(layout.root, paneID, dupIndex);
    runtime.focusedPaneID = paneID;
    return false;
  }

  const insertAt = leaf.tabs.length;
  runtime.root = insertTabInPane(layout.root, paneID, tab, insertAt);
  runtime.focusedPaneID = paneID;
  return true;
}

export function addEditorTabToWorkspaceRuntime(
  runtime: WorkspaceRuntimeState,
  relativePath: string
): boolean {
  return insertTab(
    runtime,
    { kind: "editor", path: relativePath },
    (candidate) => candidate.kind === "editor" && candidate.path === relativePath
  );
}

export function addDiffTabToWorkspaceRuntime(
  runtime: WorkspaceRuntimeState,
  relativePath: string,
  source: DiffSource
): boolean {
  return insertTab(
    runtime,
    { kind: "diff", path: relativePath, source },
    (candidate) =>
      candidate.kind === "diff" &&
      candidate.path === relativePath &&
      candidate.source === source
  );
}

export function addTerminalTabToWorkspaceRuntime(
  runtime: WorkspaceRuntimeState,
  slotId: string
): boolean {
  if (!runtime.root) {
    const root = createLeaf([{ kind: "terminal", slotId }]);
    runtime.root = root;
    runtime.focusedPaneID = root.id;
    return true;
  }

  const paneID = selectInsertionPane(runtime.root, runtime.focusedPaneID);
  if (!paneID) {
    const root = createLeaf([{ kind: "terminal", slotId }]);
    runtime.root = root;
    runtime.focusedPaneID = root.id;
    return true;
  }

  const existingLeaf = findLeaf(runtime.root, paneID);
  if (!existingLeaf) return false;
  if (existingLeaf.tabs.some((tab) => tab.kind === "terminal" && tab.slotId === slotId)) {
    runtime.focusedPaneID = paneID;
    return false;
  }

  runtime.root = addTerminalTabToNode(runtime.root, paneID, slotId);
  runtime.focusedPaneID = paneID;
  return true;
}

function addTabToSpecificPane(
  runtime: WorkspaceRuntimeState,
  paneID: string,
  tab: PaneTab,
  insertIndex?: number
): boolean {
  const layout = ensureWorkspaceRoot(runtime);
  const leaf = findLeaf(layout.root, paneID);
  if (!leaf) return false;

  const dupIndex = leaf.tabs.findIndex((candidate) => tabsEqual(candidate, tab));
  if (dupIndex >= 0) {
    runtime.root = selectTabInLayout(layout.root, paneID, dupIndex);
    runtime.focusedPaneID = paneID;
    return false;
  }

  runtime.root = insertTabInPane(layout.root, paneID, tab, insertIndex ?? leaf.tabs.length);
  runtime.focusedPaneID = paneID;
  return true;
}

export function addEditorTabToPaneInWorkspaceRuntime(
  runtime: WorkspaceRuntimeState,
  paneID: string,
  relativePath: string,
  insertIndex?: number
): boolean {
  return addTabToSpecificPane(runtime, paneID, { kind: "editor", path: relativePath }, insertIndex);
}

export function splitPaneWithEditorInWorkspaceRuntime(
  runtime: WorkspaceRuntimeState,
  targetPaneID: string,
  relativePath: string,
  axis: "horizontal" | "vertical",
  position: "before" | "after"
): boolean {
  if (!runtime.root) return false;
  if (!findLeaf(runtime.root, targetPaneID)) return false;

  const tab: PaneTab = { kind: "editor", path: relativePath };
  const previousLeafIds = new Set(getAllLeaves(runtime.root).map((leaf) => leaf.id));
  const nextRoot = splitPaneAroundTab(runtime.root, targetPaneID, tab, axis, position);
  const insertedLeaf = getAllLeaves(nextRoot).find(
    (leaf) => !previousLeafIds.has(leaf.id) && leaf.tabs.some((candidate) => tabsEqual(candidate, tab))
  );

  runtime.root = nextRoot;
  runtime.focusedPaneID = insertedLeaf?.id ?? targetPaneID;
  return true;
}
