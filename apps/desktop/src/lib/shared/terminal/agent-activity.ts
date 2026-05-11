import type { LayoutNode, TerminalAgentStatus } from "@/lib/shared/shared.types";
import { findLeaf } from "@/lib/shared/utils";

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
