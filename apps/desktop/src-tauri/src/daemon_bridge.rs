//! Daemon bridge — one embedded `pandorad` sidecar process per **runtime** (Unix socket + child).
//!
//! - **Workspace runtime** — key = workspace UUID; `workspace_path` is the worktree; used for
//!   editor + workspace-scoped terminals.
//! - **Project runtime** — key = `project:<project_id>`; `workspace_path` is the git root; one
//!   shared shell per project (bottom panel).

use crate::surface_registry::SurfaceRegistry;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::UnixStream;
use tokio::sync::Mutex;
use tokio::time::{sleep, Duration};

struct WorkspaceRuntime {
    control_writer: Option<tokio::io::WriteHalf<UnixStream>>,
    daemon_process: Option<CommandChild>,
    connected: bool,
}

pub struct DaemonState {
    runtimes: Arc<Mutex<HashMap<String, Arc<Mutex<WorkspaceRuntime>>>>>,
    start_locks: Arc<Mutex<HashMap<String, Arc<Mutex<()>>>>>,
}

impl DaemonState {
    pub fn new() -> Self {
        Self {
            runtimes: Arc::new(Mutex::new(HashMap::new())),
            start_locks: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

fn socket_prefix_for_runtime(workspace_path: &str, runtime_id: &str) -> String {
    let normalized = std::fs::canonicalize(workspace_path)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| workspace_path.to_string());
    let mut hasher = Sha256::new();
    hasher.update(normalized.as_bytes());
    hasher.update(b"\0");
    hasher.update(runtime_id.as_bytes());
    let hash = hex::encode(hasher.finalize());
    let prefix = &hash[..8];
    format!("/tmp/pandora-{}", prefix)
}

fn control_socket_path_for_runtime(workspace_path: &str, runtime_id: &str) -> String {
    format!(
        "{}-ctl.sock",
        socket_prefix_for_runtime(workspace_path, runtime_id)
    )
}

fn data_socket_path_for_runtime(workspace_path: &str, runtime_id: &str) -> String {
    format!(
        "{}-data.sock",
        socket_prefix_for_runtime(workspace_path, runtime_id)
    )
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

async fn read_output_frame(
    stream: &mut tokio::io::ReadHalf<UnixStream>,
) -> Result<(String, Vec<u8>), Box<dyn std::error::Error + Send + Sync>> {
    let mut len_buf = [0u8; 4];
    stream.read_exact(&mut len_buf).await?;
    let len = u32::from_be_bytes(len_buf) as usize;
    if len == 0 || len > 16 * 1024 * 1024 {
        return Err("invalid output frame size".into());
    }

    let mut buf = vec![0u8; len];
    stream.read_exact(&mut buf).await?;
    let session_len = *buf.first().ok_or("missing output frame session length")? as usize;
    if len < 1 + session_len {
        return Err("invalid output frame payload".into());
    }
    let session_id = String::from_utf8(buf[1..1 + session_len].to_vec())?;
    let data = buf[1 + session_len..].to_vec();
    Ok((session_id, data))
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

fn daemon_script_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .resolve("binaries/pandorad-dist/index.js", BaseDirectory::Resource)
        .map_err(|e| e.to_string())
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
    match rt.control_writer.as_mut() {
        Some(writer) => write_lp_message(writer, message)
            .await
            .map_err(|e| e.to_string()),
        None => Err("Not connected to daemon".into()),
    }
}

fn start_daemon_runtime(
    app: AppHandle,
    runtime_id: String,
    workspace_path: String,
    default_cwd: String,
) {
    let state = app.state::<DaemonState>();
    let runtimes = state.runtimes.clone();
    let start_locks = state.start_locks.clone();

    tauri::async_runtime::spawn(async move {
        let lock_arc = {
            let mut locks = start_locks.lock().await;
            locks
                .entry(runtime_id.clone())
                .or_insert_with(|| Arc::new(Mutex::new(())))
                .clone()
        };
        let mut startup_guard = Some(lock_arc.lock().await);

        let existing_runtime = {
            let map = runtimes.lock().await;
            map.get(&runtime_id).cloned()
        };
        if let Some(existing_runtime) = existing_runtime {
            let connected = {
                let rt = existing_runtime.lock().await;
                rt.connected
            };

            if connected {
                tlog!(
                    "DAEMON",
                    "runtime={} already active; replaying connection state + snapshot",
                    runtime_id
                );

                let _ = app.emit(
                    "daemon-connection",
                    serde_json::json!({
                        "workspaceId": runtime_id,
                        "state": "connected"
                    })
                    .to_string(),
                );

                let mut rt = existing_runtime.lock().await;
                if let Some(writer) = rt.control_writer.as_mut() {
                    let _ = write_lp_message(writer, r#"{"type":"request_snapshot"}"#).await;
                }
                return;
            }

            {
                let mut map = runtimes.lock().await;
                map.remove(&runtime_id);
            }

            let mut rt = existing_runtime.lock().await;
            rt.control_writer = None;
            rt.connected = false;
            if let Some(child) = rt.daemon_process.take() {
                let _ = child.kill();
            }
        }

        let runtime = Arc::new(Mutex::new(WorkspaceRuntime {
            control_writer: None,
            daemon_process: None,
            connected: false,
        }));

        {
            let mut map = runtimes.lock().await;
            map.insert(runtime_id.clone(), runtime.clone());
        }

        let pid = std::process::id();
        let pandora_home = crate::git::pandora_home();
        let daemon_script = match daemon_script_path(&app) {
            Ok(path) => path,
            Err(err) => {
                tlog!(
                    "DAEMON",
                    "runtime={} failed to resolve daemon script: {}",
                    runtime_id,
                    err
                );
                eprintln!("Failed to resolve daemon script path: {}", err);
                let mut map = runtimes.lock().await;
                map.remove(&runtime_id);
                let _ = startup_guard.take();
                return;
            }
        };

        let mut sidecar_started = false;
        match app.shell().sidecar("node") {
            Ok(cmd) => match cmd
                .args([
                    daemon_script.to_string_lossy().as_ref(),
                    &workspace_path,
                    &default_cwd,
                    &runtime_id,
                ])
                .env("PANDORA_PARENT_PID", pid.to_string())
                .env("PANDORA_HOME", &pandora_home)
                .env("PANDORA_DB_PATH", crate::database::AppDatabase::db_path(&pandora_home).to_string_lossy().as_ref())
                .spawn()
            {
                Ok((mut rx, child)) => {
                    sidecar_started = true;
                    tlog!(
                        "DAEMON",
                        "runtime={} started node sidecar pid={} script={}",
                        runtime_id,
                        child.pid(),
                        daemon_script.display()
                    );
                    eprintln!("Daemon PID {} for runtime {}", child.pid(), runtime_id);
                    let runtime_for_output = runtime_id.clone();
                    tauri::async_runtime::spawn(async move {
                        while let Some(event) = rx.recv().await {
                            match event {
                                CommandEvent::Stdout(bytes) => {
                                    tlog!(
                                        "DAEMON",
                                        "runtime={} sidecar stdout: {}",
                                        runtime_for_output,
                                        String::from_utf8_lossy(&bytes).trim()
                                    );
                                }
                                CommandEvent::Stderr(bytes) => {
                                    tlog!(
                                        "DAEMON",
                                        "runtime={} sidecar stderr: {}",
                                        runtime_for_output,
                                        String::from_utf8_lossy(&bytes).trim()
                                    );
                                }
                                CommandEvent::Error(err) => {
                                    tlog!(
                                        "DAEMON",
                                        "runtime={} sidecar event error: {}",
                                        runtime_for_output,
                                        err
                                    );
                                }
                                CommandEvent::Terminated(payload) => {
                                    tlog!(
                                        "DAEMON",
                                        "runtime={} sidecar terminated code={:?} signal={:?}",
                                        runtime_for_output,
                                        payload.code,
                                        payload.signal
                                    );
                                }
                                _ => {}
                            }
                        }
                    });
                    let mut rt = runtime.lock().await;
                    rt.daemon_process = Some(child);
                }
                Err(e) => {
                    tlog!(
                        "DAEMON",
                        "runtime={} failed to start node daemon sidecar: {}",
                        runtime_id,
                        e
                    );
                    eprintln!(
                        "Failed to start node daemon sidecar for {}: {}",
                        runtime_id, e
                    );
                }
            },
            Err(e) => {
                tlog!(
                    "DAEMON",
                    "runtime={} failed to resolve node sidecar: {}",
                    runtime_id,
                    e
                );
                eprintln!("Failed to resolve node sidecar: {}", e);
            }
        }

        if !sidecar_started {
            let mut map = runtimes.lock().await;
            map.remove(&runtime_id);
            let _ = startup_guard.take();
            return;
        }

        let control_socket_path = control_socket_path_for_runtime(&workspace_path, &runtime_id);
        let data_socket_path = data_socket_path_for_runtime(&workspace_path, &runtime_id);

        loop {
            let control = loop {
                if std::path::Path::new(&control_socket_path).exists() {
                    if let Ok(sock) = UnixStream::connect(&control_socket_path).await {
                        break sock;
                    }
                }
                sleep(Duration::from_millis(200)).await;
            };

            let data = loop {
                if std::path::Path::new(&data_socket_path).exists() {
                    if let Ok(sock) = UnixStream::connect(&data_socket_path).await {
                        break sock;
                    }
                }
                sleep(Duration::from_millis(200)).await;
            };

            let (mut control_reader, control_writer) = tokio::io::split(control);
            let (mut data_reader, _) = tokio::io::split(data);
            {
                let mut rt = runtime.lock().await;
                rt.control_writer = Some(control_writer);
                rt.connected = true;
            }

            let _ = startup_guard.take();

            tlog!(
                "DAEMON",
                "runtime={} CONNECTED via {} + {}",
                runtime_id,
                control_socket_path,
                data_socket_path
            );

            let _ = app.emit(
                "daemon-connection",
                serde_json::json!({
                    "workspaceId": runtime_id,
                    "state": "connected"
                })
                .to_string(),
            );

            let app_for_control = app.clone();
            let runtime_id_for_control = runtime_id.clone();
            let mut control_task = tauri::async_runtime::spawn(async move {
                let mut msg_count: u64 = 0;
                loop {
                    let t0 = std::time::Instant::now();
                    let msg = read_lp_message(&mut control_reader).await?;
                    msg_count += 1;
                    let read_us = t0.elapsed().as_micros();

                    let wrapped =
                        if let Ok(mut parsed) = serde_json::from_str::<serde_json::Value>(&msg) {
                            if let Some(obj) = parsed.as_object_mut() {
                                obj.insert(
                                    "workspaceId".into(),
                                    serde_json::Value::String(runtime_id_for_control.clone()),
                                );
                            }
                            serde_json::to_string(&parsed).unwrap_or(msg)
                        } else {
                            msg
                        };

                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&wrapped) {
                        let msg_type = parsed.get("type").and_then(|v| v.as_str()).unwrap_or("?");
                        tlog!(
                            "DAEMON",
                            "runtime={} msg #{} type={} len={} read={}µs",
                            runtime_id_for_control,
                            msg_count,
                            msg_type,
                            wrapped.len(),
                            read_us
                        );
                    }

                    let _ = app_for_control.emit("daemon-message", wrapped);
                }

                #[allow(unreachable_code)]
                Ok::<(), Box<dyn std::error::Error + Send + Sync>>(())
            });

            let app_for_data = app.clone();
            let runtime_id_for_data = runtime_id.clone();
            let mut data_task = tauri::async_runtime::spawn(async move {
                let mut output_chunk_count: u64 = 0;
                let mut output_bytes_total: u64 = 0;
                loop {
                    let t0 = std::time::Instant::now();
                    let (session_id, bytes) = read_output_frame(&mut data_reader).await?;
                    output_chunk_count += 1;
                    output_bytes_total += bytes.len() as u64;

                    let registry = app_for_data.state::<Arc<SurfaceRegistry>>();

                    let t_feed = std::time::Instant::now();
                    let routed =
                        registry
                            .inner()
                            .feed_output(&app_for_data, &session_id, bytes.as_slice());
                    let feed_us = t_feed.elapsed().as_micros();

                    if output_chunk_count % 100 == 0 || feed_us > 1000 {
                        tlog!(
                            "DAEMON",
                            "runtime={} output_frame #{} session={} bytes={} routed={} read={}µs feed={}µs total_bytes={}",
                            runtime_id_for_data,
                            output_chunk_count,
                            session_id,
                            bytes.len(),
                            routed,
                            t0.elapsed().as_micros(),
                            feed_us,
                            output_bytes_total
                        );
                    }
                }

                #[allow(unreachable_code)]
                Ok::<(), Box<dyn std::error::Error + Send + Sync>>(())
            });

            let disconnect_reason = tokio::select! {
                control_result = &mut control_task => {
                    match control_result {
                        Ok(Ok(())) => "control socket closed".to_string(),
                        Ok(Err(err)) => format!("control read error: {}", err),
                        Err(err) => format!("control task join error: {}", err),
                    }
                }
                data_result = &mut data_task => {
                    match data_result {
                        Ok(Ok(())) => "data socket closed".to_string(),
                        Ok(Err(err)) => format!("data read error: {}", err),
                        Err(err) => format!("data task join error: {}", err),
                    }
                }
            };

            control_task.abort();
            data_task.abort();

            tlog!(
                "DAEMON",
                "runtime={} DISCONNECTED: {}",
                runtime_id,
                disconnect_reason
            );
            {
                let mut rt = runtime.lock().await;
                rt.control_writer = None;
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

pub fn start_workspace_runtime(
    app: AppHandle,
    workspace_id: String,
    workspace_path: String,
    default_cwd: String,
) {
    start_daemon_runtime(app, workspace_id, workspace_path, default_cwd);
}

pub fn start_project_runtime(
    app: AppHandle,
    project_id: String,
    git_root_path: String,
    default_cwd: String,
) {
    let runtime_id = format!("project:{}", project_id);
    start_daemon_runtime(app, runtime_id, git_root_path, default_cwd);
}

pub async fn stop_workspace_runtime(state: &DaemonState, workspace_id: &str) {
    let mut map = state.runtimes.lock().await;
    if let Some(runtime) = map.remove(workspace_id) {
        let mut rt = runtime.lock().await;
        rt.control_writer = None;
        rt.connected = false;
        if let Some(child) = rt.daemon_process.take() {
            let _ = child.kill();
        }
    }
    let mut locks = state.start_locks.lock().await;
    locks.remove(workspace_id);
}

#[tauri::command]
pub async fn daemon_send(
    state: tauri::State<'_, DaemonState>,
    workspace_id: String,
    message: String,
) -> Result<(), String> {
    send_workspace_message(state.inner(), &workspace_id, &message).await
}
