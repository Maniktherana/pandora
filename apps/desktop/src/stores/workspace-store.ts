import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type {
  ProjectRecord,
  WorkspaceRecord,
  WorkspaceKind,
  DiffSource,
  SlotState,
  SessionState,
  LayoutNode,
  LayoutAxis,
  AppState,
  WorkspaceRuntimeState,
  TerminalPanelState,
} from "@/lib/shared/types";
import { migratePersistedLayout } from "@/lib/layout/layout-migrate";
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
} from "@/lib/layout/layout-tree";
import { isProjectRuntimeKey, projectRuntimeKey } from "@/lib/runtime/runtime-keys";
import { getTerminalDaemonClient } from "@/lib/terminal/terminal-runtime";
import {
  addTerminalGroup,
  addTerminalToGroup,
  createEmptyTerminalPanel,
  moveTerminalToGroup,
  moveTerminalToNewGroup,
  reorderTerminalGroupChildren,
  reorderTerminalGroups,
  removeTerminalFromPanel,
  setActiveTerminalGroup,
  setActiveTerminalSlot,
  setTerminalPanelVisible,
  terminalPanelContainsSlot,
} from "@/lib/terminal/bottom-terminal-panel";
import {
  defaultTerminalDisplay,
  detectTerminalDisplayFromInput,
  detectTerminalDisplayFromOutput,
  resetTerminalInputTracking,
} from "@/lib/terminal/terminal-identity";

export type NavigationArea = "sidebar" | "workspace";

