use super::claude::ensure_claude_hooks_in_home;
use super::codex::{
    ensure_codex_home_from_user, ensure_codex_notify_in_home, notify_item_matches_wrapper,
};
use super::constants::*;
use super::cursor::ensure_cursor_hooks_in_home;
use super::gemini::ensure_gemini_hooks_in_home;
use super::hooks::is_pandora_agent_entry;
use super::scripts::build_agent_event_script;

use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use toml_edit::DocumentMut;

fn temp_home(prefix: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("pandora-agent-cli-{prefix}-{nanos}"));
    fs::create_dir_all(&dir).expect("create temp home");
    dir
}

#[test]
fn agent_event_script_does_not_drain_stdin_before_notifying() {
    let helper = PathBuf::from("/tmp/pandora-agent-hook");
    let script = build_agent_event_script(&helper);

    assert!(!script.contains("cat >/dev/null"));
    assert!(script.contains("pandora-agent-hook"));
    assert!(script.contains("hook_event_name"));
}

#[test]
fn claude_merge_preserves_existing_hooks_and_is_idempotent() {
    let home = temp_home("claude");
    let helper = home.join(".pandora/bin/pandora-agent-hook");
    let settings_path = home.join(CLAUDE_SETTINGS_PATH);
    fs::create_dir_all(settings_path.parent().expect("settings parent")).expect("mkdir");
    fs::write(
        &settings_path,
        r#"{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "existing-user-prompt"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "existing-stop"
          }
        ]
      }
    ]
  }
}"#,
    )
    .expect("seed settings");

    ensure_claude_hooks_in_home(&home, &helper).expect("first merge");
    ensure_claude_hooks_in_home(&home, &helper).expect("second merge");

    let merged = fs::read_to_string(&settings_path).expect("read settings");
    let json: Value = serde_json::from_str(&merged).expect("parse settings");
    let hooks = json
        .get("hooks")
        .and_then(Value::as_object)
        .expect("hooks object");

    let user_prompt = hooks
        .get("UserPromptSubmit")
        .and_then(Value::as_array)
        .expect("UserPromptSubmit array");
    assert_eq!(user_prompt.len(), 2);
    assert!(user_prompt.iter().any(|entry| {
        entry
            .get("hooks")
            .and_then(Value::as_array)
            .and_then(|hooks| hooks.first())
            .and_then(|hook| hook.get("command"))
            .and_then(Value::as_str)
            == Some("existing-user-prompt")
    }));

    let notification = hooks
        .get("Notification")
        .and_then(Value::as_array)
        .expect("Notification array");
    assert_eq!(notification.len(), 2);
    assert!(notification
        .iter()
        .all(|entry| is_pandora_agent_entry(entry, &helper, "claude-code")));
}

#[test]
fn codex_notify_wraps_existing_handler_without_duplication() {
    let home = temp_home("codex");
    let wrapper = home.join(".pandora/bin/pandora-codex-notify");
    let next_script = home.join(".pandora/bin/pandora-codex-notify-next.sh");
    let config_path = home.join(CODEX_CONFIG_PATH);
    fs::create_dir_all(config_path.parent().expect("config parent")).expect("mkdir");
    fs::write(
        &config_path,
        r#"model = "gpt-5.4"
notify = ["/usr/bin/env", "bash", "/tmp/existing-notify.sh"]
"#,
    )
    .expect("seed config");

    ensure_codex_notify_in_home(&home, &wrapper, &next_script).expect("first merge");
    ensure_codex_notify_in_home(&home, &wrapper, &next_script).expect("second merge");

    let config = fs::read_to_string(&config_path).expect("read config");
    let document = config.parse::<DocumentMut>().expect("parse config");
    let notify = document.get("notify").expect("notify");
    assert!(notify_item_matches_wrapper(notify, &wrapper));
    let next = fs::read_to_string(&next_script).expect("read next");
    assert!(next.contains("/usr/bin/env"));
    assert!(next.contains("/tmp/existing-notify.sh"));
}

