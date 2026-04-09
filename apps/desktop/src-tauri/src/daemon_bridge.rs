//! Daemon bridge — one Bun `pandorad` process per **runtime** (Unix socket + child).
//!
//! - **Workspace runtime** — key = workspace UUID; `workspace_path` is the worktree; used for
//!   editor + workspace-scoped terminals.
//! - **Project runtime** — key = `project:<project_id>`; `workspace_path` is the git root; one
//!   shared shell per project (bottom panel). Same binary as the workspace daemon; a future
//!   multiplexed single-process design can merge these without changing the frontend key scheme.
//!
//! Frontend `daemon_send` / events use the runtime id as `workspaceId` for routing.

use crate::surface_registry::SurfaceRegistry;
use base64::Engine;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Command as StdCommand;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::UnixStream;
use tokio::sync::Mutex;
use tokio::time::{sleep, Duration};

/// Per-workspace runtime: owns the daemon process and socket connection.
struct WorkspaceRuntime {
    writer: Option<tokio::io::WriteHalf<UnixStream>>,
    daemon_process: Option<std::process::Child>,
    connected: bool,
}

/// Global state managing all workspace runtimes.
pub struct DaemonState {
    runtimes: Arc<Mutex<HashMap<String, Arc<Mutex<WorkspaceRuntime>>>>>,
    daemon_dir: Arc<Mutex<Option<PathBuf>>>,
}

impl DaemonState {
    pub fn new() -> Self {
        Self {
            runtimes: Arc::new(Mutex::new(HashMap::new())),
            daemon_dir: Arc::new(Mutex::new(None)),
        }
    }
}

/// Socket path must be unique per **runtime** (workspace UUID or `project:…`), not only `workspace_path`.
/// Otherwise a linked workspace (worktree path == git root) spawns two daemons that fought over one
/// socket and one `runtime.db`, causing `SQLITE_BUSY` and broken routing.
fn socket_path_for_runtime(workspace_path: &str, runtime_id: &str) -> String {
    let normalized = std::fs::canonicalize(workspace_path)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| workspace_path.to_string());
    let mut hasher = Sha256::new();
    hasher.update(normalized.as_bytes());
    hasher.update(b"\0");
    hasher.update(runtime_id.as_bytes());
    let hash = hex::encode(hasher.finalize());
    let prefix = &hash[..8];
    format!("/tmp/pandora-{}.sock", prefix)
}

async fn read_lp_message(
    stream: &mut tokio::io::ReadHalf<UnixStream>,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let mut len_buf = [0u8; 4];
    stream.read_exact(&mut len_buf).await?;
    let len = u32::from_be_bytes(len_buf) as usize;
    if len > 10 * 1024 * 1024 {
        return Err("message too large".into());
    }
    let mut buf = vec![0u8; len];
    stream.read_exact(&mut buf).await?;
    Ok(String::from_utf8(buf)?)
}

async fn write_lp_message(
    writer: &mut tokio::io::WriteHalf<UnixStream>,
    msg: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let bytes = msg.as_bytes();
    let len = (bytes.len() as u32).to_be_bytes();
    writer.write_all(&len).await?;
    writer.write_all(bytes).await?;
    writer.flush().await?;
    Ok(())
}

pub async fn send_workspace_message(
    state: &DaemonState,
    workspace_id: &str,
    message: &str,
) -> Result<(), String> {
    let map = state.runtimes.lock().await;
    let runtime = map
        .get(workspace_id)
        .ok_or("No runtime for workspace")?
        .clone();
    drop(map);

    let mut rt = runtime.lock().await;
    match rt.writer.as_mut() {
        Some(writer) => write_lp_message(writer, message)
            .await
            .map_err(|e| e.to_string()),
        None => Err("Not connected to daemon".into()),
    }
}

