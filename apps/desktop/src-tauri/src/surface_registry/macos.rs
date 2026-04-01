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
use objc2::runtime::AnyObject;
use objc2::MainThreadMarker;
use objc2::rc::Retained;
use objc2_app_kit::NSView;
use objc2_foundation::{NSPoint, NSRect, NSSize};
use std::collections::HashMap;
use std::ffi::c_void;
use std::sync::{Arc, Mutex};
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

struct RegistryInner {
    surfaces: HashMap<String, NativeSurface>,
    session_map: HashMap<String, String>,
    pending_output: HashMap<String, Vec<Vec<u8>>>,
}

struct NativeSurface {
    session_id: String,
    ghostty_surface: ghostty_surface_t,
    ns_view: Retained<NSView>,
    _callback_ctx: Arc<SurfaceCallbackContext>,
    callback_ctx_raw: *const SurfaceCallbackContext,
    rect: SurfaceRect,
    visible: bool,
    focused: bool,
}

// Safety: NativeSurface contains raw pointers that are only accessed
// while holding the Mutex, and the ghostty surface is created/destroyed
// on the main thread.
unsafe impl Send for NativeSurface {}

/// `NSWindow.backingScaleFactor` for the display the window is on (unlike WKWebView DPR).
unsafe fn ns_window_backing_scale(window_ptr: *mut c_void) -> f64 {
    let win = window_ptr as *const AnyObject;
    let scale: f64 = objc2::msg_send![win, backingScaleFactor];
    if scale.is_finite() && scale > 0.0 {
        scale
    } else {
        1.0
    }
}

/// Best-effort backing scale when moving between displays: `NSWindow`, `window.screen`, and
/// `deepestScreen` can lag each other briefly; take the max of finite readings so 2× is picked up
/// as soon as any AppKit object reports it.
unsafe fn ns_effective_backing_scale(window_ptr: *mut c_void) -> f64 {
    let win = window_ptr as *const AnyObject;
    let w = ns_window_backing_scale(window_ptr);

    let screen: *const AnyObject = objc2::msg_send![win, screen];
    let mut s = w;
    if !screen.is_null() {
        let v: f64 = objc2::msg_send![screen, backingScaleFactor];
        if v.is_finite() && v > 0.0 {
            s = v;
        }
    }

    let deep: *const AnyObject = objc2::msg_send![win, deepestScreen];
    let mut d = s;
    if !deep.is_null() {
        let v: f64 = objc2::msg_send![deep, backingScaleFactor];
        if v.is_finite() && v > 0.0 {
            d = v;
        }
    }

    let m = w.max(s).max(d);
    if m.is_finite() && m > 0.0 {
        m
    } else {
        1.0
    }
}

/// Same backing scale as [`SurfaceRegistry::update_surface`] (for the `native_window_scale_factor` command).
pub fn backing_scale_for_ns_window(window_ptr: *mut c_void) -> f64 {
    unsafe { ns_effective_backing_scale(window_ptr) }
}

fn surface_state_unchanged(
    prev_rect: &SurfaceRect,
    next_rect: &SurfaceRect,
    prev_vis: bool,
    next_vis: bool,
    prev_foc: bool,
    next_foc: bool,
) -> bool {
    const EPS_POS: f64 = 0.25;
    const EPS_SCALE: f64 = 0.001;
    (prev_rect.x - next_rect.x).abs() < EPS_POS
        && (prev_rect.y - next_rect.y).abs() < EPS_POS
        && (prev_rect.width - next_rect.width).abs() < EPS_POS
        && (prev_rect.height - next_rect.height).abs() < EPS_POS
        && (prev_rect.scale_factor - next_rect.scale_factor).abs() < EPS_SCALE
        && prev_vis == next_vis
        && prev_foc == next_foc
}

// ---------------------------------------------------------------------------
// SurfaceRegistry
// ---------------------------------------------------------------------------

