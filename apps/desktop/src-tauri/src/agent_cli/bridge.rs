use std::fs;

use serde_json::json;
use tauri::{AppHandle, Manager};
use tokio::io::AsyncReadExt;
use tokio::net::UnixListener;

use super::paths::agent_socket_path;
use super::types::AgentHookEnvelope;

async fn handle_hook_connection(app: AppHandle, mut stream: tokio::net::UnixStream) {
    let mut buffer = Vec::new();
    if stream.read_to_end(&mut buffer).await.is_err() {
        return;
    }
    let raw = match String::from_utf8(buffer) {
        Ok(raw) => raw,
        Err(_) => return,
    };

    for line in raw.lines().filter(|line| !line.trim().is_empty()) {
        let envelope = match serde_json::from_str::<AgentHookEnvelope>(line) {
            Ok(envelope) => envelope,
            Err(_) => continue,
        };

        let source = match envelope.source.as_str() {
            "claude-code" | "codex" | "opencode" | "gemini" | "cursor-agent" | "github-copilot"
            | "amp-code" => envelope.source,
            _ => continue,
        };

        let message = json!({
            "type": "agent_cli_signal",
            "signal": {
                "slotID": envelope.slot_id,
                "source": source,
                "payloadBase64": envelope.payload_base64,
            }
        });

        let daemon_state = app.state::<crate::daemon_bridge::DaemonState>();
        let _ = crate::daemon_bridge::send_workspace_message(
            daemon_state.inner(),
            &envelope.runtime_id,
            &message.to_string(),
        )
        .await;
    }
}

pub fn start_agent_cli_bridge(app: AppHandle) {
    let socket_path = agent_socket_path();
    if let Some(parent) = socket_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if socket_path.exists() {
        let _ = fs::remove_file(&socket_path);
    }

    tauri::async_runtime::spawn(async move {
        let listener = match UnixListener::bind(&socket_path) {
            Ok(listener) => listener,
            Err(_) => return,
        };

        loop {
            let (stream, _) = match listener.accept().await {
                Ok(pair) => pair,
                Err(_) => continue,
            };
            let app_handle = app.clone();
            tauri::async_runtime::spawn(async move {
                handle_hook_connection(app_handle, stream).await;
            });
        }
    });
}
