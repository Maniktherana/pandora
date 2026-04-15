import type {
  AgentActivityState,
  LayoutNode,
  SessionState,
  TerminalAgentStatus,
  WorkspaceRuntimeState,
} from "@/lib/shared/types";
import { findLeaf, getAllLeaves } from "@/components/layout/workspace/layout-tree";

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
  runtime: WorkspaceRuntimeState | null,
): TerminalAgentStatus {
  if (!runtime) return "idle";
  return highestTerminalAgentStatus(
    runtime.slots.map((slot) => runtime.terminalAgentStatusBySlotId?.[slot.id] ?? "idle"),
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

export function isTerminalSlotSelected(runtime: WorkspaceRuntimeState, slotId: string) {
  return selectedTerminalSlotId(runtime.root, runtime.focusedPaneID) === slotId;
}

export function isTerminalSlotVisibleInSelectedLeaf(
  runtime: WorkspaceRuntimeState,
  slotId: string,
) {
  if (!runtime.root || !runtime.focusedPaneID) return false;
  return getAllLeaves(runtime.root).some((leaf) => {
    if (leaf.id !== runtime.focusedPaneID) return false;
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
  runtime: WorkspaceRuntimeState,
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
  runtime: WorkspaceRuntimeState,
  options: { selectedWorkspaceId: string | null },
) {
  runtime.terminalAgentStatusBySlotId ??= {};
  for (const session of runtime.sessions) {
    applySessionAgentActivityStatus(runtime, session, options);
  }
}

export function clearEphemeralTerminalAgentStatus(runtime: WorkspaceRuntimeState, slotId: string) {
  const current = runtime.terminalAgentStatusBySlotId?.[slotId] ?? "idle";
  if (current === "working" || current === "permission") {
    runtime.terminalAgentStatusBySlotId[slotId] = "idle";
  }
}

export function acknowledgeTerminalAgentStatus(runtime: WorkspaceRuntimeState, slotId: string) {
  runtime.terminalAgentStatusBySlotId[slotId] = acknowledgedTerminalAgentStatus(
    runtime.terminalAgentStatusBySlotId?.[slotId],
  );
}

export function acknowledgeSelectedTerminalAgentStatus(runtime: WorkspaceRuntimeState) {
  const slotId = selectedTerminalSlotId(runtime.root, runtime.focusedPaneID);
  if (slotId) {
    acknowledgeTerminalAgentStatus(runtime, slotId);
  }
}

export function sessionAgentActivity(runtime: WorkspaceRuntimeState, session: SessionState) {
  return runtime.sessions.find((candidate) => candidate.id === session.id)?.agentActivity ?? null;
}
