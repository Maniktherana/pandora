import type {
  LayoutNode,
  PersistedWorkspaceLayout,
  SessionState,
  SlotState,
  WorkspaceRuntimeState,
} from "@/lib/shared/types";
import { isProjectRuntimeKey } from "@/lib/runtime/runtime-keys";
import {
  addTerminalTabToNode,
  createLeaf,
  findLeaf,
  getAllLeaves,
  getAllTerminalSlotIds,
  removeTerminalSlotFromTree,
} from "@/lib/layout/layout-tree";
import { defaultTerminalDisplay } from "@/lib/terminal/terminal-identity";
import {
  addTerminalGroup,
  createEmptyTerminalPanel,
  removeTerminalFromPanel,
  terminalPanelContainsSlot,
} from "@/lib/terminal/bottom-terminal-panel";

function createProjectTerminalPanelState(): WorkspaceRuntimeState["terminalPanel"] {
  return createEmptyTerminalPanel();
}

function reconcileProjectTerminalPanelState(
  panel: WorkspaceRuntimeState["terminalPanel"],
  slotIds: Iterable<string>
): WorkspaceRuntimeState["terminalPanel"] {
  const liveSlotIds = new Set(slotIds);
  let terminalPanel = panel ?? createEmptyTerminalPanel();

  for (const slotId of liveSlotIds) {
    if (!terminalPanelContainsSlot(terminalPanel, slotId)) {
      terminalPanel = addTerminalGroup(terminalPanel, slotId, {
        activate: terminalPanel.groups.length === 0,
      });
    }
  }

  for (const group of terminalPanel.groups) {
    for (const child of group.children) {
      if (!liveSlotIds.has(child)) {
        terminalPanel = removeTerminalFromPanel(terminalPanel, child);
      }
    }
  }

  return terminalPanel;
}

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

export function createWorkspaceRuntimeState(workspaceId: string): WorkspaceRuntimeState {
  return {
    workspaceId,
    slots: [],
    sessions: [],
    terminalDisplayBySlotId: {},
    connectionState: "disconnected",
    root: null,
    focusedPaneID: null,
    terminalPanel: isProjectRuntimeKey(workspaceId) ? createProjectTerminalPanelState() : null,
    layoutLoading: false,
    layoutLoaded: isProjectRuntimeKey(workspaceId),
  };
}

export function ensureRuntimeRecord(
  runtimes: Record<string, WorkspaceRuntimeState>,
  workspaceId: string
): WorkspaceRuntimeState {
  const existing = runtimes[workspaceId];
  if (existing) return existing;
  const created = createWorkspaceRuntimeState(workspaceId);
  runtimes[workspaceId] = created;
  return created;
}

export function setRuntimeConnectionState(
  runtime: WorkspaceRuntimeState,
  state: WorkspaceRuntimeState["connectionState"]
) {
  runtime.connectionState = state;
}

export function replaceRuntimeSlots(runtime: WorkspaceRuntimeState, slots: SlotState[]) {
  runtime.slots = slots;
  runtime.terminalDisplayBySlotId = Object.fromEntries(
    slots.map((slot) => [slot.id, runtime.terminalDisplayBySlotId[slot.id] ?? defaultTerminalDisplay()])
  );
}

export function replaceRuntimeSessions(runtime: WorkspaceRuntimeState, sessions: SessionState[]) {
  runtime.sessions = sessions;
}

export function updateRuntimeSlot(runtime: WorkspaceRuntimeState, slot: SlotState) {
  const idx = runtime.slots.findIndex((existing) => existing.id === slot.id);
  if (idx >= 0) {
    runtime.slots[idx] = slot;
  }
  if (!runtime.terminalDisplayBySlotId[slot.id]) {
    runtime.terminalDisplayBySlotId[slot.id] = defaultTerminalDisplay();
  }
}

