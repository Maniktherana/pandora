export type SlotKind = "process_slot" | "agent_slot" | "terminal_slot";
export type SessionKind = "process" | "agent" | "terminal";
export type PresentationMode = "single" | "tabs" | "split";
export type SessionStatus = "stopped" | "running" | "crashed" | "restarting" | "paused";
export type AggregateStatus = "stopped" | "running" | "crashed" | "restarting";
export type AgentVendor =
  | "claude-code"
  | "codex"
  | "opencode"
  | "gemini"
  | "cursor-agent"
  | "github-copilot"
  | "amp-code";
export type AgentPhase = "idle" | "working" | "waiting_input" | "waiting_approval" | "finished";
export type TerminalAgentStatus = "idle" | "working" | "permission" | "review";

export interface ActionCapabilities {
  canFocus: boolean;
  canPause: boolean;
  canResume: boolean;
  canClear: boolean;
  canStop: boolean;
  canRestart: boolean;
}

export interface AgentActivityState {
  vendor: AgentVendor;
  phase: AgentPhase;
  agentSessionID: string | null;
  updatedAt: string;
  message: string | null;
  title: string | null;
  toolName: string | null;
}

export type TerminalDisplayKind = "terminal" | "process";

export interface TerminalDisplayState {
  kind: TerminalDisplayKind;
  label: string;
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
  foregroundProcess: string | null;
  ptyForegroundProcess: string | null;
  agentActivity: AgentActivityState | null;
  capabilities: ActionCapabilities;
}

// ---------------------------------------------------------------------------
// File-tree types
// ---------------------------------------------------------------------------

export interface FileTreeEntry {
  path: string;
  name: string;
  isDirectory: boolean;
  isIgnored: boolean;
}

export interface FileTreeSnapshot {
  rootPath: string;
  directories: Record<string, FileTreeEntry[]>;
  expandedPaths: string[];
}

// ---------------------------------------------------------------------------
// SCM types
// ---------------------------------------------------------------------------

export interface ScmEntry {
  path: string;
  origPath: string | null;
  stagedKind: string | null;
  worktreeKind: string | null;
  untracked: boolean;
  lineStats: ScmLineStats;
}

export interface ScmLineStats {
  added: number;
  removed: number;
}

export interface ScmSnapshot {
  branch: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  targetBranch: string | null;
  staged: ScmEntry[];
  unstaged: ScmEntry[];
  lineStats: ScmLineStats;
}

// ---------------------------------------------------------------------------
// Runtime commands
// ---------------------------------------------------------------------------

export type RuntimeCommand =
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
  | { type: "request_snapshot" }
  | { type: "resize"; sessionID: string; cols: number; rows: number }
  | { type: "agent_cli_signal"; signal: any }
  // File tree
  | { type: "file_tree_subscribe"; expanded_paths?: string[] }
  | { type: "file_tree_set_expanded_paths"; paths: string[] }
  | { type: "file_tree_refresh"; path?: string }
  | { type: "file_tree_create_file"; parent_relative_path: string; name: string; contents?: string }
  | { type: "file_tree_create_directory"; relative_path: string }
  | { type: "file_tree_rename"; source_relative_path: string; new_name: string }
  | { type: "file_tree_delete"; relative_path: string }
  | { type: "file_tree_move"; source_relative_path: string; dest_relative_path: string }
  | { type: "file_tree_copy"; source_relative_path: string; dest_relative_path: string }
  | { type: "file_tree_import"; dest_relative_path: string; source_absolute_paths: string[] }
  | { type: "file_tree_read_text_file"; requestID: string; relative_path: string }
  | { type: "file_tree_write_text_file"; requestID: string; relative_path: string; contents: string }
  // SCM
  | { type: "scm_subscribe"; target_branch?: string | null }
  | { type: "scm_refresh" }
  | { type: "scm_stage"; paths: string[] }
  | { type: "scm_stage_all" }
  | { type: "scm_unstage"; paths: string[] }
  | { type: "scm_unstage_all" }
  | { type: "scm_discard_tracked"; paths: string[] }
  | { type: "scm_discard_untracked"; paths: string[] }
  | { type: "scm_commit"; message: string; push?: boolean }
  | { type: "scm_push" }
  | { type: "scm_fetch" }
  | { type: "scm_pull" }
  | { type: "scm_set_target_branch"; branch: string | null }
  // Editor IO
  | { type: "editor_read_text_file"; requestID: string; relative_path: string }
  | { type: "editor_write_text_file"; requestID: string; relative_path: string; contents: string };

