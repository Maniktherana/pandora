//! Process-level singleton managing the ghostty_app_t lifetime.
//!
//! Mirrors the Swift app's GhosttyApp.swift behavior: one global app handle,
//! initialized once on the main thread, with runtime callbacks for clipboard,
//! wakeup, and action dispatch.

use crate::ghostty_ffi::*;
use std::ffi::{c_void, CString};
use std::io::Write;
use std::sync::OnceLock;
use tauri::AppHandle;

/// Process-global ghostty app handle. Must only be accessed from the main thread.
static GHOSTTY_APP: OnceLock<GhosttyAppState> = OnceLock::new();
static TAURI_APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

pub struct GhosttyAppState {
    pub app: ghostty_app_t,
    // Store the runtime config so callbacks stay alive
    _runtime_config: Box<ghostty_runtime_config_s>,
}

// Safety: ghostty_app_t is thread-safe for the operations we perform
// (tick is called from main thread, the handle itself is a pointer to a
// thread-safe Zig structure).
unsafe impl Send for GhosttyAppState {}
unsafe impl Sync for GhosttyAppState {}

/// Initialize the global ghostty app. Must be called once, early in app startup.
///
/// Panics if ghostty initialization fails or if called more than once.
pub fn init_ghostty_app(app_handle: AppHandle) {
    let _ = TAURI_APP_HANDLE.set(app_handle);
    GHOSTTY_APP.get_or_init(|| {
        // 1. ghostty_init must be called before any other API
        let rc = unsafe { ghostty_init(0, std::ptr::null_mut()) };
        assert_eq!(rc, 0, "ghostty_init failed with code {rc}");

        // 2. Create and configure ghostty config
        let config = unsafe { ghostty_config_new() };
        assert!(!config.is_null(), "ghostty_config_new returned null");

        // 3. Load default config files (~/.config/ghostty/config etc.)
        unsafe { ghostty_config_load_default_files(config) };

        // 4. Write override file for Pandora-specific settings
        let override_path = "/tmp/pandora-ghostty-overrides.conf";
        if let Ok(mut f) = std::fs::File::create(override_path) {
            let _ = f.write_all(b"close-on-exit = always\nlogin-shell = false\n");
        }

        // 5. Load override file
        if let Ok(path_cstr) = CString::new(override_path) {
            unsafe { ghostty_config_load_file(config, path_cstr.as_ptr()) };
        }

        // 6. Finalize config
        unsafe { ghostty_config_finalize(config) };

        // 7. Build runtime config with callbacks
        let mut runtime_config = Box::new(ghostty_runtime_config_s {
            userdata: std::ptr::null_mut(),
            supports_selection_clipboard: false,
            wakeup_cb: Some(runtime_wakeup_cb),
            action_cb: Some(runtime_action_cb),
            read_clipboard_cb: Some(runtime_read_clipboard_cb),
            confirm_read_clipboard_cb: Some(runtime_confirm_read_clipboard_cb),
            write_clipboard_cb: Some(runtime_write_clipboard_cb),
            close_surface_cb: Some(runtime_close_surface_cb),
        });

        // 8. Create the app
        let app = unsafe { ghostty_app_new(&*runtime_config, config) };
        assert!(!app.is_null(), "ghostty_app_new returned null");

        // Store the app pointer as userdata so the wakeup callback can tick it
        runtime_config.userdata = app;

        // 9. Free config (app owns its own copy)
        unsafe { ghostty_config_free(config) };

        GhosttyAppState {
            app,
            _runtime_config: runtime_config,
        }
    });
}

/// Returns the global ghostty app handle, or `None` if not yet initialized.
pub fn get_ghostty_app() -> Option<ghostty_app_t> {
    GHOSTTY_APP.get().map(|s| s.app)
}

