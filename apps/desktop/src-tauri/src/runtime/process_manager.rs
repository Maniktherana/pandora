//! Session lifecycle, restart policy, pause/resume, output coalescing.
//!
//! One in-process `Pty` per session, one tokio task per session owning its
//! output stream and feeding it through the configured `RuntimeEmitter`.
//!
//! State model
//! -----------
//! Two layers of definitions are kept in memory:
//!   * `slot_definitions` — UI grouping (a slot can hold multiple sessions
//!     in tab/split presentation modes). Definitions are mutable; the only
//!     thing they own at runtime is sort_order / autostart / presentation.
//!   * `session_definitions` — what to spawn (command, cwd, env, restart
//!     policy). Updates fan out to every live `ManagedSession` for that
//!     definition so capability vectors stay in sync.
//!   * `sessions` — one per *open* session instance, keyed by an instance
//!     UUID generated in `open_session_instance`. Multiple instances of the
//!     same definition can be open at once (used by Cursor-style tab splits).
//!
//! Output batching
//! ---------------
//! Three flush triggers — 4 ms timer / 64 KB byte threshold / 256 KB
//! ring-buffer drop policy. Implemented in the per-session reader task.
//! Pause/resume buffers locally rather than calling into the kernel because
//! portable-pty doesn't expose a `pause()` on the reader handle.
//!
//! Restart policy
//! --------------
//! `RestartPolicy::Always` re-spawns crashed sessions with exponential
//! backoff capped at 30 s (1s × 2^crashCount). The crashCount resets to 0
//! once the new spawn produces a fresh PID. `Manual` and `Once` policies
//! require a user `restart` action.

use bytes::{Bytes, BytesMut};
use chrono::Utc;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, Mutex};
use tokio::task::JoinHandle;
use uuid::Uuid;

use crate::models::{RestartPolicy, SessionDefinition, SlotDefinition};

use super::port_manager::PortManager;
use super::pty::{Pty, PtySpawnSpec};
use super::types::{
    aggregate_slot_status, capabilities_for, ActionCapabilities, AgentCliSignal, AgentPhase,
    DetectedPort, SessionInstance, SessionState, SessionStatus, SlotState,
};

/// Output batching constants. Tuned for terminal smoothness at 240 Hz.
const OUTPUT_BUFFER_MAX: usize = 256 * 1024;
const BATCH_INTERVAL: Duration = Duration::from_millis(4);
const BATCH_MAX_BYTES: usize = 64 * 1024;

/// SIGTERM → SIGKILL escalation timeout for `stop_session`.
const STOP_ESCALATION: Duration = Duration::from_secs(5);
/// Faster escalation for `restart_session` (the user explicitly asked).
const RESTART_ESCALATION: Duration = Duration::from_millis(500);

/// Default initial PTY size. Resized as soon as the renderer attaches with
/// real dimensions.
const DEFAULT_COLS: u16 = 120;
const DEFAULT_ROWS: u16 = 40;

// ---------------------------------------------------------------------------
// Output emitter trait — keeps process_manager testable without pulling in a
// Tauri AppHandle. The runtime layer wraps this with a Tauri-event impl;
// tests use a Vec-collecting impl.
// ---------------------------------------------------------------------------

#[async_trait::async_trait]
pub trait RuntimeEmitter: Send + Sync {
    async fn session_state_changed(&self, state: SessionState);
    async fn output_chunk(&self, session_id: &str, data: Bytes);
    async fn ports_changed(&self, ports: Vec<DetectedPort>);
    /// Bulk snapshot — used on first connect and on renderer-driven
    /// rehydration (RequestSnapshot). Default no-op so test impls don't
    /// have to care.
    async fn slot_snapshot(&self, _slots: Vec<SlotState>) {}
    async fn session_snapshot(&self, _sessions: Vec<SessionState>) {}
}

// ---------------------------------------------------------------------------
// Internal session record. One per open instance.
// ---------------------------------------------------------------------------

struct ManagedSession {
    definition: SessionDefinition,
    instance: SessionInstance,
    pty: Option<Arc<Pty>>,
    /// Reader/batcher task handle. Aborted on close / before respawn.
    reader_task: Option<JoinHandle<()>>,
    /// Set while a SIGTERM → SIGKILL timer is armed.
    escalation_task: Option<JoinHandle<()>>,
    /// Restart-policy backoff task.
    restart_task: Option<JoinHandle<()>>,
    output_paused: bool,
    crash_count: u32,
    /// Set true on the first exit-handling pass so spurious double-fires
    /// (e.g. exit + dropped reader) become no-ops.
    exit_handled: bool,
}

impl ManagedSession {
    fn new(definition: SessionDefinition) -> Self {
        let id = Uuid::new_v4().to_string();
        let slot_id = definition.slot_id.clone();
        let session_def_id = definition.id.clone();
        Self {
            definition,
            instance: SessionInstance {
                id,
                session_def_id,
                slot_id,
                status: SessionStatus::Stopped,
                pid: None,
                exit_code: None,
                started_at: None,
                last_output_at: None,
                foreground_process: None,
                pty_foreground_process: None,
                agent_activity: None,
            },
            pty: None,
            reader_task: None,
            escalation_task: None,
            restart_task: None,
            output_paused: false,
            crash_count: 0,
            exit_handled: false,
        }
    }
}

// ---------------------------------------------------------------------------
// ProcessManager — public API used by daemon_bridge::dispatch and the
// surface-registry / agent-CLI hot paths.
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct ProcessManager {
    inner: Arc<Mutex<Inner>>,
    emitter: Arc<dyn RuntimeEmitter>,
    port_manager: PortManager,
    /// `_port_join` keeps the PortManager scan loop alive for the lifetime
    /// of the ProcessManager. Dropped with us.
    _port_join: Arc<JoinHandle<()>>,
    /// Single shared 1 Hz poller that walks all live sessions to detect
    /// foreground process group changes via `tcgetpgrp` + `pidpath`.
    _fg_poll_join: Arc<JoinHandle<()>>,
    /// Process-wide cwd used when a session definition leaves `cwd` empty.
    default_cwd: String,
    runtime_id: String,
}

struct Inner {
    slot_definitions: HashMap<String, SlotDefinition>,
    session_definitions: HashMap<String, SessionDefinition>,
    sessions: HashMap<String, ManagedSession>,
    outputs_paused: bool,
}