/// Launch a daemon for the given **runtime id** (workspace UUID or `project:<id>`).
fn start_daemon_runtime(
    app: AppHandle,
    runtime_id: String,
    workspace_path: String,
    default_cwd: String,
) {
    let state = app.state::<DaemonState>();
    let runtimes = state.runtimes.clone();
    let daemon_dir_lock = state.daemon_dir.clone();

    tauri::async_runtime::spawn(async move {
        let existing_runtime = {
            let map = runtimes.lock().await;
            map.get(&runtime_id).cloned()
        };
        if let Some(existing_runtime) = existing_runtime {
            tlog!(
                "DAEMON",
                "runtime={} already active; replaying connection state + snapshot",
                runtime_id
            );

            let connected = {
                let rt = existing_runtime.lock().await;
                rt.connected
            };

            let _ = app.emit(
                "daemon-connection",
                serde_json::json!({
                    "workspaceId": runtime_id,
                    "state": if connected { "connected" } else { "connecting" }
                })
                .to_string(),
            );

            if connected {
                let mut rt = existing_runtime.lock().await;
                if let Some(writer) = rt.writer.as_mut() {
                    let _ = write_lp_message(writer, r#"{"type":"request_snapshot"}"#).await;
                }
            }
            return;
        }

        // Create runtime entry
        let runtime = Arc::new(Mutex::new(WorkspaceRuntime {
            writer: None,
            daemon_process: None,
            connected: false,
        }));

        {
            let mut map = runtimes.lock().await;
            map.insert(runtime_id.clone(), runtime.clone());
        }

        // Resolve daemon directory
        let daemon_dir = {
            let guard = daemon_dir_lock.lock().await;
            guard.clone()
        };

        // Launch daemon process
        if let Some(daemon_dir) = daemon_dir {
            let pid = std::process::id();
            let pandora_home = crate::git::pandora_home();

            match StdCommand::new("bun")
                .arg("run")
                .arg("src/index.ts")
                .arg(&workspace_path)
                .arg(&default_cwd)
                .arg(&runtime_id)
                .current_dir(&daemon_dir)
                .env("PANDORA_PARENT_PID", pid.to_string())
                .env("PANDORA_HOME", &pandora_home)
                .spawn()
            {
                Ok(child) => {
                    eprintln!("Daemon PID {:?} for runtime {}", child.id(), runtime_id);
                    let mut rt = runtime.lock().await;
                    rt.daemon_process = Some(child);
                }
                Err(e) => {
                    eprintln!("Failed to start daemon for {}: {}", runtime_id, e);
                }
            }
        }

        // Connect to socket
        let socket_path = socket_path_for_runtime(&workspace_path, &runtime_id);

        loop {
            // Wait for socket to appear
            let sock = loop {
                if std::path::Path::new(&socket_path).exists() {
                    match UnixStream::connect(&socket_path).await {
                        Ok(s) => break s,
                        Err(_) => {}
                    }
                }
                sleep(Duration::from_millis(200)).await;
            };

            let (mut reader, writer) = tokio::io::split(sock);
            {
                let mut rt = runtime.lock().await;
                rt.writer = Some(writer);
                rt.connected = true;
            }

            tlog!(
                "DAEMON",
                "runtime={} CONNECTED via {}",
                runtime_id,
                socket_path
            );

            // Emit connection event scoped to workspace
            let _ = app.emit(
                "daemon-connection",
                serde_json::json!({
                    "workspaceId": runtime_id,
                    "state": "connected"
                })
                .to_string(),
            );

            // Read loop
            let mut msg_count: u64 = 0;
            let mut output_chunk_count: u64 = 0;
            let mut output_bytes_total: u64 = 0;
            loop {
                let t0 = std::time::Instant::now();
                match read_lp_message(&mut reader).await {
                    Ok(msg) => {
                        msg_count += 1;
                        let read_us = t0.elapsed().as_micros();

                        // Wrap message with workspaceId
                        let wrapped = if let Ok(mut parsed) =
                            serde_json::from_str::<serde_json::Value>(&msg)
                        {
                            if let Some(obj) = parsed.as_object_mut() {
                                obj.insert(
                                    "workspaceId".into(),
                                    serde_json::Value::String(runtime_id.clone()),
                                );
                            }
                            serde_json::to_string(&parsed).unwrap_or(msg)
                        } else {
                            msg
                        };

                        let mut emitted_to_surface = false;
                        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&wrapped) {
                            let msg_type =
                                parsed.get("type").and_then(|v| v.as_str()).unwrap_or("?");

                            if msg_type == "output_chunk" {
                                if let (Some(session_id), Some(data)) = (
                                    parsed.get("sessionID").and_then(|v| v.as_str()),
                                    parsed.get("data").and_then(|v| v.as_str()),
                                ) {
                                    if let Ok(bytes) =
                                        base64::engine::general_purpose::STANDARD.decode(data)
                                    {
                                        output_chunk_count += 1;
                                        output_bytes_total += bytes.len() as u64;
                                        let registry = app.state::<Arc<SurfaceRegistry>>();
                                        let t_feed = std::time::Instant::now();
                                        emitted_to_surface =
                                            registry.inner().feed_output(&app, session_id, &bytes);
                                        let feed_us = t_feed.elapsed().as_micros();

                                        // Log every 100th chunk or if feed was slow.
                                        if output_chunk_count % 100 == 0 || feed_us > 1000 {
                                            tlog!("DAEMON", "runtime={} output_chunk #{} session={} bytes={} routed={} read={}µs feed={}µs total_bytes={}",
                                                runtime_id, output_chunk_count, session_id,
                                                bytes.len(), emitted_to_surface, read_us, feed_us,
                                                output_bytes_total);
                                        }
                                    }
                                }
                            } else {
                                // Log non-output messages (these are infrequent).
                                tlog!(
                                    "DAEMON",
                                    "runtime={} msg #{} type={} len={} read={}µs",
                                    runtime_id,
                                    msg_count,
                                    msg_type,
                                    wrapped.len(),
                                    read_us
                                );
                            }
                        }

                        if !emitted_to_surface {
                            let _ = app.emit("daemon-message", wrapped);
                        }
                    }
                    Err(e) => {
                        tlog!(
                            "DAEMON",
                            "runtime={} READ ERROR after {} msgs ({} output chunks, {} bytes): {}",
                            runtime_id,
                            msg_count,
                            output_chunk_count,
                            output_bytes_total,
                            e
                        );
                        eprintln!("Daemon read error for runtime {}: {}", runtime_id, e);
                        break;
                    }
                }
            }

            // Disconnected
            tlog!("DAEMON", "runtime={} DISCONNECTED", runtime_id);
            {
                let mut rt = runtime.lock().await;
                rt.writer = None;
                rt.connected = false;
            }
            let _ = app.emit(
                "daemon-connection",
                serde_json::json!({
                    "workspaceId": runtime_id,
                    "state": "disconnected"
                })
                .to_string(),
            );

            // Check if runtime was removed (workspace / project deleted)
            {
                let map = runtimes.lock().await;
                if !map.contains_key(&runtime_id) {
                    break;
                }
            }

            sleep(Duration::from_secs(1)).await;
        }
    });
}

