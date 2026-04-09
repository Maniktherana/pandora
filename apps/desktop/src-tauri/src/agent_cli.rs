use crate::daemon_bridge;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::os::unix::fs::{symlink, PermissionsExt};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use tokio::io::AsyncReadExt;
use tokio::net::UnixListener;
use toml_edit::{Array, DocumentMut, Item, Value as TomlValue};

const CLAUDE_SETTINGS_PATH: &str = ".claude/settings.json";
const CODEX_CONFIG_PATH: &str = ".codex/config.toml";
const AGENT_SOCKET_NAME: &str = "agent-cli.sock";
const AGENT_HOOK_SCRIPT_NAME: &str = "pandora-agent-hook";
const AGENT_EVENT_SCRIPT_NAME: &str = "pandora-agent-event";
const CODEX_NOTIFY_SCRIPT_NAME: &str = "pandora-codex-notify";
const CODEX_NOTIFY_NEXT_SCRIPT_NAME: &str = "pandora-codex-notify-next.sh";
const CODEX_BIN_WRAPPER_SCRIPT_NAME: &str = "codex";
const CODEX_HOME_DIR_NAME: &str = "codex-home";
const GEMINI_SETTINGS_PATH: &str = ".gemini/settings.json";
const CURSOR_HOOKS_PATH: &str = ".cursor/hooks.json";

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentHookEnvelope {
    runtime_id: String,
    slot_id: String,
    source: String,
    #[serde(default)]
    payload_base64: Option<String>,
}

fn pandora_home() -> PathBuf {
    PathBuf::from(crate::git::pandora_home())
}

fn user_home() -> PathBuf {
    std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/tmp"))
}

fn agent_socket_path() -> PathBuf {
    pandora_home().join(AGENT_SOCKET_NAME)
}

