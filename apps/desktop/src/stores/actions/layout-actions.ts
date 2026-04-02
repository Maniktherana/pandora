import type { WritableDraft } from "immer";
import type { DiffSource, LayoutAxis, LayoutNode } from "@/lib/shared/types";
import {
  createLeaf,
  findLeaf,
  getAllLeaves,
  insertTabInPane,
  removeMatchingTabFromTree,
  removeTabAtIndexInTree,
  splitPaneAroundTab,
} from "@/lib/layout/layout-tree";
import { isProjectRuntimeKey } from "@/lib/runtime/runtime-keys";
import { invoke } from "@tauri-apps/api/core";
import type { ImmerSet, Get } from "./types";

export function createLayoutActions(set: ImmerSet, get: Get) {
  return {
    splitPane: (
      targetPaneID: string,
      sourcePaneID: string,
      sourceTabIndex: number,
      axis: LayoutAxis,
      position: "before" | "after"
    ) => {
      const rid = get().effectiveLayoutRuntimeId();
      if (!rid) return;
      // Bottom (project) terminal: side-by-side splits only — no stacked vertical panes.
      if (isProjectRuntimeKey(rid) && axis === "vertical") return;

      set((s) => {
        const runtime = s.runtimes[rid];
        if (!runtime?.root) return;
        const srcLeaf = findLeaf(runtime.root, sourcePaneID);
        const tab = srcLeaf?.tabs[sourceTabIndex];
        if (!tab) return;

        let root: LayoutNode | null = removeTabAtIndexInTree(runtime.root, sourcePaneID, sourceTabIndex);
        if (!root) {
          root = createLeaf([tab]);
          runtime.root = root as WritableDraft<LayoutNode>;
          runtime.focusedPaneID = root.type === "leaf" ? root.id : runtime.focusedPaneID;
          return;
        }
        root = splitPaneAroundTab(root, targetPaneID, tab, axis, position);
        runtime.root = root as WritableDraft<LayoutNode>;
      });

      get().persistLayout();
    },

    addTabToPane: (targetPaneID: string, sourcePaneID: string, sourceTabIndex: number) => {
      const rid = get().effectiveLayoutRuntimeId();
      if (!rid) return;

      set((s) => {
        const runtime = s.runtimes[rid];
        if (!runtime?.root) return;
        const srcLeaf = findLeaf(runtime.root, sourcePaneID);
        const tab = srcLeaf?.tabs[sourceTabIndex];
        if (!tab) return;

        let root: LayoutNode | null = removeMatchingTabFromTree(runtime.root, tab);
        if (!root) {
          root = createLeaf([tab]);
          runtime.root = root as WritableDraft<LayoutNode>;
          return;
        }
        const destLeaf = findLeaf(root, targetPaneID);
        const insertAt = destLeaf?.tabs.length ?? 0;
        root = insertTabInPane(root, targetPaneID, tab, insertAt);
        runtime.root = root as WritableDraft<LayoutNode>;
      });

      get().persistLayout();
    },

    removePaneTabByIndex: (paneID: string, tabIndex: number) => {
      const rid = get().effectiveLayoutRuntimeId();
      if (!rid) return;

      set((s) => {
        const runtime = s.runtimes[rid];
        if (!runtime?.root) return;

        const newRoot = removeTabAtIndexInTree(runtime.root, paneID, tabIndex);
        const leaves = newRoot ? getAllLeaves(newRoot) : [];
        const focusedOK =
          newRoot && runtime.focusedPaneID
            ? findLeaf(newRoot, runtime.focusedPaneID)
            : null;
        const focusedPaneID = focusedOK ? runtime.focusedPaneID : (leaves[0]?.id ?? null);

        runtime.root = newRoot as WritableDraft<LayoutNode> | null;
        runtime.focusedPaneID = focusedPaneID;
      });

      get().persistLayout();
    },

    selectTabInPane: (paneID: string, index: number) => {
      const rid = get().effectiveLayoutRuntimeId();
      if (!rid) return;

      set((s) => {
        const runtime = s.runtimes[rid];
        if (!runtime?.root) return;

        function selectTab(node: LayoutNode): LayoutNode {
          if (node.type === "leaf" && node.id === paneID) {
            const sel =
              node.tabs.length === 0
                ? 0
                : Math.min(Math.max(0, index), node.tabs.length - 1);
            return { ...node, selectedIndex: sel };
          }
          if (node.type === "split") {
            return { ...node, children: node.children.map(selectTab) };
          }
          return node;
        }

        runtime.root = selectTab(runtime.root) as WritableDraft<LayoutNode>;
      });

      get().persistLayout();
    },

    moveTab: (fromPaneID: string, toPaneID: string, fromIndex: number, toIndex: number) => {
      const rid = get().effectiveLayoutRuntimeId();
      if (!rid) return;

      set((s) => {
        const runtime = s.runtimes[rid];
        if (!runtime?.root) return;
        const srcLeaf = findLeaf(runtime.root, fromPaneID);
        const tab = srcLeaf?.tabs[fromIndex];
        if (!tab) return;

        let root: LayoutNode | null = removeTabAtIndexInTree(runtime.root, fromPaneID, fromIndex);
        if (!root) return;

        let insertIndex = toIndex;
        if (fromPaneID === toPaneID && fromIndex < toIndex) {
          insertIndex--;
        }
        root = insertTabInPane(root, toPaneID, tab, insertIndex);
        runtime.root = root as WritableDraft<LayoutNode>;
      });

      get().persistLayout();
    },

    reorderTab: (paneID: string, fromIndex: number, toIndex: number) => {
      const rid = get().effectiveLayoutRuntimeId();
      if (!rid) return;

      set((s) => {
        const runtime = s.runtimes[rid];
        if (!runtime?.root) return;

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

        runtime.root = reorder(runtime.root) as WritableDraft<LayoutNode>;
      });

      get().persistLayout();
    },

    addEditorTabForPath: (relativePath: string) => {
      get().setLayoutTargetRuntimeId(null);
      const wsId = get().selectedWorkspaceID;
      if (!wsId) return;
      const runtime = get().runtimes[wsId];
      if (!runtime?.root) return;

      const leaves = getAllLeaves(runtime.root);
      let paneID = runtime.focusedPaneID;
      if (!paneID || !findLeaf(runtime.root, paneID)) {
        paneID = leaves[0]?.id ?? null;
      }
      if (!paneID) return;

      const leaf = findLeaf(runtime.root, paneID);
      if (!leaf) return;
      const dup = leaf.tabs.findIndex((t) => t.kind === "editor" && t.path === relativePath);
      if (dup >= 0) {
        get().selectTabInPane(paneID, dup);
        return;
      }

      set((s) => {
        const rt = s.runtimes[wsId];
        if (!rt?.root) return;
        const pl = findLeaf(rt.root, paneID!);
        const at = pl?.tabs.length ?? 0;
        const root = insertTabInPane(rt.root, paneID!, { kind: "editor", path: relativePath }, at);
        rt.root = root as WritableDraft<LayoutNode>;
        rt.focusedPaneID = paneID;
      });

      get().persistLayout();
    },

    addDiffTabForPath: (relativePath: string, source: DiffSource) => {
      get().setLayoutTargetRuntimeId(null);
      const wsId = get().selectedWorkspaceID;
      if (!wsId) return;
      const runtime = get().runtimes[wsId];
      if (!runtime?.root) return;

      const leaves = getAllLeaves(runtime.root);
      let paneID = runtime.focusedPaneID;
      if (!paneID || !findLeaf(runtime.root, paneID)) {
        paneID = leaves[0]?.id ?? null;
      }
      if (!paneID) return;

      const leaf = findLeaf(runtime.root, paneID);
      if (!leaf) return;
      const dup = leaf.tabs.findIndex(
        (t) => t.kind === "diff" && t.path === relativePath && t.source === source
      );
      if (dup >= 0) {
        get().selectTabInPane(paneID, dup);
        return;
      }

      set((s) => {
        const rt = s.runtimes[wsId];
        if (!rt?.root) return;
        const pl = findLeaf(rt.root, paneID!);
        const at = pl?.tabs.length ?? 0;
        const root = insertTabInPane(
          rt.root,
          paneID!,
          { kind: "diff", path: relativePath, source },
          at
        );
        rt.root = root as WritableDraft<LayoutNode>;
        rt.focusedPaneID = paneID;
      });

      get().persistLayout();
    },

    setFocusedPane: (paneID: string) => {
      const rid = get().effectiveLayoutRuntimeId();
      if (!rid) return;

      set((s) => {
        const runtime = s.runtimes[rid];
        if (!runtime) return;
        runtime.focusedPaneID = paneID;
      });

      get().persistLayout();
    },

    cycleTab: (direction: -1 | 1) => {
      const rid = get().effectiveLayoutRuntimeId();
      if (!rid) return;
      const runtime = get().runtimes[rid];
      if (!runtime) return;

      if (isProjectRuntimeKey(rid)) {
        const panel = runtime.terminalPanel;
        if (!panel || panel.groups.length === 0) return;

        const activeSlotId =
          panel.activeSlotId ?? panel.groups[panel.activeGroupIndex]?.children[0] ?? null;
        if (!activeSlotId) return;

        const terminals = panel.groups.flatMap((group) =>
          group.children.map((slotId) => ({ groupId: group.id, slotId }))
        );
        if (terminals.length === 0) return;

        const currentIndex = terminals.findIndex((terminal) => terminal.slotId === activeSlotId);
        const resolvedIndex = currentIndex >= 0 ? currentIndex : 0;
        const nextIndex = (resolvedIndex + direction + terminals.length) % terminals.length;
        const nextTerminal = terminals[nextIndex] ?? terminals[0];
        if (!nextTerminal) return;

        get().selectProjectTerminalGroup(rid, nextTerminal.groupId, nextTerminal.slotId);
        return;
      }

      if (!runtime.root || !runtime.focusedPaneID) return;

      const leaves = getAllLeaves(runtime.root);
      if (leaves.length === 0) return;

      const currentLeaf = leaves.find((l) => l.id === runtime.focusedPaneID);
      if (!currentLeaf) return;

      if (currentLeaf.tabs.length === 0) {
        const withTabs = leaves.find((l) => l.tabs.length > 0);
        if (withTabs) {
          get().selectTabInPane(withTabs.id, 0);
          get().setFocusedPane(withTabs.id);
        }
        return;
      }

      // Try cycling within the current pane first
      const nextIndex = currentLeaf.selectedIndex + direction;
      if (nextIndex >= 0 && nextIndex < currentLeaf.tabs.length) {
        get().selectTabInPane(currentLeaf.id, nextIndex);
        return;
      }

      // Overflow into the next/previous pane
      const paneIdx = leaves.indexOf(currentLeaf);
      const nextPaneIdx = paneIdx + direction;

      if (nextPaneIdx < 0 || nextPaneIdx >= leaves.length) {
        // Wrap: going left past first pane → last tab of last pane, and vice versa
        const wrapPane = direction === 1 ? leaves[0] : leaves[leaves.length - 1];
        const wrapTabIdx = direction === 1 ? 0 : Math.max(0, wrapPane.tabs.length - 1);
        get().selectTabInPane(wrapPane.id, wrapTabIdx);
        get().setFocusedPane(wrapPane.id);
        return;
      }

      const nextPane = leaves[nextPaneIdx];
      const targetIndex = direction === 1 ? 0 : Math.max(0, nextPane.tabs.length - 1);
      get().selectTabInPane(nextPane.id, targetIndex);
      get().setFocusedPane(nextPane.id);
    },

    persistLayout: () => {
      const id = get().effectiveLayoutRuntimeId();
      if (!id || isProjectRuntimeKey(id)) return;
      const runtime = get().runtimes[id];
      const root =
        runtime?.root?.type === "leaf" && runtime.root.tabs.length === 0
          ? null
          : runtime?.root ?? null;
      const layout = {
        root,
        focusedPaneID: root ? runtime?.focusedPaneID ?? null : null,
      };
      void invoke("save_workspace_layout", { workspaceId: id, layout });
    },
  };
}