pub struct SurfaceRegistry {
    inner: Mutex<RegistryInner>,
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
            inner: Mutex::new(RegistryInner {
                surfaces: HashMap::new(),
                session_map: HashMap::new(),
                pending_output: HashMap::new(),
            }),
            window_ptr: Mutex::new(None),
            web_overlay_depth: Mutex::new(0),
        }
    }

    fn web_ui_suppresses_native_terminals(&self) -> bool {
        *self.web_overlay_depth.lock().unwrap() > 0
    }

    fn extract_surface_locked(inner: &mut RegistryInner, surface_id: &str) -> Option<NativeSurface> {
        let native_surface = inner.surfaces.remove(surface_id)?;
        if inner
            .session_map
            .get(&native_surface.session_id)
            .map(|id| id == surface_id)
            .unwrap_or(false)
        {
            inner.session_map.remove(&native_surface.session_id);
        }
        inner.pending_output.remove(&native_surface.session_id);
        Some(native_surface)
    }

    fn flush_pending_locked(inner: &mut RegistryInner, session_id: &str, surface: ghostty_surface_t) {
        let buffered = inner.pending_output.remove(session_id).unwrap_or_default();
        for chunk in buffered {
            unsafe {
                ghostty_surface_write_buffer(surface, chunk.as_ptr(), chunk.len());
            }
        }
    }

    unsafe fn teardown_native_surface(native_surface: NativeSurface) {
        // IMPORTANT: Null the view's surface pointer before freeing Ghostty so any AppKit
        // callbacks triggered by removeFromSuperview see NULL and bail out.
        pandora_terminal_view_set_surface(
            Retained::as_ptr(&native_surface.ns_view) as *mut c_void,
            std::ptr::null_mut(),
        );
        ghostty_surface_free(native_surface.ghostty_surface);
        let _: () = objc2::msg_send![&*native_surface.ns_view, removeFromSuperview];
        drop(Arc::from_raw(native_surface.callback_ctx_raw));
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

        let mut rect = rect;
        rect.scale_factor = unsafe { ns_effective_backing_scale(window_ptr) };

        // Layout changes may use a new surface_id for the same PTY; tear down the old native surface.
        let mut old_surfaces = Vec::new();
        {
            let mut inner = self.inner.lock().unwrap();

            if let Some(old_id) = inner.session_map.get(&session_id).cloned() {
                if let Some(native_surface) = Self::extract_surface_locked(&mut inner, &old_id) {
                    old_surfaces.push(native_surface);
                } else {
                    inner.session_map.remove(&session_id);
                    inner.pending_output.remove(&session_id);
                }
            }

            if let Some(native_surface) = Self::extract_surface_locked(&mut inner, &surface_id) {
                old_surfaces.push(native_surface);
            }
        }
        for native_surface in old_surfaces {
            unsafe { Self::teardown_native_surface(native_surface) };
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

        let suppress = self.web_ui_suppresses_native_terminals();

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
        let callback_ctx = Arc::new(SurfaceCallbackContext {
            workspace_id: workspace_id.clone(),
            session_id: session_id.clone(),
            app_handle,
        });
        let callback_ctx_raw = Arc::into_raw(callback_ctx.clone());

        // --- Ghostty surface config ---
        let mut config = unsafe { ghostty_surface_config_new() };
        config.platform_tag = ghostty_platform_e::GHOSTTY_PLATFORM_MACOS;
        config.platform.macos = ghostty_platform_macos_s {
            nsview: ns_view_raw,
        };
        config.backend = ghostty_surface_io_backend_e::GHOSTTY_SURFACE_IO_BACKEND_HOST_MANAGED;
        config.scale_factor = rect.scale_factor;
        config.context = ghostty_surface_context_e::GHOSTTY_SURFACE_CONTEXT_WINDOW;
        config.receive_userdata = callback_ctx_raw as *mut c_void;
        config.receive_buffer = Some(receive_buffer_callback);
        config.receive_resize = Some(receive_resize_callback);

        // --- Create the ghostty surface ---
        let surface = unsafe { ghostty_surface_new(app, &config) };
        if surface.is_null() {
            // Clean up on failure
            unsafe {
                let _: () = objc2::msg_send![&*ns_view, removeFromSuperview];
                drop(Arc::from_raw(callback_ctx_raw));
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
            _callback_ctx: callback_ctx,
            callback_ctx_raw,
            rect,
            visible: true,
            focused: false,
        };

        {
            let mut inner = self.inner.lock().unwrap();
            inner.surfaces.insert(surface_id.clone(), native_surface);
            inner.session_map.insert(session_id.clone(), surface_id.clone());
            Self::flush_pending_locked(&mut inner, &session_id, surface);
            if let Some(s) = inner.surfaces.get(&surface_id) {
                s.ns_view.setHidden(suppress);
            }
        }

        Ok(())
    }

    /// Update a surface's position, size, visibility, and focus state.
    pub fn update_surface(
        &self,
        surface_id: &str,
        mut rect: SurfaceRect,
        visible: bool,
        focused: bool,
    ) -> Result<(), String> {
        let window_ptr = {
            let guard = self.window_ptr.lock().unwrap();
            guard.ok_or_else(|| "NSWindow not set".to_string())?
        };
        rect.scale_factor = unsafe { ns_effective_backing_scale(window_ptr) };

        let suppress = self.web_ui_suppresses_native_terminals();
        let mut inner = self.inner.lock().unwrap();
        let surface = match inner.surfaces.get_mut(surface_id) {
            Some(surface) => surface,
            None => return Ok(()),
        };

        // Re-apply content scale on every IPC tick so Ghostty catches up even when AppKit briefly
        // reports an unchanged scale factor (stale `surface.rect` vs fresh `rect`).
        unsafe {
            ghostty_surface_set_content_scale(
                surface.ghostty_surface,
                rect.scale_factor,
                rect.scale_factor,
            );
        }

        if surface_state_unchanged(
            &surface.rect,
            &rect,
            surface.visible,
            visible,
            surface.focused,
            focused,
        ) {
            surface.rect.scale_factor = rect.scale_factor;
            return Ok(());
        }

        // Flip Y coordinate
        let flipped_y = unsafe {
            let content_view: *mut c_void =
                objc2::msg_send![window_ptr as *const AnyObject, contentView];
            let frame: NSRect =
                objc2::msg_send![content_view as *const AnyObject, frame];
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

        unsafe {
            ghostty_surface_set_content_scale(
                surface.ghostty_surface,
                rect.scale_factor,
                rect.scale_factor,
            );
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
        let inner = self.inner.lock().unwrap();
        for s in inner.surfaces.values() {
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
        let inner = self.inner.lock().unwrap();
        for s in inner.surfaces.values() {
            s.ns_view.setHidden(!s.visible);
        }
    }

    /// Destroy a surface, freeing the ghostty surface and removing the NSView.
    pub fn destroy_surface(&self, surface_id: &str) -> Result<(), String> {
        let native_surface = {
            let mut inner = self.inner.lock().unwrap();
            Self::extract_surface_locked(&mut inner, surface_id)
                .ok_or_else(|| format!("Surface not found: {surface_id}"))?
        };

        unsafe { Self::teardown_native_surface(native_surface) };

        Ok(())
    }

    /// Feed terminal output data to a surface, identified by session ID.
    ///
    /// Returns `true` if the surface was found and data was written.
    pub fn feed_output(&self, session_id: &str, data: &[u8]) -> bool {
        let mut inner = self.inner.lock().unwrap();
        let surface_id = match inner.session_map.get(session_id).cloned() {
            Some(id) => id,
            None => {
                inner
                    .pending_output
                    .entry(session_id.to_string())
                    .or_default()
                    .push(data.to_vec());
                return false;
            }
        };

        match inner.surfaces.get(&surface_id) {
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
                inner
                    .pending_output
                    .entry(session_id.to_string())
                    .or_default()
                    .push(data.to_vec());
                false
            }
        }
    }

    /// Set focus on the given surface and unfocus all others.
    pub fn focus_surface(&self, surface_id: &str) -> Result<(), String> {
        let mut inner = self.inner.lock().unwrap();

        // Check the target surface exists
        if !inner.surfaces.contains_key(surface_id) {
            return Ok(());
        }

        for (id, surface) in inner.surfaces.iter_mut() {
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

    pub fn session_id_for_ghostty_surface(&self, surface: ghostty_surface_t) -> Option<String> {
        if surface.is_null() {
            return None;
        }

        let inner = self.inner.lock().unwrap();
        inner
            .surfaces
            .values()
            .find(|native_surface| native_surface.ghostty_surface == surface)
            .map(|native_surface| native_surface.session_id.clone())
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

        let arc = Arc::from_raw(userdata as *const SurfaceCallbackContext);
        let ctx = Arc::clone(&arc);
        let _ = Arc::into_raw(arc);
        let data = std::slice::from_raw_parts(buf, len);
        let session_id = ctx.session_id.clone();
        let workspace_id = ctx.workspace_id.clone();
        let app_handle = ctx.app_handle.clone();
        let payload = serde_json::json!({
            "type": "input",
            "sessionID": session_id,
            "data": BASE64_STANDARD.encode(data),
        })
        .to_string();
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

    let arc = Arc::from_raw(userdata as *const SurfaceCallbackContext);
    let ctx = Arc::clone(&arc);
    let _ = Arc::into_raw(arc);
    let session_id = ctx.session_id.clone();
    let workspace_id = ctx.workspace_id.clone();
    let app_handle = ctx.app_handle.clone();
    let payload = serde_json::json!({
        "type": "resize",
        "sessionID": session_id,
        "cols": cols,
        "rows": rows,
    })
    .to_string();
    tauri::async_runtime::spawn(async move {
        let daemon_state = app_handle.state::<DaemonState>();
        if let Err(err) = daemon_bridge::send_workspace_message(daemon_state.inner(), &workspace_id, &payload).await {
            eprintln!("[surface_registry] failed to route terminal resize: {err}");
        }
    });
}
