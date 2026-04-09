use std::path::Path;

use serde_json::{json, Value};

use super::paths::shell_quote;

pub(super) fn agent_hook_entry(command: &str, matcher: Option<&str>) -> Value {
    match matcher {
        Some(matcher) => json!({
            "matcher": matcher,
            "hooks": [
                {
                    "type": "command",
                    "command": command,
                }
            ]
        }),
        None => json!({
            "hooks": [
                {
                    "type": "command",
                    "command": command,
                }
            ]
        }),
    }
}

pub(super) fn event_name_to_matcher(event_name: &str) -> Option<&'static str> {
    match event_name {
        "PostToolUse" | "PostToolUseFailure" | "PermissionRequest" | "PreToolUse" => Some("*"),
        _ => None,
    }
}

pub(super) fn event_script_command(
    event_script: &Path,
    source: &str,
    event_name: &str,
    response: Option<&str>,
) -> String {
    let mut command = format!(
        "{} {} {}",
        shell_quote(&event_script.to_string_lossy()),
        shell_quote(source),
        shell_quote(event_name),
    );
    if let Some(response) = response {
        command.push(' ');
        command.push_str(&shell_quote(response));
    }
    command
}

pub(super) fn is_pandora_agent_entry(entry: &Value, helper_path: &Path, source: &str) -> bool {
    let helper = helper_path.to_string_lossy();
    entry
        .get("hooks")
        .and_then(Value::as_array)
        .map(|hooks| {
            hooks.iter().any(|hook| {
                hook.get("command")
                    .and_then(Value::as_str)
                    .map(|command| command.contains(helper.as_ref()) && command.contains(source))
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false)
}

pub(super) fn merge_agent_event(
    hooks: &mut serde_json::Map<String, Value>,
    event_name: &str,
    new_entries: Vec<Value>,
    helper_path: &Path,
    source: &str,
) {
    let mut merged = hooks
        .remove(event_name)
        .and_then(|value| value.as_array().cloned())
        .unwrap_or_default()
        .into_iter()
        .filter(|entry| !is_pandora_agent_entry(entry, helper_path, source))
        .collect::<Vec<_>>();
    merged.extend(new_entries);
    hooks.insert(event_name.to_string(), Value::Array(merged));
}

pub(super) fn is_pandora_flat_hook_entry(entry: &Value, event_script: &Path, source: &str) -> bool {
    let script = event_script.to_string_lossy();
    entry
        .get("command")
        .or_else(|| entry.get("bash"))
        .and_then(Value::as_str)
        .map(|command| command.contains(script.as_ref()) && command.contains(source))
        .unwrap_or(false)
}

pub(super) fn merge_flat_event(
    hooks: &mut serde_json::Map<String, Value>,
    event_name: &str,
    new_entries: Vec<Value>,
    event_script: &Path,
    source: &str,
) {
    let mut merged = hooks
        .remove(event_name)
        .and_then(|value| value.as_array().cloned())
        .unwrap_or_default()
        .into_iter()
        .filter(|entry| !is_pandora_flat_hook_entry(entry, event_script, source))
        .collect::<Vec<_>>();
    merged.extend(new_entries);
    hooks.insert(event_name.to_string(), Value::Array(merged));
}
