// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[macro_use]
mod terminal_log;
mod agent_cli;
mod commands;
mod daemon_bridge;
mod database;
mod git;
mod models;
mod native_shortcuts;

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
mod ghostty_app;
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
mod ghostty_ffi;

mod surface_registry;
mod terminal_commands;

use commands::DbState;
use database::AppDatabase;
use std::sync::Arc;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::Emitter;
use tauri::Manager;

const MENU_CLOSE_TAB_ID: &str = "pandora.close-tab";
const MENU_PREVIOUS_TAB_ID: &str = "pandora.previous-tab";
const MENU_NEXT_TAB_ID: &str = "pandora.next-tab";
const MENU_SETTINGS_ID: &str = "pandora.settings";

fn build_app_menu<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<Menu<R>> {
    let pkg_info = app.package_info();

    let close_tab = MenuItem::with_id(app, MENU_CLOSE_TAB_ID, "Close Tab", true, Some("Cmd+W"))?;
    let settings = MenuItem::with_id(app, MENU_SETTINGS_ID, "Settings…", true, Some("Cmd+,"))?;
    let previous_tab = MenuItem::with_id(
        app,
        MENU_PREVIOUS_TAB_ID,
        "Previous Tab",
        true,
        Some("Cmd+Shift+["),
    )?;
    let next_tab = MenuItem::with_id(app, MENU_NEXT_TAB_ID, "Next Tab", true, Some("Cmd+Shift+]"))?;

    Menu::with_items(
        app,
        &[
            &Submenu::with_items(
                app,
                pkg_info.name.clone(),
                true,
                &[
                    &PredefinedMenuItem::about(app, None, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &settings,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::services(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::hide(app, None)?,
                    &PredefinedMenuItem::hide_others(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::quit(app, None)?,
                ],
            )?,
            &Submenu::with_items(app, "File", true, &[&close_tab])?,
            &Submenu::with_items(
                app,
                "Edit",
                true,
                &[
                    &PredefinedMenuItem::undo(app, None)?,
                    &PredefinedMenuItem::redo(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::cut(app, None)?,
                    &PredefinedMenuItem::copy(app, None)?,
                    &PredefinedMenuItem::paste(app, None)?,
                    &PredefinedMenuItem::select_all(app, None)?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "Window",
                true,
                &[
                    &previous_tab,
                    &next_tab,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::minimize(app, None)?,
                    &PredefinedMenuItem::maximize(app, None)?,
                ],
            )?,
        ],
    )
}

fn main() {
    // Truncate terminal diagnostic log on fresh launch.
    let _ = std::fs::write("/tmp/pandora-terminal.log", b"");
    tlog!("INIT", "pandora-tauri starting pid={}", std::process::id());

    let pandora_home = git::pandora_home();
    let db = AppDatabase::open(&pandora_home).expect("Failed to open database");
    let db = Arc::new(db);

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_drag::init())
        .on_menu_event(|app, event| match event.id().0.as_str() {
            MENU_CLOSE_TAB_ID => {
                let _ = app.emit("app-shortcut", "close-tab");
            }
            MENU_PREVIOUS_TAB_ID => {
                let _ = app.emit("app-shortcut", "previous-tab");
            }
            MENU_NEXT_TAB_ID => {
                let _ = app.emit("app-shortcut", "next-tab");
            }
            MENU_SETTINGS_ID => {
                let _ = app.emit("app-shortcut", "open-settings");
            }
            _ => {}
        })
        .manage(daemon_bridge::DaemonState::new())
        .manage(Arc::new(surface_registry::SurfaceRegistry::new()))
        .manage(DbState(db))
        .invoke_handler(tauri::generate_handler![
            // Daemon bridge
            daemon_bridge::daemon_send,
            // Native terminal surfaces (Ghostty on macOS arm64; stubs elsewhere)
            terminal_commands::terminal_surface_create,
            terminal_commands::terminal_surface_update,
            terminal_commands::terminal_surface_set_font_size,
            terminal_commands::terminal_surface_destroy,
            terminal_commands::terminal_surface_focus,
            terminal_commands::terminal_surfaces_begin_web_overlay,
            terminal_commands::terminal_surfaces_end_web_overlay,
            terminal_commands::native_window_scale_factor,
            // Project commands
            commands::list_projects,
            commands::add_project,
            commands::toggle_project,
            commands::remove_project,
            // Workspace commands
            commands::list_workspaces,
            commands::create_workspace,
            commands::retry_workspace,
            commands::remove_workspace,
            commands::mark_workspace_opened,
            // Selection
            commands::load_selection,
            commands::save_selection,
            commands::get_ui_state,
            commands::set_ui_state,
            // Layout
            commands::save_workspace_layout,
            commands::load_workspace_layout,
            // Runtime
            commands::start_workspace_runtime,
            commands::start_project_runtime,
            commands::stop_project_runtime,
            // Full state reload
            commands::load_app_state,
            commands::native_terminal_supported,
            commands::read_system_ghostty_config,
            commands::list_workspace_directory,
            commands::read_workspace_text_file,
            commands::write_workspace_text_file,
            commands::create_workspace_directory,
            commands::scm_git_diff,
            commands::scm_read_git_blob,
            commands::scm_status,
            commands::scm_line_stats,
            commands::scm_path_line_stats,
            commands::scm_path_line_stats_bulk,
            commands::scm_stage,
            commands::scm_stage_all,
            commands::scm_unstage,
            commands::scm_unstage_all,
            commands::scm_discard_tracked,
            commands::scm_discard_untracked,
            commands::scm_commit,
            // PR + archive
            commands::pr_gather_context,
            commands::header_branch_context,
            commands::pr_check_status,
            commands::pr_write_instruction,
            commands::pr_link,
            commands::archive_workspace,
            commands::restore_workspace,
            commands::copy_into_workspace,
            commands::move_within_workspace,
            commands::rename_workspace_entry,
            commands::delete_workspace_entry,
            commands::copy_within_workspace,
            commands::read_clipboard_file_paths,
        ])
        .setup(|app| {
            let _ = agent_cli::ensure_agent_cli_integration();
            agent_cli::start_agent_cli_bridge(app.handle().clone());
            native_shortcuts::init(app.handle().clone());

            let menu = build_app_menu(&app.handle())?;
            app.set_menu(menu)?;

            #[cfg(target_os = "macos")]
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_background_color(Some(tauri::window::Color(0, 0, 0, 0)));
            }

            if let Some(w) = app.get_webview_window("main") {
                w.on_window_event(|event| {
                    if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                        std::process::exit(0);
                    }
                });
            }

            #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
            ghostty_app::init_ghostty_app(app.handle().clone());

            let handle = app.handle().clone();

            let rt = tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .build()
                .expect("Failed to create tokio runtime");

            let poll_handle = handle.clone();
            let poll_db = poll_handle.state::<DbState>().0.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(10));
                if !git::gh_cli_available() {
                    return;
                }
                loop {
                    let open_prs = poll_db.workspaces_with_open_prs();
                    for ws in open_prs {
                        if let Some(pr_number) = ws.pr_number {
                            if let Ok(info) = git::gh_pr_status(&ws.worktree_path, pr_number) {
                                if info.state != "open" {
                                    let _ = poll_db.update_workspace_pr(
                                        &ws.id,
                                        ws.pr_url.as_deref(),
                                        ws.pr_number,
                                        Some(&info.state),
                                    );
                                    let _ = poll_handle.emit(
                                        "pr-state-changed",
                                        serde_json::json!({
                                            "workspaceId": ws.id,
                                            "prState": info.state,
                                        }),
                                    );
                                }
                            }
                        }
                    }
                    std::thread::sleep(std::time::Duration::from_secs(60));
                }
            });

            std::thread::spawn(move || {
                rt.block_on(async {
                    loop {
                        tokio::time::sleep(tokio::time::Duration::from_secs(3600)).await;
                    }
                });
            });

            let hb_handle = handle.clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(1));
                let hb = hb_handle.clone();
                let _ = hb.run_on_main_thread(move || {
                    tlog!("HEARTBEAT", "main thread alive");
                });
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
