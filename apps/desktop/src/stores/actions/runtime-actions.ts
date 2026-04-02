import type {
  SlotState,
  SessionState,
  LayoutNode,
  TerminalPanelState,
  WorkspaceRuntimeState,
} from "@/lib/shared/types";
import {
  addTerminalTabToNode,
  createLeaf,
  findLeaf,
  getAllLeaves,
  getAllTerminalSlotIds,
  removeTerminalSlotFromTree,
} from "@/lib/layout/layout-tree";
import { isProjectRuntimeKey } from "@/lib/runtime/runtime-keys";
import {
  addTerminalGroup,
  createEmptyTerminalPanel,
  removeTerminalFromPanel,
  terminalPanelContainsSlot,
} from "@/lib/terminal/bottom-terminal-panel";
import { defaultTerminalDisplay } from "@/lib/terminal/terminal-identity";
import { migratePersistedLayout } from "@/lib/layout/layout-migrate";
import { invoke } from "@tauri-apps/api/core";
import type { ImmerSet, Get } from "./types";

export function sanitizeWorkspaceTerminalLayout(
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

export function createRuntimeActions(set: ImmerSet, get: Get) {
  return {
    setRuntimeConnectionState: (workspaceId: string, state: "disconnected" | "connecting" | "connected") => {
      set((s) => {
        if (!s.runtimes[workspaceId]) {
          s.runtimes[workspaceId] = {
            workspaceId,
            slots: [],
            sessions: [],
            terminalDisplayBySlotId: {},
            connectionState: "disconnected",
            root: null,
            focusedPaneID: null,
            terminalPanel: isProjectRuntimeKey(workspaceId) ? createEmptyTerminalPanel() : null,
            layoutLoading: false,
          } as WorkspaceRuntimeState;
        }
        s.runtimes[workspaceId].connectionState = state;
      });
    },

    setRuntimeSlots: (workspaceId: string, slots: SlotState[]) => {
      set((s) => {
        const runtime = s.runtimes[workspaceId];
        if (!runtime) return;

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

        runtime.slots = slots as WritableDraft<SlotState>[];
        runtime.terminalDisplayBySlotId = terminalDisplayBySlotId;
        runtime.terminalPanel = terminalPanel as WritableDraft<TerminalPanelState> | null;
        runtime.root = layout.root as WritableDraft<LayoutNode> | null;
        runtime.focusedPaneID = layout.focusedPaneID;
      });

      if (isProjectRuntimeKey(workspaceId)) {
        get().ensureProjectTerminalPanel(workspaceId);
      } else {
        get().ensureRuntimeLayout(workspaceId);
      }
    },

    setRuntimeSessions: (workspaceId: string, sessions: SessionState[]) => {
      set((s) => {
        const runtime = s.runtimes[workspaceId];
        if (!runtime) return;
        runtime.sessions = sessions as WritableDraft<SessionState>[];
      });
    },

    noteTerminalOutput: (workspaceId: string, _sessionID: string, data: string) => {
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
    },

    updateRuntimeSlot: (workspaceId: string, slot: SlotState) => {
      set((s) => {
        const runtime = s.runtimes[workspaceId];
        if (!runtime) return;
        const idx = runtime.slots.findIndex((existing) => existing.id === slot.id);
        if (idx >= 0) {
          runtime.slots[idx] = slot as WritableDraft<SlotState>;
        }
        if (!runtime.terminalDisplayBySlotId[slot.id]) {
          runtime.terminalDisplayBySlotId[slot.id] = defaultTerminalDisplay();
        }
      });
    },

    addRuntimeSlot: (workspaceId: string, slot: SlotState) => {
      set((s) => {
        const runtime = s.runtimes[workspaceId];
        if (!runtime) return;

        const terminalPanel = isProjectRuntimeKey(workspaceId)
          ? terminalPanelContainsSlot(runtime.terminalPanel, slot.id)
            ? runtime.terminalPanel
            : addTerminalGroup(runtime.terminalPanel, slot.id, {
                activate: (runtime.terminalPanel?.groups.length ?? 0) === 0,
              })
          : runtime.terminalPanel;

        runtime.slots.push(slot as WritableDraft<SlotState>);
        runtime.terminalPanel = terminalPanel as WritableDraft<TerminalPanelState> | null;
        if (!runtime.terminalDisplayBySlotId[slot.id]) {
          runtime.terminalDisplayBySlotId[slot.id] = defaultTerminalDisplay();
        }
      });

      if (isProjectRuntimeKey(workspaceId)) {
        get().ensureProjectTerminalPanel(workspaceId);
      } else {
        get().ensureRuntimeLayout(workspaceId);
      }
    },

    removeRuntimeSlot: (workspaceId: string, slotID: string) => {
      set((s) => {
        const runtime = s.runtimes[workspaceId];
        if (!runtime) return;

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

        runtime.slots = runtime.slots.filter((sl) => sl.id !== slotID);
        delete runtime.terminalDisplayBySlotId[slotID];
        runtime.root = newRoot as WritableDraft<LayoutNode> | null;
        runtime.terminalPanel = terminalPanel as WritableDraft<TerminalPanelState> | null;
        runtime.focusedPaneID = focusedPaneID;
      });
    },

    updateRuntimeSession: (workspaceId: string, session: SessionState) => {
      set((s) => {
        const runtime = s.runtimes[workspaceId];
        if (!runtime) return;
        const idx = runtime.sessions.findIndex((existing) => existing.id === session.id);
        if (idx >= 0) {
          runtime.sessions[idx] = session as WritableDraft<SessionState>;
        }
      });

      if (isProjectRuntimeKey(workspaceId) && session.kind === "terminal" && session.status === "crashed") {
        get().closeProjectTerminal(workspaceId, session.slotID);
      }
    },

    addRuntimeSession: (workspaceId: string, session: SessionState) => {
      set((s) => {
        const runtime = s.runtimes[workspaceId];
        if (!runtime) return;
        runtime.sessions.push(session as WritableDraft<SessionState>);
      });
    },

    removeRuntimeSession: (workspaceId: string, sessionID: string) => {
      set((s) => {
        const runtime = s.runtimes[workspaceId];
        if (!runtime) return;
        runtime.sessions = runtime.sessions.filter((ses) => ses.id !== sessionID);
      });
    },

    ensureRuntimeLayout: (workspaceId: string) => {
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

      set((s) => {
        const rt = s.runtimes[workspaceId];
        if (!rt) return;
        rt.root = root as WritableDraft<LayoutNode> | null;
        rt.focusedPaneID = runtime.focusedPaneID ?? (root?.type === "leaf" ? root.id : null);
      });
    },

    ensureProjectTerminalPanel: (workspaceId: string) => {
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
        const rt = s.runtimes[workspaceId];
        if (!rt) return;
        rt.terminalPanel = terminalPanel as WritableDraft<TerminalPanelState>;
      });
    },

    loadPersistedLayout: async (workspaceId: string) => {
      try {
        const raw = await invoke<unknown>("load_workspace_layout", { workspaceId });
        const layout = raw != null ? migratePersistedLayout(raw) : null;

        set((s) => {
          const runtime = s.runtimes[workspaceId];
          if (!runtime) return;

          const normalizedLayout =
            layout && runtime.slots.length > 0
              ? sanitizeWorkspaceTerminalLayout(
                  layout.root,
                  layout.focusedPaneID,
                  new Set(runtime.slots.map((slot) => slot.id))
                )
              : layout;

          runtime.layoutLoading = false;
          if (normalizedLayout) {
            runtime.root = normalizedLayout.root as WritableDraft<LayoutNode> | null;
            runtime.focusedPaneID = normalizedLayout.focusedPaneID;
          }
        });

        if (!layout) {
          get().ensureRuntimeLayout(workspaceId);
        }
      } catch {
        set((s) => {
          const runtime = s.runtimes[workspaceId];
          if (!runtime) return;
          runtime.layoutLoading = false;
        });
        get().ensureRuntimeLayout(workspaceId);
      }
    },
  };
}