impl ProcessManager {
    pub fn new(
        slot_definitions: Vec<SlotDefinition>,
        session_definitions: Vec<SessionDefinition>,
        emitter: Arc<dyn RuntimeEmitter>,
        default_cwd: String,
        runtime_id: String,
    ) -> Self {
        let (port_manager, mut ports_rx, port_join) = PortManager::spawn();
        let emit_for_ports = Arc::clone(&emitter);
        // Bridge port-change events into the emitter without coupling
        // PortManager directly to RuntimeEmitter (it's reusable from anything
        // that wants per-session listening-port awareness).
        tokio::spawn(async move {
            while let Some(ports) = ports_rx.recv().await {
                emit_for_ports.ports_changed(ports).await;
            }
        });

        let mut slots = HashMap::with_capacity(slot_definitions.len());
        for slot in slot_definitions {
            slots.insert(slot.id.clone(), slot);
        }
        let mut defs = HashMap::with_capacity(session_definitions.len());
        for d in session_definitions {
            defs.insert(d.id.clone(), d);
        }

        let inner = Arc::new(Mutex::new(Inner {
            slot_definitions: slots,
            session_definitions: defs,
            sessions: HashMap::new(),
            outputs_paused: false,
        }));

        let fg_poll_handle = Self::start_fg_poll(Arc::clone(&inner), Arc::clone(&emitter));

        Self {
            inner,
            emitter,
            port_manager,
            _port_join: Arc::new(port_join),
            _fg_poll_join: Arc::new(fg_poll_handle),
            default_cwd,
            runtime_id,
        }
    }

    // ---- snapshots --------------------------------------------------------

    pub async fn list_session_states(&self) -> Vec<SessionState> {
        let inner = self.inner.lock().await;
        inner
            .sessions
            .values()
            .map(session_state_of)
            .collect()
    }

    pub async fn list_slot_states(&self) -> Vec<SlotState> {
        let inner = self.inner.lock().await;
        inner
            .slot_definitions
            .values()
            .map(|slot| slot_state_of(slot, &inner.session_definitions, &inner.sessions))
            .collect()
    }

    pub async fn list_detected_ports(&self) -> Vec<DetectedPort> {
        self.port_manager.list_ports().await
    }

    /// Push the full set of slot/session/port state through the runtime's
    /// emitter. Used on first connect and to satisfy renderer-side
    /// `RequestSnapshot` rehydration after a reload.
    pub async fn emit_snapshots(&self) {
        let slots = self.list_slot_states().await;
        let sessions = self.list_session_states().await;
        let ports = self.list_detected_ports().await;
        self.emitter.slot_snapshot(slots).await;
        self.emitter.session_snapshot(sessions).await;
        self.emitter.ports_changed(ports).await;
    }

    // ---- definition CRUD --------------------------------------------------

    pub async fn register_slot(&self, slot: SlotDefinition) {
        let mut inner = self.inner.lock().await;
        let mut slot = slot;
        slot.session_def_ids.clear();
        inner.slot_definitions.insert(slot.id.clone(), slot);
    }

    pub async fn update_slot_definition(&self, patch: SlotDefinitionMutation) {
        let mut inner = self.inner.lock().await;
        let Some(existing) = inner.slot_definitions.get_mut(&patch.id) else {
            return;
        };
        // session_def_ids is computed (joined from session_definitions) and
        // therefore preserved across mutations.
        if let Some(v) = patch.kind {
            existing.kind = v;
        }
        if let Some(v) = patch.name {
            existing.name = v;
        }
        if let Some(v) = patch.autostart {
            existing.autostart = v;
        }
        if let Some(v) = patch.presentation_mode {
            existing.presentation_mode = v;
        }
        if let Some(v) = patch.primary_session_def_id {
            existing.primary_session_def_id = v;
        }
        if let Some(v) = patch.persisted {
            existing.persisted = v;
        }
        if let Some(v) = patch.sort_order {
            existing.sort_order = v;
        }
    }

    pub async fn register_session_definition(&self, def: SessionDefinition) {
        let mut inner = self.inner.lock().await;
        inner.session_definitions.insert(def.id.clone(), def);
    }

    pub async fn update_session_definition(&self, patch: SessionDefinitionMutation) {
        let mut to_emit = Vec::new();
        {
            let mut inner = self.inner.lock().await;
            let Some(existing) = inner.session_definitions.get_mut(&patch.id) else {
                return;
            };
            if let Some(v) = patch.slot_id {
                existing.slot_id = v;
            }
            if let Some(v) = patch.kind {
                existing.kind = v;
            }
            if let Some(v) = patch.name {
                existing.name = v;
            }
            if let Some(v) = patch.command {
                existing.command = v;
            }
            if let Some(v) = patch.cwd {
                existing.cwd = v;
            }
            if let Some(v) = patch.port {
                existing.port = v;
            }
            if let Some(v) = patch.env_overrides {
                existing.env_overrides = v;
            }
            if let Some(v) = patch.restart_policy {
                existing.restart_policy = v;
            }
            if let Some(v) = patch.pause_supported {
                existing.pause_supported = v;
            }
            if let Some(v) = patch.resume_supported {
                existing.resume_supported = v;
            }
            let next = existing.clone();
            for session in inner.sessions.values_mut() {
                if session.instance.session_def_id == patch.id {
                    session.definition = next.clone();
                    to_emit.push(session_state_of(session));
                }
            }
        }
        for state in to_emit {
            self.emitter.session_state_changed(state).await;
        }
    }

    pub async fn remove_slot(&self, slot_id: &str) {
        let session_ids: Vec<String> = {
            let inner = self.inner.lock().await;
            inner
                .sessions
                .values()
                .filter(|s| s.instance.slot_id == slot_id)
                .map(|s| s.instance.id.clone())
                .collect()
        };
        for sid in session_ids {
            self.close_session(&sid).await;
        }
        let mut inner = self.inner.lock().await;
        inner.slot_definitions.remove(slot_id);
    }

    pub async fn remove_session_definition(&self, session_def_id: &str) {
        let session_ids: Vec<String> = {
            let inner = self.inner.lock().await;
            inner
                .sessions
                .values()
                .filter(|s| s.instance.session_def_id == session_def_id)
                .map(|s| s.instance.id.clone())
                .collect()
        };
        for sid in session_ids {
            self.close_session(&sid).await;
        }
        let mut inner = self.inner.lock().await;
        inner.session_definitions.remove(session_def_id);
    }

    // ---- bulk lifecycle ---------------------------------------------------

    pub async fn autostart_slots(&self) {
        let slot_ids: Vec<String> = {
            let inner = self.inner.lock().await;
            inner
                .slot_definitions
                .values()
                .filter(|s| s.autostart)
                .map(|s| s.id.clone())
                .collect()
        };
        for id in slot_ids {
            self.start_slot(&id).await;
        }
    }

