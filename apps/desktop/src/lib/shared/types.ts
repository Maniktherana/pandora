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

export interface SlotState {
  id: string;
  kind: SlotKind;
  name: string;
  autostart: boolean;
  presentationMode: PresentationMode;
  primarySessionDefID: string | null;
  sessionDefIDs: string[];
  persisted: boolean;
  sortOrder: number;
  aggregateStatus: AggregateStatus;
  sessionIDs: string[];
  capabilities: ActionCapabilities;
}

export interface SessionState {
  id: string;
  sessionDefID: string;
  slotID: string;
  kind: SessionKind;
  name: string;
  status: SessionStatus;
  pid: number | null;
  exitCode: number | null;
  port: number | null;
  startedAt: string | null;
  lastOutputAt: string | null;
  capabilities: ActionCapabilities;
}

export type ClientMessage =
  | { type: "create_slot"; slot: any }
  | { type: "update_slot"; slot: any }
  | { type: "remove_slot"; slotID: string }
  | { type: "create_session_def"; session: any }
  | { type: "update_session_def"; session: any }
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
  | { type: "slot_snapshot"; slots: SlotState[]; workspaceId?: string }
  | { type: "session_snapshot"; sessions: SessionState[]; workspaceId?: string }
  | { type: "slot_state_changed"; slot: SlotState; workspaceId?: string }
  | { type: "session_state_changed"; session: SessionState; workspaceId?: string }
  | { type: "slot_added"; slot: SlotState; workspaceId?: string }
  | { type: "slot_removed"; slotID: string; workspaceId?: string }
  | { type: "session_opened"; session: SessionState; workspaceId?: string }
  | { type: "session_closed"; sessionID: string; workspaceId?: string }
  | { type: "output_chunk"; sessionID: string; data: string; workspaceId?: string }
  | { type: "error"; message: string; workspaceId?: string };

export type WorkspaceStatus = "creating" | "ready" | "failed" | "deleting";

export type WorkspaceKind = "linked" | "worktree";

export interface ProjectRecord {
  id: string;
  displayPath: string;
  gitRootPath: string;
  gitContextSubpath: string | null;
  displayName: string;
  gitRemoteOwner: string | null;
  isExpanded: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceRecord {
  id: string;
  projectId: string;
  name: string;
  gitBranchName: string;
  gitWorktreeOwner: string;
  gitWorktreeSlug: string;
  worktreePath: string;
  workspaceContextSubpath: string | null;
  workspaceKind: WorkspaceKind;
  status: WorkspaceStatus;
  failureMessage: string | null;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
}

export type LayoutAxis = "horizontal" | "vertical";

export type DiffSource = "working" | "staged";

export type PaneTab =
  | { kind: "terminal"; slotId: string }
  | { kind: "editor"; path: string }
  | { kind: "diff"; path: string; source: DiffSource };

export interface LayoutLeaf {
  type: "leaf";
  id: string;
  tabs: PaneTab[];
  selectedIndex: number;
}

export interface LayoutSplit {
  type: "split";
  id: string;
  axis: LayoutAxis;
  children: LayoutNode[];
  ratios: number[];
}

export type LayoutNode = LayoutLeaf | LayoutSplit;

export interface PersistedWorkspaceLayout {
  root: LayoutNode;
  focusedPaneID: string | null;
}

export interface TerminalPanelGroup {
  id: string;
  children: string[];
}

export interface TerminalPanelState {
  groups: TerminalPanelGroup[];
  activeGroupIndex: number;
  activeSlotId: string | null;
  visible: boolean;
}

export interface AppState {
  projects: ProjectRecord[];
  workspaces: WorkspaceRecord[];
  selectedProjectId: string | null;
  selectedWorkspaceId: string | null;
}

export interface WorkspaceRuntimeState {
  workspaceId: string;
  slots: SlotState[];
  sessions: SessionState[];
  connectionState: "disconnected" | "connecting" | "connected";
  root: LayoutNode | null;
  focusedPaneID: string | null;
  terminalPanel: TerminalPanelState | null;
  layoutLoading: boolean;
}
