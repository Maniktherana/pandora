//! In-process runtime IPC.
//!
//! This is the renderer-facing boundary for runtime commands and events.
//! It routes Tauri commands into [`crate::runtime::registry::RuntimeRegistry`]
//! and emits typed runtime events back to the renderer.
//!
//! Two flavors of runtime are supported, distinguished only by their key:
//! - **Workspace runtime** — key = workspace UUID; `workspace_path` is the worktree.
//! - **Project runtime** — key = `project:<project_id>`; `workspace_path` is the git root.

use crate::commands::DbState;
use crate::database::{AppDatabase, SessionDefinitionPatch, SlotDefinitionPatch};
use crate::runtime::process_manager::RuntimeEmitter;
use crate::runtime::registry::{Runtime, RuntimeRegistry};
use crate::runtime::types::{
    DetectedPort, FileTreeEntry, FileTreeSnapshot, RuntimeCommand, RuntimeConnectionEvent,
    RuntimeConnectionState, RuntimeEvent, RuntimeEventEnvelope, SessionState, SlotState,
};
use crate::surface_registry::SurfaceRegistry;
use async_trait::async_trait;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine as _;
use bytes::Bytes;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};

pub type RuntimeIpcState = Arc<RuntimeRegistry>;

pub fn new_state() -> RuntimeIpcState {
    Arc::new(RuntimeRegistry::new())
}

// ---------------------------------------------------------------------------
// Tauri event emission
// ---------------------------------------------------------------------------

/// Publishes runtime state changes and terminal output as typed Tauri events.
/// Output also fans out into the surface registry so native terminals receive
/// the same bytes as renderer-side terminals.
struct TauriEventEmitter {
    app: AppHandle,
    runtime_id: String,
    surface_registry: Arc<SurfaceRegistry>,
}

impl TauriEventEmitter {
    fn emit_event(&self, event: RuntimeEvent) {
        let envelope = RuntimeEventEnvelope {
            runtime_id: self.runtime_id.clone(),
            event,
        };
        if let Err(err) = self.app.emit("runtime-event", envelope) {
            eprintln!("[runtime-ipc] emit runtime-event failed: {err}");
        }
    }
}

#[async_trait]
impl RuntimeEmitter for TauriEventEmitter {
    async fn session_state_changed(&self, state: SessionState) {
        tracing::debug!(
            runtime_id = %self.runtime_id,
            session_id = %state.instance.id,
            status = ?state.instance.status,
            "session state changed"
        );
        self.emit_event(RuntimeEvent::SessionStateChanged { session: state });
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
        self.emit_event(RuntimeEvent::OutputChunk {
            session_id: session_id.to_string(),
            data: BASE64_STANDARD.encode(&data),
        });
    }

    async fn ports_changed(&self, ports: Vec<DetectedPort>) {
        self.emit_event(RuntimeEvent::PortsSnapshot { ports });
    }

    async fn slot_snapshot(&self, slots: Vec<SlotState>) {
        tracing::info!(runtime_id = %self.runtime_id, count = slots.len(), "emitting slot_snapshot");
        self.emit_event(RuntimeEvent::SlotSnapshot { slots });
    }

    async fn session_snapshot(&self, sessions: Vec<SessionState>) {
        tracing::info!(runtime_id = %self.runtime_id, count = sessions.len(), "emitting session_snapshot");
        self.emit_event(RuntimeEvent::SessionSnapshot { sessions });
    }

    async fn file_tree_snapshot(&self, snapshot: FileTreeSnapshot) {
        self.emit_event(RuntimeEvent::FileTreeSnapshot { snapshot });
    }

    async fn file_tree_directory_changed(&self, path: String, entries: Vec<FileTreeEntry>) {
        self.emit_event(RuntimeEvent::FileTreeDirectoryChanged { path, entries });
    }

    async fn file_tree_file_read(
        &self,
        request_id: String,
        relative_path: String,
        contents: Option<String>,
    ) {
        self.emit_event(RuntimeEvent::FileTreeFileRead {
            request_id,
            relative_path,
            contents,
        });
    }

    async fn file_tree_file_written(&self, request_id: String, relative_path: String) {
        self.emit_event(RuntimeEvent::FileTreeFileWritten {
            request_id,
            relative_path,
        });
    }

    async fn file_tree_error(&self, request_id: Option<String>, message: String) {
        self.emit_event(RuntimeEvent::FileTreeError {
            request_id,
            message,
        });
    }

    async fn scm_snapshot(&self, snapshot: crate::runtime::types::ScmSnapshot) {
        self.emit_event(RuntimeEvent::ScmSnapshot { snapshot });
    }

    async fn scm_refreshing(&self) {
        self.emit_event(RuntimeEvent::ScmRefreshing);
    }

