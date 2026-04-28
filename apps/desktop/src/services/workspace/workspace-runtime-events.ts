import type { WritableDraft } from "immer";
import type { LayoutNode, SessionState, WorkspaceRuntimeState } from "@/lib/shared/types";
import { isProjectRuntimeKey } from "@/lib/runtime/runtime-keys";
import {
  sanitizeWorkspaceTerminalLayout,
  addRuntimeSession as addRuntimeSessionState,
  addRuntimeSlot as addRuntimeSlotState,
  ensureProjectTerminalPanel as ensureProjectTerminalPanelState,
  ensureRuntimeLayout as ensureRuntimeLayoutState,
  removeRuntimeSession as removeRuntimeSessionState,
  removeRuntimeSlot as removeRuntimeSlotState,
  replaceRuntimePorts,
  replaceRuntimeSessions,
  replaceRuntimeSlots,
  setRuntimeConnectionState as setRuntimeConnectionStateState,
  updateRuntimeSession as updateRuntimeSessionState,
  updateRuntimeSlot as updateRuntimeSlotState,
} from "@/services/workspace/workspace-runtime-model";
import {
  closeProjectTerminalInRuntime,
} from "@/services/terminal/project-terminal-panel-model";
import {
  acknowledgeSelectedTerminalAgentStatus,
  applySessionAgentActivityStatus,
  clearEphemeralTerminalAgentStatus,
  hasAgentActivityChanged,
  rebuildTerminalAgentStatuses,
  sessionAgentActivity,
} from "@/lib/terminal/agent-activity";
import type { RuntimeQueueEvent } from "@/services/runtime/runtime-event-queue";
import { runtimeGateway } from "@/services/runtime/runtime-gateway";
import { prLink } from "./workspace-api";

export interface WorkspaceRuntimeEventContext {
  mutateRuntimeState: <T>(
    runtimeId: string,
    mutate: (runtime: WritableDraft<WorkspaceRuntimeState>) => T,
  ) => T;
  getSelectedWorkspaceId: () => string | null;
  connectionWaiters: Map<string, Array<() => void>>;
  onConnectionStateChanged: (runtimeId: string, state: string) => void;
  onSlotAdded: (runtimeId: string) => void;
  getPrAwaitingWorkspaceIds: () => Set<string>;
  getWorkspaces: () => Array<{
    id: string;
    prUrl?: string | null;
    prNumber?: number | null;
    prState?: string | null;
  }>;
  onPrDetected: (workspaceId: string, prUrl: string, prNumber: number) => void;
  scheduleDesktopPublish: () => void;
}

function decodeOutputChunk(data: string): string {
  try {
    return atob(data);
  } catch {
    return data;
  }
}

function applyAgentActivityTransition(
  runtime: WritableDraft<WorkspaceRuntimeState>,
  session: SessionState,
  selectedWorkspaceId: string | null,
) {
  runtime.terminalAgentStatusBySlotId ??= {};
  const previous = sessionAgentActivity(runtime, session);
  const next = session.agentActivity;
  if (!hasAgentActivityChanged(previous, next)) return;
  applySessionAgentActivityStatus(runtime, session, { selectedWorkspaceId });
}

