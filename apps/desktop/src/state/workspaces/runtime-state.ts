import type {
  DetectedPort,
  LayoutNode,
  PersistedWorkspaceLayout,
  SessionState,
  SlotState,
  WorkspaceRuntimeState,
} from "@/lib/shared/types";
import { isProjectRuntimeKey } from "@/lib/runtime/runtime-keys";
import {
  createProjectTerminalPanelState,
  reconcileProjectTerminalPanelState,
} from "./project-terminal-panel-state";
import {
  addTerminalTabToNode,
  createLeaf,
  findLeaf,
  getAllLeaves,
  getAllTerminalSlotIds,
  removeTerminalSlotFromTree,
} from "@/components/layout/workspace/layout-tree";
import { defaultTerminalDisplay } from "@/lib/terminal/terminal-identity";

export function sanitizeWorkspaceTerminalLayout(
  root: LayoutNode | null,
  focusedPaneID: string | null,
  liveSlotIds: Set<string>,
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
    detectedPorts: [],
    terminalDisplayBySlotId: {},
    terminalAgentStatusBySlotId: {},
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
  workspaceId: string,
): WorkspaceRuntimeState {
  const existing = runtimes[workspaceId];
  if (existing) return existing;
  const created = createWorkspaceRuntimeState(workspaceId);
  runtimes[workspaceId] = created;
  return created;
}

export function setRuntimeConnectionState(
  runtime: WorkspaceRuntimeState,
  state: WorkspaceRuntimeState["connectionState"],
) {
  runtime.connectionState = state;
}

export function replaceRuntimeSlots(runtime: WorkspaceRuntimeState, slots: SlotState[]) {
  runtime.terminalAgentStatusBySlotId ??= {};
  runtime.slots = slots;
  const previousDisplayBySlotId = runtime.terminalDisplayBySlotId;
  const previousAgentStatusBySlotId = runtime.terminalAgentStatusBySlotId;
  let nextDisplayBySlotId = previousDisplayBySlotId;
  let nextAgentStatusBySlotId = previousAgentStatusBySlotId;
  const liveSlotIds = new Set(slots.map((slot) => slot.id));

  for (const slot of slots) {
    if (nextDisplayBySlotId[slot.id]) continue;
    if (nextDisplayBySlotId === previousDisplayBySlotId) {
      nextDisplayBySlotId = { ...previousDisplayBySlotId };
    }
    nextDisplayBySlotId[slot.id] = defaultTerminalDisplay();
  }

  for (const slot of slots) {
    if (nextAgentStatusBySlotId[slot.id]) continue;
    if (nextAgentStatusBySlotId === previousAgentStatusBySlotId) {
      nextAgentStatusBySlotId = { ...previousAgentStatusBySlotId };
    }
    nextAgentStatusBySlotId[slot.id] = "idle";
  }

  for (const slotId of Object.keys(previousDisplayBySlotId)) {
    if (liveSlotIds.has(slotId)) continue;
    if (nextDisplayBySlotId === previousDisplayBySlotId) {
      nextDisplayBySlotId = { ...previousDisplayBySlotId };
    }
    delete nextDisplayBySlotId[slotId];
  }

  for (const slotId of Object.keys(previousAgentStatusBySlotId)) {
    if (liveSlotIds.has(slotId)) continue;
    if (nextAgentStatusBySlotId === previousAgentStatusBySlotId) {
      nextAgentStatusBySlotId = { ...previousAgentStatusBySlotId };
    }
    delete nextAgentStatusBySlotId[slotId];
  }

  runtime.terminalDisplayBySlotId = nextDisplayBySlotId;
  runtime.terminalAgentStatusBySlotId = nextAgentStatusBySlotId;
}

export function replaceRuntimeSessions(runtime: WorkspaceRuntimeState, sessions: SessionState[]) {
  runtime.sessions = sessions;
}

export function replaceRuntimePorts(runtime: WorkspaceRuntimeState, ports: DetectedPort[]) {
  runtime.detectedPorts = ports;
}

export function updateRuntimeSlot(runtime: WorkspaceRuntimeState, slot: SlotState) {
  runtime.terminalAgentStatusBySlotId ??= {};
  const idx = runtime.slots.findIndex((existing) => existing.id === slot.id);
  if (idx >= 0) {
    runtime.slots[idx] = slot;
  }
  if (!runtime.terminalDisplayBySlotId[slot.id]) {
    runtime.terminalDisplayBySlotId[slot.id] = defaultTerminalDisplay();
  }
  runtime.terminalAgentStatusBySlotId[slot.id] ??= "idle";
}

export function addRuntimeSlot(runtime: WorkspaceRuntimeState, slot: SlotState) {
  runtime.terminalAgentStatusBySlotId ??= {};
  runtime.slots.push(slot);
  if (!runtime.terminalDisplayBySlotId[slot.id]) {
    runtime.terminalDisplayBySlotId[slot.id] = defaultTerminalDisplay();
  }
  runtime.terminalAgentStatusBySlotId[slot.id] ??= "idle";
  if (isProjectRuntimeKey(runtime.workspaceId)) {
    runtime.terminalPanel = reconcileProjectTerminalPanelState(
      runtime.terminalPanel,
      runtime.slots.map((entry) => entry.id),
    );
  }
}

export function removeRuntimeSlot(runtime: WorkspaceRuntimeState, slotID: string) {
  const newRoot = runtime.root ? removeTerminalSlotFromTree(runtime.root, slotID) : null;
  const leaves = newRoot ? getAllLeaves(newRoot) : [];
  const focusedPaneID =
    newRoot && runtime.focusedPaneID
      ? findLeaf(newRoot, runtime.focusedPaneID)
        ? runtime.focusedPaneID
        : (leaves[0]?.id ?? null)
      : runtime.focusedPaneID;

  runtime.slots = runtime.slots.filter((slot) => slot.id !== slotID);
  delete runtime.terminalDisplayBySlotId[slotID];
  delete runtime.terminalAgentStatusBySlotId[slotID];
  runtime.root = newRoot;
  runtime.focusedPaneID = focusedPaneID;
  if (isProjectRuntimeKey(runtime.workspaceId)) {
    runtime.terminalPanel = reconcileProjectTerminalPanelState(
      runtime.terminalPanel,
      runtime.slots.filter((slot) => slot.id !== slotID).map((slot) => slot.id),
    );
  }
}

export function updateRuntimeSession(
  runtime: WorkspaceRuntimeState,
  session: SessionState,
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
    runtime.slots.map((slot) => slot.id),
  );
}

export function applyPersistedWorkspaceLayout(
  runtime: WorkspaceRuntimeState,
  layout: PersistedWorkspaceLayout | null,
  liveSlotIds: Set<string>,
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