    /// Open a session instance for every terminal_slot that has session
    /// definitions but no open session instances yet. This bridges the gap
    /// between the DB seed (which creates a dormant terminal_slot with
    /// autostart=false) and the frontend loader (which waits for a running
    /// session before removing the spinner).
    pub async fn open_dormant_terminal_sessions(&self) {
        let defs_to_open: Vec<String> = {
            let inner = self.inner.lock().await;
            let open_slot_ids: std::collections::HashSet<&str> = inner
                .sessions
                .values()
                .map(|s| s.instance.slot_id.as_str())
                .collect();
            inner
                .slot_definitions
                .values()
                .filter(|slot| {
                    matches!(slot.kind, crate::models::SlotKind::TerminalSlot)
                        && !open_slot_ids.contains(slot.id.as_str())
                })
                .flat_map(|slot| {
                    inner
                        .session_definitions
                        .values()
                        .filter(|d| d.slot_id == slot.id)
                        .map(|d| d.id.clone())
                        .collect::<Vec<_>>()
                })
                .collect()
        };
        for def_id in defs_to_open {
            if let Err(e) = self.open_session_instance(&def_id).await {
                tracing::warn!(def_id, error = %e, "open dormant terminal session failed");
            }
        }
    }

    pub async fn close_all_sessions(&self) {
        let session_ids: Vec<String> = {
            let inner = self.inner.lock().await;
            inner.sessions.keys().cloned().collect()
        };
        for sid in session_ids {
            self.close_session(&sid).await;
        }
    }

    /// Pause/resume **output forwarding** for every open session. Used when
    /// the renderer goes background.
    #[allow(dead_code)]
    pub async fn set_outputs_paused(&self, paused: bool) {
        let session_ids: Vec<String> = {
            let mut inner = self.inner.lock().await;
            if inner.outputs_paused == paused {
                return;
            }
            inner.outputs_paused = paused;
            inner.sessions.keys().cloned().collect()
        };
        for sid in session_ids {
            if paused {
                self.pause_session_output(&sid).await;
            } else {
                self.resume_session_output(&sid).await;
            }
        }
    }

    // ---- slot-level convenience wrappers ---------------------------------

    pub async fn start_slot(&self, slot_id: &str) {
        let def_ids: Vec<String> = {
            let inner = self.inner.lock().await;
            inner
                .session_definitions
                .values()
                .filter(|d| d.slot_id == slot_id)
                .map(|d| d.id.clone())
                .collect()
        };
        for def_id in def_ids {
            if let Err(e) = self.open_session_instance(&def_id).await {
                tracing::error!(slot_id, def_id, error = %e, "start_slot failed");
            }
        }
    }

    pub async fn stop_slot(&self, slot_id: &str) {
        for sid in self.session_ids_for_slot(slot_id).await {
            self.stop_session(&sid).await;
        }
    }

    pub async fn restart_slot(&self, slot_id: &str) {
        for sid in self.session_ids_for_slot(slot_id).await {
            self.restart_session(&sid).await;
        }
    }

    pub async fn pause_slot(&self, slot_id: &str) {
        for sid in self.session_ids_for_slot(slot_id).await {
            self.pause_session(&sid).await;
        }
    }

    pub async fn resume_slot(&self, slot_id: &str) {
        for sid in self.session_ids_for_slot(slot_id).await {
            self.resume_session(&sid).await;
        }
    }

    async fn session_ids_for_slot(&self, slot_id: &str) -> Vec<String> {
        let inner = self.inner.lock().await;
        inner
            .sessions
            .values()
            .filter(|s| s.instance.slot_id == slot_id)
            .map(|s| s.instance.id.clone())
            .collect()
    }

    // ---- per-session lifecycle -------------------------------------------

    /// Open a new instance of a session definition and immediately spawn it.
    /// Returns the new instance ID, or `Err` if the definition is unknown.
    pub async fn open_session_instance(&self, session_def_id: &str) -> Result<String, String> {
        let def = {
            let inner = self.inner.lock().await;
            inner
                .session_definitions
                .get(session_def_id)
                .cloned()
                .ok_or_else(|| format!("unknown session definition: {session_def_id}"))?
        };
        let managed = ManagedSession::new(def);
        let instance_id = managed.instance.id.clone();
        {
            let mut inner = self.inner.lock().await;
            inner.sessions.insert(instance_id.clone(), managed);
        }
        self.spawn(&instance_id).await;
        Ok(instance_id)
    }

    /// Tear down an open session instance permanently (vs `stop_session`,
    /// which leaves the instance around for restart).
    pub async fn close_session(&self, session_id: &str) {
        let mut inner = self.inner.lock().await;
        if let Some(mut session) = inner.sessions.remove(session_id) {
            self.detach_locked(&mut session);
        }
    }

    pub async fn start_session(&self, session_id: &str) {
        let needs_spawn = {
            let inner = self.inner.lock().await;
            inner
                .sessions
                .get(session_id)
                .map(|s| s.pty.is_none())
                .unwrap_or(false)
        };
        if needs_spawn {
            self.spawn(session_id).await;
        }
    }

    /// Send SIGTERM, mark stopped, and arm a 5 s SIGKILL escalation.
    pub async fn stop_session(&self, session_id: &str) {
        let (pty, state_to_emit) = {
            let mut inner = self.inner.lock().await;
            let Some(session) = inner.sessions.get_mut(session_id) else {
                return;
            };
            if session.pty.is_none() {
                return;
            }
            session.instance.status = SessionStatus::Stopped;
            session.instance.foreground_process = None;
            session.instance.pty_foreground_process = None;
            let pty = session.pty.as_ref().map(Arc::clone);
            (pty, session_state_of(session))
        };

        self.emitter.session_state_changed(state_to_emit).await;

        if let Some(pty) = pty {
            #[cfg(unix)]
            let _ = pty.signal_child(nix::sys::signal::Signal::SIGTERM);
            self.arm_kill_escalation(session_id, STOP_ESCALATION).await;
            // Hold a reference so the kill lambda can race the natural exit.
            drop(pty);
        }
    }

    /// User-initiated restart. Sends Ctrl-L style screen reset (`\x1bc`),
    /// transitions to `restarting`, then SIGTERM with a fast (500 ms)
    /// escalation. The exit handler sees `restarting` and respawns.
    pub async fn restart_session(&self, session_id: &str) {
        let (pty, state, has_pty) = {
            let mut inner = self.inner.lock().await;
            let Some(session) = inner.sessions.get_mut(session_id) else {
                return;
            };
            session.instance.status = SessionStatus::Restarting;
            session.instance.foreground_process = None;
            session.instance.pty_foreground_process = None;
            session.instance.agent_activity = None;
            let pty = session.pty.as_ref().map(Arc::clone);
            let has = pty.is_some();
            (pty, session_state_of(session), has)
        };

        self.emitter.session_state_changed(state).await;
        // ESC c — full screen reset. Clears the renderer buffer so the
        // restarted command writes to a clean canvas.
        self.emitter
            .output_chunk(session_id, Bytes::from_static(b"\x1bc"))
            .await;

        if has_pty {
            if let Some(pty) = pty {
                #[cfg(unix)]
                let _ = pty.signal_child(nix::sys::signal::Signal::SIGTERM);
                drop(pty);
            }
            self.arm_kill_escalation(session_id, RESTART_ESCALATION).await;
        } else {
            // Already-exited session: spawn straight away.
            self.spawn(session_id).await;
        }
    }

