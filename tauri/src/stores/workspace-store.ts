import { create } from "zustand";
import type {
  SlotState,
  SessionState,
  Workspace,
  LayoutNode,
  LayoutLeaf,
  LayoutSplit,
  LayoutAxis,
} from "../lib/types";
import type { ConnectionState } from "../lib/daemon-client";

function uuid(): string {
  return crypto.randomUUID();
}

function createLeaf(slotIDs: string[]): LayoutLeaf {
  return { type: "leaf", id: uuid(), slotIDs, selectedIndex: 0 };
}


function getAllLeaves(node: LayoutNode): LayoutLeaf[] {
  if (node.type === "leaf") return [node];
  return node.children.flatMap(getAllLeaves);
}

function removeSlotFromTree(node: LayoutNode, slotID: string): LayoutNode | null {
  if (node.type === "leaf") {
    const filtered = node.slotIDs.filter((id) => id !== slotID);
    if (filtered.length === 0) return null;
    return {
      ...node,
      slotIDs: filtered,
      selectedIndex: Math.min(node.selectedIndex, filtered.length - 1),
    };
  }
  const newChildren: LayoutNode[] = [];
  for (const child of node.children) {
    const result = removeSlotFromTree(child, slotID);
    if (result) newChildren.push(result);
  }
  if (newChildren.length === 0) return null;
  if (newChildren.length === 1) return newChildren[0];
  return { ...node, children: newChildren, ratios: newChildren.map(() => 1 / newChildren.length) };
}

export type NavigationArea = "sidebar" | "workspace";

interface WorkspaceStoreState {
  // Daemon state
  slots: SlotState[];
  sessions: SessionState[];
  connectionState: ConnectionState;

  // Workspace state (client-side layout)
  workspaces: Workspace[];
  visibleWorkspaceID: string | null;
  selectedSidebarWorkspaceID: string | null;
  navigationArea: NavigationArea;
  searchText: string;

  // Computed helpers
  slotsByID: () => Record<string, SlotState>;
  sessionsByID: () => Record<string, SessionState>;
  visibleWorkspace: () => Workspace | null;
  filteredWorkspaces: () => Workspace[];

  // Daemon state setters
  setConnectionState: (state: ConnectionState) => void;
  setSlots: (slots: SlotState[]) => void;
  setSessions: (sessions: SessionState[]) => void;
  updateSlot: (slot: SlotState) => void;
  addSlot: (slot: SlotState) => void;
  removeSlot: (slotID: string) => void;
  updateSession: (session: SessionState) => void;
  addSession: (session: SessionState) => void;
  removeSession: (sessionID: string) => void;

  // Workspace actions
  ensureWorkspacesForSlots: () => void;
  selectWorkspace: (id: string) => void;
  setSearchText: (text: string) => void;
  setNavigationArea: (area: NavigationArea) => void;
  navigateSidebar: (offset: number) => void;

  // Layout actions
  splitPane: (paneID: string, slotID: string, axis: LayoutAxis, position: "before" | "after") => void;
  addTabToPane: (paneID: string, slotID: string) => void;
  removeTabFromPane: (paneID: string, slotID: string) => void;
  selectTabInPane: (paneID: string, index: number) => void;
  setFocusedPane: (paneID: string) => void;
  focusDirection: (direction: "left" | "right" | "up" | "down") => void;
}

