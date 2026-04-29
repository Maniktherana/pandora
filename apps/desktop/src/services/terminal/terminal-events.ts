import {
  addTerminalTabToNode,
  createLeaf,
  getAllTerminalSlotIds,
} from "@/components/layout/workspace/layout-tree";
import {
  hasAgentActivityChanged,
  previousSessionAgentActivity,
  applySessionAgentActivityStatusToMap,
} from "@/lib/terminal/agent-activity";
import { removeTerminalFromPanel } from "@/lib/terminal/bottom-terminal-panel";
import { isProjectRuntimeKey } from "@/lib/runtime/runtime-keys";
import type { TerminalAgentStatus } from "@/lib/shared/types";
import type { IpcQueueEvent } from "@/services/ipc/ipc-event-queue";
import { reconcileProjectTerminalPanelState } from "@/services/terminal/project-terminal-panel-model";
import { useTerminalScopeStore } from "@/services/terminal/terminal-scope-store";
import { useLayoutStore } from "@/services/workspace/layout-store";
import { removeTerminalSlotFromWorkspaceLayout } from "@/services/workspace/workspace-layout-model";

export interface TerminalEventHandlerContext {
  getSelectedWorkspaceId: () => string | null;
  onSlotAdded: (scopeId: string) => void;
  onScopeUpdated?: (scopeId: string) => void;
  onPrDetected: (workspaceId: string, prUrl: string, prNumber: number) => void;
  getPrAwaitingWorkspaceIds: () => Set<string>;
}

function decodeOutputChunk(data: string): string {
  try {
    return atob(data);
  } catch {
    return data;
  }
}

function ensureLayoutSlotsForNewTerminals(workspaceId: string) {
  const layoutState = useLayoutStore.getState();
  const layout = layoutState.byWorkspaceId[workspaceId];
  if (layout?.layoutLoading) return;
  const scope = useTerminalScopeStore.getState().byScopeId[workspaceId];
  if (!scope) return;

  const existingSlotIDs = layout?.root
    ? new Set(getAllTerminalSlotIds(layout.root))
    : new Set<string>();
  const newSlots = scope.slots.filter((slot) => !existingSlotIDs.has(slot.id));
  if (newSlots.length === 0) return;

  let root = layout?.root ?? null;
  let focusedPaneID = layout?.focusedPaneID ?? null;
  for (const slot of newSlots) {
    const leaf = createLeaf([{ kind: "terminal", slotId: slot.id }]);
    if (!root) {
      root = leaf;
    } else if (focusedPaneID) {
      root = addTerminalTabToNode(root, focusedPaneID, slot.id);
    } else {
      root = leaf;
    }
  }
  focusedPaneID = focusedPaneID ?? (root?.type === "leaf" ? root.id : null);
  useLayoutStore.getState().setLayout(workspaceId, { root, focusedPaneID });
}