    /// SIGSTOP the child; output forwarding stays on so the user can see any
    /// already-buffered bytes.
    pub async fn pause_session(&self, session_id: &str) {
        let (pty, state) = {
            let mut inner = self.inner.lock().await;
            let Some(session) = inner.sessions.get_mut(session_id) else {
                return;
            };
            if session.pty.is_none() || !session.definition.pause_supported {
                return;
            }
            session.instance.status = SessionStatus::Paused;
            session.instance.foreground_process = None;
            session.instance.pty_foreground_process = None;
            let pty = session.pty.as_ref().map(Arc::clone);
            (pty, session_state_of(session))
        };
        if let Some(pty) = pty {
            #[cfg(unix)]
            let _ = pty.signal_child(nix::sys::signal::Signal::SIGSTOP);
            drop(pty);
        }
        self.emitter.session_state_changed(state).await;
    }

    pub async fn resume_session(&self, session_id: &str) {
        let (pty, state) = {
            let mut inner = self.inner.lock().await;
            let Some(session) = inner.sessions.get_mut(session_id) else {
                return;
            };
            if session.pty.is_none() || !session.definition.resume_supported {
                return;
            }
            session.instance.status = SessionStatus::Running;
            let pty = session.pty.as_ref().map(Arc::clone);
            (pty, session_state_of(session))
        };
        if let Some(pty) = pty {
            #[cfg(unix)]
            let _ = pty.signal_child(nix::sys::signal::Signal::SIGCONT);
            drop(pty);
        }
        self.emitter.session_state_changed(state).await;
    }

    #[allow(dead_code)]
    pub async fn pause_session_output(&self, session_id: &str) {
        let mut inner = self.inner.lock().await;
        if let Some(session) = inner.sessions.get_mut(session_id) {
            if session.pty.is_some() && !session.output_paused {
                session.output_paused = true;
            }
        }
    }

    #[allow(dead_code)]
    pub async fn resume_session_output(&self, session_id: &str) {
        let mut inner = self.inner.lock().await;
        if let Some(session) = inner.sessions.get_mut(session_id) {
            if session.pty.is_some() && session.output_paused {
                session.output_paused = false;
            }
        }
    }

    pub async fn write_to_session(&self, session_id: &str, data: &[u8]) {
        let pty = {
            let inner = self.inner.lock().await;
            inner
                .sessions
                .get(session_id)
                .and_then(|s| s.pty.as_ref().map(Arc::clone))
        };
        if let Some(pty) = pty {
            if let Err(e) = pty.write(data) {
                tracing::warn!(session_id, error = %e, "pty write failed");
            }
        }
    }

    pub async fn resize_session(&self, session_id: &str, cols: u16, rows: u16) {
        let pty = {
            let inner = self.inner.lock().await;
            inner
                .sessions
                .get(session_id)
                .and_then(|s| s.pty.as_ref().map(Arc::clone))
        };
        if let Some(pty) = pty {
            if let Err(e) = pty.resize(cols, rows) {
                tracing::warn!(session_id, error = %e, "pty resize failed");
            }
        }
    }

    /// Apply an agent CLI signal to the matching session in the slot.
    /// Returns the updated state if a matching running/paused session was
    /// found and the event was actionable.
    pub async fn record_agent_cli_signal(
        &self,
        signal: &AgentCliSignal,
    ) -> Option<SessionState> {
        let now = Utc::now().to_rfc3339();
        let activity = super::agent_signal::next_agent_activity(signal, &now)?;

        let state = {
            let mut inner = self.inner.lock().await;
            let candidate = inner
                .sessions
                .values_mut()
                .find(|s| {
                    s.instance.slot_id == signal.slot_id
                        && matches!(
                            s.instance.status,
                            SessionStatus::Running | SessionStatus::Paused
                        )
                })?;
            candidate.instance.agent_activity = Some(activity.clone());
            candidate.instance.foreground_process = match activity.phase {
                AgentPhase::Finished | AgentPhase::Idle => None,
                _ => Some(signal.source.as_str().to_string()),
            };
            session_state_of(candidate)
        };

        self.emitter.session_state_changed(state.clone()).await;
        Some(state)
    }

    // ---- internal: spawn / exit / batching -------------------------------

    async fn spawn(&self, session_id: &str) {
        let (spec, runtime_id, slot_id) = {
            let inner = self.inner.lock().await;
            let Some(session) = inner.sessions.get(session_id) else {
                return;
            };
            if session.pty.is_some() {
                return;
            }
            let spec = build_spawn_spec(
                &session.definition,
                &self.runtime_id,
                &session.instance.slot_id,
                &self.default_cwd,
            );
            (spec, self.runtime_id.clone(), session.instance.slot_id.clone())
        };
        let _ = (runtime_id, slot_id); // available for tracing if needed

        let cmd_for_log = spec.command.clone();
        tracing::info!(session_id, cmd = %cmd_for_log, "spawning session");

        let (pty, output_rx, exit_rx) = match Pty::spawn(spec) {
            Ok(t) => t,
            Err(e) => {
                tracing::error!(session_id, error = %e, "pty spawn failed");
                self.mark_crashed(session_id).await;
                return;
            }
        };
        let pty_arc = Arc::new(pty);
        let pid = pty_arc.pid();

        // State transition + emitter snapshot.
        let snapshot = {
            let mut inner = self.inner.lock().await;
            let outputs_paused = inner.outputs_paused;
            let Some(session) = inner.sessions.get_mut(session_id) else {
                // Closed between the spawn and now — kill what we just made.
                let _ = pty_arc.kill();
                return;
            };
            session.pty = Some(Arc::clone(&pty_arc));
            session.exit_handled = false;
            session.output_paused = outputs_paused;
            session.instance.status = SessionStatus::Running;
            session.instance.started_at = Some(Utc::now().to_rfc3339());
            session.instance.exit_code = None;
            session.instance.pid = pid.map(|p| p as i64);
            session.instance.foreground_process = None;
            session.instance.pty_foreground_process = None;
            session.instance.agent_activity = None;
            session_state_of(session)
        };
        self.emitter.session_state_changed(snapshot).await;

        if let Some(pid) = pid {
            self.port_manager
                .register_session(session_id, pid)
                .await;
        }

        // Spawn the per-session reader/batcher and exit-watcher. The fg-poll
        // is a single shared task started in ProcessManager::new.
        let reader_handle = self.spawn_reader_task(session_id.to_string(), output_rx);
        let exit_handle = self.spawn_exit_task(session_id.to_string(), exit_rx);

        {
            let mut inner = self.inner.lock().await;
            if let Some(session) = inner.sessions.get_mut(session_id) {
                session.crash_count = 0;
                session.reader_task = Some(reader_handle);
                // We don't track the exit task in the struct because it owns
                // a oneshot; aborting it would discard a pending exit code.
                drop(exit_handle);
            }
        }
    }

