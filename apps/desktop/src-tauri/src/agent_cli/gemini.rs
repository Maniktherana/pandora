use std::fs;
use std::path::Path;

use serde_json::{json, Value};

use super::constants::GEMINI_SETTINGS_PATH;
use super::hooks::{agent_hook_entry, event_script_command, merge_agent_event};
use super::paths::user_home;

pub(super) fn ensure_gemini_hooks(event_script: &Path) -> Result<(), String> {
    ensure_gemini_hooks_in_home(&user_home(), event_script)
}

pub(super) fn ensure_gemini_hooks_in_home(home: &Path, event_script: &Path) -> Result<(), String> {
    let settings_path = home.join(GEMINI_SETTINGS_PATH);
    if let Some(parent) = settings_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let existing = fs::read_to_string(&settings_path).unwrap_or_else(|_| "{}".to_string());
    let mut root = serde_json::from_str::<Value>(&existing).unwrap_or_else(|_| json!({}));
    let hooks = root
        .as_object_mut()
        .ok_or_else(|| "Gemini settings root must be an object".to_string())?
        .entry("hooks")
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .ok_or_else(|| "Gemini hooks must be an object".to_string())?;

    for (gemini_event, pandora_event) in [
        ("BeforeAgent", "Start"),
        ("AfterAgent", "Stop"),
        ("AfterTool", "Start"),
    ] {
        let command = event_script_command(event_script, "gemini", pandora_event, Some("json"));
        merge_agent_event(
            hooks,
            gemini_event,
            vec![agent_hook_entry(&command, None)],
            event_script,
            "gemini",
        );
    }

    let formatted = serde_json::to_string_pretty(&root).map_err(|error| error.to_string())?;
    fs::write(&settings_path, format!("{formatted}\n")).map_err(|error| error.to_string())
}
