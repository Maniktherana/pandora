//! Renderer-facing IPC boundary for domain registries.
//!
//! Holds four domain registries as a single `DomainRegistries` Tauri state
//! value and routes incoming `IpcCommand`s to the correct domain service.
//!
//! Two scope flavors, distinguished by key convention:
//! - **Workspace scope** — key = workspace UUID; root is the workspace worktree.
//! - **Project scope**  — key = `project:<project_id>`; root is the project git root.

use crate::commands::DbState;
use crate::database::{AppDatabase, SessionDefinitionPatch, SlotDefinitionPatch};
use crate::runtime::editor_io::registry::{open_editor_io, EditorIoRegistry};
use crate::runtime::file_tree::registry::{open_file_tree, FileTreeRegistry};
use crate::runtime::scm::registry::{open_scm, ScmRegistry};
use crate::runtime::terminal::process_manager::ScopeEmitter;
use crate::runtime::terminal::registry::{open_terminal_scope, TerminalRegistry};
use crate::runtime::types::{
    DetectedPort, FileTreeEntry, FileTreeSnapshot, IpcCommand, ScopeEvent, ScopeEventEnvelope,
    SessionState, SlotState,
};
use crate::surface_registry::SurfaceRegistry;
use async_trait::async_trait;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine as _;
use bytes::Bytes;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};

// ---------------------------------------------------------------------------
// State type
// ---------------------------------------------------------------------------

/// Four domain registries bundled as a single Tauri-managed value.
/// Each registry is cheaply cloneable (inner `Arc<Mutex<…>>`).
#[derive(Clone, Default)]
pub struct DomainRegistries {
    pub terminal: TerminalRegistry,
    pub file_tree: FileTreeRegistry,
    pub scm: ScmRegistry,
    pub editor_io: EditorIoRegistry,
}

impl DomainRegistries {
    pub fn new() -> Self {
        Self::default()
    }
}

// ---------------------------------------------------------------------------
// Tauri event emission
// ---------------------------------------------------------------------------

/// Publishes domain state changes and terminal output as typed Tauri events.
/// Output also fans out into the surface registry so native terminals receive
/// the same bytes as renderer-side terminals.
struct TauriEventEmitter {
    app: AppHandle,
    scope_id: String,
    surface_registry: Arc<SurfaceRegistry>,
}

impl TauriEventEmitter {
    fn emit_event(&self, event: ScopeEvent) {
        let envelope = ScopeEventEnvelope {
            scope_id: self.scope_id.clone(),
            event,
        };
        if let Err(err) = self.app.emit("runtime-event", envelope) {
            eprintln!("[runtime-ipc] emit runtime-event failed: {err}");
        }
    }
}

#[async_trait]
impl ScopeEmitter for TauriEventEmitter {
    async fn session_state_changed(&self, state: SessionState) {
        tracing::debug!(
            scope_id = %self.scope_id,
            session_id = %state.instance.id,
            status = ?state.instance.status,
            "session state changed"
        );
        self.emit_event(ScopeEvent::SessionStateChanged { session: state });
    }

    async fn output_chunk(&self, session_id: &str, data: Bytes) {
        // Native terminal surfaces expect raw bytes — feed the registry
        // first so Ghostty doesn't fall behind the renderer event stream.
        self.surface_registry
            .feed_output(&self.app, session_id, &data);

        self.emit_event(ScopeEvent::OutputChunk {
            session_id: session_id.to_string(),
            data: BASE64_STANDARD.encode(&data),
        });
    }

    async fn ports_changed(&self, ports: Vec<DetectedPort>) {
        self.emit_event(ScopeEvent::PortsSnapshot { ports });
    }

    async fn slot_snapshot(&self, slots: Vec<SlotState>) {
        tracing::info!(scope_id = %self.scope_id, count = slots.len(), "emitting slot_snapshot");
        self.emit_event(ScopeEvent::SlotSnapshot { slots });
    }

    async fn session_snapshot(&self, sessions: Vec<SessionState>) {
        tracing::info!(scope_id = %self.scope_id, count = sessions.len(), "emitting session_snapshot");
        self.emit_event(ScopeEvent::SessionSnapshot { sessions });
    }

    async fn file_tree_snapshot(&self, snapshot: FileTreeSnapshot) {
        self.emit_event(ScopeEvent::FileTreeSnapshot { snapshot });
    }