    fn spawn_reader_task(
        &self,
        session_id: String,
        mut rx: mpsc::Receiver<Bytes>,
    ) -> JoinHandle<()> {
        let inner = Arc::clone(&self.inner);
        let emitter = Arc::clone(&self.emitter);
        let port_manager = self.port_manager.clone();

        tokio::spawn(async move {
            let mut buffer = BytesMut::new();
            let mut flush_deadline: Option<tokio::time::Instant> = None;

            loop {
                let sleep_fut = async {
                    match flush_deadline {
                        Some(dl) => tokio::time::sleep_until(dl).await,
                        None => std::future::pending().await,
                    }
                };

                tokio::select! {
                    biased;
                    chunk = rx.recv() => {
                        let Some(chunk) = chunk else { break };

                        if buffer.len() + chunk.len() > OUTPUT_BUFFER_MAX {
                            let drop = buffer.len() + chunk.len() - OUTPUT_BUFFER_MAX;
                            let drop = drop.min(buffer.len());
                            let _ = buffer.split_to(drop);
                        }
                        buffer.extend_from_slice(&chunk);

                        let now = Utc::now().to_rfc3339();
                        port_manager.check_output_for_hint(&chunk, &session_id).await;

                        let paused = {
                            let mut g = inner.lock().await;
                            if let Some(s) = g.sessions.get_mut(&session_id) {
                                s.instance.last_output_at = Some(now);
                                s.output_paused
                            } else {
                                false
                            }
                        };
                        if paused {
                            continue;
                        }

                        if buffer.len() >= BATCH_MAX_BYTES {
                            flush_deadline = None;
                            let bytes = buffer.split().freeze();
                            emitter.output_chunk(&session_id, bytes).await;
                        } else if flush_deadline.is_none() {
                            flush_deadline = Some(tokio::time::Instant::now() + BATCH_INTERVAL);
                        }
                    }
                    _ = sleep_fut => {
                        flush_deadline = None;
                        if buffer.is_empty() { continue; }
                        let paused = {
                            let g = inner.lock().await;
                            g.sessions
                                .get(&session_id)
                                .map(|s| s.output_paused)
                                .unwrap_or(false)
                        };
                        if paused { continue; }
                        let bytes = buffer.split().freeze();
                        emitter.output_chunk(&session_id, bytes).await;
                    }
                }
            }

            // Final flush on EOF.
            if !buffer.is_empty() {
                let paused = {
                    let g = inner.lock().await;
                    g.sessions
                        .get(&session_id)
                        .map(|s| s.output_paused)
                        .unwrap_or(false)
                };
                if !paused {
                    emitter.output_chunk(&session_id, buffer.split().freeze()).await;
                }
            }
        })
    }

    fn spawn_exit_task(
        &self,
        session_id: String,
        exit_rx: tokio::sync::oneshot::Receiver<super::pty::PtyExit>,
    ) -> JoinHandle<()> {
        let pm = self.clone();
        tokio::spawn(async move {
            let exit = exit_rx.await.ok();
            let exit_code = exit.and_then(|e| e.exit_code);
            pm.finalize_exit(&session_id, exit_code).await;
        })
    }

    /// Single shared 1 Hz poller that walks all live sessions and detects
    /// foreground process group changes via `tcgetpgrp` + `pidpath`. Emits
    /// `session_state_changed` only on transitions, so the steady-state cost
    /// is one lock + N `process_group_leader` calls per second (N = open
    /// sessions) regardless of how many sessions exist.
    fn start_fg_poll(
        inner: Arc<Mutex<Inner>>,
        emitter: Arc<dyn RuntimeEmitter>,
    ) -> JoinHandle<()> {
        tokio::spawn(async move {
            let mut last_names: HashMap<String, Option<String>> = HashMap::new();
            let mut interval = tokio::time::interval(Duration::from_secs(1));
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

            loop {
                interval.tick().await;

                // Collect (session_id, Pty arc) snapshot under a single lock.
                let live: Vec<(String, Arc<Pty>)> = {
                    let g = inner.lock().await;
                    g.sessions
                        .iter()
                        .filter_map(|(id, s)| {
                            s.pty.as_ref().map(|p| (id.clone(), Arc::clone(p)))
                        })
                        .collect()
                };

                // Prune stale entries from last_names for closed sessions.
                let live_ids: std::collections::HashSet<&str> =
                    live.iter().map(|(id, _)| id.as_str()).collect();
                last_names.retain(|id, _| live_ids.contains(id.as_str()));

                let mut changed: Vec<(String, Option<String>)> = Vec::new();
                for (id, pty) in &live {
                    let current = pty
                        .foreground_process_group()
                        .and_then(|pgid| resolve_process_name(pgid));
                    let prev = last_names.get(id);
                    if prev.map(|p| p != &current).unwrap_or(true) {
                        last_names.insert(id.clone(), current.clone());
                        changed.push((id.clone(), current));
                    }
                }

                if changed.is_empty() {
                    continue;
                }

                // Apply changes under a single lock, collect states to emit.
                let states: Vec<SessionState> = {
                    let mut g = inner.lock().await;
                    changed
                        .into_iter()
                        .filter_map(|(id, name)| {
                            let session = g.sessions.get_mut(&id)?;
                            if session.pty.is_none() {
                                return None;
                            }
                            session.instance.pty_foreground_process = name;
                            Some(session_state_of(session))
                        })
                        .collect()
                };

                for state in states {
                    emitter.session_state_changed(state).await;
                }
            }
        })
    }

