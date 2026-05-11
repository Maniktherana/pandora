//! Wire types shared with the renderer.
//!
//! These structs define the Tauri IPC contract between the renderer and the
//! in-process domain registries. Treat field names and tag values as a public
//! boundary: the renderer sends `IpcCommand`s through `scope_send`, and Rust
//! emits `ScopeEventEnvelope`s through the `runtime-event` channel.
//!
//! Notes on serde tagging:
//!   * `IpcCommand` and `ScopeEvent` are externally tagged with `type`,
//!     producing `{ "type": "input", ... }` payloads.
//!   * Field renames keep `slotID`, `sessionDefIDs`, `agentSessionID` style
//!     (uppercase ID), since serde's stock camelCase would lower the D in ID.

use crate::models::{
    PresentationMode, RestartPolicy, SessionDefinition, SessionKind, SlotDefinition, SlotKind,
};
use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Status enums.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionStatus {
    Stopped,
    Running,
    Crashed,
    Restarting,
    Paused,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AggregateStatus {
    Stopped,
    Running,
    Crashed,
    Restarting,
}

// ---------------------------------------------------------------------------
// State carriers.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ActionCapabilities {
    pub can_focus: bool,
    pub can_pause: bool,
    pub can_resume: bool,
    pub can_clear: bool,
    pub can_stop: bool,
    pub can_restart: bool,
}

/// Per-instance runtime state for an open session. Populated as the PTY
/// lifecycle progresses; serialized as part of `SessionState` (which also
/// embeds the definition fields).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionInstance {
    pub id: String,
    #[serde(rename = "sessionDefID")]
    pub session_def_id: String,
    #[serde(rename = "slotID")]
    pub slot_id: String,
    pub status: SessionStatus,
    pub pid: Option<i64>,
    pub exit_code: Option<i64>,
    pub started_at: Option<String>,
    pub last_output_at: Option<String>,
    /// Set by the PTY layer when the foreground process group changes
    /// (e.g. user typed `npm test`). Polled at 1 Hz via `tcgetpgrp` +
    /// `libproc` name resolution. `null` when no child process has taken
    /// the foreground group — UI falls back to the session name.
    pub pty_foreground_process: Option<String>,
}

/// Wire shape emitted in snapshots: a `SessionInstance` plus the relevant
/// definition fields (kind, name, port) and the per-state action
/// capabilities map.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionState {
    #[serde(flatten)]
    pub instance: SessionInstance,
    pub kind: SessionKind,
    pub name: String,
    pub port: Option<i64>,
    pub capabilities: ActionCapabilities,
}

/// Slot-level snapshot: definition fields + an `aggregateStatus`, the IDs of
/// open sessions for that slot, and the aggregate capability vector.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SlotState {
    #[serde(flatten)]
    pub definition: SlotDefinition,
    pub aggregate_status: AggregateStatus,
    #[serde(rename = "sessionIDs")]
    pub session_ids: Vec<String>,
    pub capabilities: ActionCapabilities,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DetectedPort {
    pub port: i64,
    pub pid: i64,
    pub process_name: String,
    #[serde(rename = "sessionID")]
    pub session_id: String,
    pub address: String,
    /// Unix epoch milliseconds.
    pub detected_at: i64,
}

// ---------------------------------------------------------------------------
// File-tree state carriers.
// ---------------------------------------------------------------------------

/// `path` is workspace-relative, forward-slash separated, no leading slash —
/// the renderer uses it as a stable identity key across IPC.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileTreeEntry {
    pub path: String,
    pub name: String,
    pub is_directory: bool,
    pub is_ignored: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileTreeSnapshot {
    pub root_path: String,
    pub paths: Vec<String>,
    pub directory_paths: Vec<String>,
    pub expanded_paths: Vec<String>,
}

// ---------------------------------------------------------------------------
// SCM state carriers.
// ---------------------------------------------------------------------------