    async fn file_tree_directory_changed(&self, path: String, entries: Vec<FileTreeEntry>) {
        self.emit_event(ScopeEvent::FileTreeDirectoryChanged { path, entries });
    }

    async fn file_tree_file_read(
        &self,
        request_id: String,
        relative_path: String,
        contents: Option<String>,
    ) {
        self.emit_event(ScopeEvent::FileTreeFileRead {
            request_id,
            relative_path,
            contents,
        });
    }

    async fn file_tree_file_written(&self, request_id: String, relative_path: String) {
        self.emit_event(ScopeEvent::FileTreeFileWritten {
            request_id,
            relative_path,
        });
    }

    async fn file_tree_error(&self, request_id: Option<String>, message: String) {
        self.emit_event(ScopeEvent::FileTreeError {
            request_id,
            message,
        });
    }

    async fn scm_snapshot(&self, snapshot: crate::runtime::types::ScmSnapshot) {
        self.emit_event(ScopeEvent::ScmSnapshot { snapshot });
    }

    async fn scm_refreshing(&self) {
        self.emit_event(ScopeEvent::ScmRefreshing);
    }

    async fn scm_operation_started(&self, op_id: String) {
        self.emit_event(ScopeEvent::ScmOperationStarted { op_id });
    }

    async fn scm_error(&self, message: String) {
        self.emit_event(ScopeEvent::ScmError { message });
    }

    async fn editor_file_read(
        &self,
        request_id: String,
        relative_path: String,
        contents: Option<String>,
    ) {
        self.emit_event(ScopeEvent::EditorFileRead {
            request_id,
            relative_path,
            contents,
        });
    }

    async fn editor_file_written(&self, request_id: String, relative_path: String) {
        self.emit_event(ScopeEvent::EditorFileWritten {
            request_id,
            relative_path,
        });
    }

    async fn editor_file_changed(&self, relative_path: String) {
        self.emit_event(ScopeEvent::EditorFileChanged { relative_path });
    }