export const useWorkspaceStore = create<WorkspaceStoreState>((set, get) => ({
  slots: [],
  sessions: [],
  connectionState: "disconnected",
  workspaces: [],
  visibleWorkspaceID: null,
  selectedSidebarWorkspaceID: null,
  navigationArea: "sidebar",
  searchText: "",

  slotsByID: () => {
    const map: Record<string, SlotState> = {};
    for (const s of get().slots) map[s.id] = s;
    return map;
  },
  sessionsByID: () => {
    const map: Record<string, SessionState> = {};
    for (const s of get().sessions) map[s.id] = s;
    return map;
  },
  visibleWorkspace: () => {
    const { workspaces, visibleWorkspaceID } = get();
    return workspaces.find((w) => w.id === visibleWorkspaceID) ?? null;
  },
  filteredWorkspaces: () => {
    const { workspaces, searchText, slotsByID } = get();
    const slotsMap = slotsByID();
    if (!searchText) return workspaces;
    const lower = searchText.toLowerCase();
    return workspaces.filter((w) => {
      if (w.title.toLowerCase().includes(lower)) return true;
      const leaves = getAllLeaves(w.root);
      return leaves.some((l) => l.slotIDs.some((sid) => slotsMap[sid]?.name.toLowerCase().includes(lower)));
    });
  },

  setConnectionState: (state) => set({ connectionState: state }),
  setSlots: (slots) => {
    set({ slots });
    get().ensureWorkspacesForSlots();
  },
  setSessions: (sessions) => set({ sessions }),
  updateSlot: (slot) =>
    set((s) => ({ slots: s.slots.map((existing) => (existing.id === slot.id ? slot : existing)) })),
  addSlot: (slot) => {
    set((s) => ({ slots: [...s.slots, slot] }));
    get().ensureWorkspacesForSlots();
  },
  removeSlot: (slotID) =>
    set((s) => ({
      slots: s.slots.filter((slot) => slot.id !== slotID),
      workspaces: s.workspaces
        .map((w) => {
          const newRoot = removeSlotFromTree(w.root, slotID);
          return newRoot ? { ...w, root: newRoot } : null;
        })
        .filter(Boolean) as Workspace[],
    })),
  updateSession: (session) =>
    set((s) => ({
      sessions: s.sessions.map((existing) => (existing.id === session.id ? session : existing)),
    })),
  addSession: (session) => set((s) => ({ sessions: [...s.sessions, session] })),
  removeSession: (sessionID) =>
    set((s) => ({ sessions: s.sessions.filter((ses) => ses.id !== sessionID) })),

  ensureWorkspacesForSlots: () => {
    const { slots, workspaces } = get();
    const existingSlotIDs = new Set(workspaces.flatMap((w) => getAllLeaves(w.root).flatMap((l) => l.slotIDs)));
    const newSlots = slots.filter((s) => !existingSlotIDs.has(s.id));
    if (newSlots.length === 0) return;

    const newWorkspaces = newSlots.map((slot, i) => ({
      id: uuid(),
      title: slot.name,
      root: createLeaf([slot.id]),
      focusedPaneID: null,
      sortOrder: workspaces.length + i,
    }));

    const allWorkspaces = [...workspaces, ...newWorkspaces];
    set({
      workspaces: allWorkspaces,
      visibleWorkspaceID: get().visibleWorkspaceID ?? allWorkspaces[0]?.id ?? null,
      selectedSidebarWorkspaceID: get().selectedSidebarWorkspaceID ?? allWorkspaces[0]?.id ?? null,
    });
  },

  selectWorkspace: (id) =>
    set({ visibleWorkspaceID: id, selectedSidebarWorkspaceID: id }),

  setSearchText: (text) => set({ searchText: text }),

  setNavigationArea: (area) => set({ navigationArea: area }),

  navigateSidebar: (offset) => {
    const { filteredWorkspaces, selectedSidebarWorkspaceID } = get();
    const list = filteredWorkspaces();
    if (list.length === 0) return;
    const currentIdx = list.findIndex((w) => w.id === selectedSidebarWorkspaceID);
    const nextIdx = Math.max(0, Math.min(list.length - 1, currentIdx + offset));
    set({ selectedSidebarWorkspaceID: list[nextIdx].id });
  },

  splitPane: (paneID, slotID, axis, position) => {
    set((s) => {
      const workspace = s.visibleWorkspace();
      if (!workspace) return s;

      function splitNode(node: LayoutNode): LayoutNode {
        if (node.type === "leaf" && node.id === paneID) {
          const newLeaf = createLeaf([slotID]);
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

      return {
        workspaces: s.workspaces.map((w) =>
          w.id === workspace.id ? { ...w, root: splitNode(w.root) } : w
        ),
      };
    });
  },

  addTabToPane: (paneID, slotID) => {
    set((s) => {
      const workspace = s.visibleWorkspace();
      if (!workspace) return s;

      function addTab(node: LayoutNode): LayoutNode {
        if (node.type === "leaf" && node.id === paneID) {
          if (node.slotIDs.includes(slotID)) return node;
          return { ...node, slotIDs: [...node.slotIDs, slotID], selectedIndex: node.slotIDs.length };
        }
        if (node.type === "split") {
          return { ...node, children: node.children.map(addTab) };
        }
        return node;
      }

      return {
        workspaces: s.workspaces.map((w) =>
          w.id === workspace.id ? { ...w, root: addTab(w.root) } : w
        ),
      };
    });
  },

  removeTabFromPane: (paneID, slotID) => {
    set((s) => {
      const workspace = s.visibleWorkspace();
      if (!workspace) return s;

      const newRoot = removeSlotFromTree(workspace.root, slotID);
      if (!newRoot) return s;

      return {
        workspaces: s.workspaces.map((w) =>
          w.id === workspace.id ? { ...w, root: newRoot } : w
        ),
      };
    });
  },

  selectTabInPane: (paneID, index) => {
    set((s) => {
      const workspace = s.visibleWorkspace();
      if (!workspace) return s;

      function selectTab(node: LayoutNode): LayoutNode {
        if (node.type === "leaf" && node.id === paneID) {
          return { ...node, selectedIndex: Math.min(index, node.slotIDs.length - 1) };
        }
        if (node.type === "split") {
          return { ...node, children: node.children.map(selectTab) };
        }
        return node;
      }

      return {
        workspaces: s.workspaces.map((w) =>
          w.id === workspace.id ? { ...w, root: selectTab(w.root) } : w
        ),
      };
    });
  },

  setFocusedPane: (paneID) => {
    set((s) => {
      const workspace = s.visibleWorkspace();
      if (!workspace) return s;
      return {
        workspaces: s.workspaces.map((w) =>
          w.id === workspace.id ? { ...w, focusedPaneID: paneID } : w
        ),
      };
    });
  },

  focusDirection: (_direction) => {
    // TODO: implement spatial navigation between panes
  },
}));
