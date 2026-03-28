//! Direct Unix socket bridge via Tauri commands and events.
//!
//! Instead of a WebSocket proxy, the frontend calls Tauri commands
//! and receives daemon messages via Tauri events — the same pattern
//! as the Swift app's DaemonClient using Unix sockets directly.

use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::UnixStream;
use tokio::sync::Mutex;
use tokio::time::{sleep, Duration};

/// Shared state: the daemon's Unix socket write half.
pub struct DaemonState {
    writer: Arc<Mutex<Option<tokio::io::WriteHalf<UnixStream>>>>,
}

impl DaemonState {
    pub fn new() -> Self {
        Self {
            writer: Arc::new(Mutex::new(None)),
        }
    }
}

fn find_daemon_socket() -> Option<PathBuf> {
    let tmp = std::path::Path::new("/tmp");
    if let Ok(entries) = std::fs::read_dir(tmp) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if name_str.starts_with("pandora-") && name_str.ends_with(".sock") {
                return Some(entry.path());
            }
        }
    }
    None
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

/// Connect to the daemon and start reading messages.
/// Called once from setup; reconnects automatically.
pub fn start_daemon_reader(app: AppHandle) {
    let state = app.state::<DaemonState>();
    let writer = state.writer.clone();

    tokio::spawn(async move {
        loop {
            // Wait for socket to appear
            let socket_path = loop {
                if let Some(path) = find_daemon_socket() {
                    break path;
                }
                sleep(Duration::from_millis(500)).await;
            };

            eprintln!("Connecting to daemon at {:?}", socket_path);

            let stream = match UnixStream::connect(&socket_path).await {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("Failed to connect: {}", e);
                    sleep(Duration::from_secs(1)).await;
                    continue;
                }
            };

            let (mut reader, w) = tokio::io::split(stream);
            {
                let mut guard = writer.lock().await;
                *guard = Some(w);
            }

            eprintln!("Connected to daemon, emitting event");
            match app.emit("daemon-connection", "connected") {
                Ok(_) => eprintln!("Emitted daemon-connection event"),
                Err(e) => eprintln!("Failed to emit event: {}", e),
            }

            // Read loop
            loop {
                match read_lp_message(&mut reader).await {
                    Ok(msg) => {
                        let _ = app.emit("daemon-message", msg);
                    }
                    Err(e) => {
                        eprintln!("Daemon read error: {}", e);
                        break;
                    }
                }
            }

            // Disconnected — clear writer
            {
                let mut guard = writer.lock().await;
                *guard = None;
            }
            let _ = app.emit("daemon-connection", "disconnected");
            eprintln!("Daemon disconnected, will reconnect...");
            sleep(Duration::from_secs(1)).await;
        }
    });
}

/// Tauri command: send a message to the daemon.
#[tauri::command]
pub async fn daemon_send(
    state: tauri::State<'_, DaemonState>,
    message: String,
) -> Result<(), String> {
    let mut guard = state.writer.lock().await;
    match guard.as_mut() {
        Some(writer) => write_lp_message(writer, &message)
            .await
            .map_err(|e| e.to_string()),
        None => Err("Not connected to daemon".into()),
    }
}