    async fn arm_kill_escalation(&self, session_id: &str, after: Duration) {
        let pm = self.clone();
        let sid = session_id.to_string();
        let task = tokio::spawn(async move {
            tokio::time::sleep(after).await;
            let pty = {
                let inner = pm.inner.lock().await;
                inner
                    .sessions
                    .get(&sid)
                    .and_then(|s| s.pty.as_ref().map(Arc::clone))
            };
            if let Some(pty) = pty {
                let _ = pty.kill();
            }
        });
        let mut inner = self.inner.lock().await;
        if let Some(session) = inner.sessions.get_mut(session_id) {
            if let Some(prev) = session.escalation_task.replace(task) {
                prev.abort();
            }
        }
    }

    async fn finalize_exit(&self, session_id: &str, exit_code: Option<i32>) {
        let (snapshot_to_emit, want_respawn, want_restart_backoff, crash_count) = {
            let mut inner = self.inner.lock().await;
            let Some(session) = inner.sessions.get_mut(session_id) else {
                return;
            };
            if session.exit_handled {
                return;
            }
            session.exit_handled = true;

            // Cancel any pending escalation / reader / fg poller; PTY is dead.
            if let Some(t) = session.escalation_task.take() { t.abort(); }
            if let Some(t) = session.reader_task.take() { t.abort(); }

            session.pty = None;
            session.output_paused = false;
            session.instance.pid = None;
            session.instance.exit_code = exit_code.map(|c| c as i64);
            session.instance.foreground_process = None;
            session.instance.pty_foreground_process = None;
            session.instance.agent_activity = None;

            let was_restarting = matches!(session.instance.status, SessionStatus::Restarting);
            if was_restarting {
                // Respawn handler does the rest; don't transition to crashed.
                (None, true, false, session.crash_count)
            } else {
                let next = if matches!(session.instance.status, SessionStatus::Stopped) {
                    SessionStatus::Stopped
                } else {
                    SessionStatus::Crashed
                };
                session.instance.status = next;
                let snapshot = session_state_of(session);
                let auto_restart = matches!(next, SessionStatus::Crashed)
                    && session.definition.restart_policy == RestartPolicy::Always;
                (Some(snapshot), false, auto_restart, session.crash_count)
            }
        };

        self.port_manager.unregister_session(session_id).await;

        if let Some(state) = snapshot_to_emit {
            self.emitter.session_state_changed(state).await;
        }

        if want_respawn {
            self.spawn(session_id).await;
            return;
        }

        if want_restart_backoff {
            let backoff_ms = (1_000u64
                .saturating_mul(1u64 << crash_count.min(5)))
                .min(30_000);
            // Bump count for the next round; reset to 0 on successful spawn.
            {
                let mut inner = self.inner.lock().await;
                if let Some(s) = inner.sessions.get_mut(session_id) {
                    s.crash_count = crash_count.saturating_add(1);
                }
            }
            let pm = self.clone();
            let sid = session_id.to_string();
            let task = tokio::spawn(async move {
                tokio::time::sleep(Duration::from_millis(backoff_ms)).await;
                let still_crashed = {
                    let inner = pm.inner.lock().await;
                    inner
                        .sessions
                        .get(&sid)
                        .map(|s| {
                            matches!(s.instance.status, SessionStatus::Crashed)
                                && s.pty.is_none()
                        })
                        .unwrap_or(false)
                };
                if !still_crashed {
                    return;
                }
                let snapshot = {
                    let mut inner = pm.inner.lock().await;
                    if let Some(s) = inner.sessions.get_mut(&sid) {
                        s.instance.status = SessionStatus::Restarting;
                        Some(session_state_of(s))
                    } else {
                        None
                    }
                };
                if let Some(state) = snapshot {
                    pm.emitter.session_state_changed(state).await;
                }
                pm.spawn(&sid).await;
            });
            let mut inner = self.inner.lock().await;
            if let Some(s) = inner.sessions.get_mut(session_id) {
                if let Some(prev) = s.restart_task.replace(task) {
                    prev.abort();
                }
            }
        }
    }

    /// Spawn-time error path: the session never produced a PID, so transition
    /// straight to crashed without going through the exit-watcher path.
    async fn mark_crashed(&self, session_id: &str) {
        let snapshot = {
            let mut inner = self.inner.lock().await;
            let Some(s) = inner.sessions.get_mut(session_id) else {
                return;
            };
            s.instance.status = SessionStatus::Crashed;
            s.instance.pid = None;
            session_state_of(s)
        };
        self.emitter.session_state_changed(snapshot).await;
    }

    /// Synchronous teardown helper: kills the PTY, aborts background tasks,
    /// scrubs the SessionInstance fields. Callers must already hold the
    /// session removed from the map so the exit-watcher can't reach it.
    fn detach_locked(&self, session: &mut ManagedSession) {
        session.exit_handled = true;
        if let Some(t) = session.escalation_task.take() { t.abort(); }
        if let Some(t) = session.reader_task.take() { t.abort(); }
        if let Some(t) = session.restart_task.take() { t.abort(); }
        if let Some(pty) = session.pty.take() {
            let _ = pty.kill();
        }
        session.instance.status = SessionStatus::Stopped;
        session.instance.pid = None;
        session.instance.exit_code = None;
        session.instance.foreground_process = None;
        session.instance.pty_foreground_process = None;
        session.instance.agent_activity = None;
    }
}

// ---------------------------------------------------------------------------
// Mutation structs — runtime-side equivalents of the patch wire types.
// We don't reuse PatchWire directly so internal callers (tauri command
// handlers) can construct partial updates without going through serde.
// ---------------------------------------------------------------------------

#[derive(Default, Debug, Clone)]
pub struct SlotDefinitionMutation {
    pub id: String,
    pub kind: Option<crate::models::SlotKind>,
    pub name: Option<String>,
    pub autostart: Option<bool>,
    pub presentation_mode: Option<crate::models::PresentationMode>,
    /// `Some(None)` clears, `Some(Some(x))` sets, `None` leaves alone.
    pub primary_session_def_id: Option<Option<String>>,
    pub persisted: Option<bool>,
    pub sort_order: Option<i64>,
}

#[derive(Default, Debug, Clone)]
pub struct SessionDefinitionMutation {
    pub id: String,
    pub slot_id: Option<String>,
    pub kind: Option<crate::models::SessionKind>,
    pub name: Option<String>,
    pub command: Option<String>,
    pub cwd: Option<Option<String>>,
    pub port: Option<Option<i64>>,
    pub env_overrides: Option<std::collections::BTreeMap<String, String>>,
    pub restart_policy: Option<RestartPolicy>,
    pub pause_supported: Option<bool>,
    pub resume_supported: Option<bool>,
}

// ---------------------------------------------------------------------------
// Free helpers shared with the runtime/registry layer.
// ---------------------------------------------------------------------------

