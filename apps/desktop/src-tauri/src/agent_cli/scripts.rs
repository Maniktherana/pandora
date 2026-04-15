use std::path::Path;

use super::constants::AGENT_SOCKET_NAME;
use super::paths::shell_quote;

pub(super) fn build_agent_hook_script() -> String {
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

pub(super) fn build_agent_event_script(agent_hook_script: &Path) -> String {
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

pub(super) fn build_passthrough_wrapper(binary_name: &str, exec_prefix: &str) -> String {
    format!(
        "#!/bin/sh
set +e
wrapper_path=\"$0\"
wrapper_dir=$(CDPATH= cd -- \"$(dirname -- \"$wrapper_path\")\" 2>/dev/null && pwd)
path_without_wrapper=$(printf '%s' \"${{PATH:-}}\" | awk -v skip=\"$wrapper_dir\" 'BEGIN {{ RS=\":\"; first=1 }} $0 != skip && $0 != \"\" {{ if (!first) printf \":\"; printf \"%s\", $0; first=0 }}')
if [ -z \"$path_without_wrapper\" ]; then
  path_without_wrapper=\"/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin\"
fi
real_bin=$(PATH=\"$path_without_wrapper\" command -v {binary_name} 2>/dev/null)
if [ -z \"$real_bin\" ]; then
  echo \"pandora: {binary_name} not found on PATH\" >&2
  exit 127
fi
{exec_prefix}exec \"$real_bin\" \"$@\"
",
        binary_name = binary_name,
        exec_prefix = exec_prefix,
    )
}

pub(super) fn build_codex_notify_wrapper(agent_hook_script: &Path, next_script: &Path) -> String {
    format!(
        "#!/bin/sh
set +e
hook_script={hook_script}
next_script={next_script}
if [ -n \"${{PANDORA_SLOT_ID:-}}\" ] && [ -x \"$hook_script\" ]; then
  printf '{{\"hook_event_name\":\"Stop\"}}' | \"$hook_script\" codex >/dev/null 2>&1 || true
fi
if [ -x \"$next_script\" ]; then
  exec \"$next_script\" \"$@\"
fi
exit 0
",
        hook_script = shell_quote(&agent_hook_script.to_string_lossy()),
        next_script = next_script.to_string_lossy(),
    )
}

pub(super) fn build_codex_bin_wrapper(
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

  pandora_log_dir=\"${{PANDORA_HOME:-${{HOME}}/.pandora}}/logs\"
  mkdir -p \"$pandora_log_dir\" 2>/dev/null
  pandora_codex_log=\"$pandora_log_dir/codex-watcher.log\"

  (
    log=\"$CODEX_TUI_SESSION_LOG_PATH\"
    echo \"[$(date)] codex watcher started, log=$log\" >> \"$pandora_codex_log\"
    last_turn_id=\"\"
    last_approval_id=\"\"
    last_exec_call_id=\"\"
    approval_fallback_seq=0

    emit_event() {{
      event=\"$1\"
      echo \"[$(date)] emit $event\" >> \"$pandora_codex_log\"
      printf '{{\"hook_event_name\":\"%s\"}}' \"$event\" | \"$hook_script\" codex >/dev/null 2>&1 || true
    }}

    i=0
    while [ ! -f \"$log\" ] && [ \"$i\" -lt 200 ]; do
      i=$((i + 1))
      sleep 0.05
    done
    if [ ! -f \"$log\" ]; then
      echo \"[$(date)] codex session log not found after 10s\" >> \"$pandora_codex_log\"
      exit 0
    fi
    echo \"[$(date)] codex session log found, tailing\" >> \"$pandora_codex_log\"

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

pub(super) fn build_copilot_bin_wrapper(event_script: &Path) -> String {
    format!(
        "#!/bin/sh
set +e
wrapper_path=\"$0\"
wrapper_dir=$(CDPATH= cd -- \"$(dirname -- \"$wrapper_path\")\" 2>/dev/null && pwd)
path_without_wrapper=$(printf '%s' \"${{PATH:-}}\" | awk -v skip=\"$wrapper_dir\" 'BEGIN {{ RS=\":\"; first=1 }} $0 != skip && $0 != \"\" {{ if (!first) printf \":\"; printf \"%s\", $0; first=0 }}')
if [ -z \"$path_without_wrapper\" ]; then
  path_without_wrapper=\"/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin\"
fi
real_bin=$(PATH=\"$path_without_wrapper\" command -v copilot 2>/dev/null)
if [ -z \"$real_bin\" ]; then
  echo \"pandora: copilot not found on PATH\" >&2
  exit 127
fi

event_script={event_script}
config=$(cat <<'PANDORA_EOF_HOOKS'
{{\"version\":1,\"hooks\":{{\"beforeSubmitPrompt\":[{{\"command\":\"{event_script_raw} github-copilot Start\"}}],\"stop\":[{{\"command\":\"{event_script_raw} github-copilot Stop\"}}]}}}}
PANDORA_EOF_HOOKS
)
export GITHUB_COPILOT_HOOKS_CONFIG=\"$config\"
exec \"$real_bin\" \"$@\"
",
        event_script = shell_quote(&event_script.to_string_lossy()),
        event_script_raw = event_script.to_string_lossy(),
    )
}

pub(super) fn build_opencode_plugin(event_script: &Path) -> String {
    format!(
        r#"// Pandora opencode plugin – emits agent lifecycle events
const {{ execSync }} = require("child_process");

function fire(event) {{
  try {{
    execSync(
      {event_script} + " opencode " + event,
      {{ stdio: "ignore", timeout: 3000 }}
    );
  }} catch (_) {{}}
}}

let sessionActive = false;

module.exports = {{
  name: "pandora-notify",
  subscribe: [
    "session.start",
    "session.complete",
    "session.error",
    "tool.start",
    "tool.complete",
    "tool.error",
  ],
  onEvent(event) {{
    switch (event.type) {{
      case "session.start":
        if (!sessionActive) {{
          sessionActive = true;
          fire("Start");
        }}
        break;
      case "session.complete":
      case "session.error":
        sessionActive = false;
        fire("Stop");
        break;
      case "tool.start":
        fire("Start");
        break;
      case "tool.complete":
      case "tool.error":
        fire("Start");
        break;
    }}
  }},
}};
"#,
        event_script = format!(
            "\"{}\"",
            event_script
                .to_string_lossy()
                .replace('\\', "\\\\")
                .replace('"', "\\\"")
        ),
    )
}

pub(super) fn build_opencode_bin_wrapper(opencode_config_dir: &Path) -> String {
    format!(
        "#!/bin/sh
set +e
export OPENCODE_CONFIG_DIR={config_dir}
wrapper_path=\"$0\"
wrapper_dir=$(CDPATH= cd -- \"$(dirname -- \"$wrapper_path\")\" 2>/dev/null && pwd)
path_without_wrapper=$(printf '%s' \"${{PATH:-}}\" | awk -v skip=\"$wrapper_dir\" 'BEGIN {{ RS=\":\"; first=1 }} $0 != skip && $0 != \"\" {{ if (!first) printf \":\"; printf \"%s\", $0; first=0 }}')
if [ -z \"$path_without_wrapper\" ]; then
  path_without_wrapper=\"/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin\"
fi
real_bin=$(PATH=\"$path_without_wrapper\" command -v opencode 2>/dev/null)
if [ -z \"$real_bin\" ]; then
  echo \"pandora: opencode not found on PATH\" >&2
  exit 127
fi
exec \"$real_bin\" \"$@\"
",
        config_dir = shell_quote(&opencode_config_dir.to_string_lossy()),
    )
}