/// Wire-safe copy of `git::ScmStatusEntry` so the SCM domain stays inside
/// the runtime module without re-exporting crate-private git structs.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScmEntry {
    pub path: String,
    pub orig_path: Option<String>,
    pub staged_kind: Option<String>,
    pub worktree_kind: Option<String>,
    pub untracked: bool,
    pub line_stats: ScmLineStatsSummary,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScmLineStatsSummary {
    pub added: u64,
    pub removed: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScmSnapshot {
    pub branch: String,
    pub upstream: Option<String>,
    /// Commits ahead of upstream (0 when no upstream or no commits ahead).
    pub ahead: u64,
    /// Commits behind upstream (0 when no upstream or up to date).
    pub behind: u64,
    pub target_branch: Option<String>,
    /// Entries that have staged changes (index differs from HEAD).
    pub staged: Vec<ScmEntry>,
    /// Entries that have unstaged changes (worktree differs from index) or are
    /// untracked.
    pub unstaged: Vec<ScmEntry>,
    pub line_stats: ScmLineStatsSummary,
}

// ---------------------------------------------------------------------------
// Wire enums (renderer ⇄ runtime). Tag = "type" produces JSON like
// `{ "type": "input", … }`.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum IpcCommand {
    CreateSlot {
        slot: SlotDefinition,
    },
    UpdateSlot {
        slot: SlotDefinitionPatchWire,
    },
    RemoveSlot {
        #[serde(rename = "slotID")]
        slot_id: String,
    },
    CreateSessionDef {
        session: SessionDefinition,
    },
    UpdateSessionDef {
        session: SessionDefinitionPatchWire,
    },
    RemoveSessionDef {
        #[serde(rename = "sessionDefID")]
        session_def_id: String,
    },
    StartSlot {
        #[serde(rename = "slotID")]
        slot_id: String,
    },
    StopSlot {
        #[serde(rename = "slotID")]
        slot_id: String,
    },
    RestartSlot {
        #[serde(rename = "slotID")]
        slot_id: String,
    },
    PauseSlot {
        #[serde(rename = "slotID")]
        slot_id: String,
    },
    ResumeSlot {
        #[serde(rename = "slotID")]
        slot_id: String,
    },
    StartSession {
        #[serde(rename = "sessionID")]
        session_id: String,
    },
    StopSession {
        #[serde(rename = "sessionID")]
        session_id: String,
    },
    RestartSession {
        #[serde(rename = "sessionID")]
        session_id: String,
    },
    PauseSession {
        #[serde(rename = "sessionID")]
        session_id: String,
    },
    ResumeSession {
        #[serde(rename = "sessionID")]
        session_id: String,
    },
    OpenSessionInstance {
        #[serde(rename = "sessionDefID")]
        session_def_id: String,
    },
    CloseSessionInstance {
        #[serde(rename = "sessionID")]
        session_id: String,
    },
    Input {
        #[serde(rename = "sessionID")]
        session_id: String,
        data: String,
    },
    RequestSnapshot,
    Resize {
        #[serde(rename = "sessionID")]
        session_id: String,
        cols: u16,
        rows: u16,
    },
    // ---- File tree ------------------------------------------------------
    /// Initial subscription: seeds the expansion set and replies with a
    /// `FileTreeSnapshot`. Idempotent — safe to call after a renderer reload.
    FileTreeSubscribe {
        #[serde(default)]
        expanded_paths: Vec<String>,
    },
    FileTreeSetExpandedPaths {
        paths: Vec<String>,
    },
    /// Re-read one expanded directory; with no `path`, all of them.
    FileTreeRefresh {
        #[serde(default)]
        path: Option<String>,
    },
    FileTreeCreateFile {
        parent_relative_path: String,
        name: String,
        #[serde(default)]
        contents: String,
    },
    FileTreeCreateDirectory {
        relative_path: String,
    },
    FileTreeRename {
        source_relative_path: String,
        new_name: String,
    },
    FileTreeDelete {
        relative_path: String,
    },
    FileTreeMove {
        source_relative_path: String,
        dest_relative_path: String,
    },
    /// Copy within the workspace; collisions append " copy", " copy 2", …
    FileTreeCopy {
        source_relative_path: String,
        dest_relative_path: String,
    },
    /// Import absolute paths from outside the workspace (Finder drag,
    /// clipboard paste) into a workspace-relative directory.
    FileTreeImport {
        dest_relative_path: String,
        source_absolute_paths: Vec<String>,
    },
    FileTreeReadTextFile {
        #[serde(rename = "requestID")]
        request_id: String,
        relative_path: String,
    },
    FileTreeWriteTextFile {
        #[serde(rename = "requestID")]
        request_id: String,
        relative_path: String,
        contents: String,
    },

    // ---- SCM ---------------------------------------------------------------
    /// Initial subscription: replies with a `ScmSnapshot`.
    ScmSubscribe {
        target_branch: Option<String>,
    },
    ScmRefresh,
    ScmStage {
        paths: Vec<String>,
    },
    ScmStageAll,
    ScmUnstage {
        paths: Vec<String>,
    },
    ScmUnstageAll,
    ScmDiscardTracked {
        paths: Vec<String>,
    },
    ScmDiscardUntracked {
        paths: Vec<String>,
    },
    ScmCommit {
        message: String,
        #[serde(default)]
        push: bool,
    },
    ScmPush,
    ScmFetch,
    ScmPull,
    ScmSetTargetBranch {
        branch: Option<String>,
    },

    // ---- Editor IO ---------------------------------------------------------
    EditorReadTextFile {
        #[serde(rename = "requestID")]
        request_id: String,
        relative_path: String,
    },
    EditorWriteTextFile {
        #[serde(rename = "requestID")]
        request_id: String,
        relative_path: String,
        contents: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ScopeEvent {
    SlotSnapshot {
        slots: Vec<SlotState>,
    },
    SessionSnapshot {
        sessions: Vec<SessionState>,
    },
    SlotStateChanged {
        slot: SlotState,
    },
    SessionStateChanged {
        session: SessionState,
    },
    SlotAdded {
        slot: SlotState,
    },
    SlotRemoved {
        #[serde(rename = "slotID")]
        slot_id: String,
    },
    SessionOpened {
        session: SessionState,
    },
    SessionClosed {
        #[serde(rename = "sessionID")]
        session_id: String,
    },
    PortsSnapshot {
        ports: Vec<DetectedPort>,
    },

    // ---- File tree ------------------------------------------------------
    FileTreeSnapshot {
        snapshot: FileTreeSnapshot,
    },
    /// One directory's listing changed; replace cached entries for `path`.
    FileTreeDirectoryChanged {
        path: String,
        entries: Vec<FileTreeEntry>,
    },
    /// Reply to `FileTreeReadTextFile`. `contents` is `None` if missing.
    FileTreeFileRead {
        #[serde(rename = "requestID")]
        request_id: String,
        relative_path: String,
        contents: Option<String>,
    },
    FileTreeFileWritten {
        #[serde(rename = "requestID")]
        request_id: String,
        relative_path: String,
    },
    FileTreeError {
        #[serde(rename = "requestID", default, skip_serializing_if = "Option::is_none")]
        request_id: Option<String>,
        message: String,
    },

    // ---- SCM ---------------------------------------------------------------
    ScmSnapshot {
        snapshot: ScmSnapshot,
    },
    ScmRefreshing,
    ScmOperationStarted {
        #[serde(rename = "opId")]
        op_id: String,
    },
    ScmError {
        message: String,
    },

    // ---- Editor IO ---------------------------------------------------------
    /// Reply to `EditorReadTextFile`. `contents` is `None` if missing/binary.
    EditorFileRead {
        #[serde(rename = "requestID")]
        request_id: String,
        relative_path: String,
        contents: Option<String>,
    },
    EditorFileWritten {
        #[serde(rename = "requestID")]
        request_id: String,
        relative_path: String,
    },
    /// A file that was previously read/opened has changed on disk.
    EditorFileChanged {
        relative_path: String,
    },
    EditorError {
        #[serde(rename = "requestID", default, skip_serializing_if = "Option::is_none")]
        request_id: Option<String>,
        message: String,
    },

    Error {
        message: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScopeEventEnvelope {
    #[serde(rename = "runtimeId")]
    pub scope_id: String,
    #[serde(flatten)]
    pub event: ScopeEvent,
}

// ---------------------------------------------------------------------------
// Patch wire types.
//
// The renderer sends partial-update payloads (`Partial<SlotDefinition> &
// { id }` in TS terms). Rust serde can't model "any subset of fields"
// directly; making every field except `id` optional gets the same effect.
// Outer Option = "field present in patch", inner Option (for nullable
// fields) = "set to NULL".
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct SlotDefinitionPatchWire {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<SlotKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub autostart: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub presentation_mode: Option<PresentationMode>,
    #[serde(
        default,
        rename = "primarySessionDefID",
        skip_serializing_if = "Option::is_none"
    )]
    pub primary_session_def_id: Option<Option<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub persisted: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sort_order: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct SessionDefinitionPatchWire {
    pub id: String,
    #[serde(default, rename = "slotID", skip_serializing_if = "Option::is_none")]
    pub slot_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<SessionKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<Option<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub port: Option<Option<i64>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub env_overrides: Option<std::collections::BTreeMap<String, String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub restart_policy: Option<RestartPolicy>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pause_supported: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resume_supported: Option<bool>,
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

/// Per-status capability vector. Drives the per-row action buttons in
/// the UI (focus / pause / resume / clear / stop / restart).
pub fn capabilities_for(status: SessionStatus, def: &SessionDefinition) -> ActionCapabilities {
    use SessionStatus::*;
    ActionCapabilities {
        can_focus: matches!(status, Running | Paused),
        can_pause: def.pause_supported && matches!(status, Running),
        can_resume: def.resume_supported && matches!(status, Paused),
        can_clear: true,
        can_stop: matches!(status, Running | Paused | Restarting),
        can_restart: matches!(status, Running | Paused | Crashed | Stopped),
    }
}

/// Reduce a slot's per-session statuses to one aggregate.
pub fn aggregate_slot_status(states: &[SessionState]) -> AggregateStatus {
    if states
        .iter()
        .any(|s| s.instance.status == SessionStatus::Crashed)
    {
        return AggregateStatus::Crashed;
    }
    if states
        .iter()
        .any(|s| s.instance.status == SessionStatus::Restarting)
    {
        return AggregateStatus::Restarting;
    }
    if states.iter().any(|s| {
        matches!(
            s.instance.status,
            SessionStatus::Running | SessionStatus::Paused
        )
    }) {
        return AggregateStatus::Running;
    }
    AggregateStatus::Stopped
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn client_message_input_round_trips() {
        let raw = json!({
            "type": "input",
            "sessionID": "s-1",
            "data": "hello"
        });
        let msg: IpcCommand = serde_json::from_value(raw.clone()).unwrap();
        assert_eq!(
            msg,
            IpcCommand::Input {
                session_id: "s-1".to_string(),
                data: "hello".to_string(),
            }
        );
        assert_eq!(serde_json::to_value(&msg).unwrap(), raw);
    }

    #[test]
    fn client_message_resize_round_trips() {
        let raw = json!({"type":"resize","sessionID":"s","cols":80,"rows":24});
        let msg: IpcCommand = serde_json::from_value(raw.clone()).unwrap();
        assert!(matches!(msg, IpcCommand::Resize { .. }));
        assert_eq!(serde_json::to_value(&msg).unwrap(), raw);
    }

    #[test]
    fn client_message_request_snapshot_serializes_as_unit_variant() {
        let raw = json!({"type":"request_snapshot"});
        let msg: IpcCommand = serde_json::from_value(raw.clone()).unwrap();
        assert_eq!(msg, IpcCommand::RequestSnapshot);
        assert_eq!(serde_json::to_value(&msg).unwrap(), raw);
    }

    #[test]
    fn capabilities_match_status_truth_table() {
        let def = SessionDefinition {
            id: "s".into(),
            slot_id: "x".into(),
            kind: SessionKind::Process,
            name: "n".into(),
            command: "c".into(),
            cwd: None,
            port: None,
            env_overrides: Default::default(),
            restart_policy: RestartPolicy::Manual,
            pause_supported: true,
            resume_supported: true,
        };
        let running = capabilities_for(SessionStatus::Running, &def);
        assert!(running.can_focus && running.can_pause && running.can_stop && running.can_restart);
        assert!(!running.can_resume);

        let paused = capabilities_for(SessionStatus::Paused, &def);
        assert!(paused.can_resume && paused.can_focus && !paused.can_pause);

        let stopped = capabilities_for(SessionStatus::Stopped, &def);
        assert!(!stopped.can_focus && !stopped.can_pause && !stopped.can_stop);
        assert!(stopped.can_restart);
    }

    #[test]
    fn aggregate_status_priority_crashed_over_restarting_over_running() {
        fn st(status: SessionStatus) -> SessionState {
            SessionState {
                instance: SessionInstance {
                    id: "x".into(),
                    session_def_id: "x".into(),
                    slot_id: "x".into(),
                    status,
                    pid: None,
                    exit_code: None,
                    started_at: None,
                    last_output_at: None,
                    pty_foreground_process: None,
                },
                kind: SessionKind::Process,
                name: "n".into(),
                port: None,
                capabilities: ActionCapabilities {
                    can_focus: false,
                    can_pause: false,
                    can_resume: false,
                    can_clear: false,
                    can_stop: false,
                    can_restart: false,
                },
            }
        }
        assert_eq!(
            aggregate_slot_status(&[st(SessionStatus::Running), st(SessionStatus::Crashed)]),
            AggregateStatus::Crashed
        );
        assert_eq!(
            aggregate_slot_status(&[st(SessionStatus::Restarting), st(SessionStatus::Running)]),
            AggregateStatus::Restarting
        );
        assert_eq!(
            aggregate_slot_status(&[st(SessionStatus::Running), st(SessionStatus::Paused)]),
            AggregateStatus::Running
        );
        assert_eq!(
            aggregate_slot_status(&[st(SessionStatus::Stopped)]),
            AggregateStatus::Stopped
        );
        assert_eq!(aggregate_slot_status(&[]), AggregateStatus::Stopped);
    }
}
