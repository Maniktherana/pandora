//! When the native Ghostty `NSView` is first responder, keyboard events never reach the
//! webview, so Tauri/React shortcut handlers do not run. Route the same app shortcuts here
//! and emit `app-shortcut` for the frontend.

use std::sync::OnceLock;
use tauri::{AppHandle, Emitter};

static APP: OnceLock<AppHandle> = OnceLock::new();

pub fn init(app: AppHandle) {
    let _ = APP.set(app);
}

/// macOS virtual key codes (ANSI US) for keys we care about.
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
mod key {
    pub const Q: u32 = 12;
    pub const W: u32 = 13;
    pub const T: u32 = 17;
    pub const B: u32 = 11;
    pub const LEFT_BRACKET: u32 = 33;
    pub const RIGHT_BRACKET: u32 = 30;
    pub const GRAVE: u32 = 50;
}

/// Called from `native_terminal_view.m` before delivering keys to Ghostty.
/// Returns 0 = pass to Ghostty, 1 = handled (emit), 2 = `[super keyDown:]` (e.g. Cmd+Q).
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
#[no_mangle]
pub extern "C" fn pandora_try_emit_app_shortcut(
    keycode: u32,
    cmd: bool,
    shift: bool,
    ctrl: bool,
    alt: bool,
) -> u8 {
    if alt {
        return 0;
    }
    let Some(app) = APP.get() else {
        return 0;
    };

    if ctrl && !cmd {
        if keycode == key::GRAVE {
            let _ = app.emit("app-shortcut", "toggle-bottom-terminal");
            return 1;
        }
        return 0;
    }

    if cmd {
        use key::*;
        let emit = |s: &str| {
            let _ = app.emit("app-shortcut", s);
        };
        match keycode {
            W if !shift => {
                emit("close-tab");
                return 1;
            }
            T => {
                emit("new-terminal");
                return 1;
            }
            B if !shift => {
                emit("toggle-sidebar");
                return 1;
            }
            LEFT_BRACKET if shift => {
                emit("previous-tab");
                return 1;
            }
            RIGHT_BRACKET if shift => {
                emit("next-tab");
                return 1;
            }
            Q if !shift => {
                return 2;
            }
            _ => {}
        }
    }
    0
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
#[no_mangle]
pub extern "C" fn pandora_emit_terminal_focus(session_id: *const std::ffi::c_char) {
    let Some(app) = APP.get() else {
        return;
    };
    if session_id.is_null() {
        return;
    }

    let session_id = unsafe { std::ffi::CStr::from_ptr(session_id) };
    if let Ok(session_id) = session_id.to_str() {
        let _ = app.emit("native-terminal-focus", session_id.to_string());
    }
}

#[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
#[no_mangle]
pub extern "C" fn pandora_try_emit_app_shortcut(
    _keycode: u32,
    _cmd: bool,
    _shift: bool,
    _ctrl: bool,
    _alt: bool,
) -> u8 {
    0
}

#[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
#[no_mangle]
pub extern "C" fn pandora_emit_terminal_focus(_session_id: *const std::ffi::c_char) {}
