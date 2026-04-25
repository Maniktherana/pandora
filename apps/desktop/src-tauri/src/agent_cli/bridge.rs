use std::fs;

use tauri::{AppHandle, Manager};
use tokio::io::AsyncReadExt;
use tokio::net::UnixListener;

use super::paths::agent_socket_path;
use super::types::AgentHookEnvelope;
use crate::daemon_bridge::DaemonState;
use crate::runtime::types::{AgentCliSignal, AgentVendor};

/// Map a hook payload's `source` string into the `AgentVendor` enum the
/// runtime understands. Unknown vendors are dropped so we don't surface
/// garbage signals to the activity tracker.
fn vendor_from_source(s: &str) -> Option<AgentVendor> {
    match s {
        "claude-code" => Some(AgentVendor::ClaudeCode),
        "codex" => Some(AgentVendor::Codex),
        "opencode" => Some(AgentVendor::Opencode),
        "gemini" => Some(AgentVendor::Gemini),
        "cursor-agent" => Some(AgentVendor::CursorAgent),
        "github-copilot" => Some(AgentVendor::GithubCopilot),
        "amp-code" => Some(AgentVendor::AmpCode),
        _ => None,
    }
}

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

        let Some(vendor) = vendor_from_source(envelope.source.as_str()) else {
            continue;
        };

        let signal = AgentCliSignal {
            slot_id: envelope.slot_id,
            source: vendor,
            payload_base64: envelope.payload_base64,
        };

        let runtime_state = app.state::<DaemonState>();
        match runtime_state.inner().get(&envelope.runtime_id).await {
            Some(runtime) => {
                runtime.process_manager.record_agent_cli_signal(&signal).await;
            }
            None => {
                // Hook payloads can race with workspace teardown; log and
                // move on instead of disturbing the agent's terminal.
                eprintln!(
                    "[agent-cli] dropped hook for runtime {}: no runtime registered",
                    envelope.runtime_id
                );
            }
        }
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
