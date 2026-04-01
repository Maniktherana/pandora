//! Native terminal surface registry.
//!
//! Maps session IDs to ghostty surfaces + NSViews, managing their lifecycle,
//! layout, focus, and I/O routing. Each surface is an NSView overlaid on the
//! Tauri webview, with a ghostty terminal rendering into it.

use crate::daemon_bridge::{self, DaemonState};
use crate::ghostty_app;
use crate::ghostty_ffi::*;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine as _;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::MainThreadMarker;
use objc2_app_kit::NSView;
use objc2_foundation::{NSPoint, NSRect, NSSize};
use std::collections::HashMap;
use std::ffi::c_void;
use std::ffi::CString;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::{AppHandle, Emitter, Manager};
use tokio::time::Duration;

unsafe extern "C" {
    fn pandora_terminal_view_new(x: f64, y: f64, width: f64, height: f64) -> *mut c_void;
    fn pandora_terminal_view_set_surface(view: *mut c_void, surface: ghostty_surface_t);
    fn pandora_terminal_view_set_session_id(view: *mut c_void, session_id: *const std::ffi::c_char);
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

/// Per-surface output mailbox. Kept in a separate map from `RegistryInner` so that
/// the hot `feed_output` path (called from the daemon read loop) never contends with
/// surface lifecycle operations (create / update / focus / destroy).
struct OutputMailbox {
    queue: Mutex<Vec<Vec<u8>>>,
    flush_scheduled: AtomicBool,
}

struct NativeSurface {
    session_id: String,
    ghostty_surface: ghostty_surface_t,
    ns_view: Retained<NSView>,
    _callback_ctx: Arc<SurfaceCallbackContext>,
    callback_ctx_raw: *const SurfaceCallbackContext,
    mailbox: Arc<OutputMailbox>,
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
    /// Per-surface output mailboxes keyed by surface_id. Separate from `inner` so
    /// `feed_output` (daemon read loop) never contends with surface lifecycle ops.
    mailboxes: Mutex<HashMap<String, Arc<OutputMailbox>>>,
    /// session_id → surface_id fast lookup for the output path.
    /// Guarded separately so output routing doesn't touch `inner` at all.
    output_routes: Mutex<HashMap<String, String>>,
    /// NSWindow pointer (the main Tauri window)
    window_ptr: Mutex<Option<*mut c_void>>,
    /// Refcount: while > 0, terminal NSViews stay hidden so web UI (tab drag, pane resize) receives input.
    web_overlay_depth: Mutex<u32>,
}

// Safety: All mutable state is behind Mutex; raw pointers are only
// dereferenced on the main thread under lock.
unsafe impl Send for SurfaceRegistry {}
unsafe impl Sync for SurfaceRegistry {}

const FLUSH_BATCH_CHUNK_LIMIT: usize = 128;
const FLUSH_BATCH_BYTE_LIMIT: usize = 512 * 1024;
/// Delay before rescheduling the next flush when data remains. Prevents the main
/// thread from being monopolised by back-to-back flush callbacks during heavy output.
const FLUSH_RESCHEDULE_DELAY_MS: u64 = 4;

impl SurfaceRegistry {
    /// Create an empty registry.
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(RegistryInner {
                surfaces: HashMap::new(),
                session_map: HashMap::new(),
                pending_output: HashMap::new(),
            }),
            mailboxes: Mutex::new(HashMap::new()),
            output_routes: Mutex::new(HashMap::new()),
            window_ptr: Mutex::new(None),
            web_overlay_depth: Mutex::new(0),
        }
    }

    fn web_ui_suppresses_native_terminals(&self) -> bool {
        *self.web_overlay_depth.lock().unwrap() > 0
    }

    fn extract_surface_locked(
        inner: &mut RegistryInner,
        surface_id: &str,
    ) -> Option<NativeSurface> {
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

    fn flush_pending_locked(inner: &mut RegistryInner, session_id: &str) -> Vec<Vec<u8>> {
        inner.pending_output.remove(session_id).unwrap_or_default()
    }

    /// Schedule an immediate flush on a background thread.
    ///
    /// `ghostty_surface_write_buffer` does NOT need the main thread — in standalone
    /// ghostty the IO thread calls into the terminal parser. Dispatching via
    /// `run_on_main_thread` was causing the main thread to block on an internal
    /// ghostty futex, freezing the entire UI (beachball).
    fn schedule_surface_flush(
        self: &Arc<Self>,
        app_handle: &AppHandle,
        surface_id: &str,
    ) -> Result<(), String> {
        let registry = Arc::clone(self);
        let flush_handle = app_handle.clone();
        let surface_id = surface_id.to_string();
        tauri::async_runtime::spawn_blocking(move || {
            registry.flush_surface_output(&flush_handle, &surface_id);
        });
        Ok(())
    }

    /// Schedule a flush after a short delay. Used when data remains after a flush so
    /// other work can proceed between batches.
    fn schedule_surface_flush_delayed(self: &Arc<Self>, app_handle: &AppHandle, surface_id: &str) {
        let registry = Arc::clone(self);
        let flush_handle = app_handle.clone();
        let surface_id = surface_id.to_string();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(FLUSH_RESCHEDULE_DELAY_MS)).await;
            tokio::task::spawn_blocking(move || {
                registry.flush_surface_output(&flush_handle, &surface_id);
            });
        });
    }

    fn flush_surface_output(self: &Arc<Self>, app_handle: &AppHandle, surface_id: &str) {
        let t0 = Instant::now();

        // Get the mailbox and ghostty surface without holding inner for long.
        let (ghostty_surface, mailbox) = {
            let inner = self.inner.lock().unwrap();
            let surface = match inner.surfaces.get(surface_id) {
                Some(s) => s,
                None => {
                    tlog!("FLUSH", "surface={} NOT FOUND, bail", surface_id);
                    return;
                }
            };
            (surface.ghostty_surface, Arc::clone(&surface.mailbox))
        };
        let t_lock = t0.elapsed().as_micros();

        // Drain a batch from the mailbox (separate lock from inner).
        let (merged, has_more, chunk_count, remaining) = {
            let mut queue = mailbox.queue.lock().unwrap();
            if queue.is_empty() {
                mailbox.flush_scheduled.store(false, Ordering::Release);
                tlog!("FLUSH", "surface={} empty queue, clearing flag", surface_id);
                return;
            }

            let mut chunk_count = 0usize;
            let mut byte_count = 0usize;
            for chunk in queue.iter() {
                if chunk_count >= FLUSH_BATCH_CHUNK_LIMIT {
                    break;
                }
                if chunk_count > 0 && byte_count + chunk.len() > FLUSH_BATCH_BYTE_LIMIT {
                    break;
                }
                chunk_count += 1;
                byte_count += chunk.len();
                if byte_count >= FLUSH_BATCH_BYTE_LIMIT {
                    break;
                }
            }

            let chunk_count = chunk_count.max(1);

            let mut merged = Vec::with_capacity(byte_count);
            for chunk in queue.drain(..chunk_count) {
                merged.extend_from_slice(&chunk);
            }
            let remaining = queue.len();
            let has_more = remaining > 0;
            if !has_more {
                mailbox.flush_scheduled.store(false, Ordering::Release);
            }

            (merged, has_more, chunk_count, remaining)
        };
        let t_drain = t0.elapsed().as_micros();

        if !merged.is_empty() {
            unsafe {
                ghostty_surface_write_buffer(ghostty_surface, merged.as_ptr(), merged.len());
            }
        }
        let t_write = t0.elapsed().as_micros();

        tlog!("FLUSH", "surface={} chunks={} bytes={} remaining={} has_more={} lock={}µs drain={}µs write={}µs total={}µs",
            surface_id, chunk_count, merged.len(), remaining, has_more,
            t_lock, t_drain - t_lock, t_write - t_drain, t_write);

        if has_more {
            self.schedule_surface_flush_delayed(app_handle, surface_id);
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
        let t0 = Instant::now();
        tlog!("CREATE", "START surface={} session={} workspace={} rect=({:.0},{:.0} {:.0}x{:.0})",
            surface_id, session_id, workspace_id, rect.x, rect.y, rect.width, rect.height);

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
                    old_surfaces.push((old_id.clone(), native_surface));
                } else {
                    inner.session_map.remove(&session_id);
                    inner.pending_output.remove(&session_id);
                }
            }

            if let Some(native_surface) = Self::extract_surface_locked(&mut inner, &surface_id) {
                old_surfaces.push((surface_id.clone(), native_surface));
            }
        }
        // Clean up mailboxes/routes for old surfaces.
        if !old_surfaces.is_empty() {
            let mut mboxes = self.mailboxes.lock().unwrap();
            let mut routes = self.output_routes.lock().unwrap();
            for (old_sid, ref ns) in &old_surfaces {
                mboxes.remove(old_sid);
                routes.remove(&ns.session_id);
            }
        }
        for (_, native_surface) in old_surfaces {
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
        let ns_view_raw =
            unsafe { pandora_terminal_view_new(rect.x, flipped_y, rect.width, rect.height) };
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
        let session_id_cstr = CString::new(session_id.clone())
            .map_err(|_| "session id contained NUL byte".to_string())?;

        // --- Callback context ---
        let callback_ctx = Arc::new(SurfaceCallbackContext {
            workspace_id: workspace_id.clone(),
            session_id: session_id.clone(),
            app_handle: app_handle.clone(),
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
            pandora_terminal_view_set_session_id(ns_view_raw, session_id_cstr.as_ptr());
            pandora_terminal_view_set_surface(ns_view_raw, surface);
        }

        // Set initial pixel size
        let width_px = (rect.width * rect.scale_factor) as u32;
        let height_px = (rect.height * rect.scale_factor) as u32;
        unsafe { ghostty_surface_set_size(surface, width_px, height_px) };

        // --- Store in maps ---
        let mailbox = Arc::new(OutputMailbox {
            queue: Mutex::new(Vec::new()),
            flush_scheduled: AtomicBool::new(false),
        });

        let native_surface = NativeSurface {
            session_id: session_id.clone(),
            ghostty_surface: surface,
            ns_view,
            _callback_ctx: callback_ctx,
            callback_ctx_raw,
            mailbox: Arc::clone(&mailbox),
            rect,
            visible: true,
            focused: false,
        };

        let mut should_flush_output = false;
        {
            let mut inner = self.inner.lock().unwrap();
            inner.surfaces.insert(surface_id.clone(), native_surface);
            inner
                .session_map
                .insert(session_id.clone(), surface_id.clone());

            // Drain any output that arrived before the surface existed.
            let pending_output = Self::flush_pending_locked(&mut inner, &session_id);
            if !pending_output.is_empty() {
                let mut queue = mailbox.queue.lock().unwrap();
                queue.extend(pending_output);
                mailbox.flush_scheduled.store(true, Ordering::Release);
                should_flush_output = true;
            }

            if let Some(s) = inner.surfaces.get_mut(&surface_id) {
                s.ns_view.setHidden(suppress);
            }
        }

        // Register output routing (separate from inner).
        {
            let mut routes = self.output_routes.lock().unwrap();
            routes.insert(session_id.clone(), surface_id.clone());
        }
        {
            let mut mboxes = self.mailboxes.lock().unwrap();
            mboxes.insert(surface_id.clone(), mailbox);
        }

        if should_flush_output {
            tlog!("CREATE", "surface={} flushing pending output", surface_id);
            let registry = app_handle.state::<Arc<SurfaceRegistry>>().inner().clone();
            registry.flush_surface_output(&app_handle, &surface_id);
        }

        tlog!("CREATE", "DONE surface={} session={} took={}µs",
            surface_id, session_id, t0.elapsed().as_micros());
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
        let t0 = Instant::now();

        let window_ptr = {
            let guard = self.window_ptr.lock().unwrap();
            guard.ok_or_else(|| "NSWindow not set".to_string())?
        };
        rect.scale_factor = unsafe { ns_effective_backing_scale(window_ptr) };

        let suppress = self.web_ui_suppresses_native_terminals();
        let (ghostty_surface, ns_view_ptr, prev_rect, prev_visible, prev_focused) = {
            let inner = self.inner.lock().unwrap();
            let surface = match inner.surfaces.get(surface_id) {
                Some(surface) => surface,
                None => {
                    tlog!("UPDATE", "surface={} NOT FOUND", surface_id);
                    return Ok(());
                }
            };
            (
                surface.ghostty_surface,
                Retained::as_ptr(&surface.ns_view) as *mut c_void,
                surface.rect.clone(),
                surface.visible,
                surface.focused,
            )
        };

        unsafe {
            ghostty_surface_set_content_scale(
                ghostty_surface,
                rect.scale_factor,
                rect.scale_factor,
            );
        }

        if surface_state_unchanged(
            &prev_rect,
            &rect,
            prev_visible,
            visible,
            prev_focused,
            focused,
        ) {
            if let Some(surface) = self.inner.lock().unwrap().surfaces.get_mut(surface_id) {
                surface.rect.scale_factor = rect.scale_factor;
            }
            // Only log if slow.
            let elapsed = t0.elapsed().as_micros();
            if elapsed > 1000 {
                tlog!("UPDATE", "surface={} NO-OP (unchanged) took={}µs", surface_id, elapsed);
            }
            return Ok(());
        }

        // Flip Y coordinate
        let flipped_y = unsafe {
            let content_view: *mut c_void =
                objc2::msg_send![window_ptr as *const AnyObject, contentView];
            let frame: NSRect = objc2::msg_send![content_view as *const AnyObject, frame];
            frame.size.height - rect.y - rect.height
        };

        let new_frame = NSRect::new(
            NSPoint::new(rect.x, flipped_y),
            NSSize::new(rect.width, rect.height),
        );

        // Update NSView frame and visibility
        let hidden = suppress || !visible;
        unsafe {
            let ns_view = ns_view_ptr as *mut AnyObject;
            let _: () = objc2::msg_send![ns_view, setFrame: new_frame];
            let _: () = objc2::msg_send![ns_view, setHidden: hidden];
        }

        // Update ghostty surface size (in pixels)
        let width_px = (rect.width * rect.scale_factor) as u32;
        let height_px = (rect.height * rect.scale_factor) as u32;
        unsafe {
            ghostty_surface_set_size(ghostty_surface, width_px, height_px);
        }

        // Update focus
        unsafe {
            ghostty_surface_set_focus(ghostty_surface, focused);
        }
        if focused {
            let _ = unsafe { pandora_terminal_view_focus(ns_view_ptr) };
        }

        unsafe {
            ghostty_surface_set_content_scale(
                ghostty_surface,
                rect.scale_factor,
                rect.scale_factor,
            );
        }

        // Persist state
        if let Some(surface) = self.inner.lock().unwrap().surfaces.get_mut(surface_id) {
            surface.rect = rect;
            surface.visible = visible;
            surface.focused = focused;
        }

        tlog!("UPDATE", "surface={} vis={} foc={} suppress={} rect=({:.0},{:.0} {:.0}x{:.0} @{:.2}) took={}µs",
            surface_id, visible, focused, suppress,
            prev_rect.x, prev_rect.y, prev_rect.width, prev_rect.height, prev_rect.scale_factor,
            t0.elapsed().as_micros());

        Ok(())
    }

    /// Hide all terminal surfaces (first holder). Pair with [`Self::end_web_overlay`].
    pub fn begin_web_overlay(&self) {
        let mut d = self.web_overlay_depth.lock().unwrap();
        *d += 1;
        tlog!("OVERLAY", "begin depth={}", *d);
        if *d != 1 {
            return;
        }
        let views = {
            let inner = self.inner.lock().unwrap();
            inner
                .surfaces
                .values()
                .map(|surface| Retained::as_ptr(&surface.ns_view) as *mut AnyObject)
                .collect::<Vec<_>>()
        };
        for view in views {
            unsafe {
                let _: () = objc2::msg_send![view, setHidden: true];
            }
        }
    }

    /// Restore visibility after [`Self::begin_web_overlay`]. Safe to over-pop (clamped).
    pub fn end_web_overlay(&self) {
        let mut d = self.web_overlay_depth.lock().unwrap();
        *d = d.saturating_sub(1);
        tlog!("OVERLAY", "end depth={}", *d);
        if *d > 0 {
            return;
        }
        let views = {
            let inner = self.inner.lock().unwrap();
            inner
                .surfaces
                .values()
                .map(|surface| {
                    (
                        Retained::as_ptr(&surface.ns_view) as *mut AnyObject,
                        !surface.visible,
                    )
                })
                .collect::<Vec<_>>()
        };
        for (view, hidden) in views {
            unsafe {
                let _: () = objc2::msg_send![view, setHidden: hidden];
            }
        }
    }

    /// Destroy a surface, freeing the ghostty surface and removing the NSView.
    pub fn destroy_surface(&self, surface_id: &str) -> Result<(), String> {
        let t0 = Instant::now();
        tlog!("DESTROY", "START surface={}", surface_id);

        let native_surface = {
            let mut inner = self.inner.lock().unwrap();
            Self::extract_surface_locked(&mut inner, surface_id)
                .ok_or_else(|| format!("Surface not found: {surface_id}"))?
        };

        let session_id = native_surface.session_id.clone();
        // Clean up output routing.
        {
            let mut routes = self.output_routes.lock().unwrap();
            routes.remove(&session_id);
        }
        self.mailboxes.lock().unwrap().remove(surface_id);

        unsafe { Self::teardown_native_surface(native_surface) };

        tlog!("DESTROY", "DONE surface={} session={} took={}µs",
            surface_id, session_id, t0.elapsed().as_micros());
        Ok(())
    }

    /// Feed terminal output data to a surface, identified by session ID.
    ///
    /// This is the hot path — called from the daemon read loop for every output
    /// chunk. It only touches `output_routes` and the per-surface `OutputMailbox`,
    /// never the main `inner` mutex, so it cannot contend with surface lifecycle
    /// operations running on the main thread.
    ///
    /// Returns `true` if the surface was found and data was queued.
    pub fn feed_output(
        self: &Arc<Self>,
        app_handle: &AppHandle,
        session_id: &str,
        data: &[u8],
    ) -> bool {
        let t0 = Instant::now();

        // Fast path: look up surface_id and mailbox without touching inner.
        let surface_id = {
            let routes = self.output_routes.lock().unwrap();
            match routes.get(session_id) {
                Some(id) => id.clone(),
                None => {
                    drop(routes);
                    let mut inner = self.inner.lock().unwrap();
                    inner
                        .pending_output
                        .entry(session_id.to_string())
                        .or_default()
                        .push(data.to_vec());
                    tlog!("FEED", "session={} bytes={} → pending (no route) took={}µs",
                        session_id, data.len(), t0.elapsed().as_micros());
                    return false;
                }
            }
        };
        let mailbox = {
            let mboxes = self.mailboxes.lock().unwrap();
            match mboxes.get(&surface_id) {
                Some(mb) => Arc::clone(mb),
                None => {
                    drop(mboxes);
                    let mut inner = self.inner.lock().unwrap();
                    inner
                        .pending_output
                        .entry(session_id.to_string())
                        .or_default()
                        .push(data.to_vec());
                    tlog!("FEED", "session={} surface={} bytes={} → pending (no mailbox) took={}µs",
                        session_id, surface_id, data.len(), t0.elapsed().as_micros());
                    return false;
                }
            }
        };

        let queue_len = {
            let mut q = mailbox.queue.lock().unwrap();
            q.push(data.to_vec());
            q.len()
        };

        // Schedule a flush if one isn't already pending.
        let scheduled = if !mailbox.flush_scheduled.swap(true, Ordering::AcqRel) {
            if let Err(err) = self.schedule_surface_flush(app_handle, &surface_id) {
                eprintln!(
                    "[surface_registry] failed to schedule surface flush for {}: {}",
                    surface_id, err
                );
                mailbox.flush_scheduled.store(false, Ordering::Release);
                false
            } else {
                true
            }
        } else {
            false
        };

        let elapsed = t0.elapsed().as_micros();
        // Only log if slow (>500µs) or we scheduled a flush, to avoid flooding the log.
        if scheduled || elapsed > 500 {
            tlog!("FEED", "session={} surface={} bytes={} queue={} scheduled={} took={}µs",
                session_id, surface_id, data.len(), queue_len, scheduled, elapsed);
        }

        true
    }

    /// Set focus on the given surface and unfocus all others.
    pub fn focus_surface(&self, surface_id: &str) -> Result<(), String> {
        let t0 = Instant::now();
        let surfaces = {
            let inner = self.inner.lock().unwrap();
            if !inner.surfaces.contains_key(surface_id) {
                tlog!("FOCUS", "surface={} NOT FOUND", surface_id);
                return Ok(());
            }
            inner
                .surfaces
                .iter()
                .map(|(id, surface)| {
                    (
                        id.clone(),
                        surface.ghostty_surface,
                        Retained::as_ptr(&surface.ns_view) as *mut c_void,
                        surface.focused,
                    )
                })
                .collect::<Vec<_>>()
        };

        let total = surfaces.len();
        let mut changed = 0u32;
        for (id, ghostty_surface, ns_view_ptr, was_focused) in &surfaces {
            let should_focus = id == surface_id;
            if *was_focused != should_focus {
                changed += 1;
                unsafe {
                    ghostty_surface_set_focus(*ghostty_surface, should_focus);
                }
                if should_focus {
                    let _ = unsafe { pandora_terminal_view_focus(*ns_view_ptr) };
                }
            }
        }

        let mut inner = self.inner.lock().unwrap();
        for (id, _, _, _) in surfaces {
            if let Some(surface) = inner.surfaces.get_mut(&id) {
                surface.focused = id == surface_id;
            }
        }

        tlog!("FOCUS", "surface={} total_surfaces={} changed={} took={}µs",
            surface_id, total, changed, t0.elapsed().as_micros());
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Ghostty receive callbacks (extern "C")
// ---------------------------------------------------------------------------

/// Called by ghostty when the terminal generates output in HOST_MANAGED mode.
/// Routes data back toward the daemon for the associated session.
unsafe extern "C" fn receive_buffer_callback(userdata: *mut c_void, buf: *const u8, len: usize) {
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

    // Log PTY input (user keystrokes / ghostty-generated input going to daemon).
    if len <= 64 {
        tlog!("PTY_IN", "session={} workspace={} bytes={} data={:?}",
            session_id, workspace_id, len,
            String::from_utf8_lossy(data));
    } else {
        tlog!("PTY_IN", "session={} workspace={} bytes={}",
            session_id, workspace_id, len);
    }
    let payload = serde_json::json!({
        "type": "input",
        "sessionID": session_id,
        "data": BASE64_STANDARD.encode(data),
    })
    .to_string();
    let _ = app_handle.emit(
        "native-terminal-input",
        serde_json::json!({
            "workspaceId": workspace_id,
            "sessionId": ctx.session_id,
            "data": BASE64_STANDARD.encode(data),
        })
        .to_string(),
    );
    tauri::async_runtime::spawn(async move {
        let daemon_state = app_handle.state::<DaemonState>();
        if let Err(err) =
            daemon_bridge::send_workspace_message(daemon_state.inner(), &workspace_id, &payload)
                .await
        {
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

    tlog!("PTY_RESIZE", "session={} workspace={} cols={} rows={} px={}x{}",
        session_id, workspace_id, cols, rows, _width_px, _height_px);
    let payload = serde_json::json!({
        "type": "resize",
        "sessionID": session_id,
        "cols": cols,
        "rows": rows,
    })
    .to_string();
    tauri::async_runtime::spawn(async move {
        let daemon_state = app_handle.state::<DaemonState>();
        if let Err(err) =
            daemon_bridge::send_workspace_message(daemon_state.inner(), &workspace_id, &payload)
                .await
        {
            eprintln!("[surface_registry] failed to route terminal resize: {err}");
        }
    });
}
