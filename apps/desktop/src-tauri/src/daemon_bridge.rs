//! In-process runtime bridge.
//!
//! Thin compatibility surface that keeps the existing call sites
//! (commands, surface registry, agent-CLI bridge) and the frontend's
//! `daemon-message` / `daemon-connection` event names stable while
//! delegating all real work — spawning PTYs, batching output, restarting
//! crashed sessions, port detection — to
//! [`crate::runtime::registry::RuntimeRegistry`].
//!
//! Two flavors of runtime are supported, distinguished only by their key:
//! - **Workspace runtime** — key = workspace UUID; `workspace_path` is the worktree.
//! - **Project runtime** — key = `project:<project_id>`; `workspace_path` is the git root.

use crate::commands::DbState;
use crate::runtime::process_manager::RuntimeEmitter;
use crate::runtime::registry::{Runtime, RuntimeRegistry};
use crate::runtime::types::{
    ClientMessage, DaemonMessage, DetectedPort, SessionState, SlotState,
};
use crate::surface_registry::SurfaceRegistry;
use async_trait::async_trait;
use bytes::Bytes;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine as _;
use serde_json::{json, Value};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};

/// Tauri-managed state slot. Aliased to `DaemonState` so existing call sites
/// (commands, surface registry, agent CLI bridge) keep their imports intact;
/// new code should depend on `RuntimeRegistry` directly.
pub type DaemonState = Arc<RuntimeRegistry>;

pub fn new_state() -> DaemonState {
    Arc::new(RuntimeRegistry::new())
}

// ---------------------------------------------------------------------------
// Tauri event bridge
// ---------------------------------------------------------------------------

/// Implementation of [`RuntimeEmitter`] that publishes every state change /
/// output chunk / port snapshot as a `daemon-message` Tauri event with
/// `workspaceId` injected — matches the wire shape the existing
/// `daemon-client.ts` consumes.
///
/// Output also fans out into the surface registry so native (Ghostty)
/// terminals get fed bytes alongside the renderer event stream. The
/// emitter is the single place every PTY chunk passes through.
struct TauriEventEmitter {
    app: AppHandle,
    workspace_id: String,
    surface_registry: Arc<SurfaceRegistry>,
}

impl TauriEventEmitter {
    fn emit_message(&self, message: &DaemonMessage) {
        // Serialize the typed enum, then inject `workspaceId` at the top level
        // so the renderer's router can dispatch by workspace without changing
        // the discriminant shape.
        let mut payload = match serde_json::to_value(message) {
            Ok(v) => v,
            Err(e) => {
                eprintln!("[daemon-bridge] serialize daemon message: {e}");
                return;
            }
        };
        if let Value::Object(map) = &mut payload {
            map.insert("workspaceId".into(), Value::String(self.workspace_id.clone()));
        }
        let serialized = match serde_json::to_string(&payload) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[daemon-bridge] stringify daemon message: {e}");
                return;
            }
        };
        if let Err(err) = self.app.emit("daemon-message", serialized) {
            eprintln!("[daemon-bridge] emit daemon-message failed: {err}");
        }
    }
}

#[async_trait]
impl RuntimeEmitter for TauriEventEmitter {
    async fn session_state_changed(&self, state: SessionState) {
        tracing::debug!(
            workspace_id = %self.workspace_id,
            session_id = %state.instance.id,
            status = ?state.instance.status,
            "session state changed"
        );
        self.emit_message(&DaemonMessage::SessionStateChanged { session: state });
    }

    async fn output_chunk(&self, session_id: &str, data: Bytes) {
        // Native terminal surfaces expect raw bytes — feed the registry
        // first so Ghostty doesn't fall behind the renderer event stream.
        // If no surface is currently routed to this session the registry
        // buffers the data internally (bounded), so this is safe to call
        // unconditionally.
        self.surface_registry
            .feed_output(&self.app, session_id, &data);

        // Renderer-side terminals (xterm.js etc.) receive the same bytes
        // base64-encoded so the IPC layer doesn't have to reckon with
        // ANSI escape sequences that include lone surrogates.
        self.emit_message(&DaemonMessage::OutputChunk {
            session_id: session_id.to_string(),
            data: BASE64_STANDARD.encode(&data),
        });
    }

    async fn ports_changed(&self, ports: Vec<DetectedPort>) {
        self.emit_message(&DaemonMessage::PortsSnapshot { ports });
    }