fn scripts_dir() -> PathBuf {
    pandora_home().join("bin")
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn write_executable(path: &Path, contents: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(path, contents).map_err(|error| error.to_string())?;
    let mut perms = fs::metadata(path)
        .map_err(|error| error.to_string())?
        .permissions();
    perms.set_mode(0o755);
    fs::set_permissions(path, perms).map_err(|error| error.to_string())
}

fn build_agent_hook_script() -> String {
    format!(
        "#!/bin/sh
set -eu
source=\"${{1:-}}\"
runtime_id=\"${{PANDORA_RUNTIME_ID:-}}\"
slot_id=\"${{PANDORA_SLOT_ID:-}}\"
pandora_home=\"${{PANDORA_HOME:-${{HOME}}/.pandora}}\"
socket=\"$pandora_home/{socket_name}\"

[ -n \"$source\" ] || exit 0
[ -n \"$runtime_id\" ] || exit 0
[ -n \"$slot_id\" ] || exit 0
[ -S \"$socket\" ] || exit 0
command -v nc >/dev/null 2>&1 || exit 0
command -v base64 >/dev/null 2>&1 || exit 0

payload_b64=\"$(base64 | tr -d '\\n')\"
json=$(printf '{{\"source\":\"%s\",\"runtimeId\":\"%s\",\"slotId\":\"%s\",\"payloadBase64\":\"%s\"}}' \"$source\" \"$runtime_id\" \"$slot_id\" \"$payload_b64\")
printf '%s\\n' \"$json\" | nc -U \"$socket\" >/dev/null 2>&1 || true
exit 0
",
        socket_name = AGENT_SOCKET_NAME,
    )
}

fn build_agent_event_script(agent_hook_script: &Path) -> String {
    format!(
        "#!/bin/sh
set +e
hook_script={hook_script}
source=\"${{1:-}}\"
event=\"${{2:-}}\"
response=\"${{3:-}}\"
case \"$response\" in
  json) printf '{{}}\\n' ;;
  continue) printf '{{\"continue\":true}}\\n' ;;
esac
[ -n \"$source\" ] || exit 0
[ -n \"$event\" ] || exit 0
[ -x \"$hook_script\" ] || exit 0
payload=$(printf '{{\"hook_event_name\":\"%s\"}}' \"$event\")
printf '%s' \"$payload\" | \"$hook_script\" \"$source\" >/dev/null 2>&1 || true
exit 0
",
        hook_script = shell_quote(&agent_hook_script.to_string_lossy()),
    )
}

fn build_passthrough_wrapper(binary_name: &str, exec_prefix: &str) -> String {
    format!(
        "#!/bin/sh
set +e
wrapper_path=\"$0\"
wrapper_dir=$(CDPATH= cd -- \"$(dirname -- \"$wrapper_path\")\" 2>/dev/null && pwd)
path_without_wrapper=$(printf '%s' \"${{PATH:-}}\" | awk -v skip=\"$wrapper_dir\" 'BEGIN {{ RS=\":\"; first=1 }} $0 != skip && $0 != \"\" {{ if (!first) printf \":\"; printf \"%s\", $0; first=0 }}')
[ -n \"$path_without_wrapper\" ] || path_without_wrapper=\"/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin\"
real_bin=$(PATH=\"$path_without_wrapper\" command -v {binary_name} 2>/dev/null)
if [ -z \"$real_bin\" ]; then
  echo \"pandora: {binary_name} not found on PATH\" >&2
  exit 127
fi
{exec_prefix}
exec \"$real_bin\" \"$@\"
",
        binary_name = binary_name,
        exec_prefix = exec_prefix,
    )
}

fn build_codex_notify_wrapper(agent_hook_script: &Path, next_script: &Path) -> String {
    format!(
        "#!/bin/sh
set +e
hook_script={hook_script}
next_script={next_script}
tmp=$(mktemp \"${{TMPDIR:-/tmp}}/pandora-codex-notify.XXXXXX\") || exit 0
trap 'rm -f \"$tmp\"' EXIT
cat >\"$tmp\" || true
if [ -x \"$hook_script\" ]; then
  \"$hook_script\" codex <\"$tmp\" >/dev/null 2>&1 || true
fi
if [ -x \"$next_script\" ]; then
  \"$next_script\" \"$@\" <\"$tmp\"
  status=$?
  exit \"$status\"
fi
exit 0
",
        hook_script = shell_quote(&agent_hook_script.to_string_lossy()),
        next_script = shell_quote(&next_script.to_string_lossy()),
    )
}

fn build_codex_bin_wrapper(
    agent_hook_script: &Path,
    notify_wrapper: &Path,
    codex_home: &Path,
) -> String {
    format!(
        "#!/bin/sh
set +e
wrapper_path=\"$0\"
wrapper_dir=$(CDPATH= cd -- \"$(dirname -- \"$wrapper_path\")\" 2>/dev/null && pwd)
path_without_wrapper=$(printf '%s' \"${{PATH:-}}\" | awk -v skip=\"$wrapper_dir\" 'BEGIN {{ RS=\":\"; first=1 }} $0 != skip && $0 != \"\" {{ if (!first) printf \":\"; printf \"%s\", $0; first=0 }}')
if [ -z \"$path_without_wrapper\" ]; then
  path_without_wrapper=\"/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin\"
fi
real_bin=$(PATH=\"$path_without_wrapper\" command -v codex 2>/dev/null)
if [ -z \"$real_bin\" ]; then
  echo \"pandora: codex not found on PATH\" >&2
  exit 127
fi

hook_script={hook_script}
notify_wrapper={notify_wrapper}
export CODEX_HOME={codex_home}

if [ -n \"${{PANDORA_SLOT_ID:-}}\" ] && [ -x \"$hook_script\" ]; then
  export CODEX_TUI_RECORD_SESSION=1
  if [ -z \"${{CODEX_TUI_SESSION_LOG_PATH:-}}\" ]; then
    pandora_codex_ts=$(date +%s 2>/dev/null || echo \"$$\")
    export CODEX_TUI_SESSION_LOG_PATH=\"${{TMPDIR:-/tmp}}/pandora-codex-session-$$_${{pandora_codex_ts}}.jsonl\"
  fi

  (
    log=\"$CODEX_TUI_SESSION_LOG_PATH\"
    last_turn_id=\"\"
    last_approval_id=\"\"
    last_exec_call_id=\"\"
    approval_fallback_seq=0

    emit_event() {{
      event=\"$1\"
      printf '{{\"hook_event_name\":\"%s\"}}' \"$event\" | \"$hook_script\" codex >/dev/null 2>&1 || true
    }}

    i=0
    while [ ! -f \"$log\" ] && [ \"$i\" -lt 200 ]; do
      i=$((i + 1))
      sleep 0.05
    done
    [ -f \"$log\" ] || exit 0

    tail -n 0 -F \"$log\" 2>/dev/null | while IFS= read -r line; do
      case \"$line\" in
        *'\"dir\":\"to_tui\"'*'\"kind\":\"codex_event\"'*'\"msg\":{{\"type\":\"task_started\"'*)
          turn_id=$(printf '%s\\n' \"$line\" | awk -F'\"turn_id\":\"' 'NF > 1 {{ sub(/\".*/, \"\", $2); print $2; exit }}')
          [ -n \"$turn_id\" ] || turn_id=\"task_started\"
          if [ \"$turn_id\" != \"$last_turn_id\" ]; then
            last_turn_id=\"$turn_id\"
            emit_event \"Start\"
          fi
          ;;
        *'\"dir\":\"to_tui\"'*'\"kind\":\"codex_event\"'*'\"msg\":{{\"type\":\"'*'_approval_request\"'*)
          approval_id=$(printf '%s\\n' \"$line\" | awk -F'\"id\":\"' 'NF > 1 {{ sub(/\".*/, \"\", $2); print $2; exit }}')
          [ -n \"$approval_id\" ] || approval_id=$(printf '%s\\n' \"$line\" | awk -F'\"approval_id\":\"' 'NF > 1 {{ sub(/\".*/, \"\", $2); print $2; exit }}')
          [ -n \"$approval_id\" ] || approval_id=$(printf '%s\\n' \"$line\" | awk -F'\"call_id\":\"' 'NF > 1 {{ sub(/\".*/, \"\", $2); print $2; exit }}')
          if [ -z \"$approval_id\" ]; then
            approval_fallback_seq=$((approval_fallback_seq + 1))
            approval_id=\"approval_request_${{approval_fallback_seq}}\"
          fi
          if [ \"$approval_id\" != \"$last_approval_id\" ]; then
            last_approval_id=\"$approval_id\"
            emit_event \"PermissionRequest\"
          fi
          ;;
        *'\"dir\":\"to_tui\"'*'\"kind\":\"codex_event\"'*'\"msg\":{{\"type\":\"exec_command_begin\"'*)
          exec_call_id=$(printf '%s\\n' \"$line\" | awk -F'\"call_id\":\"' 'NF > 1 {{ sub(/\".*/, \"\", $2); print $2; exit }}')
          if [ -n \"$exec_call_id\" ]; then
            if [ \"$exec_call_id\" != \"$last_exec_call_id\" ]; then
              last_exec_call_id=\"$exec_call_id\"
              emit_event \"Start\"
            fi
          else
            emit_event \"Start\"
          fi
          ;;
      esac
    done
  ) &
  watcher_pid=$!
fi

if [ -x \"$notify_wrapper\" ]; then
  \"$real_bin\" --enable codex_hooks -c \"notify=['$notify_wrapper']\" \"$@\"
else
  \"$real_bin\" --enable codex_hooks \"$@\"
fi
status=$?

if [ -n \"${{watcher_pid:-}}\" ]; then
  kill \"$watcher_pid\" >/dev/null 2>&1 || true
  wait \"$watcher_pid\" 2>/dev/null || true
fi

exit \"$status\"
",
        hook_script = shell_quote(&agent_hook_script.to_string_lossy()),
        notify_wrapper = notify_wrapper.to_string_lossy(),
        codex_home = shell_quote(&codex_home.to_string_lossy()),
    )
}

fn build_copilot_bin_wrapper(agent_event_script: &Path) -> String {
    let hooks_json = format!(
        r#"{{
  "version": 1,
  "hooks": {{
    "sessionStart": [
      {{ "type": "command", "bash": "{event} github-copilot Start json", "timeoutSec": 5 }}
    ],
    "sessionEnd": [
      {{ "type": "command", "bash": "{event} github-copilot Stop json", "timeoutSec": 5 }}
    ],
    "userPromptSubmitted": [
      {{ "type": "command", "bash": "{event} github-copilot Start json", "timeoutSec": 5 }}
    ],
    "postToolUse": [
      {{ "type": "command", "bash": "{event} github-copilot Start json", "timeoutSec": 5 }}
    ]
  }}
}}"#,
        event = agent_event_script.to_string_lossy().replace('"', "\\\""),
    );
    let escaped_hooks_json = shell_quote(&hooks_json);
    build_passthrough_wrapper(
        "copilot",
        &format!(
            "if [ -n \"${{PANDORA_SLOT_ID:-}}\" ]; then
  copilot_hooks_dir=\".github/hooks\"
  copilot_hook_file=\"$copilot_hooks_dir/pandora-notify.json\"
  mkdir -p \"$copilot_hooks_dir\" 2>/dev/null || true
  printf '%s\\n' {escaped_hooks_json} > \"$copilot_hook_file\" 2>/dev/null || true
  if [ -d \".git/info\" ]; then
    grep -qF \".github/hooks/pandora-notify.json\" \".git/info/exclude\" 2>/dev/null || printf '%s\\n' \".github/hooks/pandora-notify.json\" >> \".git/info/exclude\" 2>/dev/null || true
  fi
fi
",
        ),
    )
}

fn build_opencode_plugin(agent_event_script: &Path) -> String {
    let event_script = agent_event_script
        .to_string_lossy()
        .replace('\\', "\\\\")
        .replace('"', "\\\"");
    format!(
        r#"// Pandora opencode plugin
export const PandoraNotifyPlugin = async ({{ $, client }}) => {{
  if (globalThis.__pandoraOpencodeNotifyPluginV2) return {{}};
  globalThis.__pandoraOpencodeNotifyPluginV2 = true;
  if (!process?.env?.PANDORA_SLOT_ID) return {{}};

  const eventScript = "{event_script}";
  let currentState = "idle";
  let rootSessionID = null;
  let stopSent = false;
  const childSessionCache = new Map();

  const notify = async (eventName) => {{
    try {{
      await $`sh ${{eventScript}} opencode ${{eventName}}`;
    }} catch (_) {{}}
  }};

  const isChildSession = async (sessionID) => {{
    if (!sessionID || !client?.session?.list) return false;
    if (childSessionCache.has(sessionID)) return childSessionCache.get(sessionID);
    try {{
      const sessions = await client.session.list();
      const session = sessions.data?.find((candidate) => candidate.id === sessionID);
      const isChild = Boolean(session?.parentID);
      childSessionCache.set(sessionID, isChild);
      return isChild;
    }} catch (_) {{
      return false;
    }}
  }};

  const start = async (sessionID) => {{
    if (!rootSessionID) rootSessionID = sessionID;
    if (rootSessionID && sessionID && rootSessionID !== sessionID) return;
    if (currentState === "busy") return;
    currentState = "busy";
    stopSent = false;
    await notify("Start");
  }};

  const stop = async (sessionID) => {{
    if (rootSessionID && sessionID && rootSessionID !== sessionID) return;
    if (currentState !== "busy" || stopSent) return;
    currentState = "idle";
    stopSent = true;
    await notify("Stop");
    rootSessionID = null;
  }};

  return {{
    event: async ({{ event }}) => {{
      const sessionID = event.properties?.sessionID;
      if (await isChildSession(sessionID)) return;

      if (event.type === "session.status") {{
        const status = event.properties?.status?.type;
        if (status === "busy") await start(sessionID);
        if (status === "idle") await stop(sessionID);
      }}
      if (event.type === "session.busy") await start(sessionID);
      if (event.type === "session.idle" || event.type === "session.error") await stop(sessionID);
    }},
    "permission.ask": async (_permission, output) => {{
      if (output?.status === "ask") await notify("PermissionRequest");
    }},
  }};
}};
"#,
        event_script = event_script,
    )
}

fn build_opencode_bin_wrapper(opencode_config_dir: &Path) -> String {
    build_passthrough_wrapper(
        "opencode",
        &format!(
            "export OPENCODE_CONFIG_DIR={}\n",
            shell_quote(&opencode_config_dir.to_string_lossy()),
        ),
    )
}

fn codex_notify_runner_script(original: &Item) -> Option<String> {
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

fn wrapper_notify_item(wrapper_path: &Path) -> Item {
    let mut array = Array::default();
    array.push(wrapper_path.to_string_lossy().to_string());
    Item::Value(TomlValue::Array(array))
}

fn notify_item_matches_wrapper(item: &Item, wrapper_path: &Path) -> bool {
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

fn ensure_codex_home(
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

fn ensure_gemini_hooks(event_script: &Path) -> Result<(), String> {
    ensure_gemini_hooks_in_home(&user_home(), event_script)
}

fn ensure_cursor_hooks(event_script: &Path) -> Result<(), String> {
    ensure_cursor_hooks_in_home(&user_home(), event_script)
}

fn ensure_codex_notify_in_home(
    home: &Path,
    wrapper_path: &Path,
    next_script: &Path,
) -> Result<(), String> {
    ensure_codex_notify_config(&home.join(CODEX_CONFIG_PATH), wrapper_path, next_script)
}

fn ensure_codex_notify_config(
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

    let command = event_script_command(event_script, "codex", "UserPromptSubmit", None);
    hooks.insert(
        "UserPromptSubmit".to_string(),
        Value::Array(vec![codex_pandora_hook_entry(&command)]),
    );

    let formatted = serde_json::to_string_pretty(&root).map_err(|error| error.to_string())?;
    fs::write(&hooks_path, format!("{formatted}\n")).map_err(|error| error.to_string())
}

fn ensure_codex_home_from_user(
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

fn agent_hook_entry(command: &str, matcher: Option<&str>) -> Value {
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

fn event_name_to_matcher(event_name: &str) -> Option<&'static str> {
    match event_name {
        "PostToolUse" | "PostToolUseFailure" | "PermissionRequest" | "PreToolUse" => Some("*"),
        _ => None,
    }
}

fn event_script_command(
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

fn is_pandora_agent_entry(entry: &Value, helper_path: &Path, source: &str) -> bool {
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

fn merge_agent_event(
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

fn ensure_claude_hooks(helper_path: &Path) -> Result<(), String> {
    ensure_claude_hooks_in_home(&user_home(), helper_path)
}

fn ensure_claude_hooks_in_home(home: &Path, helper_path: &Path) -> Result<(), String> {
    let settings_path = home.join(CLAUDE_SETTINGS_PATH);
    if let Some(parent) = settings_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
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

fn ensure_gemini_hooks_in_home(home: &Path, event_script: &Path) -> Result<(), String> {
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

fn is_pandora_flat_hook_entry(entry: &Value, event_script: &Path, source: &str) -> bool {
    let script = event_script.to_string_lossy();
    entry
        .get("command")
        .or_else(|| entry.get("bash"))
        .and_then(Value::as_str)
        .map(|command| command.contains(script.as_ref()) && command.contains(source))
        .unwrap_or(false)
}

fn merge_flat_event(
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

fn ensure_cursor_hooks_in_home(home: &Path, event_script: &Path) -> Result<(), String> {
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

pub fn ensure_agent_cli_integration() -> Result<(), String> {
    let scripts_dir = scripts_dir();
    fs::create_dir_all(&scripts_dir).map_err(|error| error.to_string())?;

    let helper_script = scripts_dir.join(AGENT_HOOK_SCRIPT_NAME);
    let event_script = scripts_dir.join(AGENT_EVENT_SCRIPT_NAME);
    let codex_wrapper = scripts_dir.join(CODEX_NOTIFY_SCRIPT_NAME);
    let codex_next = scripts_dir.join(CODEX_NOTIFY_NEXT_SCRIPT_NAME);
    let codex_bin_wrapper = scripts_dir.join(CODEX_BIN_WRAPPER_SCRIPT_NAME);
    let gemini_bin_wrapper = scripts_dir.join("gemini");
    let cursor_bin_wrapper = scripts_dir.join("cursor-agent");
    let copilot_bin_wrapper = scripts_dir.join("copilot");
    let opencode_bin_wrapper = scripts_dir.join("opencode");
    let amp_bin_wrapper = scripts_dir.join("amp");
    let opencode_config_dir = pandora_home().join("opencode");
    let opencode_plugin_dir = opencode_config_dir.join("plugin");
    let opencode_plugin = opencode_plugin_dir.join("pandora-notify.js");
    let codex_home = pandora_home().join(CODEX_HOME_DIR_NAME);

    write_executable(&helper_script, &build_agent_hook_script())?;
    write_executable(&event_script, &build_agent_event_script(&helper_script))?;
    write_executable(
        &codex_wrapper,
        &build_codex_notify_wrapper(&helper_script, &codex_next),
    )?;
    write_executable(
        &codex_bin_wrapper,
        &build_codex_bin_wrapper(&helper_script, &codex_wrapper, &codex_home),
    )?;
    write_executable(
        &gemini_bin_wrapper,
        &build_passthrough_wrapper("gemini", ""),
    )?;
    write_executable(
        &cursor_bin_wrapper,
        &build_passthrough_wrapper("cursor-agent", ""),
    )?;
    write_executable(
        &copilot_bin_wrapper,
        &build_copilot_bin_wrapper(&event_script),
    )?;
    fs::create_dir_all(&opencode_plugin_dir).map_err(|error| error.to_string())?;
    write_executable(
        &opencode_bin_wrapper,
        &build_opencode_bin_wrapper(&opencode_config_dir),
    )?;
    write_executable(&amp_bin_wrapper, &build_passthrough_wrapper("amp", ""))?;
    fs::write(&opencode_plugin, build_opencode_plugin(&event_script))
        .map_err(|error| error.to_string())?;
    ensure_claude_hooks(&helper_script)?;
    ensure_codex_home(
        &codex_home,
        &codex_wrapper,
        &codex_next,
        &event_script,
    )?;
    ensure_gemini_hooks(&event_script)?;
    ensure_cursor_hooks(&event_script)?;
    Ok(())
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

        let daemon_state = app.state::<daemon_bridge::DaemonState>();
        let _ = daemon_bridge::send_workspace_message(
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

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
        assert!(notification.iter().all(|entry| is_pandora_agent_entry(
            entry,
            &helper,
            "claude-code"
        )));
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
        assert!(is_pandora_flat_hook_entry(
            &stop[0],
            &event_script,
            "cursor-agent"
        ));
    }
}