function sanitizeWorkspaceTerminalLayout(
  root: LayoutNode | null,
  focusedPaneID: string | null,
  liveSlotIds: Set<string>
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
  noteTerminalInput: (workspaceId: string, sessionID: string, data: string) => void;
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

export const useWorkspaceStore = create<WorkspaceStoreState>((set, get) => {
  /**
   * Project-scoped (bottom) daemon: always-on for ready workspaces so the bottom panel can show
   * Terminal + Ports consistently. Uses a distinct runtime id / socket from the workspace daemon
   * even when the checkout path matches (linked worktrees).
   */
  const syncProjectScopedRuntime = (workspace: WorkspaceRecord) => {
    const project = get().projects.find((p) => p.id === workspace.projectId);
    if (!project || workspace.status !== "ready") return;

    const pk = projectRuntimeKey(workspace.projectId);

    if (!get().runtimes[pk]) {
      void invoke("start_project_runtime", {
        projectId: project.id,
        gitRootPath: project.gitRootPath,
        defaultCwd: project.gitRootPath,
      });
      const placeholder = createLeaf([]);
      set((s) => ({
        runtimes: {
          ...s.runtimes,
          [pk]: {
            workspaceId: pk,
            slots: [],
            sessions: [],
            terminalDisplayBySlotId: {},
            connectionState: "connecting",
            root: placeholder,
            focusedPaneID: placeholder.id,
            terminalPanel: createEmptyTerminalPanel(),
            layoutLoading: false,
          },
        },
      }));
    }
  };

  return {
  projects: [],
  workspaces: [],
  selectedProjectID: null,
  selectedWorkspaceID: null,
  runtimes: {},
  navigationArea: "sidebar",
  searchText: "",
  layoutTargetRuntimeId: null,

  setLayoutTargetRuntimeId: (id) => set({ layoutTargetRuntimeId: id }),
  effectiveLayoutRuntimeId: () => {
    const { layoutTargetRuntimeId, selectedWorkspaceID } = get();
    return layoutTargetRuntimeId ?? selectedWorkspaceID;
  },

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
      const ws = get().workspaces.find((w) => w.id === get().selectedWorkspaceID);
      if (ws?.status === "ready") syncProjectScopedRuntime(ws);
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
    const pk = projectRuntimeKey(projectId);
    void invoke("stop_project_runtime", { projectId }).catch(() => {});
    set((s) => {
      const { [pk]: _, ...rest } = s.runtimes;
      return {
        runtimes: rest,
        layoutTargetRuntimeId: s.layoutTargetRuntimeId === pk ? null : s.layoutTargetRuntimeId,
      };
    });
    try {
      await invoke("remove_project", { projectId });
      await get().reloadFromBackend();
    } catch (e) {
      console.error("Failed to remove project:", e);
    }
  },
  selectProject: (projectId) => {
    set({ selectedProjectID: projectId });
    void invoke("save_selection", {
      projectId,
      workspaceId: get().selectedWorkspaceID,
    });
  },

  // ─── Workspace actions ───
  createWorkspace: async (projectId, workspaceKind) => {
    try {
      await invoke("create_workspace", {
        projectId,
        ...(workspaceKind != null ? { workspaceKind } : {}),
      });
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
      layoutTargetRuntimeId: null,
    });
    void invoke("save_selection", {
      projectId: workspace.projectId,
      workspaceId: workspace.id,
    });

    // Start runtime if workspace is ready and not already running
    if (workspace.status === "ready") {
      syncProjectScopedRuntime(workspace);

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
              terminalDisplayBySlotId: {},
              connectionState: "connecting",
              root: null,
              focusedPaneID: null,
              terminalPanel: null,
              layoutLoading: true,
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
        terminalDisplayBySlotId: {},
        connectionState: "disconnected",
        root: null,
        focusedPaneID: null,
        terminalPanel: isProjectRuntimeKey(workspaceId) ? createEmptyTerminalPanel() : null,
        layoutLoading: false,
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
      const liveSlotIds = new Set(slots.map((slot) => slot.id));
      const layout = !isProjectRuntimeKey(workspaceId)
        ? sanitizeWorkspaceTerminalLayout(runtime.root, runtime.focusedPaneID, liveSlotIds)
        : { root: runtime.root, focusedPaneID: runtime.focusedPaneID };
      const terminalPanel = isProjectRuntimeKey(workspaceId)
        ? slots.reduce<TerminalPanelState>(
            (panel, slot) =>
              terminalPanelContainsSlot(panel, slot.id)
                ? panel
                : addTerminalGroup(panel, slot.id, { activate: panel.groups.length === 0 }),
            runtime.terminalPanel ?? createEmptyTerminalPanel()
          )
        : runtime.terminalPanel;
      const terminalDisplayBySlotId = Object.fromEntries(
        slots.map((slot) => [
          slot.id,
          runtime.terminalDisplayBySlotId[slot.id] ?? defaultTerminalDisplay(),
        ])
      );
      return {
        runtimes: {
          ...s.runtimes,
          [workspaceId]: {
            ...runtime,
            slots,
            terminalDisplayBySlotId,
            terminalPanel,
            root: layout.root,
            focusedPaneID: layout.focusedPaneID,
          },
        },
      };
    });
    if (isProjectRuntimeKey(workspaceId)) {
      get().ensureProjectTerminalPanel(workspaceId);
    } else {
      get().ensureRuntimeLayout(workspaceId);
    }
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
  noteTerminalInput: (workspaceId, sessionID, data) => {
    const detected = detectTerminalDisplayFromInput(sessionID, data);
    if (!detected) return;
    set((s) => {
      const runtime = s.runtimes[workspaceId];
      if (!runtime) return s;
      const session = runtime.sessions.find((item) => item.id === sessionID);
      if (!session) return s;
      const current = runtime.terminalDisplayBySlotId[session.slotID];
      if (current?.kind === detected.kind && current.label === detected.label) {
        return s;
      }
      return {
        runtimes: {
          ...s.runtimes,
          [workspaceId]: {
            ...runtime,
            terminalDisplayBySlotId: {
              ...runtime.terminalDisplayBySlotId,
              [session.slotID]: detected,
            },
          },
        },
      };
    });
  },
  noteTerminalOutput: (workspaceId, sessionID, data) => {
    // PR URL detection: scan output for GitHub PR URLs when awaiting
    if (get().prAwaitingWorkspaceIds.has(workspaceId)) {
      const match = data.match(/https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/(\d+)/);
      if (match) {
        const prUrl = match[0];
        const prNumber = parseInt(match[1], 10);
        get().setPrAwaiting(workspaceId, false);
        get().updateWorkspacePr(workspaceId, prUrl, prNumber, "open");
        void invoke("pr_link", { workspaceId, prUrl, prNumber });
      }
    }

    const detected = detectTerminalDisplayFromOutput(data);
    if (!detected) return;
    set((s) => {
      const runtime = s.runtimes[workspaceId];
      if (!runtime) return s;
      const session = runtime.sessions.find((item) => item.id === sessionID);
      if (!session) return s;
      const current = runtime.terminalDisplayBySlotId[session.slotID];
      if (current?.kind === detected.kind && current.label === detected.label) {
        return s;
      }
      return {
        runtimes: {
          ...s.runtimes,
          [workspaceId]: {
            ...runtime,
            terminalDisplayBySlotId: {
              ...runtime.terminalDisplayBySlotId,
              [session.slotID]: detected,
            },
          },
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
            terminalDisplayBySlotId: {
              ...runtime.terminalDisplayBySlotId,
              [slot.id]: runtime.terminalDisplayBySlotId[slot.id] ?? defaultTerminalDisplay(),
            },
          },
        },
      };
    });
  },
  addRuntimeSlot: (workspaceId, slot) => {
    set((s) => {
      const runtime = s.runtimes[workspaceId];
      if (!runtime) return s;
      const terminalPanel = isProjectRuntimeKey(workspaceId)
        ? terminalPanelContainsSlot(runtime.terminalPanel, slot.id)
          ? runtime.terminalPanel
          : addTerminalGroup(runtime.terminalPanel, slot.id, {
              activate: (runtime.terminalPanel?.groups.length ?? 0) === 0,
            })
        : runtime.terminalPanel;
      return {
        runtimes: {
          ...s.runtimes,
          [workspaceId]: {
            ...runtime,
            slots: [...runtime.slots, slot],
            terminalPanel,
            terminalDisplayBySlotId: {
              ...runtime.terminalDisplayBySlotId,
              [slot.id]: runtime.terminalDisplayBySlotId[slot.id] ?? defaultTerminalDisplay(),
            },
          },
        },
      };
    });
    if (isProjectRuntimeKey(workspaceId)) {
      get().ensureProjectTerminalPanel(workspaceId);
    } else {
      get().ensureRuntimeLayout(workspaceId);
    }
  },
  removeRuntimeSlot: (workspaceId, slotID) => {
    set((s) => {
      const runtime = s.runtimes[workspaceId];
      if (!runtime) return s;
      const newRoot =
        !isProjectRuntimeKey(workspaceId) && runtime.root
          ? (removeTerminalSlotFromTree(runtime.root, slotID) ?? createLeaf([]))
          : runtime.root
            ? removeTerminalSlotFromTree(runtime.root, slotID)
            : null;
      const terminalPanel = isProjectRuntimeKey(workspaceId)
        ? removeTerminalFromPanel(runtime.terminalPanel, slotID)
        : runtime.terminalPanel;
      const leaves = newRoot ? getAllLeaves(newRoot) : [];
      const focusedPaneID =
        !isProjectRuntimeKey(workspaceId) && newRoot
          ? runtime.focusedPaneID && findLeaf(newRoot, runtime.focusedPaneID)
            ? runtime.focusedPaneID
            : (leaves[0]?.id ?? null)
          : runtime.focusedPaneID;
      const { [slotID]: _, ...terminalDisplayBySlotId } = runtime.terminalDisplayBySlotId;
      return {
        runtimes: {
          ...s.runtimes,
          [workspaceId]: {
            ...runtime,
            slots: runtime.slots.filter((sl) => sl.id !== slotID),
            terminalDisplayBySlotId,
            root: newRoot,
            terminalPanel,
            focusedPaneID,
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
    if (isProjectRuntimeKey(workspaceId) && session.kind === "terminal" && session.status === "crashed") {
      get().closeProjectTerminal(workspaceId, session.slotID);
    }
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
    resetTerminalInputTracking(sessionID);
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
    if (runtime.layoutLoading) return;
    if (isProjectRuntimeKey(workspaceId)) return;

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
  ensureProjectTerminalPanel: (workspaceId) => {
    if (!isProjectRuntimeKey(workspaceId)) return;
    const runtime = get().runtimes[workspaceId];
    if (!runtime) return;
    const slotIds = new Set(runtime.slots.map((slot) => slot.id));
    let terminalPanel = runtime.terminalPanel ?? createEmptyTerminalPanel();

    for (const slot of runtime.slots) {
      if (!terminalPanelContainsSlot(terminalPanel, slot.id)) {
        terminalPanel = addTerminalGroup(terminalPanel, slot.id, {
          activate: terminalPanel.groups.length === 0,
        });
      }
    }

    for (const group of terminalPanel.groups) {
      for (const child of group.children) {
        if (!slotIds.has(child)) {
          terminalPanel = removeTerminalFromPanel(terminalPanel, child);
        }
      }
    }

    set((s) => {
      const nextRuntime = s.runtimes[workspaceId];
      if (!nextRuntime) return s;
      return {
        runtimes: {
          ...s.runtimes,
          [workspaceId]: {
            ...nextRuntime,
            terminalPanel,
          },
        },
      };
    });
  },
  addProjectTerminalGroup: (workspaceId, slotId, index) => {
    if (!isProjectRuntimeKey(workspaceId)) return;
    set((s) => {
      const runtime = s.runtimes[workspaceId];
      if (!runtime) return s;
      return {
        runtimes: {
          ...s.runtimes,
          [workspaceId]: {
            ...runtime,
            terminalPanel: addTerminalGroup(runtime.terminalPanel, slotId, { index }),
          },
        },
      };
    });
  },
  splitProjectTerminalGroup: (workspaceId, groupId, slotId) => {
    if (!isProjectRuntimeKey(workspaceId)) return;
    set((s) => {
      const runtime = s.runtimes[workspaceId];
      if (!runtime) return s;
      return {
        runtimes: {
          ...s.runtimes,
          [workspaceId]: {
            ...runtime,
            terminalPanel: addTerminalToGroup(runtime.terminalPanel, groupId, slotId),
          },
        },
      };
    });
  },
  closeProjectTerminal: (workspaceId, slotId) => {
    if (!isProjectRuntimeKey(workspaceId)) return;
    getTerminalDaemonClient()?.send(workspaceId, { type: "remove_slot", slotID: slotId });
    set((s) => {
      const runtime = s.runtimes[workspaceId];
      if (!runtime) return s;
      return {
        runtimes: {
          ...s.runtimes,
          [workspaceId]: {
            ...runtime,
            terminalPanel: removeTerminalFromPanel(runtime.terminalPanel, slotId),
          },
        },
      };
    });
  },
  selectProjectTerminalGroup: (workspaceId, groupId, slotId) => {
    if (!isProjectRuntimeKey(workspaceId)) return;
    set((s) => {
      const runtime = s.runtimes[workspaceId];
      if (!runtime) return s;
      return {
        runtimes: {
          ...s.runtimes,
          [workspaceId]: {
            ...runtime,
            terminalPanel: setActiveTerminalGroup(runtime.terminalPanel, groupId, slotId),
          },
        },
      };
    });
  },
  focusProjectTerminal: (workspaceId, slotId) => {
    if (!isProjectRuntimeKey(workspaceId)) return;
    set((s) => {
      const runtime = s.runtimes[workspaceId];
      if (!runtime) return s;
      return {
        runtimes: {
          ...s.runtimes,
          [workspaceId]: {
            ...runtime,
            terminalPanel: setActiveTerminalSlot(runtime.terminalPanel, slotId),
          },
        },
      };
    });
  },
  setProjectTerminalPanelVisible: (workspaceId, visible) => {
    if (!isProjectRuntimeKey(workspaceId)) return;
    set((s) => {
      const runtime = s.runtimes[workspaceId];
      if (!runtime) return s;
      return {
        runtimes: {
          ...s.runtimes,
          [workspaceId]: {
            ...runtime,
            terminalPanel: setTerminalPanelVisible(runtime.terminalPanel, visible),
          },
        },
      };
    });
  },
  reorderProjectTerminalGroups: (workspaceId, fromIndex, toIndex) => {
    if (!isProjectRuntimeKey(workspaceId)) return;
    set((s) => {
      const runtime = s.runtimes[workspaceId];
      if (!runtime) return s;
      return {
        runtimes: {
          ...s.runtimes,
          [workspaceId]: {
            ...runtime,
            terminalPanel: reorderTerminalGroups(runtime.terminalPanel, fromIndex, toIndex),
          },
        },
      };
    });
  },
  reorderProjectTerminalGroupChildren: (workspaceId, groupId, fromIndex, toIndex) => {
    if (!isProjectRuntimeKey(workspaceId)) return;
    set((s) => {
      const runtime = s.runtimes[workspaceId];
      if (!runtime) return s;
      return {
        runtimes: {
          ...s.runtimes,
          [workspaceId]: {
            ...runtime,
            terminalPanel: reorderTerminalGroupChildren(runtime.terminalPanel, groupId, fromIndex, toIndex),
          },
        },
      };
    });
  },
  moveProjectTerminalToGroup: (workspaceId, slotId, targetGroupId, index) => {
    if (!isProjectRuntimeKey(workspaceId)) return;
    set((s) => {
      const runtime = s.runtimes[workspaceId];
      if (!runtime) return s;
      return {
        runtimes: {
          ...s.runtimes,
          [workspaceId]: {
            ...runtime,
            terminalPanel: moveTerminalToGroup(runtime.terminalPanel, slotId, targetGroupId, {
              index,
            }),
          },
        },
      };
    });
  },
  moveProjectTerminalToNewGroup: (workspaceId, slotId, index) => {
    if (!isProjectRuntimeKey(workspaceId)) return;
    set((s) => {
      const runtime = s.runtimes[workspaceId];
      if (!runtime) return s;
      return {
        runtimes: {
          ...s.runtimes,
          [workspaceId]: {
            ...runtime,
            terminalPanel: moveTerminalToNewGroup(runtime.terminalPanel, slotId, index),
          },
        },
      };
    });
  },

  // ─── Layout actions ───
  splitPane: (targetPaneID, sourcePaneID, sourceTabIndex, axis, position) => {
    const rid = get().effectiveLayoutRuntimeId();
    if (!rid) return;
    // Bottom (project) terminal: side-by-side splits only — no stacked vertical panes.
    if (isProjectRuntimeKey(rid) && axis === "vertical") return;
    set((s) => {
      const runtime = s.runtimes[rid];
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
            [rid]: { ...runtime, root, focusedPaneID: root.type === "leaf" ? root.id : runtime.focusedPaneID },
          },
        };
      }
      root = splitPaneAroundTab(root, targetPaneID, tab, axis, position);
      return {
        runtimes: {
          ...s.runtimes,
          [rid]: { ...runtime, root },
        },
      };
    });
    get().persistLayout();
  },

  addTabToPane: (targetPaneID, sourcePaneID, sourceTabIndex) => {
    const rid = get().effectiveLayoutRuntimeId();
    if (!rid) return;
    set((s) => {
      const runtime = s.runtimes[rid];
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
            [rid]: { ...runtime, root },
          },
        };
      }
      const destLeaf = findLeaf(root, targetPaneID);
      const insertAt = destLeaf?.tabs.length ?? 0;
      root = insertTabInPane(root, targetPaneID, tab, insertAt);
      return {
        runtimes: {
          ...s.runtimes,
          [rid]: { ...runtime, root },
        },
      };
    });
    get().persistLayout();
  },

  removePaneTabByIndex: (paneID, tabIndex) => {
    const rid = get().effectiveLayoutRuntimeId();
    if (!rid) return;
    set((s) => {
      const runtime = s.runtimes[rid];
      if (!runtime?.root) return s;
      let newRoot = removeTabAtIndexInTree(runtime.root, paneID, tabIndex);
      if (!newRoot) {
        newRoot = createLeaf([]);
      }
      const leaves = getAllLeaves(newRoot);
      const focusedOK =
        runtime.focusedPaneID && findLeaf(newRoot, runtime.focusedPaneID);
      const focusedPaneID = focusedOK
        ? runtime.focusedPaneID
        : (leaves[0]?.id ?? null);
      return {
        runtimes: {
          ...s.runtimes,
          [rid]: { ...runtime, root: newRoot, focusedPaneID },
        },
      };
    });
    get().persistLayout();
  },

  addEditorTabForPath: (relativePath) => {
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

  addDiffTabForPath: (relativePath, source) => {
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
      if (!rt?.root) return s;
      const pl = findLeaf(rt.root, paneID!);
      const at = pl?.tabs.length ?? 0;
      const root = insertTabInPane(
        rt.root,
        paneID!,
        { kind: "diff", path: relativePath, source },
        at
      );
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
    const rid = get().effectiveLayoutRuntimeId();
    if (!rid) return;
    set((s) => {
      const runtime = s.runtimes[rid];
      if (!runtime?.root) return s;

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

      return {
        runtimes: {
          ...s.runtimes,
          [rid]: { ...runtime, root: selectTab(runtime.root) },
        },
      };
    });
    get().persistLayout();
  },

  moveTab: (fromPaneID, toPaneID, fromIndex, toIndex) => {
    const rid = get().effectiveLayoutRuntimeId();
    if (!rid) return;
    set((s) => {
      const runtime = s.runtimes[rid];
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
          [rid]: { ...runtime, root },
        },
      };
    });
    get().persistLayout();
  },

  reorderTab: (paneID, fromIndex, toIndex) => {
    const rid = get().effectiveLayoutRuntimeId();
    if (!rid) return;
    set((s) => {
      const runtime = s.runtimes[rid];
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
          [rid]: { ...runtime, root: reorder(runtime.root) },
        },
      };
    });
    get().persistLayout();
  },

  setFocusedPane: (paneID) => {
    const rid = get().effectiveLayoutRuntimeId();
    if (!rid) return;
    set((s) => {
      const runtime = s.runtimes[rid];
      if (!runtime) return s;
      return {
        runtimes: {
          ...s.runtimes,
          [rid]: { ...runtime, focusedPaneID: paneID },
        },
      };
    });
    get().persistLayout();
  },

  cycleTab: (direction) => {
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

      get().selectProjectTerminalGroup(
        rid,
        nextTerminal.groupId,
        nextTerminal.slotId
      );
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
      const wrapTabIdx =
        direction === 1 ? 0 : Math.max(0, wrapPane.tabs.length - 1);
      get().selectTabInPane(wrapPane.id, wrapTabIdx);
      get().setFocusedPane(wrapPane.id);
      return;
    }

    const nextPane = leaves[nextPaneIdx];
    const targetIndex =
      direction === 1 ? 0 : Math.max(0, nextPane.tabs.length - 1);
    get().selectTabInPane(nextPane.id, targetIndex);
    get().setFocusedPane(nextPane.id);
  },

  persistLayout: () => {
    const id = get().effectiveLayoutRuntimeId();
    if (!id || isProjectRuntimeKey(id)) return;
    const runtime = get().runtimes[id];
    if (!runtime?.root) return;
    const layout = {
      root: runtime.root,
      focusedPaneID: runtime.focusedPaneID,
    };
    void invoke("save_workspace_layout", { workspaceId: id, layout });
  },

  loadPersistedLayout: async (workspaceId) => {
    try {
      const raw = await invoke<unknown>("load_workspace_layout", {
        workspaceId,
      });
      const layout = raw != null ? migratePersistedLayout(raw) : null;
      set((s) => {
        const runtime = s.runtimes[workspaceId];
        if (!runtime) return s;
        const normalizedLayout =
          layout && runtime.slots.length > 0
            ? sanitizeWorkspaceTerminalLayout(
                layout.root,
                layout.focusedPaneID,
                new Set(runtime.slots.map((slot) => slot.id))
              )
            : layout;
        return {
          runtimes: {
            ...s.runtimes,
            [workspaceId]: {
              ...runtime,
              layoutLoading: false,
              ...(normalizedLayout
                ? { root: normalizedLayout.root, focusedPaneID: normalizedLayout.focusedPaneID }
                : {}),
            },
          },
        };
      });
      if (!layout) {
        get().ensureRuntimeLayout(workspaceId);
      }
    } catch {
      set((s) => {
        const runtime = s.runtimes[workspaceId];
        if (!runtime) return s;
        return {
          runtimes: {
            ...s.runtimes,
            [workspaceId]: {
              ...runtime,
              layoutLoading: false,
            },
          },
        };
      });
      get().ensureRuntimeLayout(workspaceId);
    }
  },

  // ─── PR ───
  prAwaitingWorkspaceIds: new Set<string>(),
  setPrAwaiting: (workspaceId, awaiting) => {
    set((s) => {
      const next = new Set(s.prAwaitingWorkspaceIds);
      if (awaiting) {
        next.add(workspaceId);
      } else {
        next.delete(workspaceId);
      }
      return { prAwaitingWorkspaceIds: next };
    });

    // Auto-clear after 90s timeout
    if (awaiting) {
      setTimeout(() => {
        const s = get();
        if (s.prAwaitingWorkspaceIds.has(workspaceId)) {
          s.setPrAwaiting(workspaceId, false);
        }
      }, 90_000);
    }
  },
  updateWorkspacePr: (workspaceId, prUrl, prNumber, prState) => {
    set((s) => ({
      workspaces: s.workspaces.map((w) =>
        w.id === workspaceId
          ? { ...w, prUrl, prNumber, prState: prState as any }
          : w
      ),
    }));
  },
  updateWorkspacePrState: (workspaceId, prState) => {
    set((s) => ({
      workspaces: s.workspaces.map((w) =>
        w.id === workspaceId ? { ...w, prState: prState as any } : w
      ),
    }));
  },
  archiveWorkspaceFromStore: (workspaceId) => {
    set((s) => ({
      workspaces: s.workspaces.map((w) =>
        w.id === workspaceId ? { ...w, status: "archived" as any } : w
      ),
    }));
    // If archived workspace was selected, select another one
    const { selectedWorkspaceID, workspaces, selectedProjectID } = get();
    if (selectedWorkspaceID === workspaceId) {
      const next = workspaces.find(
        (w) => w.projectId === selectedProjectID && w.id !== workspaceId && w.status !== "archived"
      );
      if (next) {
        get().selectWorkspace(next);
      }
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
};
});
