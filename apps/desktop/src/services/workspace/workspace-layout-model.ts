import type { DiffSource, LayoutAxis, LayoutNode, WorkspaceRuntimeState } from "@/lib/shared/types";
import {
  createLeaf,
  findLeaf,
  getAllLeaves,
  getVisualLeaves,
  insertTabInPane,
  removeMatchingTabFromTree,
  removeTabAtIndexInTree,
  splitPaneAroundTab,
  splitPaneWithinLeaf,
} from "@/components/layout/workspace/layout-tree";
import { isProjectRuntimeKey } from "@/lib/runtime/runtime-keys";
import { acknowledgeTerminalAgentStatus } from "@/lib/terminal/agent-activity";

export type WorkspaceLayoutChange = {
  root: LayoutNode | null;
  focusedPaneID: string | null;
};

type WorkspaceLayoutSnapshot = {
  root: LayoutNode | null;
  focusedPaneID: string | null;
};

function snapshotRuntime(runtime: WorkspaceRuntimeState): WorkspaceLayoutSnapshot {
  return {
    root: runtime.root,
    focusedPaneID: runtime.focusedPaneID,
  };
}

function applySnapshot(runtime: WorkspaceRuntimeState, snapshot: WorkspaceLayoutSnapshot) {
  runtime.root = snapshot.root;
  runtime.focusedPaneID = snapshot.focusedPaneID;
}

function ensureWorkspaceRoot(snapshot: WorkspaceLayoutSnapshot): WorkspaceLayoutSnapshot {
  if (snapshot.root) {
    const leaves = getAllLeaves(snapshot.root);
    const focusedPaneID =
      snapshot.focusedPaneID && findLeaf(snapshot.root, snapshot.focusedPaneID)
        ? snapshot.focusedPaneID
        : (leaves[0]?.id ?? null);
    return { root: snapshot.root, focusedPaneID };
  }

  const root = createLeaf([]);
  return { root, focusedPaneID: root.id };
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

function withLayoutSnapshot(
  runtime: WorkspaceRuntimeState,
  transform: (snapshot: WorkspaceLayoutSnapshot) => WorkspaceLayoutSnapshot | null,
): boolean {
  const next = transform(snapshotRuntime(runtime));
  if (!next) return false;
  applySnapshot(runtime, next);
  return true;
}

export function splitPaneInWorkspaceRuntime(
  runtime: WorkspaceRuntimeState,
  targetPaneID: string,
  sourcePaneID: string,
  sourceTabIndex: number,
  axis: LayoutAxis,
  position: "before" | "after",
) {
  return withLayoutSnapshot(runtime, (snapshot) => {
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
      return {
        root,
        focusedPaneID: root.type === "leaf" ? root.id : snapshot.focusedPaneID,
      };
    }
    if (!findLeaf(root, targetPaneID)) return null;
    root = splitPaneAroundTab(root, targetPaneID, tab, axis, position);
    return { root, focusedPaneID: snapshot.focusedPaneID };
  });
}

