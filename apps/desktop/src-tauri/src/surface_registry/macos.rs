//! Native terminal surface registry.
//!
//! Maps session IDs to ghostty surfaces + NSViews, managing their lifecycle,
//! layout, focus, and I/O routing. Each surface is an NSView overlaid on the
//! Tauri webview, with a ghostty terminal rendering into it.

use crate::ghostty_app;
use crate::daemon_bridge::{self, DaemonState};
use crate::ghostty_ffi::*;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine as _;
use objc2::MainThreadMarker;
use objc2::rc::Retained;
use objc2_app_kit::NSView;
use objc2_foundation::{NSPoint, NSRect, NSSize};
use std::collections::HashMap;
use std::ffi::c_void;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

unsafe extern "C" {
    fn pandora_terminal_view_new(x: f64, y: f64, width: f64, height: f64) -> *mut c_void;
    fn pandora_terminal_view_set_surface(view: *mut c_void, surface: ghostty_surface_t);
    fn pandora_terminal_view_focus(view: *mut c_void) -> bool;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub scale_factor: f64,
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/// Context passed to ghostty receive callbacks so they can identify
/// which workspace/session produced the data.
struct SurfaceCallbackContext {
    workspace_id: String,
    session_id: String,
    app_handle: AppHandle,
}

struct NativeSurface {
    session_id: String,
    ghostty_surface: ghostty_surface_t,
    ns_view: Retained<NSView>,
    callback_ctx: *mut SurfaceCallbackContext,
    rect: SurfaceRect,
    visible: bool,
    focused: bool,
}

// Safety: NativeSurface contains raw pointers that are only accessed
// while holding the Mutex, and the ghostty surface is created/destroyed
// on the main thread.
unsafe impl Send for NativeSurface {}

// ---------------------------------------------------------------------------
// SurfaceRegistry
// ---------------------------------------------------------------------------

pub struct SurfaceRegistry {
    surfaces: Mutex<HashMap<String, NativeSurface>>,
    /// Map session_id -> surface_id for output routing
    session_map: Mutex<HashMap<String, String>>,
    pending_output: Mutex<HashMap<String, Vec<Vec<u8>>>>,
    /// NSWindow pointer (the main Tauri window)
    window_ptr: Mutex<Option<*mut c_void>>,
    /// Refcount: while > 0, terminal NSViews stay hidden so web UI (tab drag, pane resize) receives input.
    web_overlay_depth: Mutex<u32>,
}

// Safety: All mutable state is behind Mutex; raw pointers are only
// dereferenced on the main thread under lock.
unsafe impl Send for SurfaceRegistry {}
unsafe impl Sync for SurfaceRegistry {}

impl SurfaceRegistry {
    /// Create an empty registry.
    pub fn new() -> Self {
        Self {
            surfaces: Mutex::new(HashMap::new()),
            session_map: Mutex::new(HashMap::new()),
            pending_output: Mutex::new(HashMap::new()),
            window_ptr: Mutex::new(None),
            web_overlay_depth: Mutex::new(0),
        }
    }

    fn web_ui_suppresses_native_terminals(&self) -> bool {
        *self.web_overlay_depth.lock().unwrap() > 0
    }

    /// Store the NSWindow pointer for later use when adding subviews.
    pub fn set_window(&self, window_ptr: *mut c_void) {
        let mut guard = self.window_ptr.lock().unwrap();
        *guard = Some(window_ptr);
    }

    /// Create a new ghostty surface and its backing NSView.
    ///
    /// The NSView is added as a subview of the window's content view, positioned
    /// above the webview so the native terminal renders on top.
    pub fn create_surface(
        &self,
        surface_id: String,
        workspace_id: String,
        session_id: String,
        rect: SurfaceRect,
        app_handle: AppHandle,
    ) -> Result<(), String> {
        let app = ghostty_app::get_ghostty_app()
            .ok_or_else(|| "Ghostty app not initialized".to_string())?;

        let window_ptr = {
            let guard = self.window_ptr.lock().unwrap();
            guard.ok_or_else(|| "NSWindow not set".to_string())?
        };

        // Layout changes may use a new surface_id for the same PTY; tear down the old native surface.
        let prev_for_session = {
            let sm = self.session_map.lock().unwrap();
            sm.get(&session_id).cloned()
        };
        if let Some(old_id) = prev_for_session {
            if old_id != surface_id {
                let _ = self.destroy_surface(&old_id);
            }
        }
        if self.surfaces.lock().unwrap().contains_key(&surface_id) {
            let _ = self.destroy_surface(&surface_id);
        }

        // --- NSView creation (must happen on main thread) ---

        // Flip Y: macOS has origin at bottom-left, frontend sends top-left.
        // We need the window height to flip.
        let flipped_y = unsafe {
            let content_view: *mut c_void =
                objc2::msg_send![window_ptr as *const objc2::runtime::AnyObject, contentView];
            if content_view.is_null() {
                return Err("Window has no contentView".to_string());
            }
            let frame: NSRect =
                objc2::msg_send![content_view as *const objc2::runtime::AnyObject, frame];
            frame.size.height - rect.y - rect.height
        };

        let _mtm = MainThreadMarker::new()
            .ok_or_else(|| "create_surface must run on the main thread".to_string())?;

        // Create the native terminal NSView subclass that can receive key/mouse events.
        let ns_view_raw = unsafe {
            pandora_terminal_view_new(rect.x, flipped_y, rect.width, rect.height)
        };
        if ns_view_raw.is_null() {
            return Err("pandora_terminal_view_new returned null".to_string());
        }
        let ns_view = unsafe { Retained::from_raw(ns_view_raw.cast::<NSView>()) }
            .ok_or_else(|| "failed to retain native terminal view".to_string())?;
        ns_view.setWantsLayer(true);

        // Add as subview of the window's content view (above webview)
        unsafe {
            let content_view: *mut objc2::runtime::AnyObject =
                objc2::msg_send![window_ptr as *const objc2::runtime::AnyObject, contentView];
            let _: () = objc2::msg_send![content_view, addSubview: &*ns_view];
        }

        let ns_view_raw = Retained::as_ptr(&ns_view) as *mut c_void;

        // --- Callback context ---
        let callback_ctx = Box::into_raw(Box::new(SurfaceCallbackContext {
            workspace_id: workspace_id.clone(),
            session_id: session_id.clone(),
            app_handle,
        }));

        // --- Ghostty surface config ---
        let mut config = unsafe { ghostty_surface_config_new() };
        config.platform_tag = ghostty_platform_e::GHOSTTY_PLATFORM_MACOS;
        config.platform.macos = ghostty_platform_macos_s {
            nsview: ns_view_raw,
        };
        config.backend = ghostty_surface_io_backend_e::GHOSTTY_SURFACE_IO_BACKEND_HOST_MANAGED;
        config.scale_factor = rect.scale_factor;
        config.context = ghostty_surface_context_e::GHOSTTY_SURFACE_CONTEXT_WINDOW;
        config.receive_userdata = callback_ctx as *mut c_void;
        config.receive_buffer = Some(receive_buffer_callback);
        config.receive_resize = Some(receive_resize_callback);

        // --- Create the ghostty surface ---
        let surface = unsafe { ghostty_surface_new(app, &config) };
        if surface.is_null() {
            // Clean up on failure
            unsafe {
                let _: () = objc2::msg_send![&*ns_view, removeFromSuperview];
                drop(Box::from_raw(callback_ctx));
            }
            return Err("ghostty_surface_new returned null".to_string());
        }

        unsafe {
            pandora_terminal_view_set_surface(ns_view_raw, surface);
        }

        // Set initial pixel size
        let width_px = (rect.width * rect.scale_factor) as u32;
        let height_px = (rect.height * rect.scale_factor) as u32;
        unsafe { ghostty_surface_set_size(surface, width_px, height_px) };

        // --- Store in maps ---
        let native_surface = NativeSurface {
            session_id: session_id.clone(),
            ghostty_surface: surface,
            ns_view,
            callback_ctx,
            rect,
            visible: true,
            focused: false,
        };

        {
            let mut surfaces = self.surfaces.lock().unwrap();
            surfaces.insert(surface_id.clone(), native_surface);
        }
        {
            let mut session_map = self.session_map.lock().unwrap();
            session_map.insert(session_id.clone(), surface_id.clone());
        }
        self.flush_pending_output(&session_id);

        let suppress = self.web_ui_suppresses_native_terminals();
        {
            let surfaces = self.surfaces.lock().unwrap();
            if let Some(s) = surfaces.get(&surface_id) {
                s.ns_view.setHidden(suppress);
            }
        }

        Ok(())
    }

    /// Update a surface's position, size, visibility, and focus state.
    pub fn update_surface(
        &self,
        surface_id: &str,
        rect: SurfaceRect,
        visible: bool,
        focused: bool,
    ) -> Result<(), String> {
        let suppress = self.web_ui_suppresses_native_terminals();
        let mut surfaces = self.surfaces.lock().unwrap();
        let surface = surfaces
            .get_mut(surface_id)
            .ok_or_else(|| format!("Surface not found: {surface_id}"))?;

        // Flip Y coordinate
        let flipped_y = unsafe {
            let window_ptr = {
                let guard = self.window_ptr.lock().unwrap();
                guard.ok_or_else(|| "NSWindow not set".to_string())?
            };
            let content_view: *mut c_void =
                objc2::msg_send![window_ptr as *const objc2::runtime::AnyObject, contentView];
            let frame: NSRect =
                objc2::msg_send![content_view as *const objc2::runtime::AnyObject, frame];
            frame.size.height - rect.y - rect.height
        };

        let new_frame = NSRect::new(
            NSPoint::new(rect.x, flipped_y),
            NSSize::new(rect.width, rect.height),
        );

        // Update NSView frame and visibility
        surface.ns_view.setFrame(new_frame);
        let hidden = suppress || !visible;
        surface.ns_view.setHidden(hidden);

        // Update ghostty surface size (in pixels)
        let width_px = (rect.width * rect.scale_factor) as u32;
        let height_px = (rect.height * rect.scale_factor) as u32;
        unsafe {
            ghostty_surface_set_size(surface.ghostty_surface, width_px, height_px);
        }

        // Update focus
        unsafe {
            ghostty_surface_set_focus(surface.ghostty_surface, focused);
        }
        if focused {
            let _ = unsafe { pandora_terminal_view_focus(Retained::as_ptr(&surface.ns_view) as *mut c_void) };
        }

        // Update content scale if it changed
        if (rect.scale_factor - surface.rect.scale_factor).abs() > f64::EPSILON {
            unsafe {
                ghostty_surface_set_content_scale(
                    surface.ghostty_surface,
                    rect.scale_factor,
                    rect.scale_factor,
                );
            }
        }

        // Persist state
        surface.rect = rect;
        surface.visible = visible;
        surface.focused = focused;

        Ok(())
    }

    /// Hide all terminal surfaces (first holder). Pair with [`Self::end_web_overlay`].
    pub fn begin_web_overlay(&self) {
        let mut d = self.web_overlay_depth.lock().unwrap();
        *d += 1;
        if *d != 1 {
            return;
        }
        drop(d);
        let surfaces = self.surfaces.lock().unwrap();
        for s in surfaces.values() {
            s.ns_view.setHidden(true);
        }
    }

    /// Restore visibility after [`Self::begin_web_overlay`]. Safe to over-pop (clamped).
    pub fn end_web_overlay(&self) {
        let mut d = self.web_overlay_depth.lock().unwrap();
        *d = d.saturating_sub(1);
        if *d > 0 {
            return;
        }
        drop(d);
        let surfaces = self.surfaces.lock().unwrap();
        for s in surfaces.values() {
            s.ns_view.setHidden(!s.visible);
        }
    }

    /// Destroy a surface, freeing the ghostty surface and removing the NSView.
    pub fn destroy_surface(&self, surface_id: &str) -> Result<(), String> {
        let native_surface = {
            let mut surfaces = self.surfaces.lock().unwrap();
            surfaces
                .remove(surface_id)
                .ok_or_else(|| format!("Surface not found: {surface_id}"))?
        };

        // Remove from session map
        {
            let mut session_map = self.session_map.lock().unwrap();
            session_map.remove(&native_surface.session_id);
        }

        // Free the ghostty surface
        unsafe {
            pandora_terminal_view_set_surface(
                Retained::as_ptr(&native_surface.ns_view) as *mut c_void,
                std::ptr::null_mut(),
            );
            ghostty_surface_free(native_surface.ghostty_surface);
        }

        // Remove NSView from its superview
        unsafe {
            let _: () = objc2::msg_send![&*native_surface.ns_view, removeFromSuperview];
        }

        // Free the callback context
        unsafe {
            drop(Box::from_raw(native_surface.callback_ctx));
        }

        Ok(())
    }

    /// Feed terminal output data to a surface, identified by session ID.
    ///
    /// Returns `true` if the surface was found and data was written.
    pub fn feed_output(&self, session_id: &str, data: &[u8]) -> bool {
        let surface_id = {
            let session_map = self.session_map.lock().unwrap();
            match session_map.get(session_id) {
                Some(id) => id.clone(),
                None => {
                    self.pending_output
                        .lock()
                        .unwrap()
                        .entry(session_id.to_string())
                        .or_default()
                        .push(data.to_vec());
                    return false;
                }
            }
        };

        let surfaces = self.surfaces.lock().unwrap();
        match surfaces.get(&surface_id) {
            Some(surface) => {
                unsafe {
                    ghostty_surface_write_buffer(
                        surface.ghostty_surface,
                        data.as_ptr(),
                        data.len(),
                    );
                }
                true
            }
            None => {
                drop(surfaces);
                self.pending_output
                    .lock()
                    .unwrap()
                    .entry(session_id.to_string())
                    .or_default()
                    .push(data.to_vec());
                false
            }
        }
    }

    /// Set focus on the given surface and unfocus all others.
    pub fn focus_surface(&self, surface_id: &str) -> Result<(), String> {
        let mut surfaces = self.surfaces.lock().unwrap();

        // Check the target surface exists
        if !surfaces.contains_key(surface_id) {
            return Err(format!("Surface not found: {surface_id}"));
        }

        for (id, surface) in surfaces.iter_mut() {
            let should_focus = id == surface_id;
            if surface.focused != should_focus {
                unsafe {
                    ghostty_surface_set_focus(surface.ghostty_surface, should_focus);
                }
                if should_focus {
                    let _ = unsafe {
                        pandora_terminal_view_focus(
                            Retained::as_ptr(&surface.ns_view) as *mut c_void,
                        )
                    };
                }
                surface.focused = should_focus;
            }
        }

        Ok(())
    }

    fn flush_pending_output(&self, session_id: &str) {
        let buffered = self
            .pending_output
            .lock()
            .unwrap()
            .remove(session_id)
            .unwrap_or_default();
        for chunk in buffered {
            let _ = self.feed_output(session_id, &chunk);
        }
    }
}

// ---------------------------------------------------------------------------
// Ghostty receive callbacks (extern "C")
// ---------------------------------------------------------------------------

/// Called by ghostty when the terminal generates output in HOST_MANAGED mode.
/// Routes data back toward the daemon for the associated session.
unsafe extern "C" fn receive_buffer_callback(
    userdata: *mut c_void,
    buf: *const u8,
    len: usize,
) {
    if userdata.is_null() || buf.is_null() || len == 0 {
        return;
    }

    let ctx = &*(userdata as *const SurfaceCallbackContext);
    let data = std::slice::from_raw_parts(buf, len);
    let payload = serde_json::json!({
        "type": "input",
        "sessionID": ctx.session_id,
        "data": BASE64_STANDARD.encode(data),
    })
    .to_string();
    let app_handle = ctx.app_handle.clone();
    let workspace_id = ctx.workspace_id.clone();
    tauri::async_runtime::spawn(async move {
        let daemon_state = app_handle.state::<DaemonState>();
        if let Err(err) = daemon_bridge::send_workspace_message(daemon_state.inner(), &workspace_id, &payload).await {
            eprintln!("[surface_registry] failed to route terminal input: {err}");
        }
    });
}

/// Called by ghostty when the terminal grid size changes.
/// Routes resize events back toward the daemon for the associated session.
unsafe extern "C" fn receive_resize_callback(
    userdata: *mut c_void,
    cols: u16,
    rows: u16,
    _width_px: u32,
    _height_px: u32,
) {
    if userdata.is_null() {
        return;
    }

    let ctx = &*(userdata as *const SurfaceCallbackContext);
    let payload = serde_json::json!({
        "type": "resize",
        "sessionID": ctx.session_id,
        "cols": cols,
        "rows": rows,
    })
    .to_string();
    let app_handle = ctx.app_handle.clone();
    let workspace_id = ctx.workspace_id.clone();
    tauri::async_runtime::spawn(async move {
        let daemon_state = app_handle.state::<DaemonState>();
        if let Err(err) = daemon_bridge::send_workspace_message(daemon_state.inner(), &workspace_id, &payload).await {
            eprintln!("[surface_registry] failed to route terminal resize: {err}");
        }
    });
}
