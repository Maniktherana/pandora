use std::fs;

use super::claude::ensure_claude_hooks;
use super::codex::ensure_codex_home;
use super::constants::*;
use super::cursor::ensure_cursor_hooks;
use super::gemini::ensure_gemini_hooks;
use super::paths::{pandora_home, scripts_dir, write_executable};
use super::scripts::*;

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
