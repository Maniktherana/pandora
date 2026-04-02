import type { Socket } from "node:net";

export type SlotKind = "process_slot" | "agent_slot" | "terminal_slot";
export type SessionKind = "process" | "agent" | "terminal";
export type PresentationMode = "single" | "tabs" | "split";
export type SessionStatus = "stopped" | "running" | "crashed" | "restarting" | "paused";
export type AggregateStatus = "stopped" | "running" | "crashed" | "restarting";

export interface ActionCapabilities {
  canFocus: boolean;
  canPause: boolean;
  canResume: boolean;
  canClear: boolean;
  canStop: boolean;
  canRestart: boolean;
}

export interface SlotDefinition {
  id: string;
  kind: SlotKind;
  name: string;
  autostart: boolean;
  presentationMode: PresentationMode;
  primarySessionDefID: string | null;
  sessionDefIDs: string[];
  persisted: boolean;
  sortOrder: number;
}

export interface SessionDefinition {
  id: string;
  slotID: string;
  kind: SessionKind;
  name: string;
  command: string;
  cwd: string | null;
  port: number | null;
  envOverrides: Record<string, string>;
  restartPolicy: "manual" | "always";
  pauseSupported: boolean;
  resumeSupported: boolean;
}

export interface SessionInstance {
  id: string;
  sessionDefID: string;
  slotID: string;
  status: SessionStatus;
  pid: number | null;
  exitCode: number | null;
  startedAt: string | null;
  lastOutputAt: string | null;
  foregroundProcess: string | null;
}

export interface SlotState extends SlotDefinition {
  aggregateStatus: AggregateStatus;
  sessionIDs: string[];
  capabilities: ActionCapabilities;
}

export interface SessionState extends SessionInstance {
  kind: SessionKind;
  name: string;
  port: number | null;
  capabilities: ActionCapabilities;
}

export type ClientMessage =
  | {
      type: "create_slot";
      slot: SlotDefinition;
    }
  | { type: "update_slot"; slot: Partial<SlotDefinition> & { id: string } }
  | { type: "remove_slot"; slotID: string }
  | {
      type: "create_session_def";
      session: SessionDefinition;
    }
  | { type: "update_session_def"; session: Partial<SessionDefinition> & { id: string } }
  | { type: "remove_session_def"; sessionDefID: string }
  | { type: "start_slot"; slotID: string }
  | { type: "stop_slot"; slotID: string }
  | { type: "restart_slot"; slotID: string }
  | { type: "pause_slot"; slotID: string }
  | { type: "resume_slot"; slotID: string }
  | { type: "start_session"; sessionID: string }
  | { type: "stop_session"; sessionID: string }
  | { type: "restart_session"; sessionID: string }
  | { type: "pause_session"; sessionID: string }
  | { type: "resume_session"; sessionID: string }
  | { type: "open_session_instance"; sessionDefID: string }
  | { type: "close_session_instance"; sessionID: string }
  | { type: "input"; sessionID: string; data: string }
  | { type: "resize"; sessionID: string; cols: number; rows: number };

export type DaemonMessage =
  | { type: "slot_snapshot"; slots: SlotState[] }
  | { type: "session_snapshot"; sessions: SessionState[] }
  | { type: "slot_state_changed"; slot: SlotState }
  | { type: "session_state_changed"; session: SessionState }
  | { type: "slot_added"; slot: SlotState }
  | { type: "slot_removed"; slotID: string }
  | { type: "session_opened"; session: SessionState }
  | { type: "session_closed"; sessionID: string }
  | { type: "output_chunk"; sessionID: string; data: string }
  | { type: "error"; message: string };

export interface ConnectedClient {
  socket: Socket;
}