#[test]
fn codex_home_merge_uses_one_named_pandora_hook_and_preserves_user_hooks() {
    let home = temp_home("codex-hooks");
    let event_script = home.join(".pandora/bin/pandora-agent-event");
    let hooks_path = home.join(".codex/hooks.json");
    fs::create_dir_all(hooks_path.parent().expect("hooks parent")).expect("mkdir");
    fs::write(
        &hooks_path,
        r#"{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/opt/user-start.sh"
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/opt/user-hook.sh"
          }
        ],
        "matcher": "*"
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/opt/user-stop.sh"
          }
        ]
      }
    ]
  }
}"#,
    )
    .expect("seed hooks");

    let codex_home = home.join(".pandora/codex-home");
    let wrapper = home.join(".pandora/bin/pandora-codex-notify");
    let next_script = home.join(".pandora/bin/pandora-codex-notify-next.sh");
    ensure_codex_home_from_user(
        &home.join(".codex"),
        &codex_home,
        &wrapper,
        &next_script,
        &event_script,
    )
    .expect("first merge");
    ensure_codex_home_from_user(
        &home.join(".codex"),
        &codex_home,
        &wrapper,
        &next_script,
        &event_script,
    )
    .expect("second merge");

    let cleaned_user_hooks = fs::read_to_string(&hooks_path).expect("read user hooks");
    let user_json: Value = serde_json::from_str(&cleaned_user_hooks).expect("parse user hooks");
    let user_hooks = user_json
        .get("hooks")
        .and_then(Value::as_object)
        .expect("hooks object");

    let pre_tool = user_hooks
        .get("PreToolUse")
        .and_then(Value::as_array)
        .expect("PreToolUse array");
    assert_eq!(pre_tool.len(), 1);
    assert!(pre_tool.iter().any(|entry| {
        entry
            .get("hooks")
            .and_then(Value::as_array)
            .and_then(|hooks| hooks.first())
            .and_then(|hook| hook.get("command"))
            .and_then(Value::as_str)
            == Some("/opt/user-hook.sh")
    }));

    assert!(user_hooks.contains_key("SessionStart"));
    assert!(user_hooks.contains_key("Stop"));

    let generated_hooks_path = codex_home.join("hooks.json");
    let generated_hooks = fs::read_to_string(generated_hooks_path).expect("read hooks");
    let generated_json: Value = serde_json::from_str(&generated_hooks).expect("parse hooks");
    let hooks = generated_json
        .get("hooks")
        .and_then(Value::as_object)
        .expect("generated hooks object");

    let user_prompt = hooks
        .get("UserPromptSubmit")
        .and_then(Value::as_array)
        .expect("UserPromptSubmit array");
    assert_eq!(user_prompt.len(), 1);
    assert_eq!(
        user_prompt[0].get("name").and_then(Value::as_str),
        Some("Pandora")
    );
    assert_eq!(
        user_prompt[0]
            .get("hooks")
            .and_then(Value::as_array)
            .and_then(|hooks| hooks.first())
            .and_then(|hook| hook.get("name"))
            .and_then(Value::as_str),
        Some("Pandora")
    );
    assert!(is_pandora_agent_entry(
        &user_prompt[0],
        &event_script,
        "codex"
    ));

    // Verify additional codex hooks are generated
    for event_name in ["PreToolUse", "PostToolUse", "Stop"] {
        let entries = hooks
            .get(event_name)
            .and_then(Value::as_array)
            .unwrap_or_else(|| panic!("generated {event_name} array"));
        assert_eq!(entries.len(), 1, "expected 1 entry for {event_name}");
        assert!(is_pandora_agent_entry(&entries[0], &event_script, "codex"));
    }
}

#[test]
fn gemini_merge_preserves_existing_hooks_and_is_idempotent() {
    let home = temp_home("gemini");
    let event_script = home.join(".pandora/bin/pandora-agent-event");
    let settings_path = home.join(GEMINI_SETTINGS_PATH);
    fs::create_dir_all(settings_path.parent().expect("settings parent")).expect("mkdir");
    fs::write(
        &settings_path,
        r#"{
  "hooks": {
    "BeforeAgent": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/opt/custom-gemini-start.sh"
          }
        ]
      }
    ]
  }
}"#,
    )
    .expect("seed settings");

    ensure_gemini_hooks_in_home(&home, &event_script).expect("first merge");
    ensure_gemini_hooks_in_home(&home, &event_script).expect("second merge");

    let merged = fs::read_to_string(&settings_path).expect("read settings");
    let json: Value = serde_json::from_str(&merged).expect("parse settings");
    let hooks = json
        .get("hooks")
        .and_then(Value::as_object)
        .expect("hooks object");
    let before_agent = hooks
        .get("BeforeAgent")
        .and_then(Value::as_array)
        .expect("BeforeAgent array");

    assert_eq!(before_agent.len(), 2);
    assert!(before_agent.iter().any(|entry| {
        entry
            .get("hooks")
            .and_then(Value::as_array)
            .and_then(|hooks| hooks.first())
            .and_then(|hook| hook.get("command"))
            .and_then(Value::as_str)
            == Some("/opt/custom-gemini-start.sh")
    }));
    for event_name in ["AfterAgent", "AfterTool"] {
        let entries = hooks
            .get(event_name)
            .and_then(Value::as_array)
            .unwrap_or_else(|| panic!("{event_name} array"));
        assert_eq!(entries.len(), 1);
        assert!(is_pandora_agent_entry(&entries[0], &event_script, "gemini"));
    }
}

#[test]
fn cursor_merge_preserves_existing_hooks_and_is_idempotent() {
    let home = temp_home("cursor");
    let event_script = home.join(".pandora/bin/pandora-agent-event");
    let hooks_path = home.join(CURSOR_HOOKS_PATH);
    fs::create_dir_all(hooks_path.parent().expect("hooks parent")).expect("mkdir");
    fs::write(
        &hooks_path,
        r#"{
  "version": 1,
  "hooks": {
    "beforeSubmitPrompt": [
      {
        "command": "/opt/custom-cursor-start.sh"
      }
    ]
  }
}"#,
    )
    .expect("seed hooks");

    ensure_cursor_hooks_in_home(&home, &event_script).expect("first merge");
    ensure_cursor_hooks_in_home(&home, &event_script).expect("second merge");

    let merged = fs::read_to_string(&hooks_path).expect("read hooks");
    let json: Value = serde_json::from_str(&merged).expect("parse hooks");
    let hooks = json
        .get("hooks")
        .and_then(Value::as_object)
        .expect("hooks object");
    let before_submit = hooks
        .get("beforeSubmitPrompt")
        .and_then(Value::as_array)
        .expect("beforeSubmitPrompt array");

    assert_eq!(before_submit.len(), 2);
    assert!(before_submit
        .iter()
        .any(|entry| entry.get("command").and_then(Value::as_str)
            == Some("/opt/custom-cursor-start.sh")));

    let stop = hooks
        .get("stop")
        .and_then(Value::as_array)
        .expect("stop array");
    assert_eq!(stop.len(), 1);
    assert!(super::hooks::is_pandora_flat_hook_entry(
        &stop[0],
        &event_script,
        "cursor-agent"
    ));
}
