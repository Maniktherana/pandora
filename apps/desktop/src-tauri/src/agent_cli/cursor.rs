use std::fs;
use std::path::Path;

use serde_json::{json, Value};

use super::constants::CURSOR_HOOKS_PATH;
use super::hooks::{event_script_command, merge_flat_event};
use super::paths::user_home;

pub(super) fn ensure_cursor_hooks(event_script: &Path) -> Result<(), String> {
    ensure_cursor_hooks_in_home(&user_home(), event_script)
}

pub(super) fn ensure_cursor_hooks_in_home(
    home: &Path,
    event_script: &Path,
) -> Result<(), String> {
    let hooks_path = home.join(CURSOR_HOOKS_PATH);
    if let Some(parent) = hooks_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let existing = fs::read_to_string(&hooks_path).unwrap_or_else(|_| "{}".to_string());
    let mut root = serde_json::from_str::<Value>(&existing).unwrap_or_else(|_| json!({}));
    let object = root
        .as_object_mut()
        .ok_or_else(|| "Cursor hooks root must be an object".to_string())?;
    object.entry("version").or_insert_with(|| json!(1));
    let hooks = object
        .entry("hooks")
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .ok_or_else(|| "Cursor hooks must be an object".to_string())?;

    for (cursor_event, pandora_event) in [("beforeSubmitPrompt", "Start"), ("stop", "Stop")] {
        let command = event_script_command(event_script, "cursor-agent", pandora_event, None);
        merge_flat_event(
            hooks,
            cursor_event,
            vec![json!({ "command": command })],
            event_script,
            "cursor-agent",
        );
    }

    let formatted = serde_json::to_string_pretty(&root).map_err(|error| error.to_string())?;
    fs::write(&hooks_path, format!("{formatted}\n")).map_err(|error| error.to_string())
}