    async fn scm_operation_started(&self, op_id: String) {
        self.emit_event(RuntimeEvent::ScmOperationStarted { op_id });
    }

    async fn scm_error(&self, message: String) {
        self.emit_event(RuntimeEvent::ScmError { message });
    }

    async fn editor_file_read(
        &self,
        request_id: String,
        relative_path: String,
        contents: Option<String>,
    ) {
        self.emit_event(RuntimeEvent::EditorFileRead {
            request_id,
            relative_path,
            contents,
        });
    }

    async fn editor_file_written(&self, request_id: String, relative_path: String) {
        self.emit_event(RuntimeEvent::EditorFileWritten {
            request_id,
            relative_path,
        });
    }

    async fn editor_file_changed(&self, relative_path: String) {
        self.emit_event(RuntimeEvent::EditorFileChanged { relative_path });
    }

    async fn editor_error(&self, request_id: Option<String>, message: String) {
        self.emit_event(RuntimeEvent::EditorError {
            request_id,
            message,
        });
    }
}

// ---------------------------------------------------------------------------
// Connection-state event helper
// ---------------------------------------------------------------------------

fn emit_connection_state(app: &AppHandle, runtime_id: &str, state: RuntimeConnectionState) {
    tracing::info!(runtime_id, ?state, "emitting runtime-connection");
    let payload = RuntimeConnectionEvent {
        runtime_id: runtime_id.to_string(),
        state,
    };
    if let Err(err) = app.emit("runtime-connection", payload) {
        tracing::error!(runtime_id, %err, "emit runtime-connection failed");
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

fn spawn_start(app: AppHandle, runtime_id: String, workspace_path: String, default_cwd: String) {
    // Heavy work (DB seed, autostart) goes off the main thread.
    tauri::async_runtime::spawn(async move {
        let registry = app.state::<RuntimeIpcState>().inner().clone();
        let db = app.state::<DbState>().inner().0.clone();
        let surface_registry = app.state::<Arc<SurfaceRegistry>>().inner().clone();

        let app_for_emitter = app.clone();
        let runtime_id_for_emitter = runtime_id.clone();
        let surface_registry_for_emitter = Arc::clone(&surface_registry);
        let factory = || {
            let emitter: Arc<dyn RuntimeEmitter> = Arc::new(TauriEventEmitter {
                app: app_for_emitter,
                runtime_id: runtime_id_for_emitter,
                surface_registry: surface_registry_for_emitter,
            });
            Runtime::open(
                Arc::clone(&db),
                &runtime_id,
                &workspace_path,
                &default_cwd,
                emitter,
            )
        };

        let (runtime, was_new) = match registry.get_or_create(&runtime_id, factory).await {
            Ok(rt) => rt,
            Err(err) => {
                eprintln!("[runtime-ipc] start_runtime({runtime_id}) failed: {err}");
                emit_connection_state(&app, &runtime_id, RuntimeConnectionState::Error);
                return;
            }
        };

        emit_connection_state(&app, &runtime_id, RuntimeConnectionState::Connected);
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
            runtime
                .process_manager
                .open_dormant_terminal_sessions()
                .await;
        }
    });
}

pub async fn stop_runtime(state: &RuntimeIpcState, runtime_id: &str) {
    state.close(runtime_id).await;
}

/// Parse a JSON `RuntimeCommand` and dispatch it to the named runtime's
/// process manager. Used by `runtime_send` (renderer → backend) for everything
/// the surface-registry / agent-CLI fast paths don't already cover.
pub async fn send_runtime_command(
    state: &RuntimeIpcState,
    db: &AppDatabase,
    runtime_id: &str,
    message: &str,
) -> Result<(), String> {
    let parsed: RuntimeCommand =
        serde_json::from_str(message).map_err(|e| format!("invalid runtime command: {e}"))?;
    let runtime = state
        .get(runtime_id)
        .await
        .ok_or_else(|| format!("no runtime: {runtime_id}"))?;
    dispatch(&runtime, db, runtime_id, parsed).await
}

/// Synchronous-style helpers used by the macOS surface registry hot path —
/// it has the runtime_id and session_id but doesn't want to round-trip
/// through JSON for every keystroke.
pub async fn write_to_session(
    state: &RuntimeIpcState,
    runtime_id: &str,
    session_id: &str,
    data: &[u8],
) -> Result<(), String> {
    let runtime = state
        .get(runtime_id)
        .await
        .ok_or_else(|| format!("no runtime: {runtime_id}"))?;
    runtime
        .process_manager
        .write_to_session(session_id, data)
        .await;
    Ok(())
}

pub async fn resize_session(
    state: &RuntimeIpcState,
    runtime_id: &str,
    session_id: &str,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let runtime = state
        .get(runtime_id)
        .await
        .ok_or_else(|| format!("no runtime: {runtime_id}"))?;
    runtime
        .process_manager
        .resize_session(session_id, cols, rows)
        .await;
    Ok(())
}

/// Translate one parsed `RuntimeCommand` into the corresponding
/// `ProcessManager` call.
async fn dispatch(
    runtime: &Runtime,
    db: &AppDatabase,
    runtime_id: &str,
    message: RuntimeCommand,
) -> Result<(), String> {
    let pm = &runtime.process_manager;
    match message {
        RuntimeCommand::CreateSlot { slot } => {
            db.create_slot_definition(runtime_id, &slot)?;
            pm.register_slot(slot).await;
            pm.emit_snapshots().await;
        }
        RuntimeCommand::UpdateSlot { slot } => {
            db.update_slot_definition(
                runtime_id,
                &slot.id,
                SlotDefinitionPatch {
                    kind: slot.kind,
                    name: slot.name.clone(),
                    autostart: slot.autostart,
                    presentation_mode: slot.presentation_mode,
                    primary_session_def_id: slot.primary_session_def_id.clone(),
                    persisted: slot.persisted,
                    sort_order: slot.sort_order,
                },
            )?;
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
            pm.emit_snapshots().await;
        }
        RuntimeCommand::RemoveSlot { slot_id } => {
            pm.remove_slot(&slot_id).await;
            db.remove_slot_definition(runtime_id, &slot_id)?;
            pm.emit_snapshots().await;
        }
        RuntimeCommand::CreateSessionDef { session } => {
            db.create_session_definition(runtime_id, &session)?;
            pm.register_session_definition(session).await;
            pm.emit_snapshots().await;
        }
        RuntimeCommand::UpdateSessionDef { session } => {
            db.update_session_definition(
                runtime_id,
                &session.id,
                SessionDefinitionPatch {
                    slot_id: session.slot_id.clone(),
                    kind: session.kind,
                    name: session.name.clone(),
                    command: session.command.clone(),
                    cwd: session.cwd.clone(),
                    port: session.port,
                    env_overrides: session.env_overrides.clone(),
                    restart_policy: session.restart_policy,
                    pause_supported: session.pause_supported,
                    resume_supported: session.resume_supported,
                },
            )?;
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
            pm.emit_snapshots().await;
        }
        RuntimeCommand::RemoveSessionDef { session_def_id } => {
            pm.remove_session_definition(&session_def_id).await;
            db.remove_session_definition(runtime_id, &session_def_id)?;
            pm.emit_snapshots().await;
        }
        RuntimeCommand::StartSlot { slot_id } => {
            pm.start_slot(&slot_id).await;
            pm.emit_snapshots().await;
        }
        RuntimeCommand::StopSlot { slot_id } => {
            pm.stop_slot(&slot_id).await;
            pm.emit_snapshots().await;
        }
        RuntimeCommand::RestartSlot { slot_id } => {
            pm.restart_slot(&slot_id).await;
            pm.emit_snapshots().await;
        }
        RuntimeCommand::PauseSlot { slot_id } => {
            pm.pause_slot(&slot_id).await;
            pm.emit_snapshots().await;
        }
        RuntimeCommand::ResumeSlot { slot_id } => {
            pm.resume_slot(&slot_id).await;
            pm.emit_snapshots().await;
        }
        RuntimeCommand::StartSession { session_id } => {
            pm.start_session(&session_id).await;
            pm.emit_snapshots().await;
        }
        RuntimeCommand::StopSession { session_id } => {
            pm.stop_session(&session_id).await;
            pm.emit_snapshots().await;
        }
        RuntimeCommand::RestartSession { session_id } => {
            pm.restart_session(&session_id).await;
            pm.emit_snapshots().await;
        }
        RuntimeCommand::PauseSession { session_id } => {
            pm.pause_session(&session_id).await;
            pm.emit_snapshots().await;
        }
        RuntimeCommand::ResumeSession { session_id } => {
            pm.resume_session(&session_id).await;
            pm.emit_snapshots().await;
        }
        RuntimeCommand::OpenSessionInstance { session_def_id } => {
            pm.open_session_instance(&session_def_id).await?;
            pm.emit_snapshots().await;
        }
        RuntimeCommand::CloseSessionInstance { session_id } => {
            pm.close_session(&session_id).await;
            pm.emit_snapshots().await;
        }
        RuntimeCommand::Input { session_id, data } => {
            let bytes = BASE64_STANDARD
                .decode(data.as_bytes())
                .map_err(|e| format!("invalid input payload: {e}"))?;
            pm.write_to_session(&session_id, &bytes).await;
        }
        RuntimeCommand::Resize {
            session_id,
            cols,
            rows,
        } => {
            pm.resize_session(&session_id, cols, rows).await;
        }
        RuntimeCommand::RequestSnapshot => {
            // Re-emit current snapshots through the runtime's own emitter
            // so the renderer can rehydrate after a reload.
            pm.emit_snapshots().await;
        }
        RuntimeCommand::AgentCliSignal { signal } => {
            pm.record_agent_cli_signal(&signal).await;
        }

        // ---- File tree -------------------------------------------------
        RuntimeCommand::FileTreeSubscribe { expanded_paths } => {
            runtime.file_tree.subscribe(expanded_paths).await;
        }
        RuntimeCommand::FileTreeSetExpandedPaths { paths } => {
            runtime.file_tree.set_expanded_paths(paths).await;
        }
        RuntimeCommand::FileTreeRefresh { path } => {
            runtime.file_tree.refresh(path).await;
        }
        RuntimeCommand::FileTreeCreateFile {
            parent_relative_path,
            name,
            contents,
        } => {
            runtime
                .file_tree
                .create_file(parent_relative_path, name, contents)
                .await;
        }
        RuntimeCommand::FileTreeCreateDirectory { relative_path } => {
            runtime.file_tree.create_directory(relative_path).await;
        }
        RuntimeCommand::FileTreeRename {
            source_relative_path,
            new_name,
        } => {
            runtime
                .file_tree
                .rename(source_relative_path, new_name)
                .await;
        }
        RuntimeCommand::FileTreeDelete { relative_path } => {
            runtime.file_tree.delete(relative_path).await;
        }
        RuntimeCommand::FileTreeMove {
            source_relative_path,
            dest_relative_path,
        } => {
            runtime
                .file_tree
                .move_entry(source_relative_path, dest_relative_path)
                .await;
        }
        RuntimeCommand::FileTreeCopy {
            source_relative_path,
            dest_relative_path,
        } => {
            runtime
                .file_tree
                .copy_entry(source_relative_path, dest_relative_path)
                .await;
        }
        RuntimeCommand::FileTreeImport {
            dest_relative_path,
            source_absolute_paths,
        } => {
            runtime
                .file_tree
                .import_external(dest_relative_path, source_absolute_paths)
                .await;
        }
        RuntimeCommand::FileTreeReadTextFile {
            request_id,
            relative_path,
        } => {
            runtime
                .file_tree
                .read_text_file(request_id, relative_path)
                .await;
        }
        RuntimeCommand::FileTreeWriteTextFile {
            request_id,
            relative_path,
            contents,
        } => {
            runtime
                .file_tree
                .write_text_file(request_id, relative_path, contents)
                .await;
        }

        // ---- SCM -----------------------------------------------------------
        RuntimeCommand::ScmSubscribe { target_branch } => {
            runtime.scm.subscribe(target_branch).await;
        }
        RuntimeCommand::ScmRefresh => {
            runtime.scm.refresh().await;
        }
        RuntimeCommand::ScmStage { paths } => {
            runtime.scm.stage(paths).await;
        }
        RuntimeCommand::ScmStageAll => {
            runtime.scm.stage_all().await;
        }
        RuntimeCommand::ScmUnstage { paths } => {
            runtime.scm.unstage(paths).await;
        }
        RuntimeCommand::ScmUnstageAll => {
            runtime.scm.unstage_all().await;
        }
        RuntimeCommand::ScmDiscardTracked { paths } => {
            runtime.scm.discard_tracked(paths).await;
        }
        RuntimeCommand::ScmDiscardUntracked { paths } => {
            runtime.scm.discard_untracked(paths).await;
        }
        RuntimeCommand::ScmCommit { message, push } => {
            runtime.scm.commit(message, push).await;
        }
        RuntimeCommand::ScmPush => {
            runtime.scm.push().await;
        }
        RuntimeCommand::ScmFetch => {
            runtime.scm.fetch().await;
        }
        RuntimeCommand::ScmPull => {
            runtime.scm.pull().await;
        }
        RuntimeCommand::ScmSetTargetBranch { branch } => {
            runtime.scm.set_target_branch(branch).await;
        }

        // ---- Editor IO -----------------------------------------------------
        RuntimeCommand::EditorReadTextFile {
            request_id,
            relative_path,
        } => {
            runtime
                .editor_io
                .read_text_file(request_id, relative_path)
                .await;
        }
        RuntimeCommand::EditorWriteTextFile {
            request_id,
            relative_path,
            contents,
        } => {
            runtime
                .editor_io
                .write_text_file(request_id, relative_path, contents)
                .await;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn runtime_send(
    state: tauri::State<'_, RuntimeIpcState>,
    db: tauri::State<'_, DbState>,
    runtime_id: String,
    message: String,
) -> Result<(), String> {
    send_runtime_command(state.inner(), db.0.as_ref(), &runtime_id, &message).await
}
