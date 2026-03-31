import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type {
  ProjectRecord,
  WorkspaceRecord,
  SlotState,
  SessionState,
  LayoutNode,
  LayoutAxis,
  AppState,
  WorkspaceRuntimeState,
} from "../lib/types";
import { migratePersistedLayout } from "../lib/layout-migrate";
import {
  addTerminalTabToNode,
  createLeaf,
  findLeaf,
  getAllLeaves,
  getAllTerminalSlotIds,
  insertTabInPane,
  removeMatchingTabFromTree,
  removeTabAtIndexInTree,
  removeTerminalSlotFromTree,
  splitPaneAroundTab,
} from "../lib/layout-tree";

export type NavigationArea = "sidebar" | "workspace";

interface WorkspaceStoreState {
  // ─── Project/workspace model ───
  projects: ProjectRecord[];
  workspaces: WorkspaceRecord[];
  selectedProjectID: string | null;
  selectedWorkspaceID: string | null;

  // ─── Per-workspace runtime state ───
  runtimes: Record<string, WorkspaceRuntimeState>;

  // ─── UI state ───
  navigationArea: NavigationArea;
  searchText: string;

  // ─── Computed helpers ───
  selectedProject: () => ProjectRecord | null;
  selectedWorkspace: () => WorkspaceRecord | null;
  workspacesForProject: (projectId: string) => WorkspaceRecord[];
  filteredProjects: () => ProjectRecord[];
  activeRuntime: () => WorkspaceRuntimeState | null;
  slotsByID: (workspaceId: string) => Record<string, SlotState>;
  sessionsByID: (workspaceId: string) => Record<string, SessionState>;

  // ─── Data loading ───
  loadAppState: () => Promise<void>;
  reloadFromBackend: () => Promise<void>;

  // ─── Project actions ───
  addProject: (path: string) => Promise<void>;
  toggleProject: (projectId: string) => Promise<void>;
  removeProject: (projectId: string) => Promise<void>;
  selectProject: (projectId: string) => void;

  // ─── Workspace actions ───
  createWorkspace: (projectId: string) => Promise<void>;
  retryWorkspace: (workspaceId: string) => Promise<void>;
  removeWorkspace: (workspaceId: string) => Promise<void>;
  selectWorkspace: (workspace: WorkspaceRecord) => void;
  markWorkspaceOpened: (workspaceId: string) => Promise<void>;

  // ─── Runtime actions (per-workspace) ───
  setRuntimeConnectionState: (workspaceId: string, state: "disconnected" | "connecting" | "connected") => void;
  setRuntimeSlots: (workspaceId: string, slots: SlotState[]) => void;
  setRuntimeSessions: (workspaceId: string, sessions: SessionState[]) => void;
  updateRuntimeSlot: (workspaceId: string, slot: SlotState) => void;
  addRuntimeSlot: (workspaceId: string, slot: SlotState) => void;
  removeRuntimeSlot: (workspaceId: string, slotID: string) => void;
  updateRuntimeSession: (workspaceId: string, session: SessionState) => void;
  addRuntimeSession: (workspaceId: string, session: SessionState) => void;
  removeRuntimeSession: (workspaceId: string, sessionID: string) => void;
  ensureRuntimeLayout: (workspaceId: string) => void;

  // ─── Layout actions ───
  splitPane: (
    targetPaneID: string,
    sourcePaneID: string,
    sourceTabIndex: number,
    axis: LayoutAxis,
    position: "before" | "after"
  ) => void;
  addTabToPane: (targetPaneID: string, sourcePaneID: string, sourceTabIndex: number) => void;
  /** Remove tab by index (e.g. editor tab). Terminal tabs are usually removed via daemon `remove_slot`. */
  removePaneTabByIndex: (paneID: string, tabIndex: number) => void;
  selectTabInPane: (paneID: string, index: number) => void;
  moveTab: (fromPaneID: string, toPaneID: string, fromIndex: number, toIndex: number) => void;
  reorderTab: (paneID: string, fromIndex: number, toIndex: number) => void;
  /** Add or focus an editor tab in the focused pane (or first pane). */
  addEditorTabForPath: (relativePath: string) => void;
  setFocusedPane: (paneID: string) => void;
  cycleTab: (direction: -1 | 1) => void;
  persistLayout: () => void;
  loadPersistedLayout: (workspaceId: string) => Promise<void>;

  // ─── Navigation ───
  setNavigationArea: (area: NavigationArea) => void;
  setSearchText: (text: string) => void;
  navigateSidebar: (offset: number) => void;
}