/// Start a periodic ghostty_app_tick on the main thread.
///
/// In embedded/HOST_MANAGED mode, the host must call tick regularly to drain
/// the app mailbox and keep the IO→render pipeline flowing. Ghostty's internal
/// BlockingQueue has capacity 64 — when full, `ghostty_surface_write_buffer`
/// blocks until the IO thread consumes messages. The IO thread signals via
/// `wakeup_cb` which dispatches tick to the main thread. Under heavy output,
/// these async dispatches pile up behind WebView/IPC work on Tauri's main
/// thread, causing the pipeline to stall permanently.
///
/// This timer guarantees tick runs at ~120Hz regardless of wakeup callback
/// delays, matching standalone Ghostty's behavior where tick runs every
/// iteration of the macOS run loop.
pub fn start_tick_timer(app_handle: tauri::AppHandle) {
    // Cache the app pointer as usize to cross thread boundaries (raw pointer isn't Send).
    // Safety: ghostty_app_t is thread-safe for tick (same assertion as GhosttyAppState).
    let app_ptr = get_ghostty_app().expect("ghostty app must be initialized before tick timer");
    let app_usize = app_ptr as usize;

    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(tokio::time::Duration::from_millis(8));
        loop {
            interval.tick().await;
            let _ = app_handle.run_on_main_thread(move || unsafe {
                ghostty_app_tick(app_usize as ghostty_app_t);
            });
        }
    });
}

// ---------------------------------------------------------------------------
// Runtime callbacks (extern "C")
// ---------------------------------------------------------------------------

/// Called by ghostty when it needs the app runtime to wake up and process events.
unsafe extern "C" fn runtime_wakeup_cb(userdata: *mut c_void) {
    if !userdata.is_null() {
        let app = userdata as usize;
        if let Some(handle) = TAURI_APP_HANDLE.get() {
            let handle = handle.clone();
            let _ = handle.run_on_main_thread(move || unsafe {
                ghostty_app_tick(app as ghostty_app_t);
            });
        } else {
            eprintln!("[ghostty] wakeup_cb skipped: no TAURI_APP_HANDLE (init ordering bug?)");
        }
    }
}

/// Called when ghostty wants to perform a runtime action (new_window, new_tab, etc.).
/// We return false for all actions since we don't handle ghostty-initiated actions.
unsafe extern "C" fn runtime_action_cb(
    _app: ghostty_app_t,
    _target: ghostty_target_s,
    _action: ghostty_action_s,
) -> bool {
    false
}

/// Called when ghostty wants to read the clipboard.
/// TODO: Read from NSPasteboard general and call ghostty_surface_complete_clipboard_request.
/// For now, return false (clipboard read not supported yet).
unsafe extern "C" fn runtime_read_clipboard_cb(
    _userdata: *mut c_void,
    _clipboard: ghostty_clipboard_e,
    _state: *mut c_void,
) -> bool {
    false
}

/// Called when ghostty wants confirmation before reading the clipboard.
/// We auto-approve by immediately completing the clipboard request.
unsafe extern "C" fn runtime_confirm_read_clipboard_cb(
    _userdata: *mut c_void,
    _data: *const std::ffi::c_char,
    _state: *mut c_void,
    _request: ghostty_clipboard_request_e,
) {
    // Auto-approve: in the future we can call
    // ghostty_surface_complete_clipboard_request here with the data.
    // For now, no-op since we don't have the surface handle in this context.
}

/// Called when ghostty wants to write to the clipboard.
/// TODO: Write to NSPasteboard general. For now, no-op.
unsafe extern "C" fn runtime_write_clipboard_cb(
    _userdata: *mut c_void,
    _clipboard: ghostty_clipboard_e,
    _content: *const ghostty_clipboard_content_s,
    _content_len: usize,
    _confirm: bool,
) {
    // No-op: clipboard write not wired yet.
}

/// Called when ghostty wants to close a surface.
/// No-op: the runtime manages terminal lifecycle via `close_session`.
unsafe extern "C" fn runtime_close_surface_cb(_userdata: *mut c_void, _process_alive: bool) {}
