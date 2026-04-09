use std::fs;
use std::os::unix::fs::symlink;
use std::path::Path;

use serde_json::{json, Value};
use toml_edit::{Array, DocumentMut, Item, Value as TomlValue};

use super::hooks::event_script_command;
use super::paths::{shell_quote, user_home, write_executable};

pub(super) fn codex_notify_runner_script(original: &Item) -> Option<String> {
    if let Some(raw) = original.as_str() {
        return Some(format!(
            "#!/bin/sh
set +e
sh -lc {} -- \"$@\"
status=$?
exit \"$status\"
",
            shell_quote(raw)
        ));
    }

    let array = original.as_array()?;
    let parts = array
        .iter()
        .filter_map(|value| value.as_str())
        .collect::<Vec<_>>();
    if parts.is_empty() {
        return None;
    }

    let mut command = shell_quote(parts[0]);
    for arg in parts.iter().skip(1) {
        command.push(' ');
        command.push_str(&shell_quote(arg));
    }

    Some(format!(
        "#!/bin/sh
set +e
{command} \"$@\"
status=$?
exit \"$status\"
",
        command = command
    ))
}

pub(super) fn wrapper_notify_item(wrapper_path: &Path) -> Item {
    let mut array = Array::default();
    array.push(wrapper_path.to_string_lossy().to_string());
    Item::Value(TomlValue::Array(array))
}

pub(super) fn notify_item_matches_wrapper(item: &Item, wrapper_path: &Path) -> bool {
    let wrapper = wrapper_path.to_string_lossy();
    item.as_str()
        .map(|value| value == wrapper)
        .or_else(|| {
            item.as_array().map(|array| {
                array
                    .iter()
                    .filter_map(|value| value.as_str())
                    .collect::<Vec<_>>()
                    == vec![wrapper.as_ref()]
            })
        })
        .unwrap_or(false)
}

pub(super) fn ensure_codex_home(
    codex_home: &Path,
    wrapper_path: &Path,
    next_script: &Path,
    event_script: &Path,
) -> Result<(), String> {
    ensure_codex_home_from_user(
        &user_home().join(".codex"),
        codex_home,
        wrapper_path,
        next_script,
        event_script,
    )
}

pub(super) fn ensure_codex_home_from_user(
    user_codex_home: &Path,
    codex_home: &Path,
    wrapper_path: &Path,
    next_script: &Path,
    event_script: &Path,
) -> Result<(), String> {
    link_codex_home_entry(user_codex_home, codex_home)?;
    ensure_codex_notify_config(&codex_home.join("config.toml"), wrapper_path, next_script)?;
    ensure_codex_hooks_json(codex_home, event_script)
}

#[cfg(test)]
pub(super) fn ensure_codex_notify_in_home(
    home: &Path,
    wrapper_path: &Path,
    next_script: &Path,
) -> Result<(), String> {
    ensure_codex_notify_config(&home.join(super::constants::CODEX_CONFIG_PATH), wrapper_path, next_script)
}

pub(super) fn ensure_codex_notify_config(
    config_path: &Path,
    wrapper_path: &Path,
    next_script: &Path,
) -> Result<(), String> {
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let existing = fs::read_to_string(&config_path).unwrap_or_default();
    let mut document = if existing.trim().is_empty() {
        DocumentMut::new()
    } else {
        existing
            .parse::<DocumentMut>()
            .map_err(|error| error.to_string())?
    };

    let existing_notify = document.get("notify").cloned();
    let wrapper_already_installed = existing_notify
        .as_ref()
        .map(|item| notify_item_matches_wrapper(item, wrapper_path))
        .unwrap_or(false);

    if !wrapper_already_installed {
        if let Some(original_notify) = existing_notify.as_ref() {
            if let Some(script) = codex_notify_runner_script(original_notify) {
                write_executable(next_script, &script)?;
            }
        } else if next_script.exists() {
            let _ = fs::remove_file(next_script);
        }

        document["notify"] = wrapper_notify_item(wrapper_path);
    }

    fs::write(&config_path, document.to_string()).map_err(|error| error.to_string())?;

    Ok(())
}

fn link_codex_home_entry(user_codex_home: &Path, codex_home: &Path) -> Result<(), String> {
    if !user_codex_home.exists() {
        return Ok(());
    }

    fs::create_dir_all(codex_home).map_err(|error| error.to_string())?;
    for entry in fs::read_dir(user_codex_home).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let name = entry.file_name();
        if name == "config.toml" || name == "hooks.json" {
            continue;
        }

        let target = codex_home.join(&name);
        if target.exists() || target.symlink_metadata().is_ok() {
            continue;
        }
        symlink(entry.path(), target).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn codex_pandora_hook_entry(command: &str) -> Value {
    json!({
        "name": "Pandora",
        "displayName": "Pandora",
        "hooks": [
            {
                "name": "Pandora",
                "displayName": "Pandora",
                "type": "command",
                "command": command,
            }
        ]
    })
}

fn ensure_codex_hooks_json(codex_home: &Path, event_script: &Path) -> Result<(), String> {
    let hooks_path = codex_home.join("hooks.json");
    if let Some(parent) = hooks_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let existing = fs::read_to_string(&hooks_path).unwrap_or_else(|_| "{}".to_string());
    let mut root = serde_json::from_str::<Value>(&existing).unwrap_or_else(|_| json!({}));
    let hooks = root
        .as_object_mut()
        .ok_or_else(|| "Codex hooks root must be an object".to_string())?
        .entry("hooks")
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .ok_or_else(|| "Codex hooks must be an object".to_string())?;

    hooks.clear();

    for (codex_event, pandora_event) in [
        ("UserPromptSubmit", "UserPromptSubmit"),
        ("PreToolUse", "PreToolUse"),
        ("PostToolUse", "PostToolUse"),
        ("Stop", "Stop"),
    ] {
        let command = event_script_command(event_script, "codex", pandora_event, None);
        hooks.insert(
            codex_event.to_string(),
            Value::Array(vec![codex_pandora_hook_entry(&command)]),
        );
    }

    let formatted = serde_json::to_string_pretty(&root).map_err(|error| error.to_string())?;
    fs::write(&hooks_path, format!("{formatted}\n")).map_err(|error| error.to_string())
}