export function addTabToPaneInWorkspaceRuntime(
  runtime: WorkspaceRuntimeState,
  targetPaneID: string,
  sourcePaneID: string,
  sourceTabIndex: number,
) {
  return withLayoutSnapshot(runtime, (snapshot) => {
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

export function removeTabFromWorkspaceRuntime(
  runtime: WorkspaceRuntimeState,
  paneID: string,
  tabIndex: number,
) {
  return withLayoutSnapshot(runtime, (snapshot) => {
    if (!snapshot.root) return null;
    const newRoot = removeTabAtIndexInTree(snapshot.root, paneID, tabIndex);
    const leaves = newRoot ? getAllLeaves(newRoot) : [];
    const focusedOK =
      newRoot && snapshot.focusedPaneID ? findLeaf(newRoot, snapshot.focusedPaneID) : null;
    const focusedPaneID = focusedOK ? snapshot.focusedPaneID : (leaves[0]?.id ?? null);
    return { root: newRoot, focusedPaneID };
  });
}

export function selectTabInPaneInWorkspaceRuntime(
  runtime: WorkspaceRuntimeState,
  paneID: string,
  index: number,
) {
  return withLayoutSnapshot(runtime, (snapshot) => {
    if (!snapshot.root) return null;
    const leaf = findLeaf(snapshot.root, paneID);
    if (!leaf) return null;
    const selectedTab = leaf.tabs[index];
    if (selectedTab?.kind === "terminal") {
      acknowledgeTerminalAgentStatus(runtime, selectedTab.slotId);
    }
    return { root: selectTabInLayout(snapshot.root, paneID, index), focusedPaneID: paneID };
  });
}

export function moveTabInWorkspaceRuntime(
  runtime: WorkspaceRuntimeState,
  fromPaneID: string,
  toPaneID: string,
  fromIndex: number,
  toIndex: number,
) {
  return withLayoutSnapshot(runtime, (snapshot) => {
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

export function reorderTabInWorkspaceRuntime(
  runtime: WorkspaceRuntimeState,
  paneID: string,
  fromIndex: number,
  toIndex: number,
) {
  return withLayoutSnapshot(runtime, (snapshot) => {
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

export function setFocusedPaneInWorkspaceRuntime(runtime: WorkspaceRuntimeState, paneID: string) {
  return withLayoutSnapshot(runtime, (snapshot) => {
    if (!snapshot.root) return null;
    if (!findLeaf(snapshot.root, paneID)) return null;
    return { root: snapshot.root, focusedPaneID: paneID };
  });
}

export function cycleRuntimeTabs(runtime: WorkspaceRuntimeState, direction: -1 | 1) {
  if (isProjectRuntimeKey(runtime.workspaceId)) {
    const panel = runtime.terminalPanel;
    if (!panel || panel.groups.length === 0) return false;

    const activeSlotId =
      panel.activeSlotId ?? panel.groups[panel.activeGroupIndex]?.children[0] ?? null;
    if (!activeSlotId) return false;

    const terminals = panel.groups.flatMap((group) =>
      group.children.map((slotId) => ({ groupId: group.id, slotId })),
    );
    if (terminals.length === 0) return false;

    const currentIndex = terminals.findIndex((terminal) => terminal.slotId === activeSlotId);
    const resolvedIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = (resolvedIndex + direction + terminals.length) % terminals.length;
    const nextTerminal = terminals[nextIndex] ?? terminals[0];
    if (!nextTerminal) return false;

    runtime.terminalPanel = {
      ...panel,
      activeSlotId: nextTerminal.slotId,
      activeGroupIndex: panel.groups.findIndex((group) => group.id === nextTerminal.groupId),
    };
    return true;
  }

  if (!runtime.root || !runtime.focusedPaneID) return false;

  const leaves = getVisualLeaves(runtime.root).filter((leaf) => leaf.tabs.length > 0);
  if (leaves.length === 0) return false;

  const currentLeaf = leaves.find((leaf) => leaf.id === runtime.focusedPaneID);
  if (!currentLeaf) return false;

  const nextIndex = currentLeaf.selectedIndex + direction;
  if (nextIndex >= 0 && nextIndex < currentLeaf.tabs.length) {
    return selectTabInPaneInWorkspaceRuntime(runtime, currentLeaf.id, nextIndex);
  }

  const paneIdx = leaves.indexOf(currentLeaf);
  const nextPaneIdx = paneIdx + direction;
  if (nextPaneIdx < 0 || nextPaneIdx >= leaves.length) {
    const wrapPane = direction === 1 ? leaves[0] : leaves[leaves.length - 1];
    const wrapTabIdx = direction === 1 ? 0 : Math.max(0, wrapPane.tabs.length - 1);
    return (
      selectTabInPaneInWorkspaceRuntime(runtime, wrapPane.id, wrapTabIdx) &&
      setFocusedPaneInWorkspaceRuntime(runtime, wrapPane.id)
    );
  }

  const nextPane = leaves[nextPaneIdx];
  const targetIndex = direction === 1 ? 0 : Math.max(0, nextPane.tabs.length - 1);
  return (
    selectTabInPaneInWorkspaceRuntime(runtime, nextPane.id, targetIndex) &&
    setFocusedPaneInWorkspaceRuntime(runtime, nextPane.id)
  );
}

export function openEditorTabInWorkspaceRuntime(
  runtime: WorkspaceRuntimeState,
  relativePath: string,
) {
  const snapshot = ensureWorkspaceRoot(snapshotRuntime(runtime));
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
    return selectTabInPaneInWorkspaceRuntime(runtime, paneID, dup);
  }

  return withLayoutSnapshot(runtime, (current) => {
    if (!current.root) return null;
    const pl = findLeaf(current.root, paneID!);
    const at = pl?.tabs.length ?? 0;
    const root = insertTabInPane(current.root, paneID!, { kind: "editor", path: relativePath }, at);
    return { root, focusedPaneID: paneID };
  });
}

export function openDiffTabInWorkspaceRuntime(
  runtime: WorkspaceRuntimeState,
  relativePath: string,
  source: DiffSource,
) {
  const snapshot = ensureWorkspaceRoot(snapshotRuntime(runtime));
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
    return selectTabInPaneInWorkspaceRuntime(runtime, paneID, dup);
  }

  return withLayoutSnapshot(runtime, (current) => {
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

export function openReviewTabInWorkspaceRuntime(runtime: WorkspaceRuntimeState) {
  const snapshot = ensureWorkspaceRoot(snapshotRuntime(runtime));
  if (!snapshot.root) return false;

  for (const leaf of getAllLeaves(snapshot.root)) {
    const reviewIndex = leaf.tabs.findIndex((tab) => tab.kind === "review");
    if (reviewIndex >= 0) {
      return (
        selectTabInPaneInWorkspaceRuntime(runtime, leaf.id, reviewIndex) &&
        setFocusedPaneInWorkspaceRuntime(runtime, leaf.id)
      );
    }
  }

  const leaves = getAllLeaves(snapshot.root);
  let paneID = snapshot.focusedPaneID;
  if (!paneID || !findLeaf(snapshot.root, paneID)) {
    paneID = leaves[0]?.id ?? null;
  }
  if (!paneID) return false;

  return withLayoutSnapshot(runtime, (current) => {
    if (!current.root) return null;
    const leaf = findLeaf(current.root, paneID!);
    const insertAt = leaf?.tabs.length ?? 0;
    const root = insertTabInPane(current.root, paneID!, { kind: "review" }, insertAt);
    return { root, focusedPaneID: paneID };
  });
}