export function applyWorkspaceRuntimeEvent(
  event: RuntimeQueueEvent,
  ctx: WorkspaceRuntimeEventContext,
): Promise<void> | void {
  switch (event.type) {
    case "connection_state_changed":
      ctx.mutateRuntimeState(event.runtimeId, (runtime) => {
        setRuntimeConnectionStateState(runtime, event.state);
      });
      if (event.state === "connected") {
        const waiters = ctx.connectionWaiters.get(event.runtimeId);
        if (waiters?.length) {
          ctx.connectionWaiters.delete(event.runtimeId);
          waiters.forEach((fn) => fn());
        }
        runtimeGateway.getClient()?.requestSnapshot(event.runtimeId);
      }
      ctx.onConnectionStateChanged(event.runtimeId, event.state);
      break;

    case "slot_snapshot":
      ctx.mutateRuntimeState(event.runtimeId, (runtime) => {
        replaceRuntimeSlots(runtime, event.slots);
        if (isProjectRuntimeKey(event.runtimeId)) {
          ensureProjectTerminalPanelState(runtime);
        } else {
          const liveSlotIds = new Set(event.slots.map((slot) => slot.id));
          const layout = sanitizeWorkspaceTerminalLayout(
            runtime.root,
            runtime.focusedPaneID,
            liveSlotIds,
          );
          runtime.root = layout.root as WritableDraft<LayoutNode> | null;
          runtime.focusedPaneID = layout.focusedPaneID;
          ensureRuntimeLayoutState(runtime);
        }
      });
      ctx.onSlotAdded(event.runtimeId);
      break;

    case "session_snapshot":
      ctx.mutateRuntimeState(event.runtimeId, (runtime) => {
        replaceRuntimeSessions(runtime, event.sessions);
        rebuildTerminalAgentStatuses(runtime, {
          selectedWorkspaceId: ctx.getSelectedWorkspaceId(),
        });
      });
      break;

    case "ports_snapshot":
      ctx.mutateRuntimeState(event.runtimeId, (runtime) => {
        replaceRuntimePorts(runtime, event.ports);
      });
      break;

    case "slot_state_changed":
      ctx.mutateRuntimeState(event.runtimeId, (runtime) => {
        updateRuntimeSlotState(runtime, event.slot);
      });
      break;

    case "session_state_changed": {
      const crashedTerminalSlotId = ctx.mutateRuntimeState(event.runtimeId, (runtime) => {
        applyAgentActivityTransition(
          runtime,
          event.session,
          ctx.getSelectedWorkspaceId(),
        );
        return updateRuntimeSessionState(runtime, event.session).crashedTerminalSlotId;
      });
      if (crashedTerminalSlotId) {
        ctx.mutateRuntimeState(event.runtimeId, (runtime) => {
          closeProjectTerminalInRuntime(runtime, crashedTerminalSlotId);
        });
      }
      break;
    }

    case "slot_added":
      ctx.mutateRuntimeState(event.runtimeId, (runtime) => {
        addRuntimeSlotState(runtime, event.slot);
        if (isProjectRuntimeKey(event.runtimeId)) {
          ensureProjectTerminalPanelState(runtime);
        } else {
          ensureRuntimeLayoutState(runtime);
        }
      });
      ctx.onSlotAdded(event.runtimeId);
      break;

    case "slot_removed":
      ctx.mutateRuntimeState(event.runtimeId, (runtime) => {
        removeRuntimeSlotState(runtime, event.slotID);
      });
      break;

    case "session_opened":
      ctx.mutateRuntimeState(event.runtimeId, (runtime) => {
        addRuntimeSessionState(runtime, event.session);
      });
      break;

    case "session_closed":
      ctx.mutateRuntimeState(event.runtimeId, (runtime) => {
        const session = runtime.sessions.find(
          (candidate) => candidate.id === event.sessionID,
        );
        if (session) clearEphemeralTerminalAgentStatus(runtime, session.slotID);
        removeRuntimeSessionState(runtime, event.sessionID);
      });
      break;

    case "output_chunk": {
      const prAwaitingIds = ctx.getPrAwaitingWorkspaceIds();
      if (!prAwaitingIds.has(event.runtimeId)) break;
      const data = decodeOutputChunk(event.data);
      const match = data.match(/https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/(\d+)/);
      if (!match) break;
      const prUrl = match[0];
      const prNumber = parseInt(match[1], 10);
      ctx.onPrDetected(event.runtimeId, prUrl, prNumber);
      void prLink(event.runtimeId, prUrl, prNumber);
      break;
    }

    case "error":
      console.error(`Runtime error [${event.runtimeId}]:`, event.message);
      break;

    default:
      break;
  }
}

export function isWorkspaceRuntimeAcknowledgeEvent(
  event: RuntimeQueueEvent,
): event is Extract<RuntimeQueueEvent, { type: "connection_state_changed" }> & {
  state: "connected";
} {
  return event.type === "connection_state_changed" && event.state === "connected";
}

export function applySelectedWorkspaceAcknowledge(
  workspaceId: string,
  mutateRuntimeState: <T>(
    runtimeId: string,
    fn: (r: WritableDraft<WorkspaceRuntimeState>) => T,
  ) => T,
) {
  mutateRuntimeState(workspaceId, (runtime) => {
    acknowledgeSelectedTerminalAgentStatus(runtime);
  });
}