// ---------------------------------------------------------------------------
// Runtime events
// ---------------------------------------------------------------------------

export type RuntimeEvent =
  | { type: "slot_snapshot"; slots: SlotState[] }
  | { type: "session_snapshot"; sessions: SessionState[] }
  | { type: "slot_state_changed"; slot: SlotState }
  | { type: "session_state_changed"; session: SessionState }
  | { type: "slot_added"; slot: SlotState }
  | { type: "slot_removed"; slotID: string }
  | { type: "session_opened"; session: SessionState }
  | { type: "session_closed"; sessionID: string }
  | { type: "ports_snapshot"; ports: DetectedPort[] }
  | { type: "output_chunk"; sessionID: string; data: string }
  | { type: "error"; message: string }
  // File tree
  | { type: "file_tree_snapshot"; snapshot: FileTreeSnapshot }
  | { type: "file_tree_directory_changed"; path: string; entries: FileTreeEntry[] }
  | { type: "file_tree_file_read"; requestID: string; relative_path: string; contents: string | null }
  | { type: "file_tree_file_written"; requestID: string; relative_path: string }
  | { type: "file_tree_error"; requestID?: string; message: string }
  // SCM
  | { type: "scm_snapshot"; snapshot: ScmSnapshot }
  | { type: "scm_refreshing" }
  | { type: "scm_operation_started"; opId: string }
  | { type: "scm_error"; message: string }
  // Editor IO
  | { type: "editor_file_read"; requestID: string; relative_path: string; contents: string | null }
  | { type: "editor_file_written"; requestID: string; relative_path: string }
  | { type: "editor_file_changed"; relative_path: string }
  | { type: "editor_error"; requestID?: string; message: string };

export type RuntimeEventEnvelope = RuntimeEvent & {
  runtimeId: string;
};

export type RuntimeConnectionState = "connected" | "error";

export interface RuntimeConnectionEvent {
  runtimeId: string;
  state: RuntimeConnectionState;
}

export interface DetectedPort {
  port: number;
  pid: number;
  processName: string;
  sessionID: string;
  address: string;
  detectedAt: number;
}

export type WorkspaceStatus = "creating" | "ready" | "failed" | "deleting" | "archived";

export type PrState = "open" | "merged" | "closed";

export interface PrContext {
  branchName: string;
  baseBranch: string;
  commitLog: string;
  diffStat: string;
  isDefaultBranch: boolean;
  hasCommits: boolean;
}

export interface HeaderBranchContext {
  owner: string | null;
  currentBranch: string;
  defaultTargetBranch: string;
  availableBranches: string[];
}

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
  prUrl: string | null;
  prNumber: number | null;
  prState: PrState | null;
  deletingAt: string | null;
  createdByPandora: boolean;
  targetBranch: string | null;
}

export interface ProjectSettings {
  projectId: string;
  defaultBranch: string;
  worktreeRoot: string | null;
  setupScripts: string[];
  runScripts: Array<{ name: string; command: string }>;
  teardownScripts: string[];
  envVars: Record<string, string>;
  autoRunSetup: boolean;
}

export type LayoutAxis = "horizontal" | "vertical";

export type DiffSource = "working" | "staged" | "branch";

export type PaneTab =
  | { kind: "terminal"; slotId: string }
  | { kind: "editor"; path: string }
  | { kind: "diff"; path: string; source: DiffSource }
  | { kind: "review" };

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
  detectedPorts: DetectedPort[];
  terminalDisplayBySlotId: Record<string, TerminalDisplayState>;
  terminalAgentStatusBySlotId: Record<string, TerminalAgentStatus>;
  connectionState: "disconnected" | "connecting" | "connected";
  root: LayoutNode | null;
  focusedPaneID: string | null;
  terminalPanel: TerminalPanelState | null;
  layoutLoading: boolean;
  /** True once the persisted layout attempt has settled, even if the result is empty. */
  layoutLoaded: boolean;
}
