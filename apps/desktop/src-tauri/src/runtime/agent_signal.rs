//! Agent CLI hook → activity-state translation.
//!
//! Six vendors emit hook payloads with slightly different shapes; we reduce
//! them to one of five `AgentPhase` values plus optional metadata. This
//! module is intentionally pure (no state, no I/O) so it can be exhaustively
//! snapshot-tested.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde_json::Value;

use super::types::{AgentActivityState, AgentCliSignal, AgentPhase, AgentVendor};

// ---------------------------------------------------------------------------
// Event-name classifiers.
//
// Both `snake_case` and `camelCase` variants are accepted because different
// vendors report differently (Codex sends `task_started`; Cursor uses
// `userPromptSubmitted`; Claude Code uses PascalCase like `UserPromptSubmit`).
// ---------------------------------------------------------------------------

fn is_working_event(name: Option<&str>) -> bool {
    matches!(
        name,
        Some(
            "Start"
                | "UserPromptSubmit"
                | "PostToolUse"
                | "PostToolUseFailure"
                | "BeforeAgent"
                | "AfterTool"
                | "sessionStart"
                | "session_start"
                | "userPromptSubmitted"
                | "user_prompt_submit"
                | "postToolUse"
                | "post_tool_use"
                | "task_started"
                | "exec_command_begin"
                | "PreToolUse"
        )
    )
}

fn is_finished_event(name: Option<&str>) -> bool {
    matches!(
        name,
        Some(
            "Stop"
                | "SessionEnd"
                | "sessionEnd"
                | "session_end"
                | "stop"
                | "task_complete"
                | "agent-turn-complete"
        )
    )
}

fn is_approval_event(name: Option<&str>) -> bool {
    matches!(
        name,
        Some(
            "PermissionRequest"
                | "exec_approval_request"
                | "apply_patch_approval_request"
                | "request_user_input"
        )
    )
}

// ---------------------------------------------------------------------------
// Payload helpers.
// ---------------------------------------------------------------------------

/// Decode and parse `signal.payload_base64` into a JSON object. Returns
/// `None` if the payload is missing, base64 invalid, or not parseable as
/// JSON.
fn parse_payload(signal: &AgentCliSignal) -> Option<Value> {
    let raw = signal.payload_base64.as_deref()?;
    let decoded = STANDARD.decode(raw).ok()?;
    let text = std::str::from_utf8(&decoded).ok()?;
    serde_json::from_str(text).ok()
}

/// Read a non-empty JSON string field, returning `None` for missing/empty
/// values.
fn read_string(payload: Option<&Value>, key: &str) -> Option<String> {
    payload?
        .get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(String::from)
}

/// Extract the event name from a payload, trying the four field names that
/// the various vendors use.
fn read_event_name(payload: Option<&Value>) -> Option<String> {
    read_string(payload, "hook_event_name")
        .or_else(|| read_string(payload, "eventType"))
        .or_else(|| read_string(payload, "event_type"))
        .or_else(|| read_string(payload, "type"))
}

// ---------------------------------------------------------------------------
// Public entry point.
// ---------------------------------------------------------------------------