/// Construct the env passed to the child shell.
///
/// Order:
///   1. inherited process env
///   2. PANDORA_HOME (override or default)
///   3. session definition's env_overrides
///   4. PANDORA_RUNTIME_ID, PANDORA_SLOT_ID, TERM (always set, never overridable)
///   5. PATH gets `${PANDORA_HOME}/bin` prepended last so the runtime's
///      shimmed agent binaries take precedence.
pub fn session_spawn_env(
    def: &SessionDefinition,
    runtime_id: &str,
    slot_id: &str,
) -> Vec<(String, String)> {
    let pandora_home = def
        .env_overrides
        .get("PANDORA_HOME")
        .cloned()
        .or_else(|| std::env::var("PANDORA_HOME").ok())
        .unwrap_or_else(|| {
            std::env::var("HOME")
                .map(|h| format!("{h}/.pandora"))
                .unwrap_or_else(|_| "/tmp/.pandora".to_string())
        });

    let mut env: HashMap<String, String> = std::env::vars().collect();
    env.insert("PANDORA_HOME".to_string(), pandora_home.clone());
    for (k, v) in &def.env_overrides {
        env.insert(k.clone(), v.clone());
    }
    env.insert("PANDORA_RUNTIME_ID".to_string(), runtime_id.to_string());
    env.insert("PANDORA_SLOT_ID".to_string(), slot_id.to_string());
    env.insert("TERM".to_string(), "xterm-256color".to_string());

    // PATH: prepend `${PANDORA_HOME}/bin`. Skip if it's already there
    // (avoids duplicate entries on respawn).
    let bin_dir = format!("{pandora_home}/bin");
    let new_path = match env.get("PATH").cloned() {
        Some(existing) if existing.split(':').any(|p| p == bin_dir) => existing,
        Some(existing) => format!("{bin_dir}:{existing}"),
        None => bin_dir,
    };
    env.insert("PATH".to_string(), new_path);

    env.into_iter().collect()
}

fn build_spawn_spec(
    def: &SessionDefinition,
    runtime_id: &str,
    slot_id: &str,
    default_cwd: &str,
) -> PtySpawnSpec {
    let cwd = def
        .cwd
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| default_cwd.to_string());

    PtySpawnSpec {
        shell: std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string()),
        command: def.command.clone(),
        cwd,
        env: session_spawn_env(def, runtime_id, slot_id),
        cols: DEFAULT_COLS,
        rows: DEFAULT_ROWS,
    }
}

/// Resolve a PID to a short process name (e.g. "npm", "node", "zsh").
/// Returns `None` if the PID is invalid or the lookup fails. On macOS
/// this uses `proc_pidpath` and extracts the basename; on other platforms
/// it's a no-op stub.
#[cfg(target_os = "macos")]
fn resolve_process_name(pid: i32) -> Option<String> {
    use libproc::libproc::proc_pid::pidpath;
    pidpath(pid)
        .ok()
        .and_then(|path| {
            path.rsplit('/')
                .next()
                .map(|s| s.to_string())
        })
        .filter(|name| !name.is_empty())
}

#[cfg(not(target_os = "macos"))]
fn resolve_process_name(_pid: i32) -> Option<String> {
    None
}

fn session_state_of(session: &ManagedSession) -> SessionState {
    SessionState {
        instance: session.instance.clone(),
        kind: session.definition.kind,
        name: session.definition.name.clone(),
        port: session.definition.port,
        capabilities: capabilities_for(session.instance.status, &session.definition),
    }
}