export const useWorkspaceStore = create<WorkspaceStoreState>((set, get) => ({
  projects: [],
  workspaces: [],
  selectedProjectID: null,
  selectedWorkspaceID: null,
  runtimes: {},
  navigationArea: "sidebar",
  searchText: "",

  // ─── Computed ───
  selectedProject: () => {
    const { projects, selectedProjectID } = get();
    return projects.find((p) => p.id === selectedProjectID) ?? null;
  },
  selectedWorkspace: () => {
    const { workspaces, selectedWorkspaceID } = get();
    return workspaces.find((w) => w.id === selectedWorkspaceID) ?? null;
  },
  workspacesForProject: (projectId) => {
    return get().workspaces.filter((w) => w.projectId === projectId);
  },
  filteredProjects: () => {
    const { projects, searchText } = get();
    if (!searchText) return projects;
    const lower = searchText.toLowerCase();
    return projects.filter((p) => p.displayName.toLowerCase().includes(lower));
  },
  activeRuntime: () => {
    const { selectedWorkspaceID, runtimes } = get();
    if (!selectedWorkspaceID) return null;
    return runtimes[selectedWorkspaceID] ?? null;
  },
  slotsByID: (workspaceId) => {
    const runtime = get().runtimes[workspaceId];
    if (!runtime) return {};
    const map: Record<string, SlotState> = {};
    for (const s of runtime.slots) map[s.id] = s;
    return map;
  },
  sessionsByID: (workspaceId) => {
    const runtime = get().runtimes[workspaceId];
    if (!runtime) return {};
    const map: Record<string, SessionState> = {};
    for (const s of runtime.sessions) map[s.id] = s;
    return map;
  },

  // ─── Data loading ───
  loadAppState: async () => {
    try {
      const state = await invoke<AppState>("load_app_state");
      set({
        projects: state.projects,
        workspaces: state.workspaces,
        selectedProjectID: state.selectedProjectId,
        selectedWorkspaceID: state.selectedWorkspaceId,
      });
    } catch (e) {
      console.error("Failed to load app state:", e);
    }
  },
  reloadFromBackend: async () => {
    await get().loadAppState();
  },

  // ─── Project actions ───
  addProject: async (path) => {
    try {
      const project = await invoke<ProjectRecord>("add_project", { selectedPath: path });
      await get().reloadFromBackend();
      set({ selectedProjectID: project.id });
      void invoke("save_selection", {
        projectId: project.id,
        workspaceId: get().selectedWorkspaceID,
      });
    } catch (e) {
      console.error("Failed to add project:", e);
    }
  },
  toggleProject: async (projectId) => {
    await invoke("toggle_project", { projectId });
    await get().reloadFromBackend();
  },
  removeProject: async (projectId) => {
    await invoke("remove_project", { projectId });
    await get().reloadFromBackend();
  },
  selectProject: (projectId) => {
    set({ selectedProjectID: projectId });
    void invoke("save_selection", {
      projectId,
      workspaceId: get().selectedWorkspaceID,
    });
  },

  // ─── Workspace actions ───
  createWorkspace: async (projectId) => {
    try {
      await invoke("create_workspace", { projectId });
      // Reload to pick up the optimistic record
      await get().reloadFromBackend();
    } catch (e) {
      console.error("Failed to create workspace:", e);
    }
  },
  retryWorkspace: async (workspaceId) => {
    try {
      await invoke("retry_workspace", { workspaceId });
      await get().reloadFromBackend();
    } catch (e) {
      console.error("Failed to retry workspace:", e);
    }
  },
  removeWorkspace: async (workspaceId) => {
    try {
      await invoke("remove_workspace", { workspaceId });
      set((s) => {
        const { [workspaceId]: _, ...rest } = s.runtimes;
        return {
          runtimes: rest,
          selectedWorkspaceID:
            s.selectedWorkspaceID === workspaceId
              ? s.workspaces.find((w) => w.id !== workspaceId)?.id ?? null
              : s.selectedWorkspaceID,
        };
      });
      await get().reloadFromBackend();
    } catch (e) {
      console.error("Failed to remove workspace:", e);
    }
  },
  selectWorkspace: (workspace) => {
    set({
      selectedWorkspaceID: workspace.id,
      selectedProjectID: workspace.projectId,
      navigationArea: "sidebar",
    });
    void invoke("save_selection", {
      projectId: workspace.projectId,
      workspaceId: workspace.id,
    });

    // Start runtime if workspace is ready and not already running
    if (workspace.status === "ready") {
      const runtime = get().runtimes[workspace.id];
      if (!runtime) {
        const defaultCwd = workspace.workspaceContextSubpath
          ? `${workspace.worktreePath}/${workspace.workspaceContextSubpath}`
          : workspace.worktreePath;

        void invoke("start_workspace_runtime", {
          workspaceId: workspace.id,
          workspacePath: workspace.worktreePath,
          defaultCwd,
        });

        // Initialize runtime state
        set((s) => ({
          runtimes: {
            ...s.runtimes,
            [workspace.id]: {
              workspaceId: workspace.id,
              slots: [],
              sessions: [],
              connectionState: "connecting",
              root: null,
              focusedPaneID: null,
            },
          },
        }));

        // Load persisted layout
        void get().loadPersistedLayout(workspace.id);
      }
    }

    void invoke("mark_workspace_opened", { workspaceId: workspace.id });
  },
  markWorkspaceOpened: async (workspaceId) => {
    await invoke("mark_workspace_opened", { workspaceId });
  },

  // ─── Runtime actions ───
  setRuntimeConnectionState: (workspaceId, state) => {
    set((s) => {
      const runtime = s.runtimes[workspaceId] ?? {
        workspaceId,
        slots: [],
        sessions: [],
        connectionState: "disconnected",
        root: null,
        focusedPaneID: null,
      };
      return {
        runtimes: {
          ...s.runtimes,
          [workspaceId]: { ...runtime, connectionState: state },
        },
      };
    });
  },
  setRuntimeSlots: (workspaceId, slots) => {
    set((s) => {
      const runtime = s.runtimes[workspaceId];
      if (!runtime) return s;
      return {
        runtimes: {
          ...s.runtimes,
          [workspaceId]: { ...runtime, slots },
        },
      };
    });
    get().ensureRuntimeLayout(workspaceId);
  },
  setRuntimeSessions: (workspaceId, sessions) => {
    set((s) => {
      const runtime = s.runtimes[workspaceId];
      if (!runtime) return s;
      return {
        runtimes: {
          ...s.runtimes,
          [workspaceId]: { ...runtime, sessions },
        },
      };
    });
  },
  updateRuntimeSlot: (workspaceId, slot) => {
    set((s) => {
      const runtime = s.runtimes[workspaceId];
      if (!runtime) return s;
      return {
        runtimes: {
          ...s.runtimes,
          [workspaceId]: {
            ...runtime,
            slots: runtime.slots.map((existing) => (existing.id === slot.id ? slot : existing)),
          },
        },
      };
    });
  },
  addRuntimeSlot: (workspaceId, slot) => {
    set((s) => {
      const runtime = s.runtimes[workspaceId];
      if (!runtime) return s;
      return {
        runtimes: {
          ...s.runtimes,
          [workspaceId]: { ...runtime, slots: [...runtime.slots, slot] },
        },
      };
    });
    get().ensureRuntimeLayout(workspaceId);
  },
  removeRuntimeSlot: (workspaceId, slotID) => {
    set((s) => {
      const runtime = s.runtimes[workspaceId];
      if (!runtime) return s;
      const newRoot = runtime.root ? removeTerminalSlotFromTree(runtime.root, slotID) : null;
      return {
        runtimes: {
          ...s.runtimes,
          [workspaceId]: {
            ...runtime,
            slots: runtime.slots.filter((sl) => sl.id !== slotID),
            root: newRoot,
          },
        },
      };
    });
  },
  updateRuntimeSession: (workspaceId, session) => {
    set((s) => {
      const runtime = s.runtimes[workspaceId];
      if (!runtime) return s;
      return {
        runtimes: {
          ...s.runtimes,
          [workspaceId]: {
            ...runtime,
            sessions: runtime.sessions.map((existing) =>
              existing.id === session.id ? session : existing
            ),
          },
        },
      };
    });
  },
  addRuntimeSession: (workspaceId, session) => {
    set((s) => {
      const runtime = s.runtimes[workspaceId];
      if (!runtime) return s;
      return {
        runtimes: {
          ...s.runtimes,
          [workspaceId]: { ...runtime, sessions: [...runtime.sessions, session] },
        },
      };
    });
  },
  removeRuntimeSession: (workspaceId, sessionID) => {
    set((s) => {
      const runtime = s.runtimes[workspaceId];
      if (!runtime) return s;
      return {
        runtimes: {
          ...s.runtimes,
          [workspaceId]: {
            ...runtime,
            sessions: runtime.sessions.filter((ses) => ses.id !== sessionID),
          },
        },
      };
    });
  },

  ensureRuntimeLayout: (workspaceId) => {
    const runtime = get().runtimes[workspaceId];
    if (!runtime) return;

    const existingSlotIDs = runtime.root
      ? new Set(getAllTerminalSlotIds(runtime.root))
      : new Set<string>();
    const newSlots = runtime.slots.filter((s) => !existingSlotIDs.has(s.id));
    if (newSlots.length === 0) return;

    let root = runtime.root;
    for (const slot of newSlots) {
      const leaf = createLeaf([{ kind: "terminal", slotId: slot.id }]);
      if (!root) {
        root = leaf;
      } else {
        const focusedPaneID = runtime.focusedPaneID;
        if (focusedPaneID && root) {
          root = addTerminalTabToNode(root, focusedPaneID, slot.id);
        } else {
          root = leaf;
        }
      }
    }

    set((s) => ({
      runtimes: {
        ...s.runtimes,
        [workspaceId]: {
          ...runtime,
          root,
          focusedPaneID: runtime.focusedPaneID ?? (root?.type === "leaf" ? root.id : null),
        },
      },
    }));
  },

  // ─── Layout actions ───
  splitPane: (targetPaneID, sourcePaneID, sourceTabIndex, axis, position) => {
    const wsId = get().selectedWorkspaceID;
    if (!wsId) return;
    set((s) => {
      const runtime = s.runtimes[wsId];
      if (!runtime?.root) return s;
      const srcLeaf = findLeaf(runtime.root, sourcePaneID);
      const tab = srcLeaf?.tabs[sourceTabIndex];
      if (!tab) return s;

      let root = removeTabAtIndexInTree(runtime.root, sourcePaneID, sourceTabIndex);
      if (!root) {
        root = createLeaf([tab]);
        return {
          runtimes: {
            ...s.runtimes,
            [wsId]: { ...runtime, root, focusedPaneID: root.type === "leaf" ? root.id : runtime.focusedPaneID },
          },
        };
      }
      root = splitPaneAroundTab(root, targetPaneID, tab, axis, position);
      return {
        runtimes: {
          ...s.runtimes,
          [wsId]: { ...runtime, root },
        },
      };
    });
    get().persistLayout();
  },

  addTabToPane: (targetPaneID, sourcePaneID, sourceTabIndex) => {
    const wsId = get().selectedWorkspaceID;
    if (!wsId) return;
    set((s) => {
      const runtime = s.runtimes[wsId];
      if (!runtime?.root) return s;
      const srcLeaf = findLeaf(runtime.root, sourcePaneID);
      const tab = srcLeaf?.tabs[sourceTabIndex];
      if (!tab) return s;

      let root = removeMatchingTabFromTree(runtime.root, tab);
      if (!root) {
        root = createLeaf([tab]);
        return {
          runtimes: {
            ...s.runtimes,
            [wsId]: { ...runtime, root },
          },
        };
      }
      const destLeaf = findLeaf(root, targetPaneID);
      const insertAt = destLeaf?.tabs.length ?? 0;
      root = insertTabInPane(root, targetPaneID, tab, insertAt);
      return {
        runtimes: {
          ...s.runtimes,
          [wsId]: { ...runtime, root },
        },
      };
    });
    get().persistLayout();
  },

  removePaneTabByIndex: (paneID, tabIndex) => {
    const wsId = get().selectedWorkspaceID;
    if (!wsId) return;
    set((s) => {
      const runtime = s.runtimes[wsId];
      if (!runtime?.root) return s;
      const newRoot = removeTabAtIndexInTree(runtime.root, paneID, tabIndex);
      return {
        runtimes: {
          ...s.runtimes,
          [wsId]: { ...runtime, root: newRoot },
        },
      };
    });
    get().persistLayout();
  },

  addEditorTabForPath: (relativePath) => {
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
      if (!rt?.root) return s;
      const pl = findLeaf(rt.root, paneID!);
      const at = pl?.tabs.length ?? 0;
      const root = insertTabInPane(rt.root, paneID!, { kind: "editor", path: relativePath }, at);
      return {
        runtimes: {
          ...s.runtimes,
          [wsId]: { ...rt, root, focusedPaneID: paneID },
        },
      };
    });
    get().persistLayout();
  },

  selectTabInPane: (paneID, index) => {
    const wsId = get().selectedWorkspaceID;
    if (!wsId) return;
    set((s) => {
      const runtime = s.runtimes[wsId];
      if (!runtime?.root) return s;

      function selectTab(node: LayoutNode): LayoutNode {
        if (node.type === "leaf" && node.id === paneID) {
          return { ...node, selectedIndex: Math.min(index, node.tabs.length - 1) };
        }
        if (node.type === "split") {
          return { ...node, children: node.children.map(selectTab) };
        }
        return node;
      }

      return {
        runtimes: {
          ...s.runtimes,
          [wsId]: { ...runtime, root: selectTab(runtime.root) },
        },
      };
    });
    get().persistLayout();
  },

  moveTab: (fromPaneID, toPaneID, fromIndex, toIndex) => {
    const wsId = get().selectedWorkspaceID;
    if (!wsId) return;
    set((s) => {
      const runtime = s.runtimes[wsId];
      if (!runtime?.root) return s;
      const srcLeaf = findLeaf(runtime.root, fromPaneID);
      const tab = srcLeaf?.tabs[fromIndex];
      if (!tab) return s;

      let root = removeTabAtIndexInTree(runtime.root, fromPaneID, fromIndex);
      if (!root) return s;

      let insertIndex = toIndex;
      if (fromPaneID === toPaneID && fromIndex < toIndex) {
        insertIndex--;
      }
      root = insertTabInPane(root, toPaneID, tab, insertIndex);
      return {
        runtimes: {
          ...s.runtimes,
          [wsId]: { ...runtime, root },
        },
      };
    });
    get().persistLayout();
  },

  reorderTab: (paneID, fromIndex, toIndex) => {
    const wsId = get().selectedWorkspaceID;
    if (!wsId) return;
    set((s) => {
      const runtime = s.runtimes[wsId];
      if (!runtime?.root) return s;

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

      return {
        runtimes: {
          ...s.runtimes,
          [wsId]: { ...runtime, root: reorder(runtime.root) },
        },
      };
    });
    get().persistLayout();
  },

  setFocusedPane: (paneID) => {
    const wsId = get().selectedWorkspaceID;
    if (!wsId) return;
    set((s) => {
      const runtime = s.runtimes[wsId];
      if (!runtime) return s;
      return {
        runtimes: {
          ...s.runtimes,
          [wsId]: { ...runtime, focusedPaneID: paneID },
        },
      };
    });
    get().persistLayout();
  },

  cycleTab: (direction) => {
    const wsId = get().selectedWorkspaceID;
    if (!wsId) return;
    const runtime = get().runtimes[wsId];
    if (!runtime?.root || !runtime.focusedPaneID) return;

    const leaves = getAllLeaves(runtime.root);
    if (leaves.length === 0) return;

    const currentLeaf = leaves.find((l) => l.id === runtime.focusedPaneID);
    if (!currentLeaf) return;

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
      const wrapTabIdx = direction === 1 ? 0 : wrapPane.tabs.length - 1;
      get().selectTabInPane(wrapPane.id, wrapTabIdx);
      get().setFocusedPane(wrapPane.id);
      return;
    }

    const nextPane = leaves[nextPaneIdx];
    const targetIndex = direction === 1 ? 0 : nextPane.tabs.length - 1;
    get().selectTabInPane(nextPane.id, targetIndex);
    get().setFocusedPane(nextPane.id);
  },

  persistLayout: () => {
    const wsId = get().selectedWorkspaceID;
    if (!wsId) return;
    const runtime = get().runtimes[wsId];
    if (!runtime?.root) return;
    const layout = {
      root: runtime.root,
      focusedPaneID: runtime.focusedPaneID,
    };
    void invoke("save_workspace_layout", { workspaceId: wsId, layout });
  },

  loadPersistedLayout: async (workspaceId) => {
    try {
      const raw = await invoke<unknown>("load_workspace_layout", {
        workspaceId,
      });
      const layout = raw != null ? migratePersistedLayout(raw) : null;
      if (layout) {
        set((s) => {
          const runtime = s.runtimes[workspaceId];
          if (!runtime) return s;
          return {
            runtimes: {
              ...s.runtimes,
              [workspaceId]: {
                ...runtime,
                root: layout.root,
                focusedPaneID: layout.focusedPaneID,
              },
            },
          };
        });
      }
    } catch {
      // No persisted layout
    }
  },

  // ─── Navigation ───
  setNavigationArea: (area) => set({ navigationArea: area }),
  setSearchText: (text) => set({ searchText: text }),
  navigateSidebar: (offset) => {
    const { workspaces, selectedWorkspaceID } = get();
    if (workspaces.length === 0) return;
    const currentIdx = workspaces.findIndex((w) => w.id === selectedWorkspaceID);
    const nextIdx = Math.max(0, Math.min(workspaces.length - 1, currentIdx + offset));
    const ws = workspaces[nextIdx];
    if (ws) get().selectWorkspace(ws);
  },
}));
