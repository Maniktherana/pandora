import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type {
  ProjectRecord,
  WorkspaceRecord,
  WorkspaceKind,
  DiffSource,
  SlotState,
  SessionState,
  LayoutAxis,
  WorkspaceRuntimeState,
} from "@/lib/shared/types";
import { createWorkspaceActions } from "./actions/workspace-actions";
import { createRuntimeActions } from "./actions/runtime-actions";
import { createLayoutActions } from "./actions/layout-actions";
import { createTerminalPanelActions } from "./actions/terminal-panel-actions";

export type NavigationArea = "sidebar" | "workspace";

export interface WorkspaceStoreState {
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
  /** When set, layout shortcuts / tab DnD target this runtime (`project:…` or workspace id). */
  layoutTargetRuntimeId: string | null;
  setLayoutTargetRuntimeId: (id: string | null) => void;
  effectiveLayoutRuntimeId: () => string | null;

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
  createWorkspace: (projectId: string, workspaceKind?: WorkspaceKind) => Promise<void>;
  retryWorkspace: (workspaceId: string) => Promise<void>;
  removeWorkspace: (workspaceId: string) => Promise<void>;
  selectWorkspace: (workspace: WorkspaceRecord) => void;
  markWorkspaceOpened: (workspaceId: string) => Promise<void>;

  // ─── Runtime actions (per-workspace) ───
  setRuntimeConnectionState: (workspaceId: string, state: "disconnected" | "connecting" | "connected") => void;
  setRuntimeSlots: (workspaceId: string, slots: SlotState[]) => void;
  setRuntimeSessions: (workspaceId: string, sessions: SessionState[]) => void;
  noteTerminalOutput: (workspaceId: string, sessionID: string, data: string) => void;
  updateRuntimeSlot: (workspaceId: string, slot: SlotState) => void;
  addRuntimeSlot: (workspaceId: string, slot: SlotState) => void;
  removeRuntimeSlot: (workspaceId: string, slotID: string) => void;
  updateRuntimeSession: (workspaceId: string, session: SessionState) => void;
  addRuntimeSession: (workspaceId: string, session: SessionState) => void;
  removeRuntimeSession: (workspaceId: string, sessionID: string) => void;
  ensureRuntimeLayout: (workspaceId: string) => void;
  ensureProjectTerminalPanel: (workspaceId: string) => void;
  addProjectTerminalGroup: (workspaceId: string, slotId: string, index?: number) => void;
  splitProjectTerminalGroup: (workspaceId: string, groupId: string, slotId: string) => void;
  closeProjectTerminal: (workspaceId: string, slotId: string) => void;
  selectProjectTerminalGroup: (workspaceId: string, groupId: string, slotId?: string | null) => void;
  focusProjectTerminal: (workspaceId: string, slotId: string | null) => void;
  setProjectTerminalPanelVisible: (workspaceId: string, visible: boolean) => void;
  reorderProjectTerminalGroups: (workspaceId: string, fromIndex: number, toIndex: number) => void;
  reorderProjectTerminalGroupChildren: (
    workspaceId: string,
    groupId: string,
    fromIndex: number,
    toIndex: number
  ) => void;
  moveProjectTerminalToGroup: (
    workspaceId: string,
    slotId: string,
    targetGroupId: string,
    index?: number
  ) => void;
  moveProjectTerminalToNewGroup: (workspaceId: string, slotId: string, index: number) => void;

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
  /** Add or focus a git diff tab (working tree vs index, or staged vs HEAD). */
  addDiffTabForPath: (relativePath: string, source: DiffSource) => void;
  setFocusedPane: (paneID: string) => void;
  cycleTab: (direction: -1 | 1) => void;
  persistLayout: () => void;
  loadPersistedLayout: (workspaceId: string) => Promise<void>;

  // ─── PR ───
  prAwaitingWorkspaceIds: Set<string>;
  setPrAwaiting: (workspaceId: string, awaiting: boolean) => void;
  updateWorkspacePr: (workspaceId: string, prUrl: string, prNumber: number, prState: string) => void;
  updateWorkspacePrState: (workspaceId: string, prState: string) => void;
  archiveWorkspaceFromStore: (workspaceId: string) => void;

  // ─── Navigation ───
  setNavigationArea: (area: NavigationArea) => void;
  setSearchText: (text: string) => void;
  navigateSidebar: (offset: number) => void;
}

export const useWorkspaceStore = create<WorkspaceStoreState>()(
  immer((set, get) => ({
    // ─── Initial state ───
    projects: [],
    workspaces: [],
    selectedProjectID: null,
    selectedWorkspaceID: null,
    runtimes: {},
    navigationArea: "sidebar" as NavigationArea,
    searchText: "",
    layoutTargetRuntimeId: null,
    prAwaitingWorkspaceIds: new Set<string>(),

    // ─── Simple setters ───
    setLayoutTargetRuntimeId: (id) => set((s) => { s.layoutTargetRuntimeId = id; }),
    setNavigationArea: (area) => set((s) => { s.navigationArea = area; }),
    setSearchText: (text) => set((s) => { s.searchText = text; }),

    // ─── Computed helpers ───
    effectiveLayoutRuntimeId: () => {
      const { layoutTargetRuntimeId, selectedWorkspaceID } = get();
      return layoutTargetRuntimeId ?? selectedWorkspaceID;
    },
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

    // ─── Delegated actions ───
    ...createWorkspaceActions(set, get),
    ...createRuntimeActions(set, get),
    ...createLayoutActions(set, get),
    ...createTerminalPanelActions(set, get),
  }))
);