    async fn editor_error(&self, request_id: Option<String>, message: String) {
        self.emit_event(ScopeEvent::EditorError {
            request_id,
            message,
        });
    }
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

pub async fn stop_scope(registries: &DomainRegistries, scope_id: &str) {
    registries.terminal.close(scope_id).await;
    registries.file_tree.remove(scope_id).await;
    registries.scm.remove(scope_id).await;
    registries.editor_io.remove(scope_id).await;
}

/// Parse a JSON `IpcCommand` and dispatch it to the correct domain service.
pub async fn send_domain_command(
    app: AppHandle,
    registries: &DomainRegistries,
    db: Arc<AppDatabase>,
    scope_id: &str,
    message: &str,
) -> Result<(), String> {
    let cmd: IpcCommand =
        serde_json::from_str(message).map_err(|e| format!("invalid command: {e}"))?;
    dispatch(app, registries, db, scope_id, cmd).await
}

/// Write raw bytes to a session's PTY — used by the native surface hot path.
pub async fn write_to_session(
    registries: &DomainRegistries,
    scope_id: &str,
    session_id: &str,
    data: &[u8],
) -> Result<(), String> {
    let scope = registries
        .terminal
        .get(scope_id)
        .await
        .ok_or_else(|| format!("no terminal scope: {scope_id}"))?;
    scope.process_manager.write_to_session(session_id, data).await;
    Ok(())
}

pub async fn resize_session(
    registries: &DomainRegistries,
    scope_id: &str,
    session_id: &str,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let scope = registries
        .terminal
        .get(scope_id)
        .await
        .ok_or_else(|| format!("no terminal scope: {scope_id}"))?;
    scope
        .process_manager
        .resize_session(session_id, cols, rows)
        .await;
    Ok(())
}

// ---------------------------------------------------------------------------
// Command dispatch
// ---------------------------------------------------------------------------

async fn dispatch(
    app: AppHandle,
    registries: &DomainRegistries,
    db: Arc<AppDatabase>,
    scope_id: &str,
    cmd: IpcCommand,
) -> Result<(), String> {
    match cmd {
        // ---- Terminal --------------------------------------------------
        IpcCommand::CreateSlot { slot } => {
            let scope = ensure_terminal(registries, &db, &app, scope_id).await?;
            db.create_slot_definition(scope_id, &slot)?;
            scope.process_manager.register_slot(slot).await;
            scope.process_manager.emit_snapshots().await;
        }
        IpcCommand::UpdateSlot { slot } => {
            let scope = ensure_terminal(registries, &db, &app, scope_id).await?;
            db.update_slot_definition(
                scope_id,
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
            scope
                .process_manager
                .update_slot_definition(
                    crate::runtime::terminal::process_manager::SlotDefinitionMutation {
                        id: slot.id,
                        kind: slot.kind,
                        name: slot.name,
                        autostart: slot.autostart,
                        presentation_mode: slot.presentation_mode,
                        primary_session_def_id: slot.primary_session_def_id,
                        persisted: slot.persisted,
                        sort_order: slot.sort_order,
                    },
                )
                .await;
            scope.process_manager.emit_snapshots().await;
        }
        IpcCommand::RemoveSlot { slot_id } => {
            let scope = ensure_terminal(registries, &db, &app, scope_id).await?;
            scope.process_manager.remove_slot(&slot_id).await;
            db.remove_slot_definition(scope_id, &slot_id)?;
            scope.process_manager.emit_snapshots().await;
        }
        IpcCommand::CreateSessionDef { session } => {
            let scope = ensure_terminal(registries, &db, &app, scope_id).await?;
            db.create_session_definition(scope_id, &session)?;
            scope.process_manager.register_session_definition(session).await;
            scope.process_manager.emit_snapshots().await;
        }
        IpcCommand::UpdateSessionDef { session } => {
            let scope = ensure_terminal(registries, &db, &app, scope_id).await?;
            db.update_session_definition(
                scope_id,
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
            scope
                .process_manager
                .update_session_definition(
                    crate::runtime::terminal::process_manager::SessionDefinitionMutation {
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
            scope.process_manager.emit_snapshots().await;
        }
        IpcCommand::RemoveSessionDef { session_def_id } => {
            let scope = ensure_terminal(registries, &db, &app, scope_id).await?;
            scope
                .process_manager
                .remove_session_definition(&session_def_id)
                .await;
            db.remove_session_definition(scope_id, &session_def_id)?;
            scope.process_manager.emit_snapshots().await;
        }
        IpcCommand::StartSlot { slot_id } => {
            let scope = ensure_terminal(registries, &db, &app, scope_id).await?;
            scope.process_manager.start_slot(&slot_id).await;
            scope.process_manager.emit_snapshots().await;
        }
        IpcCommand::StopSlot { slot_id } => {
            let scope = ensure_terminal(registries, &db, &app, scope_id).await?;
            scope.process_manager.stop_slot(&slot_id).await;
            scope.process_manager.emit_snapshots().await;
        }
        IpcCommand::RestartSlot { slot_id } => {
            let scope = ensure_terminal(registries, &db, &app, scope_id).await?;
            scope.process_manager.restart_slot(&slot_id).await;
            scope.process_manager.emit_snapshots().await;
        }
        IpcCommand::PauseSlot { slot_id } => {
            let scope = ensure_terminal(registries, &db, &app, scope_id).await?;
            scope.process_manager.pause_slot(&slot_id).await;
            scope.process_manager.emit_snapshots().await;
        }
        IpcCommand::ResumeSlot { slot_id } => {
            let scope = ensure_terminal(registries, &db, &app, scope_id).await?;
            scope.process_manager.resume_slot(&slot_id).await;
            scope.process_manager.emit_snapshots().await;
        }
        IpcCommand::StartSession { session_id } => {
            let scope = ensure_terminal(registries, &db, &app, scope_id).await?;
            scope.process_manager.start_session(&session_id).await;
            scope.process_manager.emit_snapshots().await;
        }
        IpcCommand::StopSession { session_id } => {
            let scope = ensure_terminal(registries, &db, &app, scope_id).await?;
            scope.process_manager.stop_session(&session_id).await;
            scope.process_manager.emit_snapshots().await;
        }
        IpcCommand::RestartSession { session_id } => {
            let scope = ensure_terminal(registries, &db, &app, scope_id).await?;
            scope.process_manager.restart_session(&session_id).await;
            scope.process_manager.emit_snapshots().await;
        }
        IpcCommand::PauseSession { session_id } => {
            let scope = ensure_terminal(registries, &db, &app, scope_id).await?;
            scope.process_manager.pause_session(&session_id).await;
            scope.process_manager.emit_snapshots().await;
        }
        IpcCommand::ResumeSession { session_id } => {
            let scope = ensure_terminal(registries, &db, &app, scope_id).await?;
            scope.process_manager.resume_session(&session_id).await;
            scope.process_manager.emit_snapshots().await;
        }
        IpcCommand::OpenSessionInstance { session_def_id } => {
            let scope = ensure_terminal(registries, &db, &app, scope_id).await?;
            scope
                .process_manager
                .open_session_instance(&session_def_id)
                .await?;
            scope.process_manager.emit_snapshots().await;
        }
        IpcCommand::CloseSessionInstance { session_id } => {
            let scope = ensure_terminal(registries, &db, &app, scope_id).await?;
            scope.process_manager.close_session(&session_id).await;
            scope.process_manager.emit_snapshots().await;
        }
        IpcCommand::Input { session_id, data } => {
            let scope = ensure_terminal(registries, &db, &app, scope_id).await?;
            let bytes = BASE64_STANDARD
                .decode(data.as_bytes())
                .map_err(|e| format!("invalid input payload: {e}"))?;
            scope
                .process_manager
                .write_to_session(&session_id, &bytes)
                .await;
        }
        IpcCommand::Resize {
            session_id,
            cols,
            rows,
        } => {
            let scope = ensure_terminal(registries, &db, &app, scope_id).await?;
            scope
                .process_manager
                .resize_session(&session_id, cols, rows)
                .await;
        }
        IpcCommand::RequestSnapshot => {
            ensure_terminal_with_snapshot(registries, &db, &app, scope_id).await?;
        }
        IpcCommand::AgentCliSignal { signal } => {
            let scope = ensure_terminal(registries, &db, &app, scope_id).await?;
            scope.process_manager.record_agent_cli_signal(&signal).await;
        }

        // ---- File tree -------------------------------------------------
        IpcCommand::FileTreeSubscribe { expanded_paths } => {
            let ft = ensure_file_tree(registries, &db, &app, scope_id).await?;
            ft.subscribe(expanded_paths).await;
        }
        IpcCommand::FileTreeSetExpandedPaths { paths } => {
            let ft = ensure_file_tree(registries, &db, &app, scope_id).await?;
            ft.set_expanded_paths(paths).await;
        }
        IpcCommand::FileTreeRefresh { path } => {
            let ft = ensure_file_tree(registries, &db, &app, scope_id).await?;
            ft.refresh(path).await;
        }
        IpcCommand::FileTreeCreateFile {
            parent_relative_path,
            name,
            contents,
        } => {
            let ft = ensure_file_tree(registries, &db, &app, scope_id).await?;
            ft.create_file(parent_relative_path, name, contents).await;
        }
        IpcCommand::FileTreeCreateDirectory { relative_path } => {
            let ft = ensure_file_tree(registries, &db, &app, scope_id).await?;
            ft.create_directory(relative_path).await;
        }
        IpcCommand::FileTreeRename {
            source_relative_path,
            new_name,
        } => {
            let ft = ensure_file_tree(registries, &db, &app, scope_id).await?;
            ft.rename(source_relative_path, new_name).await;
        }
        IpcCommand::FileTreeDelete { relative_path } => {
            let ft = ensure_file_tree(registries, &db, &app, scope_id).await?;
            ft.delete(relative_path).await;
        }
        IpcCommand::FileTreeMove {
            source_relative_path,
            dest_relative_path,
        } => {
            let ft = ensure_file_tree(registries, &db, &app, scope_id).await?;
            ft.move_entry(source_relative_path, dest_relative_path).await;
        }
        IpcCommand::FileTreeCopy {
            source_relative_path,
            dest_relative_path,
        } => {
            let ft = ensure_file_tree(registries, &db, &app, scope_id).await?;
            ft.copy_entry(source_relative_path, dest_relative_path).await;
        }
        IpcCommand::FileTreeImport {
            dest_relative_path,
            source_absolute_paths,
        } => {
            let ft = ensure_file_tree(registries, &db, &app, scope_id).await?;
            ft.import_external(dest_relative_path, source_absolute_paths)
                .await;
        }
        IpcCommand::FileTreeReadTextFile {
            request_id,
            relative_path,
        } => {
            let ft = ensure_file_tree(registries, &db, &app, scope_id).await?;
            ft.read_text_file(request_id, relative_path).await;
        }
        IpcCommand::FileTreeWriteTextFile {
            request_id,
            relative_path,
            contents,
        } => {
            let ft = ensure_file_tree(registries, &db, &app, scope_id).await?;
            ft.write_text_file(request_id, relative_path, contents).await;
        }

        // ---- SCM -------------------------------------------------------
        IpcCommand::ScmSubscribe { target_branch } => {
            let scm = ensure_scm(registries, &db, &app, scope_id).await?;
            scm.subscribe(target_branch).await;
        }
        IpcCommand::ScmRefresh => {
            let scm = ensure_scm(registries, &db, &app, scope_id).await?;
            scm.refresh().await;
        }
        IpcCommand::ScmStage { paths } => {
            let scm = ensure_scm(registries, &db, &app, scope_id).await?;
            scm.stage(paths).await;
        }
        IpcCommand::ScmStageAll => {
            let scm = ensure_scm(registries, &db, &app, scope_id).await?;
            scm.stage_all().await;
        }
        IpcCommand::ScmUnstage { paths } => {
            let scm = ensure_scm(registries, &db, &app, scope_id).await?;
            scm.unstage(paths).await;
        }
        IpcCommand::ScmUnstageAll => {
            let scm = ensure_scm(registries, &db, &app, scope_id).await?;
            scm.unstage_all().await;
        }
        IpcCommand::ScmDiscardTracked { paths } => {
            let scm = ensure_scm(registries, &db, &app, scope_id).await?;
            scm.discard_tracked(paths).await;
        }
        IpcCommand::ScmDiscardUntracked { paths } => {
            let scm = ensure_scm(registries, &db, &app, scope_id).await?;
            scm.discard_untracked(paths).await;
        }
        IpcCommand::ScmCommit { message, push } => {
            let scm = ensure_scm(registries, &db, &app, scope_id).await?;
            scm.commit(message, push).await;
        }
        IpcCommand::ScmPush => {
            let scm = ensure_scm(registries, &db, &app, scope_id).await?;
            scm.push().await;
        }
        IpcCommand::ScmFetch => {
            let scm = ensure_scm(registries, &db, &app, scope_id).await?;
            scm.fetch().await;
        }
        IpcCommand::ScmPull => {
            let scm = ensure_scm(registries, &db, &app, scope_id).await?;
            scm.pull().await;
        }
        IpcCommand::ScmSetTargetBranch { branch } => {
            let scm = ensure_scm(registries, &db, &app, scope_id).await?;
            scm.set_target_branch(branch).await;
        }

        // ---- Editor IO -------------------------------------------------
        IpcCommand::EditorReadTextFile {
            request_id,
            relative_path,
        } => {
            let eio = ensure_editor_io(registries, &db, &app, scope_id).await?;
            eio.read_text_file(request_id, relative_path).await;
        }
        IpcCommand::EditorWriteTextFile {
            request_id,
            relative_path,
            contents,
        } => {
            let eio = ensure_editor_io(registries, &db, &app, scope_id).await?;
            eio.write_text_file(request_id, relative_path, contents).await;
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Domain lookup helpers
// ---------------------------------------------------------------------------

struct ScopeContext {
    root: String,
    default_cwd: String,
}

fn resolve_scope_context(db: &AppDatabase, scope_id: &str) -> Result<ScopeContext, String> {
    if let Some(project_id) = scope_id.strip_prefix("project:") {
        let project = db
            .load_projects()
            .into_iter()
            .find(|p| p.id == project_id)
            .ok_or_else(|| format!("project not found for terminal scope: {project_id}"))?;
        return Ok(ScopeContext {
            root: project.git_root_path.clone(),
            default_cwd: project.git_root_path,
        });
    }

    let workspace = db
        .load_workspaces(None)
        .into_iter()
        .find(|w| w.id == scope_id)
        .ok_or_else(|| format!("workspace not found for scope: {scope_id}"))?;
    let default_cwd = match workspace.workspace_context_subpath.as_deref() {
        Some(subpath) if !subpath.is_empty() => PathBuf::from(&workspace.worktree_path)
            .join(subpath)
            .to_string_lossy()
            .into_owned(),
        _ => workspace.worktree_path.clone(),
    };

    Ok(ScopeContext {
        root: workspace.worktree_path,
        default_cwd,
    })
}

fn make_emitter(app: &AppHandle, scope_id: &str) -> Arc<dyn ScopeEmitter> {
    let surface_registry = app.state::<Arc<SurfaceRegistry>>().inner().clone();
    Arc::new(TauriEventEmitter {
        app: app.clone(),
        scope_id: scope_id.to_string(),
        surface_registry,
    })
}

async fn ensure_terminal(
    registries: &DomainRegistries,
    db: &Arc<AppDatabase>,
    app: &AppHandle,
    scope_id: &str,
) -> Result<crate::runtime::terminal::registry::TerminalScope, String> {
    let context = resolve_scope_context(db.as_ref(), scope_id)?;
    let emitter = make_emitter(app, scope_id);
    let (scope, was_new) = registries
        .terminal
        .get_or_create(scope_id, || {
            open_terminal_scope(
                Arc::clone(db),
                scope_id,
                &context.default_cwd,
                Arc::clone(&emitter),
            )
        })
        .await
        .map_err(|err| format!("open terminal scope failed for {scope_id}: {err}"))?;

    if was_new {
        scope.process_manager.autostart_slots().await;
        scope.process_manager.open_dormant_terminal_sessions().await;
    }
    // Snapshot emission is caller-owned so mutating commands do not leak the
    // pre-mutation view, while RequestSnapshot can still emit explicitly.
    Ok(scope)
}

async fn ensure_terminal_with_snapshot(
    registries: &DomainRegistries,
    db: &Arc<AppDatabase>,
    app: &AppHandle,
    scope_id: &str,
) -> Result<crate::runtime::terminal::registry::TerminalScope, String> {
    let scope = ensure_terminal(registries, db, app, scope_id).await?;
    scope.process_manager.emit_snapshots().await;
    Ok(scope)
}

async fn ensure_file_tree(
    registries: &DomainRegistries,
    db: &Arc<AppDatabase>,
    app: &AppHandle,
    scope_id: &str,
) -> Result<crate::runtime::file_tree::service::FileTreeService, String> {
    let context = resolve_scope_context(db.as_ref(), scope_id)?;
    let emitter = make_emitter(app, scope_id);
    let (service, _) = registries
        .file_tree
        .get_or_create(scope_id, || open_file_tree(scope_id, &context.root, emitter))
        .await
        .map_err(|err| format!("open file tree scope failed for {scope_id}: {err}"))?;
    Ok(service)
}

async fn ensure_scm(
    registries: &DomainRegistries,
    db: &Arc<AppDatabase>,
    app: &AppHandle,
    scope_id: &str,
) -> Result<crate::runtime::scm::service::ScmService, String> {
    let context = resolve_scope_context(db.as_ref(), scope_id)?;
    let emitter = make_emitter(app, scope_id);
    let (service, _) = registries
        .scm
        .get_or_create(scope_id, || {
            open_scm(Arc::clone(db), scope_id, &context.root, emitter)
        })
        .await;
    Ok(service)
}

async fn ensure_editor_io(
    registries: &DomainRegistries,
    db: &Arc<AppDatabase>,
    app: &AppHandle,
    scope_id: &str,
) -> Result<crate::runtime::editor_io::service::EditorIoService, String> {
    let context = resolve_scope_context(db.as_ref(), scope_id)?;
    let emitter = make_emitter(app, scope_id);
    let (service, _) = registries
        .editor_io
        .get_or_create(scope_id, || open_editor_io(scope_id, &context.root, emitter))
        .await
        .map_err(|err| format!("open editor IO scope failed for {scope_id}: {err}"))?;
    Ok(service)
}

// ---------------------------------------------------------------------------
// Tauri command
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn scope_send(
    app: AppHandle,
    state: tauri::State<'_, DomainRegistries>,
    db: tauri::State<'_, DbState>,
    runtime_id: String,
    message: String,
) -> Result<(), String> {
    send_domain_command(app, state.inner(), db.0.clone(), &runtime_id, &message).await
}
