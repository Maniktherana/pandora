//! Workspace-scoped daemon bridge.
//!
//! Each workspace gets its own daemon process and Unix socket connection.
//! The frontend sends/receives messages scoped by workspaceId.

use crate::surface_registry::SurfaceRegistry;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine as _;
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

fn socket_path_for_workspace(workspace_path: &str) -> String {
    let normalized = std::fs::canonicalize(workspace_path)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| workspace_path.to_string());
    let mut hasher = Sha256::new();
    hasher.update(normalized.as_bytes());
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

/// Launch a daemon process for a workspace and start reading from its socket.
pub fn start_workspace_runtime(
    app: AppHandle,
    workspace_id: String,
    workspace_path: String,
    default_cwd: String,
) {
    let state = app.state::<DaemonState>();
    let runtimes = state.runtimes.clone();
    let daemon_dir_lock = state.daemon_dir.clone();

    tauri::async_runtime::spawn(async move {
        // Create runtime entry
        let runtime = Arc::new(Mutex::new(WorkspaceRuntime {
            writer: None,
            daemon_process: None,
            connected: false,
        }));

        {
            let mut map = runtimes.lock().await;
            map.insert(workspace_id.clone(), runtime.clone());
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
                .current_dir(&daemon_dir)
                .env("PANDORA_PARENT_PID", pid.to_string())
                .env("PANDORA_HOME", &pandora_home)
                .spawn()
            {
                Ok(child) => {
                    eprintln!(
                        "Daemon PID {:?} for workspace {}",
                        child.id(),
                        workspace_id
                    );
                    let mut rt = runtime.lock().await;
                    rt.daemon_process = Some(child);
                }
                Err(e) => {
                    eprintln!("Failed to start daemon for {}: {}", workspace_id, e);
                }
            }
        }

        // Connect to socket
        let socket_path = socket_path_for_workspace(&workspace_path);

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

            // Emit connection event scoped to workspace
            let _ = app.emit(
                "daemon-connection",
                serde_json::json!({
                    "workspaceId": workspace_id,
                    "state": "connected"
                })
                .to_string(),
            );

            // Read loop
            loop {
                match read_lp_message(&mut reader).await {
                    Ok(msg) => {
                        // Wrap message with workspaceId
                        let wrapped = if let Ok(mut parsed) =
                            serde_json::from_str::<serde_json::Value>(&msg)
                        {
                            if let Some(obj) = parsed.as_object_mut() {
                                obj.insert(
                                    "workspaceId".into(),
                                    serde_json::Value::String(workspace_id.clone()),
                                );
                            }
                            serde_json::to_string(&parsed).unwrap_or(msg)
                        } else {
                            msg
                        };

                        let mut emitted_to_surface = false;
                        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&wrapped) {
                            if parsed.get("type").and_then(|v| v.as_str()) == Some("output_chunk") {
                                if let (Some(session_id), Some(data)) = (
                                    parsed.get("sessionID").and_then(|v| v.as_str()),
                                    parsed.get("data").and_then(|v| v.as_str()),
                                ) {
                                    if let Ok(bytes) = BASE64_STANDARD.decode(data) {
                                        let registry = app.state::<Arc<SurfaceRegistry>>();
                                        emitted_to_surface = registry.feed_output(session_id, &bytes);
                                    }
                                }
                            }
                        }

                        if !emitted_to_surface {
                            let _ = app.emit("daemon-message", wrapped);
                        }
                    }
                    Err(e) => {
                        eprintln!(
                            "Daemon read error for workspace {}: {}",
                            workspace_id, e
                        );
                        break;
                    }
                }
            }

            // Disconnected
            {
                let mut rt = runtime.lock().await;
                rt.writer = None;
                rt.connected = false;
            }
            let _ = app.emit(
                "daemon-connection",
                serde_json::json!({
                    "workspaceId": workspace_id,
                    "state": "disconnected"
                })
                .to_string(),
            );

            // Check if runtime was removed (workspace deleted)
            {
                let map = runtimes.lock().await;
                if !map.contains_key(&workspace_id) {
                    break;
                }
            }

            sleep(Duration::from_secs(1)).await;
        }
    });
}

/// Stop a workspace runtime, killing its daemon process.
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