    async fn slot_snapshot(&self, slots: Vec<SlotState>) {
        tracing::info!(workspace_id = %self.workspace_id, count = slots.len(), "emitting slot_snapshot");
        self.emit_message(&DaemonMessage::SlotSnapshot { slots });
    }

    async fn session_snapshot(&self, sessions: Vec<SessionState>) {
        tracing::info!(workspace_id = %self.workspace_id, count = sessions.len(), "emitting session_snapshot");
        self.emit_message(&DaemonMessage::SessionSnapshot { sessions });
    }
}

// ---------------------------------------------------------------------------
// Connection-state event helper
// ---------------------------------------------------------------------------

fn emit_connection_state(app: &AppHandle, workspace_id: &str, state: &str) {
    tracing::info!(workspace_id, state, "emitting daemon-connection");
    let payload = json!({
        "workspaceId": workspace_id,
        "state": state,
    })
    .to_string();
    if let Err(err) = app.emit("daemon-connection", payload) {
        tracing::error!(workspace_id, %err, "emit daemon-connection failed");
    }
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/// Open or hydrate the workspace runtime, then push initial snapshots so the
/// renderer can render its slot/session list immediately. Idempotent —
/// repeated calls return the cached runtime.
pub fn start_workspace_runtime(
    app: AppHandle,
    workspace_id: String,
    workspace_path: String,
    default_cwd: String,
) {
    spawn_start(app, workspace_id, workspace_path, default_cwd);
}

pub fn start_project_runtime(
    app: AppHandle,
    project_id: String,
    git_root_path: String,
    default_cwd: String,
) {
    let runtime_id = format!("project:{}", project_id);
    spawn_start(app, runtime_id, git_root_path, default_cwd);
}

fn spawn_start(app: AppHandle, runtime_id: String, _workspace_path: String, default_cwd: String) {
    // Heavy work (DB seed, autostart) goes off the main thread.
    tauri::async_runtime::spawn(async move {
        let registry = app.state::<DaemonState>().inner().clone();
        let db = app.state::<DbState>().inner().0.clone();
        let surface_registry = app.state::<Arc<SurfaceRegistry>>().inner().clone();

        let app_for_emitter = app.clone();
        let runtime_id_for_emitter = runtime_id.clone();
        let surface_registry_for_emitter = Arc::clone(&surface_registry);
        let factory = || {
            let emitter: Arc<dyn RuntimeEmitter> = Arc::new(TauriEventEmitter {
                app: app_for_emitter,
                workspace_id: runtime_id_for_emitter,
                surface_registry: surface_registry_for_emitter,
            });
            Runtime::open(db.as_ref(), &runtime_id, &default_cwd, emitter)
        };

        let (runtime, was_new) = match registry.get_or_create(&runtime_id, factory).await {
            Ok(rt) => rt,
            Err(err) => {
                eprintln!("[daemon-bridge] start_runtime({runtime_id}) failed: {err}");
                emit_connection_state(&app, &runtime_id, "error");
                return;
            }
        };

        emit_connection_state(&app, &runtime_id, "connected");
        tracing::info!(runtime_id, was_new, "runtime ready, emitting snapshots");

        // Always re-emit the initial snapshots so a renderer reload can
        // rehydrate from the cached runtime without re-running spawn work.
        runtime.process_manager.emit_snapshots().await;

        // Autostart only on first creation. Reopening a workspace window
        // hits the cached runtime, whose autostart slots are already
        // running — re-firing them would duplicate sessions.
        if was_new {
            runtime.process_manager.autostart_slots().await;
            // The dormant terminal slot is seeded with autostart=false, but
            // the frontend expects at least one running terminal session
            // before it removes the loader. Open a session instance for
            // every terminal_slot that has definitions but no open sessions.
            runtime.process_manager.open_dormant_terminal_sessions().await;
        }
    });
}

pub async fn stop_workspace_runtime(state: &DaemonState, workspace_id: &str) {
    state.close(workspace_id).await;
}

/// Parse a JSON `ClientMessage` and dispatch it to the named runtime's
/// process manager. Used by `daemon_send` (renderer → backend) for everything
/// the surface-registry / agent-CLI fast paths don't already cover.
pub async fn send_workspace_message(
    state: &DaemonState,
    workspace_id: &str,
    message: &str,
) -> Result<(), String> {
    let parsed: ClientMessage = serde_json::from_str(message)
        .map_err(|e| format!("invalid client message: {e}"))?;
    let runtime = state
        .get(workspace_id)
        .await
        .ok_or_else(|| format!("no runtime: {workspace_id}"))?;
    dispatch(&runtime, parsed).await
}

/// Synchronous-style helpers used by the macOS surface registry hot path —
/// it has the workspace_id and session_id but doesn't want to round-trip
/// through JSON for every keystroke.
pub async fn write_to_session(
    state: &DaemonState,
    workspace_id: &str,
    session_id: &str,
    data: &[u8],
) -> Result<(), String> {
    let runtime = state
        .get(workspace_id)
        .await
        .ok_or_else(|| format!("no runtime: {workspace_id}"))?;
    runtime.process_manager.write_to_session(session_id, data).await;
    Ok(())
}

pub async fn resize_session(
    state: &DaemonState,
    workspace_id: &str,
    session_id: &str,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let runtime = state
        .get(workspace_id)
        .await
        .ok_or_else(|| format!("no runtime: {workspace_id}"))?;
    runtime
        .process_manager
        .resize_session(session_id, cols, rows)
        .await;
    Ok(())
}

/// Translate one parsed `ClientMessage` into the corresponding
/// `ProcessManager` call.
async fn dispatch(runtime: &Runtime, message: ClientMessage) -> Result<(), String> {
    let pm = &runtime.process_manager;
    match message {
        ClientMessage::CreateSlot { slot } => pm.register_slot(slot).await,
        ClientMessage::UpdateSlot { slot } => {
            pm.update_slot_definition(crate::runtime::process_manager::SlotDefinitionMutation {
                id: slot.id,
                kind: slot.kind,
                name: slot.name,
                autostart: slot.autostart,
                presentation_mode: slot.presentation_mode,
                primary_session_def_id: slot.primary_session_def_id,
                persisted: slot.persisted,
                sort_order: slot.sort_order,
            })
            .await;
        }
        ClientMessage::RemoveSlot { slot_id } => pm.remove_slot(&slot_id).await,
        ClientMessage::CreateSessionDef { session } => {
            pm.register_session_definition(session).await;
        }
        ClientMessage::UpdateSessionDef { session } => {
            pm.update_session_definition(
                crate::runtime::process_manager::SessionDefinitionMutation {
                    id: session.id,
                    slot_id: session.slot_id,
                    kind: session.kind,
                    name: session.name,
                    command: session.command,
                    cwd: session.cwd,
                    port: session.port,
                    env_overrides: session.env_overrides,
                    restart_policy: session.restart_policy,
                    pause_supported: session.pause_supported,
                    resume_supported: session.resume_supported,
                },
            )
            .await;
        }
        ClientMessage::RemoveSessionDef { session_def_id } => {
            pm.remove_session_definition(&session_def_id).await;
        }
        ClientMessage::StartSlot { slot_id } => pm.start_slot(&slot_id).await,
        ClientMessage::StopSlot { slot_id } => pm.stop_slot(&slot_id).await,
        ClientMessage::RestartSlot { slot_id } => pm.restart_slot(&slot_id).await,
        ClientMessage::PauseSlot { slot_id } => pm.pause_slot(&slot_id).await,
        ClientMessage::ResumeSlot { slot_id } => pm.resume_slot(&slot_id).await,
        ClientMessage::StartSession { session_id } => pm.start_session(&session_id).await,
        ClientMessage::StopSession { session_id } => pm.stop_session(&session_id).await,
        ClientMessage::RestartSession { session_id } => pm.restart_session(&session_id).await,
        ClientMessage::PauseSession { session_id } => pm.pause_session(&session_id).await,
        ClientMessage::ResumeSession { session_id } => pm.resume_session(&session_id).await,
        ClientMessage::OpenSessionInstance { session_def_id } => {
            pm.open_session_instance(&session_def_id).await?;
        }
        ClientMessage::CloseSessionInstance { session_id } => pm.close_session(&session_id).await,
        ClientMessage::Input { session_id, data } => {
            pm.write_to_session(&session_id, data.as_bytes()).await;
        }
        ClientMessage::Resize { session_id, cols, rows } => {
            pm.resize_session(&session_id, cols, rows).await;
        }
        ClientMessage::RequestSnapshot => {
            // Re-emit current snapshots through the runtime's own emitter
            // so the renderer can rehydrate after a reload.
            pm.emit_snapshots().await;
        }
        ClientMessage::AgentCliSignal { signal } => {
            pm.record_agent_cli_signal(&signal).await;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn daemon_send(
    state: tauri::State<'_, DaemonState>,
    workspace_id: String,
    message: String,
) -> Result<(), String> {
    send_workspace_message(state.inner(), &workspace_id, &message).await
}