/// Translate a vendor signal into the next `AgentActivityState`, or `None`
/// if the event isn't actionable.
///
/// Behavioral notes worth preserving:
///   * Codex with no event name (e.g. payload missing) → `finished`. Other
///     vendors require a recognized event.
///   * Claude Code has its own `Notification` sub-type machinery
///     (`permission_prompt` → waiting_approval, `idle_prompt` → waiting_input)
///     that no other vendor uses.
///   * `agentSessionID` is read from `session_id` for non-Codex vendors;
///     Codex doesn't expose one.
pub fn next_agent_activity(signal: &AgentCliSignal, now_iso8601: &str) -> Option<AgentActivityState> {
    let payload = parse_payload(signal);
    let event_name = read_event_name(payload.as_ref());
    let event = event_name.as_deref();

    // Codex special case: signals without payloads still count as "finished"
    // because that's how the codex hook indicates turn-end.
    if signal.source == AgentVendor::Codex {
        let phase = if is_approval_event(event) {
            AgentPhase::WaitingApproval
        } else if is_working_event(event) {
            AgentPhase::Working
        } else if is_finished_event(event) || event.is_none() {
            AgentPhase::Finished
        } else {
            return None;
        };
        return Some(AgentActivityState {
            vendor: AgentVendor::Codex,
            phase,
            agent_session_id: None,
            updated_at: now_iso8601.to_string(),
            message: read_string(payload.as_ref(), "message"),
            title: read_string(payload.as_ref(), "title"),
            tool_name: None,
        });
    }

    // Non-Claude-Code vendors share a uniform classifier.
    if signal.source != AgentVendor::ClaudeCode {
        let phase = if is_approval_event(event) {
            AgentPhase::WaitingApproval
        } else if is_working_event(event) {
            AgentPhase::Working
        } else if is_finished_event(event) || event.is_none() {
            AgentPhase::Finished
        } else {
            return None;
        };
        return Some(AgentActivityState {
            vendor: signal.source,
            phase,
            agent_session_id: read_string(payload.as_ref(), "session_id"),
            updated_at: now_iso8601.to_string(),
            message: read_string(payload.as_ref(), "message"),
            title: read_string(payload.as_ref(), "title"),
            tool_name: read_string(payload.as_ref(), "tool_name"),
        });
    }

    // Claude Code: extra Notification sub-types.
    let notification_type = read_string(payload.as_ref(), "notification_type");
    let phase = match (event, notification_type.as_deref()) {
        (Some("SessionStart"), _) => AgentPhase::Idle,
        (Some("Notification"), Some("permission_prompt")) => AgentPhase::WaitingApproval,
        (Some("Notification"), Some("idle_prompt")) => AgentPhase::WaitingInput,
        (Some("PermissionRequest"), _) => AgentPhase::WaitingApproval,
        (e, _) if is_approval_event(e) => AgentPhase::WaitingApproval,
        (e, _) if is_working_event(e) => AgentPhase::Working,
        (e, _) if is_finished_event(e) => AgentPhase::Finished,
        _ => return None,
    };

    Some(AgentActivityState {
        vendor: AgentVendor::ClaudeCode,
        phase,
        agent_session_id: read_string(payload.as_ref(), "session_id"),
        updated_at: now_iso8601.to_string(),
        message: read_string(payload.as_ref(), "message"),
        title: read_string(payload.as_ref(), "title"),
        tool_name: read_string(payload.as_ref(), "tool_name"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn encode(payload: serde_json::Value) -> Option<String> {
        Some(STANDARD.encode(serde_json::to_string(&payload).unwrap()))
    }

    fn signal(source: AgentVendor, payload: Option<serde_json::Value>) -> AgentCliSignal {
        AgentCliSignal {
            slot_id: "slot-1".to_string(),
            source,
            payload_base64: payload.and_then(encode),
        }
    }

    const NOW: &str = "2025-01-01T00:00:00Z";

    // ---- Vendor round-trip tests -------------------------------------------

    #[test]
    fn claude_code_user_prompt_submit_is_working() {
        let s = signal(
            AgentVendor::ClaudeCode,
            Some(json!({
                "hook_event_name": "UserPromptSubmit",
                "session_id": "claude-session-1",
            })),
        );
        let activity = next_agent_activity(&s, NOW).unwrap();
        assert_eq!(activity.vendor, AgentVendor::ClaudeCode);
        assert_eq!(activity.phase, AgentPhase::Working);
        assert_eq!(activity.agent_session_id.as_deref(), Some("claude-session-1"));
    }

    #[test]
    fn claude_code_permission_request_is_waiting_approval() {
        let s = signal(
            AgentVendor::ClaudeCode,
            Some(json!({
                "hook_event_name": "PermissionRequest",
                "session_id": "claude-session-1",
            })),
        );
        let activity = next_agent_activity(&s, NOW).unwrap();
        assert_eq!(activity.phase, AgentPhase::WaitingApproval);
    }

    #[test]
    fn claude_code_notification_idle_prompt_is_waiting_input() {
        let s = signal(
            AgentVendor::ClaudeCode,
            Some(json!({
                "hook_event_name": "Notification",
                "notification_type": "idle_prompt",
            })),
        );
        let activity = next_agent_activity(&s, NOW).unwrap();
        assert_eq!(activity.phase, AgentPhase::WaitingInput);
    }

    #[test]
    fn claude_code_session_start_is_idle() {
        let s = signal(
            AgentVendor::ClaudeCode,
            Some(json!({"hook_event_name": "SessionStart"})),
        );
        let activity = next_agent_activity(&s, NOW).unwrap();
        assert_eq!(activity.phase, AgentPhase::Idle);
    }

    #[test]
    fn claude_code_unknown_event_returns_none() {
        let s = signal(
            AgentVendor::ClaudeCode,
            Some(json!({"hook_event_name": "Banana"})),
        );
        assert!(next_agent_activity(&s, NOW).is_none());
    }

    #[test]
    fn codex_user_prompt_submit_is_working() {
        let s = signal(
            AgentVendor::Codex,
            Some(json!({"hook_event_name": "UserPromptSubmit"})),
        );
        let activity = next_agent_activity(&s, NOW).unwrap();
        assert_eq!(activity.vendor, AgentVendor::Codex);
        assert_eq!(activity.phase, AgentPhase::Working);
        assert!(activity.agent_session_id.is_none());
    }

    #[test]
    fn codex_with_no_payload_is_finished() {
        let s = signal(AgentVendor::Codex, None);
        let activity = next_agent_activity(&s, NOW).unwrap();
        assert_eq!(activity.vendor, AgentVendor::Codex);
        assert_eq!(activity.phase, AgentPhase::Finished);
    }

    #[test]
    fn codex_exec_approval_request_is_waiting_approval() {
        let s = signal(
            AgentVendor::Codex,
            Some(json!({"type": "exec_approval_request"})),
        );
        let activity = next_agent_activity(&s, NOW).unwrap();
        assert_eq!(activity.phase, AgentPhase::WaitingApproval);
    }

    // ---- Other vendors --------------------------------------------------

    #[test]
    fn cursor_agent_user_prompt_submitted_camelcase_is_working() {
        let s = signal(
            AgentVendor::CursorAgent,
            Some(json!({"eventType": "userPromptSubmitted"})),
        );
        let activity = next_agent_activity(&s, NOW).unwrap();
        assert_eq!(activity.vendor, AgentVendor::CursorAgent);
        assert_eq!(activity.phase, AgentPhase::Working);
    }

    #[test]
    fn gemini_agent_turn_complete_is_finished() {
        let s = signal(
            AgentVendor::Gemini,
            Some(json!({"event_type": "agent-turn-complete"})),
        );
        let activity = next_agent_activity(&s, NOW).unwrap();
        assert_eq!(activity.phase, AgentPhase::Finished);
    }

    #[test]
    fn opencode_unknown_event_returns_none() {
        let s = signal(
            AgentVendor::Opencode,
            Some(json!({"event_type": "unrelated"})),
        );
        assert!(next_agent_activity(&s, NOW).is_none());
    }

    #[test]
    fn non_codex_vendor_with_no_payload_is_finished() {
        let s = signal(AgentVendor::Gemini, None);
        let activity = next_agent_activity(&s, NOW).unwrap();
        assert_eq!(activity.phase, AgentPhase::Finished);
    }

    #[test]
    fn malformed_base64_is_treated_as_no_payload() {
        let s = AgentCliSignal {
            slot_id: "slot-1".to_string(),
            source: AgentVendor::Codex,
            payload_base64: Some("@@not-base64@@".to_string()),
        };
        let activity = next_agent_activity(&s, NOW).unwrap();
        // Codex falls through to finished when payload can't be parsed.
        assert_eq!(activity.phase, AgentPhase::Finished);
    }

    #[test]
    fn message_and_title_are_passed_through() {
        let s = signal(
            AgentVendor::ClaudeCode,
            Some(json!({
                "hook_event_name": "UserPromptSubmit",
                "message": "hi",
                "title": "claude-3.5",
                "tool_name": "edit_file",
            })),
        );
        let activity = next_agent_activity(&s, NOW).unwrap();
        assert_eq!(activity.message.as_deref(), Some("hi"));
        assert_eq!(activity.title.as_deref(), Some("claude-3.5"));
        assert_eq!(activity.tool_name.as_deref(), Some("edit_file"));
    }
}
