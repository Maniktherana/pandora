import type {
  AgentActivityState,
  LayoutNode,
  SessionState,
  TerminalAgentStatus,
} from "@/lib/shared/types";
import { findLeaf, getAllLeaves } from "@/components/layout/workspace/layout-tree";

type ScopeAgentActivityContext = {
  workspaceId: string;
  sessions: SessionState[];
  terminalAgentStatusBySlotId: Record<string, TerminalAgentStatus>;
  root: LayoutNode | null;
  focusedPaneID: string | null;
};

/** Minimal shape needed to read per-slot agent status across all slots. */
type SlotStatusReadable = {
  slots: Array<{ id: string }>;
  terminalAgentStatusBySlotId?: Record<string, TerminalAgentStatus> | null;
};

/** Minimal mutable shape needed to update a single slot's agent status. */
type SlotStatusMutable = {
  terminalAgentStatusBySlotId: Record<string, TerminalAgentStatus>;
};

/** Minimal shape needed for layout-aware operations (focused terminal detection). */
type LayoutAwareMutable = SlotStatusMutable & {
  root: LayoutNode | null;
  focusedPaneID: string | null;
};

/** Minimal shape needed to rebuild agent statuses from sessions. */
type SessionStatusMutable = LayoutAwareMutable & {
  workspaceId: string;
  sessions: SessionState[];
};

const STATUS_PRIORITY: Record<TerminalAgentStatus, number> = {
  idle: 0,
  review: 1,
  working: 2,
  permission: 3,
};

export function terminalAgentStatusPriority(status: TerminalAgentStatus) {
  return STATUS_PRIORITY[status];
}

export function highestTerminalAgentStatus(
  statuses: Iterable<TerminalAgentStatus | null | undefined>,
): TerminalAgentStatus {
  let highest: TerminalAgentStatus = "idle";
  for (const status of statuses) {
    if (!status) continue;
    if (terminalAgentStatusPriority(status) > terminalAgentStatusPriority(highest)) {
      highest = status;
    }
  }
  return highest;
}

export function workspaceTerminalAgentStatus(
  scope: SlotStatusReadable | null,
): TerminalAgentStatus {
  if (!scope) return "idle";
  return highestTerminalAgentStatus(
    scope.slots.map((slot) => scope.terminalAgentStatusBySlotId?.[slot.id] ?? "idle"),
  );
}

export function isTerminalAgentAttentionStatus(status: TerminalAgentStatus | null | undefined) {
  return status === "permission" || status === "review";
}

export function shouldHighlightWorkspaceForTerminalAgent(options: {
  isSelected: boolean;
  status: TerminalAgentStatus | null | undefined;
}) {
  return !options.isSelected && isTerminalAgentAttentionStatus(options.status);
}

export function acknowledgedTerminalAgentStatus(
  status: TerminalAgentStatus | null | undefined,
): TerminalAgentStatus {
  return status === "review" ? "idle" : (status ?? "idle");
}

function selectedTerminalSlotId(root: LayoutNode | null, focusedPaneID: string | null) {
  if (!root || !focusedPaneID) return null;
  const leaf = findLeaf(root, focusedPaneID);
  const selected = leaf?.tabs[leaf.selectedIndex];
  return selected?.kind === "terminal" ? selected.slotId : null;
}

export function isTerminalSlotSelected(
  state: { root: LayoutNode | null; focusedPaneID: string | null },
  slotId: string,
) {
  return selectedTerminalSlotId(state.root, state.focusedPaneID) === slotId;
}

export function isTerminalSlotVisibleInSelectedLeaf(
  state: { root: LayoutNode | null; focusedPaneID: string | null },
  slotId: string,
) {
  if (!state.root || !state.focusedPaneID) return false;
  return getAllLeaves(state.root).some((leaf) => {
    if (leaf.id !== state.focusedPaneID) return false;
    const selected = leaf.tabs[leaf.selectedIndex];
    return selected?.kind === "terminal" && selected.slotId === slotId;
  });
}

export function hasAgentActivityChanged(
  previous: AgentActivityState | null | undefined,
  next: AgentActivityState | null | undefined,
) {
  return (
    (previous?.updatedAt ?? null) !== (next?.updatedAt ?? null) ||
    (previous?.phase ?? null) !== (next?.phase ?? null) ||
    (previous?.vendor ?? null) !== (next?.vendor ?? null)
  );
}