export function applyTerminalRuntimeEvent(
  event: IpcQueueEvent,
  ctx: TerminalEventHandlerContext,
): void {
  switch (event.type) {
    case "slot_snapshot": {
      useTerminalScopeStore.getState().replaceSlots(event.scopeId, event.slots);
      if (isProjectRuntimeKey(event.scopeId)) {
        const scope = useTerminalScopeStore.getState().byScopeId[event.scopeId];
        const panel = reconcileProjectTerminalPanelState(
          scope?.terminalPanel,
          event.slots.map((s) => s.id),
        );
        useTerminalScopeStore.getState().setTerminalPanel(event.scopeId, panel);
      } else {
        const layout = useLayoutStore.getState().byWorkspaceId[event.scopeId];
        if (layout?.root) {
          const liveSlotIds = new Set(event.slots.map((slot) => slot.id));
          const deadSlotIds = getAllTerminalSlotIds(layout.root).filter(
            (id) => !liveSlotIds.has(id),
          );
          for (const deadSlotId of deadSlotIds) {
            removeTerminalSlotFromWorkspaceLayout(event.scopeId, deadSlotId);
          }
        }
        ensureLayoutSlotsForNewTerminals(event.scopeId);
      }
      ctx.onSlotAdded(event.scopeId);
      ctx.onScopeUpdated?.(event.scopeId);
      break;
    }

    case "slot_state_changed": {
      const scopeState = useTerminalScopeStore.getState().byScopeId[event.scopeId];
      const slots = (scopeState?.slots ?? []).map((s) =>
        s.id === event.slot.id ? event.slot : s,
      );
      useTerminalScopeStore.getState().replaceSlots(event.scopeId, slots);
      ctx.onScopeUpdated?.(event.scopeId);
      break;
    }

    case "slot_added": {
      const scopeStateBefore = useTerminalScopeStore.getState().byScopeId[event.scopeId];
      const slots = [...(scopeStateBefore?.slots ?? []), event.slot];
      useTerminalScopeStore.getState().replaceSlots(event.scopeId, slots);
      if (isProjectRuntimeKey(event.scopeId)) {
        const scope = useTerminalScopeStore.getState().byScopeId[event.scopeId];
        const panel = reconcileProjectTerminalPanelState(
          scope?.terminalPanel,
          scope?.slots.map((s) => s.id) ?? [],
        );
        useTerminalScopeStore.getState().setTerminalPanel(event.scopeId, panel);
      } else {
        ensureLayoutSlotsForNewTerminals(event.scopeId);
      }
      ctx.onSlotAdded(event.scopeId);
      ctx.onScopeUpdated?.(event.scopeId);
      break;
    }

    case "slot_removed": {
      const scopeStateBeforeRemove = useTerminalScopeStore.getState().byScopeId[event.scopeId];
      const slotsAfterRemove = (scopeStateBeforeRemove?.slots ?? []).filter(
        (s) => s.id !== event.slotID,
      );
      useTerminalScopeStore.getState().replaceSlots(event.scopeId, slotsAfterRemove);
      if (!isProjectRuntimeKey(event.scopeId)) {
        removeTerminalSlotFromWorkspaceLayout(event.scopeId, event.slotID);
      }
      ctx.onScopeUpdated?.(event.scopeId);
      break;
    }

    case "session_snapshot": {
      useTerminalScopeStore.getState().replaceSessions(event.scopeId, event.sessions);
      const scope = useTerminalScopeStore.getState().byScopeId[event.scopeId];
      if (!scope) break;
      const layout = useLayoutStore.getState().byWorkspaceId[event.scopeId];
      const statusMap: Record<string, TerminalAgentStatus> = {
        ...scope.terminalAgentStatusBySlotId,
      };
      const agentCtx = {
        workspaceId: event.scopeId,
        sessions: scope.sessions,
        terminalAgentStatusBySlotId: statusMap,
        root: layout?.root ?? null,
        focusedPaneID: layout?.focusedPaneID ?? null,
      };
      for (const session of scope.sessions) {
        applySessionAgentActivityStatusToMap(agentCtx, session, {
          selectedWorkspaceId: ctx.getSelectedWorkspaceId(),
        });
      }
      useTerminalScopeStore.getState().setAgentStatuses(event.scopeId, statusMap);
      ctx.onScopeUpdated?.(event.scopeId);
      break;
    }

    case "ports_snapshot": {
      useTerminalScopeStore.getState().replacePorts(event.scopeId, event.ports);
      break;
    }

    case "session_opened": {
      const scopeStateForOpen = useTerminalScopeStore.getState().byScopeId[event.scopeId];
      const sessionsAfterOpen = [...(scopeStateForOpen?.sessions ?? []), event.session];
      useTerminalScopeStore.getState().replaceSessions(event.scopeId, sessionsAfterOpen);
      ctx.onScopeUpdated?.(event.scopeId);
      break;
    }

    case "session_closed": {
      const scopeStateForClose = useTerminalScopeStore.getState().byScopeId[event.scopeId];
      const closedSession = scopeStateForClose?.sessions.find((s) => s.id === event.sessionID);
      if (closedSession) {
        const currentStatus =
          scopeStateForClose?.terminalAgentStatusBySlotId?.[closedSession.slotID] ?? "idle";
        if (currentStatus === "working" || currentStatus === "permission") {
          useTerminalScopeStore
            .getState()
            .setAgentStatus(event.scopeId, closedSession.slotID, "idle");
        }
      }
      const sessionsAfterClose = (scopeStateForClose?.sessions ?? []).filter(
        (s) => s.id !== event.sessionID,
      );
      useTerminalScopeStore.getState().replaceSessions(event.scopeId, sessionsAfterClose);
      ctx.onScopeUpdated?.(event.scopeId);
      break;
    }

    case "session_state_changed": {
      const scopeStore = useTerminalScopeStore.getState();
      const scope = scopeStore.byScopeId[event.scopeId];
      const layout = useLayoutStore.getState().byWorkspaceId[event.scopeId];

      const previousSessions = scope?.sessions ?? [];
      const previous = previousSessionAgentActivity(previousSessions, event.session);
      const next = event.session.agentActivity;

      const statusMap: Record<string, TerminalAgentStatus> = {
        ...(scope?.terminalAgentStatusBySlotId ?? {}),
      };

      if (hasAgentActivityChanged(previous, next)) {
        applySessionAgentActivityStatusToMap(
          {
            workspaceId: event.scopeId,
            sessions: previousSessions,
            terminalAgentStatusBySlotId: statusMap,
            root: layout?.root ?? null,
            focusedPaneID: layout?.focusedPaneID ?? null,
          },
          event.session,
          { selectedWorkspaceId: ctx.getSelectedWorkspaceId() },
        );
      }

      scopeStore.updateSession(event.scopeId, event.session);
      scopeStore.setAgentStatuses(event.scopeId, statusMap);

      const crashedTerminalSlotId =
        isProjectRuntimeKey(event.scopeId) &&
        event.session.kind === "terminal" &&
        event.session.status === "crashed"
          ? event.session.slotID
          : null;

      if (crashedTerminalSlotId) {
        const after = useTerminalScopeStore.getState().byScopeId[event.scopeId];
        if (after?.terminalPanel) {
          useTerminalScopeStore
            .getState()
            .setTerminalPanel(
              event.scopeId,
              removeTerminalFromPanel(after.terminalPanel, crashedTerminalSlotId),
            );
        }
      }
      ctx.onScopeUpdated?.(event.scopeId);
      break;
    }

    case "output_chunk": {
      const prAwaitingIds = ctx.getPrAwaitingWorkspaceIds();
      if (!prAwaitingIds.has(event.scopeId)) break;
      const data = decodeOutputChunk(event.data);
      const match = data.match(/https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/(\d+)/);
      if (!match) break;
      const prUrl = match[0];
      const prNumber = parseInt(match[1], 10);
      ctx.onPrDetected(event.scopeId, prUrl, prNumber);
      break;
    }

    case "error": {
      console.error(`Scope error [${event.scopeId}]:`, event.message);
      break;
    }

    default:
      break;
  }
}
