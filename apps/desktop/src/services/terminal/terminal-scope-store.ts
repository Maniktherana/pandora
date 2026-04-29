import { create } from "zustand";

import type {
  DetectedPort,
  SessionState,
  SlotState,
  TerminalAgentStatus,
  TerminalDisplayState,
  TerminalPanelState,
} from "@/lib/shared/types";
import { defaultTerminalDisplay } from "@/lib/terminal/terminal-identity";
import { workspaceTerminalAgentStatus } from "@/lib/terminal/agent-activity";

export type TerminalScopeId = string;

export interface TerminalScopeState {
  slots: SlotState[];
  sessions: SessionState[];
  detectedPorts: DetectedPort[];
  terminalDisplayBySlotId: Record<string, TerminalDisplayState>;
  terminalAgentStatusBySlotId: Record<string, TerminalAgentStatus>;
  terminalPanel: TerminalPanelState | null;
}

interface TerminalScopeStoreState {
  byScopeId: Record<string, TerminalScopeState>;
  replaceSlots: (scopeId: string, slots: SlotState[]) => void;
  replaceSessions: (scopeId: string, sessions: SessionState[]) => void;
  updateSession: (scopeId: string, session: SessionState) => void;
  replacePorts: (scopeId: string, ports: DetectedPort[]) => void;
  setTerminalDisplay: (scopeId: string, slotId: string, display: TerminalDisplayState) => void;
  setAgentStatus: (scopeId: string, slotId: string, status: TerminalAgentStatus) => void;
  setAgentStatuses: (scopeId: string, statuses: Record<string, TerminalAgentStatus>) => void;
  setTerminalPanel: (scopeId: string, panel: TerminalPanelState | null) => void;
  removeScope: (scopeId: string) => void;
}

function emptyTerminalScopeState(): TerminalScopeState {
  return {
    slots: [],
    sessions: [],
    detectedPorts: [],
    terminalDisplayBySlotId: {},
    terminalAgentStatusBySlotId: {},
    terminalPanel: null,
  };
}

export const useTerminalScopeStore = create<TerminalScopeStoreState>((set) => ({
  byScopeId: {},
  replaceSlots: (scopeId, slots) =>
    set((s) => {
      const prev = s.byScopeId[scopeId] ?? emptyTerminalScopeState();
      const slotIds = new Set(slots.map((sl) => sl.id));
      const terminalDisplayBySlotId: Record<string, TerminalDisplayState> = {};
      const terminalAgentStatusBySlotId: Record<string, TerminalAgentStatus> = {};
      for (const id of slotIds) {
        terminalDisplayBySlotId[id] =
          prev.terminalDisplayBySlotId[id] ?? defaultTerminalDisplay();
        terminalAgentStatusBySlotId[id] = prev.terminalAgentStatusBySlotId[id] ?? "idle";
      }
      return {
        byScopeId: {
          ...s.byScopeId,
          [scopeId]: {
            ...prev,
            slots,
            terminalDisplayBySlotId,
            terminalAgentStatusBySlotId,
          },
        },
      };
    }),
  replaceSessions: (scopeId, sessions) =>
    set((s) => {
      const prev = s.byScopeId[scopeId] ?? emptyTerminalScopeState();
      return {
        byScopeId: {
          ...s.byScopeId,
          [scopeId]: { ...prev, sessions },
        },
      };
    }),
  updateSession: (scopeId, session) =>
    set((s) => {
      const prev = s.byScopeId[scopeId] ?? emptyTerminalScopeState();
      const idx = prev.sessions.findIndex((x) => x.id === session.id);
      if (idx === -1) {
        return s;
      }
      const nextSessions = [...prev.sessions];
      nextSessions[idx] = session;
      return {
        byScopeId: {
          ...s.byScopeId,
          [scopeId]: { ...prev, sessions: nextSessions },
        },
      };
    }),
  replacePorts: (scopeId, ports) =>
    set((s) => {
      const prev = s.byScopeId[scopeId] ?? emptyTerminalScopeState();
      return {
        byScopeId: {
          ...s.byScopeId,
          [scopeId]: { ...prev, detectedPorts: ports },
        },
      };
    }),
  setTerminalDisplay: (scopeId, slotId, display) =>
    set((s) => {
      const prev = s.byScopeId[scopeId] ?? emptyTerminalScopeState();
      return {
        byScopeId: {
          ...s.byScopeId,
          [scopeId]: {
            ...prev,
            terminalDisplayBySlotId: {
              ...prev.terminalDisplayBySlotId,
              [slotId]: display,
            },
          },
        },
      };
    }),
  setAgentStatus: (scopeId, slotId, status) =>
    set((s) => {
      const prev = s.byScopeId[scopeId] ?? emptyTerminalScopeState();
      return {
        byScopeId: {
          ...s.byScopeId,
          [scopeId]: {
            ...prev,
            terminalAgentStatusBySlotId: {
              ...prev.terminalAgentStatusBySlotId,
              [slotId]: status,
            },
          },
        },
      };
    }),
  setAgentStatuses: (scopeId, statuses) =>
    set((s) => {
      const prev = s.byScopeId[scopeId] ?? emptyTerminalScopeState();
      return {
        byScopeId: {
          ...s.byScopeId,
          [scopeId]: {
            ...prev,
            terminalAgentStatusBySlotId: {
              ...prev.terminalAgentStatusBySlotId,
              ...statuses,
            },
          },
        },
      };
    }),
  setTerminalPanel: (scopeId, panel) =>
    set((s) => {
      const prev = s.byScopeId[scopeId] ?? emptyTerminalScopeState();
      return {
        byScopeId: {
          ...s.byScopeId,
          [scopeId]: { ...prev, terminalPanel: panel },
        },
      };
    }),
  removeScope: (scopeId) =>
    set((s) => {
      const { [scopeId]: _removed, ...rest } = s.byScopeId;
      return { byScopeId: rest };
    }),
}));

export function useWorkspaceAgentStatus(workspaceId: string): TerminalAgentStatus {
  return useTerminalScopeStore((s) =>
    workspaceTerminalAgentStatus(s.byScopeId[workspaceId] ?? null),
  );
}
