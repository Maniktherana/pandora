// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod daemon_bridge;
mod database;
mod git;
mod ghostty_app;
mod ghostty_ffi;
mod models;
mod surface_registry;
mod terminal_commands;

use commands::DbState;
use database::AppDatabase;
use std::sync::Arc;
use tauri::Manager;

fn main() {
    let pandora_home = git::pandora_home();
    let db = AppDatabase::open(&pandora_home).expect("Failed to open database");
    let db = Arc::new(db);

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(daemon_bridge::DaemonState::new())
        .manage(Arc::new(surface_registry::SurfaceRegistry::new()))
        .manage(DbState(db))
        .invoke_handler(tauri::generate_handler![
            // Daemon bridge
            daemon_bridge::daemon_send,
            // Native terminal surfaces
            terminal_commands::terminal_surface_create,
            terminal_commands::terminal_surface_update,
            terminal_commands::terminal_surface_destroy,
            terminal_commands::terminal_surface_focus,
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
            // Layout
            commands::save_workspace_layout,
            commands::load_workspace_layout,
            // Runtime
            commands::start_workspace_runtime,
            // Full state reload
            commands::load_app_state,
        ])
        .setup(|app| {
            ghostty_app::init_ghostty_app(app.handle().clone());

            // Resolve daemon dir relative to repo root
            let daemon_dir = std::env::current_dir()
                .unwrap_or_default()
                .parent()
                .and_then(|p| p.parent())
                .map(|p| p.join("daemon"))
                .unwrap_or_else(|| std::path::PathBuf::from("../daemon"));

            let handle = app.handle().clone();
            let daemon_state = handle.state::<daemon_bridge::DaemonState>();

            // Store daemon directory for later workspace launches
            let rt = tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .build()
                .expect("Failed to create tokio runtime");

            let daemon_dir_clone = daemon_dir.clone();
            let daemon_state_ref = daemon_state.inner();
            rt.block_on(async {
                daemon_bridge::set_daemon_dir(daemon_state_ref, daemon_dir_clone).await;
            });

            // Start tokio runtime in background for async operations
            std::thread::spawn(move || {
                rt.block_on(async {
                    loop {
                        tokio::time::sleep(tokio::time::Duration::from_secs(3600)).await;
                    }
                });
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
