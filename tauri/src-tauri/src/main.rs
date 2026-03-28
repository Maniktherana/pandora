// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod daemon_bridge;

use std::process::Command;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(daemon_bridge::DaemonState::new())
        .invoke_handler(tauri::generate_handler![daemon_bridge::daemon_send])
        .setup(|app| {
            let pid = std::process::id();

            // Resolve daemon dir relative to repo root
            let daemon_dir = std::env::current_dir()
                .unwrap_or_default()
                .parent()
                .and_then(|p| p.parent())
                .map(|p| p.join("daemon"))
                .unwrap_or_else(|| std::path::PathBuf::from("../daemon"));

            let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
            let project_dir = format!("{}/pandora-tauri-project", home);
            let _ = std::fs::create_dir_all(&project_dir);

            // Start the daemon as a child process
            eprintln!("Starting daemon from {:?}", daemon_dir);
            let daemon_dir_clone = daemon_dir.clone();
            let project_dir_clone = project_dir.clone();
            std::thread::spawn(move || {
                match Command::new("bun")
                    .arg("run")
                    .arg("src/index.ts")
                    .arg(&project_dir_clone)
                    .current_dir(&daemon_dir_clone)
                    .env("PANDORA_PARENT_PID", pid.to_string())
                    .env(
                        "PANDORA_HOME",
                        format!("{}/.pandora", project_dir_clone),
                    )
                    .spawn()
                {
                    Ok(mut child) => {
                        eprintln!("Daemon PID: {:?}", child.id());
                        let _ = child.wait();
                        eprintln!("Daemon exited");
                    }
                    Err(e) => eprintln!("Failed to start daemon: {}", e),
                }
            });

            // Start reading from daemon socket (connects when socket appears).
            // start_daemon_reader spawns its own tokio task, so we just need
            // a runtime running on a background thread.
            let handle = app.handle().clone();
            let rt = tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .build()
                .expect("Failed to create tokio runtime");

            std::thread::spawn(move || {
                rt.block_on(async {
                    daemon_bridge::start_daemon_reader(handle);
                    // Keep the runtime alive
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