fn slot_state_of(
    slot: &SlotDefinition,
    session_definitions: &HashMap<String, SessionDefinition>,
    sessions: &HashMap<String, ManagedSession>,
) -> SlotState {
    let states: Vec<SessionState> = sessions
        .values()
        .filter(|s| s.instance.slot_id == slot.id)
        .map(session_state_of)
        .collect();
    let aggregate_status = aggregate_slot_status(&states);
    let session_ids: Vec<String> = states.iter().map(|s| s.instance.id.clone()).collect();
    let capabilities = ActionCapabilities {
        can_focus: states.iter().any(|s| s.capabilities.can_focus),
        can_pause: states.iter().any(|s| s.capabilities.can_pause),
        can_resume: states.iter().any(|s| s.capabilities.can_resume),
        can_clear: states.iter().any(|s| s.capabilities.can_clear),
        can_stop: states.iter().any(|s| s.capabilities.can_stop),
        can_restart: states.iter().any(|s| s.capabilities.can_restart),
    };
    let mut definition = slot.clone();
    definition.session_def_ids = session_definitions
        .values()
        .filter(|definition| definition.slot_id == slot.id)
        .map(|definition| definition.id.clone())
        .collect();
    SlotState {
        definition,
        aggregate_status,
        session_ids,
        capabilities,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{PresentationMode, SessionKind, SlotKind};
    use std::sync::Mutex as StdMutex;

    // ---- Test emitter ----------------------------------------------------

    #[derive(Default)]
    struct CapturedEvent {
        states: Vec<SessionState>,
        outputs: Vec<(String, Vec<u8>)>,
    }

    #[derive(Clone, Default)]
    struct TestEmitter(Arc<StdMutex<CapturedEvent>>);

    #[async_trait::async_trait]
    impl RuntimeEmitter for TestEmitter {
        async fn session_state_changed(&self, state: SessionState) {
            self.0.lock().unwrap().states.push(state);
        }
        async fn output_chunk(&self, session_id: &str, data: Bytes) {
            self.0
                .lock()
                .unwrap()
                .outputs
                .push((session_id.to_string(), data.to_vec()));
        }
        async fn ports_changed(&self, _ports: Vec<DetectedPort>) {}
    }

    fn slot(id: &str, autostart: bool) -> SlotDefinition {
        SlotDefinition {
            id: id.into(),
            kind: SlotKind::ProcessSlot,
            name: id.into(),
            autostart,
            presentation_mode: PresentationMode::Single,
            primary_session_def_id: None,
            session_def_ids: vec![],
            persisted: true,
            sort_order: 0,
        }
    }

    fn session_def(id: &str, slot_id: &str, command: &str) -> SessionDefinition {
        SessionDefinition {
            id: id.into(),
            slot_id: slot_id.into(),
            kind: SessionKind::Process,
            name: id.into(),
            command: command.into(),
            cwd: Some(std::env::temp_dir().to_string_lossy().into_owned()),
            port: None,
            env_overrides: Default::default(),
            restart_policy: RestartPolicy::Manual,
            pause_supported: true,
            resume_supported: true,
        }
    }

    fn make_pm(slots: Vec<SlotDefinition>, defs: Vec<SessionDefinition>) -> (ProcessManager, TestEmitter) {
        let emitter = TestEmitter::default();
        let arc: Arc<dyn RuntimeEmitter> = Arc::new(emitter.clone());
        let pm = ProcessManager::new(
            slots,
            defs,
            arc,
            std::env::temp_dir().to_string_lossy().into_owned(),
            "test-runtime".to_string(),
        );
        (pm, emitter)
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn slot_state_computes_session_def_ids_from_registered_definitions() {
        let (pm, _emitter) = make_pm(vec![], vec![]);
        let mut slot = slot("slot-1", false);
        slot.session_def_ids = vec!["future-def".into()];

        pm.register_slot(slot).await;
        assert_eq!(
            pm.list_slot_states().await[0].definition.session_def_ids,
            Vec::<String>::new(),
        );

        pm.register_session_definition(session_def("def-1", "slot-1", "true")).await;
        assert_eq!(
            pm.list_slot_states().await[0].definition.session_def_ids,
            vec!["def-1".to_string()],
        );
    }

    #[test]
    fn session_spawn_env_sets_required_keys() {
        let def = session_def("s", "slot", "true");
        let env = session_spawn_env(&def, "runtime-1", "slot-1");
        let map: HashMap<_, _> = env.into_iter().collect();
        assert_eq!(map.get("PANDORA_RUNTIME_ID").map(String::as_str), Some("runtime-1"));
        assert_eq!(map.get("PANDORA_SLOT_ID").map(String::as_str), Some("slot-1"));
        assert_eq!(map.get("TERM").map(String::as_str), Some("xterm-256color"));
        assert!(map.get("PANDORA_HOME").is_some());
        let path = map.get("PATH").expect("PATH");
        let pandora_home = map.get("PANDORA_HOME").unwrap();
        assert!(path.starts_with(&format!("{pandora_home}/bin:")));
    }

    #[test]
    fn session_spawn_env_does_not_double_prepend_pandora_bin() {
        let mut def = session_def("s", "slot", "true");
        // First call adds the bin dir; second call must see "already there"
        // and not duplicate it.
        let env_first = session_spawn_env(&def, "r", "s");
        let map_first: HashMap<_, _> = env_first.into_iter().collect();
        let path_first = map_first.get("PATH").unwrap().clone();
        def.env_overrides
            .insert("PATH".to_string(), path_first.clone());
        let env_second = session_spawn_env(&def, "r", "s");
        let map_second: HashMap<_, _> = env_second.into_iter().collect();
        assert_eq!(map_second.get("PATH").unwrap(), &path_first);
    }

    #[test]
    fn session_spawn_env_honors_pandora_home_override() {
        let mut def = session_def("s", "slot", "true");
        def.env_overrides
            .insert("PANDORA_HOME".to_string(), "/custom/home".to_string());
        let env = session_spawn_env(&def, "r", "s");
        let map: HashMap<_, _> = env.into_iter().collect();
        assert_eq!(map.get("PANDORA_HOME").map(String::as_str), Some("/custom/home"));
        assert!(map.get("PATH").unwrap().starts_with("/custom/home/bin:"));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn open_and_run_echo_emits_running_state_then_output_then_exit() {
        let slots = vec![slot("slot-1", false)];
        let defs = vec![session_def("def-1", "slot-1", "echo hi")];
        let (pm, emitter) = make_pm(slots, defs);
        let sid = pm.open_session_instance("def-1").await.expect("open");

        // Wait for echo to print + exit.
        tokio::time::sleep(Duration::from_millis(1500)).await;

        let captured = emitter.0.lock().unwrap();
        assert!(
            captured.states.iter().any(|s| s.instance.status == SessionStatus::Running),
            "expected at least one Running state"
        );
        let outputs: Vec<u8> = captured
            .outputs
            .iter()
            .filter(|(id, _)| id == &sid)
            .flat_map(|(_, b)| b.clone())
            .collect();
        assert!(
            String::from_utf8_lossy(&outputs).contains("hi"),
            "expected 'hi' in output: {:?}",
            String::from_utf8_lossy(&outputs)
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn close_session_terminates_long_running_process() {
        let slots = vec![slot("slot-1", false)];
        let defs = vec![session_def("def-1", "slot-1", "sleep 30")];
        let (pm, _emitter) = make_pm(slots, defs);
        let sid = pm.open_session_instance("def-1").await.expect("open");

        // Give the shell time to actually exec sleep.
        tokio::time::sleep(Duration::from_millis(200)).await;
        pm.close_session(&sid).await;
        // Should be gone immediately.
        let states = pm.list_session_states().await;
        assert!(states.iter().all(|s| s.instance.id != sid));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn agent_signal_with_no_matching_session_returns_none() {
        let slots = vec![slot("slot-1", false)];
        let defs = vec![session_def("def-1", "slot-1", "echo hi")];
        let (pm, _emitter) = make_pm(slots, defs);
        let signal = AgentCliSignal {
            slot_id: "slot-1".to_string(),
            source: super::super::types::AgentVendor::ClaudeCode,
            payload_base64: None,
        };
        // No open sessions yet.
        assert!(pm.record_agent_cli_signal(&signal).await.is_none());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn update_session_definition_propagates_to_open_instances() {
        let slots = vec![slot("slot-1", false)];
        let defs = vec![session_def("def-1", "slot-1", "sleep 30")];
        let (pm, emitter) = make_pm(slots, defs);
        let _sid = pm.open_session_instance("def-1").await.expect("open");
        tokio::time::sleep(Duration::from_millis(100)).await;

        let before_count = emitter.0.lock().unwrap().states.len();
        pm.update_session_definition(SessionDefinitionMutation {
            id: "def-1".into(),
            name: Some("renamed".into()),
            ..Default::default()
        })
        .await;
        let (after_count, last_name) = {
            let after = emitter.0.lock().unwrap();
            let count = after.states.len();
            let name = after.states.last().unwrap().name.clone();
            (count, name)
        };
        assert!(after_count > before_count);
        assert_eq!(last_name, "renamed");

        pm.close_all_sessions().await;
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn slot_state_aggregates_session_capabilities() {
        let slots = vec![slot("slot-1", false)];
        let defs = vec![session_def("def-1", "slot-1", "sleep 30")];
        let (pm, _emitter) = make_pm(slots, defs);
        let _sid = pm.open_session_instance("def-1").await.expect("open");
        tokio::time::sleep(Duration::from_millis(100)).await;

        let states = pm.list_slot_states().await;
        assert_eq!(states.len(), 1);
        let slot_state = &states[0];
        assert_eq!(slot_state.session_ids.len(), 1);
        // A running session should grant focus, pause, stop, restart.
        assert!(slot_state.capabilities.can_focus);
        assert!(slot_state.capabilities.can_stop);
        assert!(slot_state.capabilities.can_restart);

        pm.close_all_sessions().await;
    }
}