export function addRuntimeSlot(runtime: WorkspaceRuntimeState, slot: SlotState) {
  runtime.slots.push(slot);
  if (!runtime.terminalDisplayBySlotId[slot.id]) {
    runtime.terminalDisplayBySlotId[slot.id] = defaultTerminalDisplay();
  }
  if (isProjectRuntimeKey(runtime.workspaceId)) {
    runtime.terminalPanel = reconcileProjectTerminalPanelState(
      runtime.terminalPanel,
      runtime.slots.map((entry) => entry.id)
    );
  }
}

export function removeRuntimeSlot(runtime: WorkspaceRuntimeState, slotID: string) {
  const newRoot =
    runtime.root
      ? removeTerminalSlotFromTree(runtime.root, slotID)
      : null;
  const leaves = newRoot ? getAllLeaves(newRoot) : [];
  const focusedPaneID =
    newRoot && runtime.focusedPaneID
      ? findLeaf(newRoot, runtime.focusedPaneID)
        ? runtime.focusedPaneID
        : (leaves[0]?.id ?? null)
      : runtime.focusedPaneID;

  runtime.slots = runtime.slots.filter((slot) => slot.id !== slotID);
  delete runtime.terminalDisplayBySlotId[slotID];
  runtime.root = newRoot;
  runtime.focusedPaneID = focusedPaneID;
  if (isProjectRuntimeKey(runtime.workspaceId)) {
    runtime.terminalPanel = reconcileProjectTerminalPanelState(
      runtime.terminalPanel,
      runtime.slots.filter((slot) => slot.id !== slotID).map((slot) => slot.id)
    );
  }
}

export function updateRuntimeSession(
  runtime: WorkspaceRuntimeState,
  session: SessionState
): { crashedTerminalSlotId: string | null } {
  const idx = runtime.sessions.findIndex((existing) => existing.id === session.id);
  if (idx >= 0) {
    runtime.sessions[idx] = session;
  }
  return {
    crashedTerminalSlotId:
      isProjectRuntimeKey(runtime.workspaceId) &&
      session.kind === "terminal" &&
      session.status === "crashed"
        ? session.slotID
        : null,
  };
}

export function addRuntimeSession(runtime: WorkspaceRuntimeState, session: SessionState) {
  runtime.sessions.push(session);
}

export function removeRuntimeSession(runtime: WorkspaceRuntimeState, sessionID: string) {
  runtime.sessions = runtime.sessions.filter((session) => session.id !== sessionID);
}

export function ensureRuntimeLayout(runtime: WorkspaceRuntimeState) {
  if (runtime.layoutLoading) return;
  if (isProjectRuntimeKey(runtime.workspaceId)) return;

  const existingSlotIDs = runtime.root
    ? new Set(getAllTerminalSlotIds(runtime.root))
    : new Set<string>();
  const newSlots = runtime.slots.filter((slot) => !existingSlotIDs.has(slot.id));
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

  runtime.root = root;
  runtime.focusedPaneID = runtime.focusedPaneID ?? (root?.type === "leaf" ? root.id : null);
}

export function ensureProjectTerminalPanel(runtime: WorkspaceRuntimeState) {
  if (!isProjectRuntimeKey(runtime.workspaceId)) return;
  runtime.terminalPanel = reconcileProjectTerminalPanelState(
    runtime.terminalPanel,
    runtime.slots.map((slot) => slot.id)
  );
}

export function applyPersistedWorkspaceLayout(
  runtime: WorkspaceRuntimeState,
  layout: PersistedWorkspaceLayout | null,
  liveSlotIds: Set<string>
) {
  const normalizedLayout =
    layout && liveSlotIds.size > 0
      ? sanitizeWorkspaceTerminalLayout(layout.root, layout.focusedPaneID, liveSlotIds)
      : null;

  runtime.layoutLoading = false;
  runtime.layoutLoaded = true;
  runtime.root = normalizedLayout?.root ?? layout?.root ?? null;
  runtime.focusedPaneID = normalizedLayout?.focusedPaneID ?? layout?.focusedPaneID ?? null;
}