export function terminalAgentStatusForActivity(
  activity: AgentActivityState,
  options: { isSelectedTerminal: boolean },
): TerminalAgentStatus {
  switch (activity.phase) {
    case "working":
      return "working";
    case "waiting_approval":
      return "permission";
    case "finished":
    case "waiting_input":
      return options.isSelectedTerminal ? "idle" : "review";
    case "idle":
    default:
      return "idle";
  }
}

export function applySessionAgentActivityStatus(
  runtime: SessionStatusMutable,
  session: SessionState,
  options: { selectedWorkspaceId: string | null },
) {
  runtime.terminalAgentStatusBySlotId ??= {};
  const activity = session.agentActivity;
  if (!activity) {
    clearEphemeralTerminalAgentStatus(runtime, session.slotID);
    return;
  }

  runtime.terminalAgentStatusBySlotId[session.slotID] = terminalAgentStatusForActivity(activity, {
    isSelectedTerminal:
      runtime.workspaceId === options.selectedWorkspaceId &&
      isTerminalSlotSelected(runtime, session.slotID),
  });
}

export function rebuildTerminalAgentStatuses(
  state: SessionStatusMutable,
  options: { selectedWorkspaceId: string | null },
) {
  state.terminalAgentStatusBySlotId ??= {};
  for (const session of state.sessions) {
    applySessionAgentActivityStatus(state, session, options);
  }
}

export function clearEphemeralTerminalAgentStatus(runtime: SlotStatusMutable, slotId: string) {
  const current = runtime.terminalAgentStatusBySlotId?.[slotId] ?? "idle";
  if (current === "working" || current === "permission") {
    runtime.terminalAgentStatusBySlotId[slotId] = "idle";
  }
}

export function acknowledgeTerminalAgentStatus(runtime: SlotStatusMutable, slotId: string) {
  runtime.terminalAgentStatusBySlotId[slotId] = acknowledgedTerminalAgentStatus(
    runtime.terminalAgentStatusBySlotId?.[slotId],
  );
}

export function acknowledgeSelectedTerminalAgentStatus(runtime: LayoutAwareMutable) {
  const slotId = selectedTerminalSlotId(runtime.root, runtime.focusedPaneID);
  if (slotId) {
    acknowledgeTerminalAgentStatus(runtime, slotId);
  }
}

export function sessionAgentActivity(
  state: { sessions: SessionState[] },
  session: SessionState,
) {
  return state.sessions.find((candidate) => candidate.id === session.id)?.agentActivity ?? null;
}

export function previousSessionAgentActivity(
  sessions: SessionState[],
  session: SessionState,
): AgentActivityState | null {
  return sessions.find((s) => s.id === session.id)?.agentActivity ?? null;
}

export function applySessionAgentActivityStatusToMap(
  scope: ScopeAgentActivityContext,
  session: SessionState,
  options: { selectedWorkspaceId: string | null },
): void {
  const activity = session.agentActivity;
  if (!activity) {
    const current = scope.terminalAgentStatusBySlotId[session.slotID] ?? "idle";
    if (current === "working" || current === "permission") {
      scope.terminalAgentStatusBySlotId[session.slotID] = "idle";
    }
    return;
  }
  const isSelectedTerminal =
    scope.workspaceId === options.selectedWorkspaceId &&
    selectedTerminalSlotId(scope.root, scope.focusedPaneID) === session.slotID;
  scope.terminalAgentStatusBySlotId[session.slotID] = terminalAgentStatusForActivity(activity, {
    isSelectedTerminal,
  });
}

export function rebuildTerminalAgentStatusesFromScope(
  scope: ScopeAgentActivityContext,
  options: { selectedWorkspaceId: string | null },
): Record<string, TerminalAgentStatus> {
  const statusMap: Record<string, TerminalAgentStatus> = { ...scope.terminalAgentStatusBySlotId };
  const mutable: ScopeAgentActivityContext = { ...scope, terminalAgentStatusBySlotId: statusMap };
  for (const session of scope.sessions) {
    applySessionAgentActivityStatusToMap(mutable, session, options);
  }
  return statusMap;
}