/// Workspace-scoped daemon (worktree path + cwd).
pub fn start_workspace_runtime(
    app: AppHandle,
    workspace_id: String,
    workspace_path: String,
    default_cwd: String,
) {
    start_daemon_runtime(app, workspace_id, workspace_path, default_cwd);
}

/// Project-scoped daemon: git root as daemon root, default cwd = repo root (shared bottom terminal).
pub fn start_project_runtime(
    app: AppHandle,
    project_id: String,
    git_root_path: String,
    default_cwd: String,
) {
    let runtime_id = format!("project:{}", project_id);
    start_daemon_runtime(app, runtime_id, git_root_path, default_cwd);
}

/// Stop a runtime (workspace id or `project:<id>`), killing its daemon process.
pub async fn stop_workspace_runtime(state: &DaemonState, workspace_id: &str) {
    let mut map = state.runtimes.lock().await;
    if let Some(runtime) = map.remove(workspace_id) {
        let mut rt = runtime.lock().await;
        rt.writer = None;
        rt.connected = false;
        if let Some(ref mut child) = rt.daemon_process {
            let _ = child.kill();
        }
    }
}

/// Tauri command: send a message to a specific workspace's daemon.
#[tauri::command]
pub async fn daemon_send(
    state: tauri::State<'_, DaemonState>,
    workspace_id: String,
    message: String,
) -> Result<(), String> {
    send_workspace_message(state.inner(), &workspace_id, &message).await
}

/// Store the daemon directory for launching.
pub async fn set_daemon_dir(state: &DaemonState, dir: PathBuf) {
    let mut guard = state.daemon_dir.lock().await;
    *guard = Some(dir);
}
