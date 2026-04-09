use std::path::Path;
use std::{fs, io};

use serde_json::{json, Value};

use super::constants::CLAUDE_SETTINGS_PATH;
use super::hooks::{agent_hook_entry, event_name_to_matcher, merge_agent_event};
use super::paths::shell_quote;

pub(super) fn ensure_claude_hooks(helper_path: &Path) -> Result<(), String> {
    ensure_claude_hooks_in_home(&super::paths::user_home(), helper_path)
}

pub(super) fn ensure_claude_hooks_in_home(home: &Path, helper_path: &Path) -> Result<(), String> {
    let settings_path = home.join(CLAUDE_SETTINGS_PATH);
    if let Some(parent) = settings_path.parent() {
        fs::create_dir_all(parent).map_err(|error: io::Error| error.to_string())?;
    }

    let existing = fs::read_to_string(&settings_path).unwrap_or_else(|_| "{}".to_string());
    let mut root = serde_json::from_str::<Value>(&existing).unwrap_or_else(|_| json!({}));
    let hooks = root
        .as_object_mut()
        .ok_or_else(|| "Claude settings root must be an object".to_string())?
        .entry("hooks")
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .ok_or_else(|| "Claude hooks must be an object".to_string())?;

    let command = format!(
        "{} claude-code",
        shell_quote(&helper_path.to_string_lossy())
    );

    merge_agent_event(
        hooks,
        "Notification",
        vec![
            agent_hook_entry(&command, Some("permission_prompt")),
            agent_hook_entry(&command, Some("idle_prompt")),
        ],
        helper_path,
        "claude-code",
    );
    for event_name in [
        "UserPromptSubmit",
        "PreToolUse",
        "PostToolUse",
        "PostToolUseFailure",
        "PermissionRequest",
        "Stop",
        "SessionEnd",
    ] {
        merge_agent_event(
            hooks,
            event_name,
            vec![agent_hook_entry(
                &command,
                event_name_to_matcher(event_name),
            )],
            helper_path,
            "claude-code",
        );
    }

    let formatted = serde_json::to_string_pretty(&root).map_err(|error| error.to_string())?;
    fs::write(&settings_path, format!("{formatted}\n")).map_err(|error| error.to_string())
}
