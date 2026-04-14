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
use std::collections::{HashMap, VecDeque};
use std::ffi::c_void;
use std::ffi::CString;
use std::fs;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

unsafe extern "C" {
    fn pandora_terminal_view_new(x: f64, y: f64, width: f64, height: f64) -> *mut c_void;
    fn pandora_terminal_view_set_surface(view: *mut c_void, surface: ghostty_surface_t);
    fn pandora_terminal_view_set_session_id(view: *mut c_void, session_id: *const std::ffi::c_char);
    fn pandora_terminal_view_focus(view: *mut c_void) -> bool;
    fn pandora_terminal_view_set_blocks_mouse_for_web_overlay(view: *mut c_void, blocks: bool);
    fn pandora_terminal_view_set_web_occlusion_rects(
        view: *mut c_void,
        rects: *const NativeOcclusionRect,
        count: usize,
    );
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

#[repr(C)]
#[derive(Debug, Clone, Copy)]
struct NativeOcclusionRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
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
    pending_output: HashMap<String, PendingOutput>,
}

struct PendingOutput {
    queue: VecDeque<Vec<u8>>,
    total_bytes: usize,
    last_updated_ms: u64,
}

struct SurfaceOutputQueue {
    queue: Mutex<VecDeque<Vec<u8>>>,
    total_bytes: AtomicUsize,
    flush_scheduled: AtomicBool,
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
    overlay_exempt: bool,
}

// Safety: NativeSurface contains raw pointers that are only accessed
// while holding the Mutex, and the ghostty surface is created/destroyed
// on the main thread.
unsafe impl Send for NativeSurface {}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WebOverlayMode {
    Opaque,
    SemiTransparent,
}

impl WebOverlayMode {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "opaque" => Ok(Self::Opaque),
            "semi-transparent" => Ok(Self::SemiTransparent),
            _ => Err(format!("Unknown terminal overlay mode: {value}")),
        }
    }

    fn alpha(self) -> Option<f64> {
        match self {
            Self::Opaque => None,
            Self::SemiTransparent => Some(0.15),
        }
    }
}

#[derive(Default)]
struct WebOverlayState {
    opaque: u32,
    semi_transparent: u32,
}

impl WebOverlayState {
    fn effective_mode(&self) -> Option<WebOverlayMode> {
        // Prefer semi-transparent when any popover/select is open, even if a page-level
        // opaque overlay (e.g. settings) is active — so overlay-exempt previews still dim.
        if self.semi_transparent > 0 {
            Some(WebOverlayMode::SemiTransparent)
        } else if self.opaque > 0 {
            Some(WebOverlayMode::Opaque)
        } else {
            None
        }
    }

    fn increment(&mut self, mode: WebOverlayMode) {
        match mode {
            WebOverlayMode::Opaque => self.opaque += 1,
            WebOverlayMode::SemiTransparent => self.semi_transparent += 1,
        }
    }

    fn decrement(&mut self, mode: WebOverlayMode) {
        match mode {
            WebOverlayMode::Opaque => self.opaque = self.opaque.saturating_sub(1),
            WebOverlayMode::SemiTransparent => {
                self.semi_transparent = self.semi_transparent.saturating_sub(1)
            }
        }
    }
}

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
    surface_queues: Mutex<HashMap<String, Arc<SurfaceOutputQueue>>>,
    /// session_id → surface_id fast lookup for the output path.
    /// Guarded separately so output routing doesn't touch `inner` at all.
    output_routes: Mutex<HashMap<String, String>>,
    /// NSWindow pointer (the main Tauri window)
    window_ptr: Mutex<Option<*mut c_void>>,
    /// Refcounts per overlay mode so overlapping drag/resize/menu interactions can resolve
    /// to the strongest active visual treatment.
    web_overlay_state: Mutex<WebOverlayState>,
    /// Viewport-space web rectangles that should visually and interactively punch through
    /// any terminal surface they overlap.
    web_occlusion_rects: Mutex<Vec<SurfaceRect>>,
}

// Safety: All mutable state is behind Mutex; raw pointers are only
// dereferenced on the main thread under lock.
unsafe impl Send for SurfaceRegistry {}
unsafe impl Sync for SurfaceRegistry {}

const PENDING_OUTPUT_MAX_BYTES: usize = 2 * 1024 * 1024;
const PENDING_OUTPUT_MAX_CHUNKS: usize = 2_048;
const PENDING_OUTPUT_STALE_MS: u64 = 60_000;
const QUEUE_MAX_BYTES: usize = 4 * 1024 * 1024;
const QUEUE_MAX_CHUNKS: usize = 4_096;
const FLUSH_BATCH_BYTE_LIMIT: usize = 512 * 1024;
const FLUSH_RESCHEDULE_DELAY_MS: u64 = 4;
const FLUSH_BATCH_CHUNK_LIMIT: usize = 128;

fn current_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

impl SurfaceRegistry {
    /// Create an empty registry.
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(RegistryInner {
                surfaces: HashMap::new(),
                session_map: HashMap::new(),
                pending_output: HashMap::new(),
            }),
            surface_queues: Mutex::new(HashMap::new()),
            output_routes: Mutex::new(HashMap::new()),
            window_ptr: Mutex::new(None),
            web_overlay_state: Mutex::new(WebOverlayState::default()),
            web_occlusion_rects: Mutex::new(Vec::new()),
        }
    }

    fn pending_stats(chunks: &VecDeque<Vec<u8>>) -> (usize, usize) {
        (chunks.len(), chunks.iter().map(Vec::len).sum())
    }

    fn push_pending_output(
        inner: &mut RegistryInner,
        session_id: &str,
        data: &[u8],
    ) -> (usize, usize, usize, usize) {
        let now_ms = current_epoch_ms();
        let pending = inner
            .pending_output
            .entry(session_id.to_string())
            .or_insert_with(|| PendingOutput {
                queue: VecDeque::new(),
                total_bytes: 0,
                last_updated_ms: now_ms,
            });

        pending.queue.push_back(data.to_vec());
        pending.total_bytes += data.len();
        pending.last_updated_ms = now_ms;

        let mut dropped_chunks = 0usize;
        let mut dropped_bytes = 0usize;
        while pending.queue.len() > PENDING_OUTPUT_MAX_CHUNKS
            || pending.total_bytes > PENDING_OUTPUT_MAX_BYTES
        {
            let Some(old) = pending.queue.pop_front() else {
                break;
            };
            pending.total_bytes = pending.total_bytes.saturating_sub(old.len());
            dropped_chunks += 1;
            dropped_bytes += old.len();
        }

        (
            pending.queue.len(),
            pending.total_bytes,
            dropped_chunks,
            dropped_bytes,
        )
    }

    fn sweep_stale_pending_locked(
        inner: &mut RegistryInner,
        now_ms: u64,
    ) -> Vec<(String, usize, usize)> {
        let stale_sessions = inner
            .pending_output
            .iter()
            .filter_map(|(session_id, pending)| {
                let is_stale =
                    now_ms.saturating_sub(pending.last_updated_ms) > PENDING_OUTPUT_STALE_MS;
                let has_surface = inner.session_map.contains_key(session_id);
                if is_stale && !has_surface {
                    Some((session_id.clone(), pending.queue.len(), pending.total_bytes))
                } else {
                    None
                }
            })
            .collect::<Vec<_>>();

        for (session_id, _, _) in &stale_sessions {
            inner.pending_output.remove(session_id);
        }

        stale_sessions
    }

    fn debug_route_snapshot(&self, session_id: &str) -> String {
        let route_surface = {
            let routes = self.output_routes.lock().unwrap();
            routes.get(session_id).cloned()
        };
        let (session_surface, pending_chunks, pending_bytes, total_surfaces, total_sessions) = {
            let inner = self.inner.lock().unwrap();
            let pending = inner.pending_output.get(session_id);
            let (pending_chunks, pending_bytes) = pending
                .map(|entry| (entry.queue.len(), entry.total_bytes))
                .unwrap_or((0, 0));
            (
                inner.session_map.get(session_id).cloned(),
                pending_chunks,
                pending_bytes,
                inner.surfaces.len(),
                inner.session_map.len(),
            )
        };

        format!(
            "session={} route={:?} session_map={:?} pending_chunks={} pending_bytes={} surfaces={} sessions={}",
            session_id,
            route_surface,
            session_surface,
            pending_chunks,
            pending_bytes,
            total_surfaces,
            total_sessions
        )
    }

    fn effective_web_overlay_mode(&self) -> Option<WebOverlayMode> {
        self.web_overlay_state.lock().unwrap().effective_mode()
    }

    fn apply_view_overlay(
        view: *mut AnyObject,
        visible: bool,
        overlay_exempt: bool,
        overlay_mode: Option<WebOverlayMode>,
    ) {
        unsafe {
            if !visible {
                let _: () = objc2::msg_send![view, setAlphaValue: 1.0_f64];
                let _: () = objc2::msg_send![view, setHidden: true];
                pandora_terminal_view_set_blocks_mouse_for_web_overlay(view.cast(), false);
                return;
            }

            // Exempt surfaces (e.g. settings terminal font preview) stay visible during an
            // opaque web overlay, but still respect semi-transparent dimming for popovers.
            if overlay_exempt && overlay_mode == Some(WebOverlayMode::Opaque) {
                let _: () = objc2::msg_send![view, setHidden: false];
                let _: () = objc2::msg_send![view, setAlphaValue: 1.0_f64];
                pandora_terminal_view_set_blocks_mouse_for_web_overlay(view.cast(), false);
                return;
            }

            match overlay_mode.and_then(WebOverlayMode::alpha) {
                None if overlay_mode == Some(WebOverlayMode::Opaque) => {
                    let _: () = objc2::msg_send![view, setAlphaValue: 1.0_f64];
                    let _: () = objc2::msg_send![view, setHidden: true];
                }
                Some(alpha) => {
                    let _: () = objc2::msg_send![view, setHidden: false];
                    let _: () = objc2::msg_send![view, setAlphaValue: alpha];
                }
                None => {
                    let _: () = objc2::msg_send![view, setHidden: false];
                    let _: () = objc2::msg_send![view, setAlphaValue: 1.0_f64];
                }
            }

            let block_mouse = overlay_mode == Some(WebOverlayMode::SemiTransparent);
            pandora_terminal_view_set_blocks_mouse_for_web_overlay(view.cast(), block_mouse);
        }
    }

    fn local_occlusion_rects(
        surface_rect: &SurfaceRect,
        web_rects: &[SurfaceRect],
    ) -> Vec<NativeOcclusionRect> {
        web_rects
            .iter()
            .filter_map(|rect| {
                let left = surface_rect.x.max(rect.x);
                let top = surface_rect.y.max(rect.y);
                let right = (surface_rect.x + surface_rect.width).min(rect.x + rect.width);
                let bottom = (surface_rect.y + surface_rect.height).min(rect.y + rect.height);
                if right <= left || bottom <= top {
                    return None;
                }

                let width = right - left;
                let height = bottom - top;
                let local_x = left - surface_rect.x;
                let local_y_top = top - surface_rect.y;
                let local_y = surface_rect.height - local_y_top - height;

                Some(NativeOcclusionRect {
                    x: local_x,
                    y: local_y,
                    width,
                    height,
                })
            })
            .collect()
    }

    fn apply_view_occlusion(
        view: *mut c_void,
        surface_rect: &SurfaceRect,
        web_rects: &[SurfaceRect],
    ) {
        let local_rects = Self::local_occlusion_rects(surface_rect, web_rects);
        unsafe {
            pandora_terminal_view_set_web_occlusion_rects(
                view,
                local_rects.as_ptr(),
                local_rects.len(),
            );
        }
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
        Some(native_surface)
    }

    fn flush_pending_locked(inner: &mut RegistryInner, session_id: &str) -> VecDeque<Vec<u8>> {
        inner
            .pending_output
            .remove(session_id)
            .map(|pending| pending.queue)
            .unwrap_or_default()
    }

    /// Schedule an immediate flush on a blocking thread.
    fn schedule_flush(self: &Arc<Self>, surface_id: &str, output_queue: &Arc<SurfaceOutputQueue>) {
        if output_queue.flush_scheduled.swap(true, Ordering::AcqRel) {
            return; // already scheduled
        }
        let registry = Arc::clone(self);
        let sid = surface_id.to_string();
        tauri::async_runtime::spawn_blocking(move || {
            registry.flush_surface_output(&sid);
        });
    }

    /// Schedule a flush after a short delay. Used when data remains after a flush so
    /// other work can proceed between batches — the main thread gets a window to
    /// process input (Ctrl+C), ghostty_app_tick (rendering), and other surfaces.
    fn schedule_flush_delayed(self: &Arc<Self>, surface_id: &str) {
        let registry = Arc::clone(self);
        let sid = surface_id.to_string();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(tokio::time::Duration::from_millis(FLUSH_RESCHEDULE_DELAY_MS)).await;
            tokio::task::spawn_blocking(move || {
                registry.flush_surface_output(&sid);
            });
        });
    }

    /// Drain a bounded batch from one surface's queue and write to Ghostty.
    /// Runs on a spawn_blocking thread. Ghostty's wakeup_cb → tick handles rendering.
    fn flush_surface_output(self: &Arc<Self>, surface_id: &str) {
        let (output_queue, ghostty_surface) = {
            let queues = self.surface_queues.lock().unwrap();
            let output_queue = match queues.get(surface_id) {
                Some(queue) => Arc::clone(queue),
                None => return,
            };
            let inner = self.inner.lock().unwrap();
            let ghostty_surface = match inner.surfaces.get(surface_id) {
                Some(surface) => surface.ghostty_surface,
                None => {
                    output_queue
                        .flush_scheduled
                        .store(false, Ordering::Release);
                    return;
                }
            };
            (output_queue, ghostty_surface)
        };

        let merged = {
            let mut queue = output_queue.queue.lock().unwrap();
            if queue.is_empty() {
                output_queue
                    .flush_scheduled
                    .store(false, Ordering::Release);
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
            let mut buf = Vec::with_capacity(byte_count);
            for _ in 0..chunk_count {
                let Some(chunk) = queue.pop_front() else {
                    break;
                };
                output_queue
                    .total_bytes
                    .fetch_sub(chunk.len(), Ordering::AcqRel);
                buf.extend_from_slice(&chunk);
            }

            let has_more = !queue.is_empty();
            if !has_more {
                output_queue
                    .flush_scheduled
                    .store(false, Ordering::Release);
            }

            (buf, has_more)
        };

        let (data, has_more) = merged;

        let t0 = std::time::Instant::now();
        if !data.is_empty() {
            unsafe {
                ghostty_surface_write_buffer(ghostty_surface, data.as_ptr(), data.len());
            }
        }
        let write_us = t0.elapsed().as_micros();

        // Log every flush so we can diagnose stalls
        if write_us > 1000 || has_more {
            tlog!(
                "FLUSH",
                "surface={} bytes={} has_more={} write={}µs",
                surface_id,
                data.len(),
                has_more,
                write_us
            );
        }

        // If more data remains, schedule the next flush after a delay.
        // flush_scheduled stays TRUE during the delay — this prevents feed_output
        // from spawning competing tasks. The 4ms gap gives the main thread a window
        // for input handling, ghostty_app_tick, and other surfaces' flushes.
        if has_more {
            self.schedule_flush_delayed(surface_id);
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
        font_size: Option<f32>,
        overlay_exempt: bool,
    ) -> Result<(), String> {
        let t0 = Instant::now();
        tlog!(
            "CREATE",
            "START surface={} session={} workspace={} rect=({:.0},{:.0} {:.0}x{:.0})",
            surface_id,
            session_id,
            workspace_id,
            rect.x,
            rect.y,
            rect.width,
            rect.height
        );

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
                    tlog!(
                        "CREATE",
                        "session={} replacing old surface={} with new surface={}",
                        session_id,
                        old_id,
                        surface_id
                    );
                    old_surfaces.push((old_id.clone(), native_surface));
                } else {
                    inner.session_map.remove(&session_id);
                    inner.pending_output.remove(&session_id);
                    tlog!(
                        "CREATE",
                        "session={} had stale session_map route old_surface={} before create",
                        session_id,
                        old_id
                    );
                }
            }

            if let Some(native_surface) = Self::extract_surface_locked(&mut inner, &surface_id) {
                tlog!(
                    "CREATE",
                    "surface={} already existed for session={} and will be recreated",
                    surface_id,
                    native_surface.session_id
                );
                old_surfaces.push((surface_id.clone(), native_surface));
            }
        }
        // Clean up routes/queues for old surfaces.
        if !old_surfaces.is_empty() {
            let mut routes = self.output_routes.lock().unwrap();
            let mut queues = self.surface_queues.lock().unwrap();
            for (old_sid, ref ns) in &old_surfaces {
                routes.remove(&ns.session_id);
                queues.remove(old_sid);
                tlog!(
                    "CREATE",
                    "removed old route/queue session={} old_surface={} remaining_routes={} remaining_queues={}",
                    ns.session_id,
                    old_sid,
                    routes.len(),
                    queues.len()
                );
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

        let overlay_mode = self.effective_web_overlay_mode();
        let occlusion_rects = self.web_occlusion_rects.lock().unwrap().clone();

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
        config.font_size = font_size.unwrap_or(0.0);
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
        let native_surface = NativeSurface {
            session_id: session_id.clone(),
            ghostty_surface: surface,
            ns_view,
            _callback_ctx: callback_ctx,
            callback_ctx_raw,
            rect,
            visible: true,
            focused: false,
            overlay_exempt,
        };

        {
            let mut inner = self.inner.lock().unwrap();
            inner.surfaces.insert(surface_id.clone(), native_surface);
            inner
                .session_map
                .insert(session_id.clone(), surface_id.clone());

            let stale_pending = Self::sweep_stale_pending_locked(&mut inner, current_epoch_ms());
            for (stale_session_id, stale_chunks, stale_bytes) in stale_pending {
                tlog!(
                    "CREATE",
                    "dropped stale pending output session={} chunks={} bytes={}",
                    stale_session_id,
                    stale_chunks,
                    stale_bytes
                );
            }

            if let Some(s) = inner.surfaces.get_mut(&surface_id) {
                let visible = s.visible;
                Self::apply_view_overlay(
                    Retained::as_ptr(&s.ns_view) as *mut AnyObject,
                    visible,
                    s.overlay_exempt,
                    overlay_mode,
                );
                Self::apply_view_occlusion(
                    Retained::as_ptr(&s.ns_view) as *mut c_void,
                    &s.rect,
                    &occlusion_rects,
                );
            }
        }

        {
            let mut queues = self.surface_queues.lock().unwrap();
            queues.insert(
                surface_id.clone(),
                Arc::new(SurfaceOutputQueue {
                    queue: Mutex::new(VecDeque::new()),
                    total_bytes: AtomicUsize::new(0),
                    flush_scheduled: AtomicBool::new(false),
                }),
            );
        }

        // Register output routing (separate from inner).
        {
            let mut routes = self.output_routes.lock().unwrap();
            let was_empty = routes.is_empty();
            routes.insert(session_id.clone(), surface_id.clone());
            tlog!(
                "CREATE",
                "installed output route session={} surface={} total_routes={}",
                session_id,
                surface_id,
                routes.len()
            );
            if was_empty {
                tlog!(
                    "CREATE",
                    "output routes transitioned from empty session={} surface={}",
                    session_id,
                    surface_id
                );
            }
        }
        let route_snapshot = self.debug_route_snapshot(&session_id);
        let pending_output = {
            let mut inner = self.inner.lock().unwrap();
            let pending_output = Self::flush_pending_locked(&mut inner, &session_id);
            if !pending_output.is_empty() {
                let (pending_chunks, pending_bytes) = Self::pending_stats(&pending_output);
                tlog!(
                    "CREATE",
                    "surface={} restored pending output session={} chunks={} bytes={}",
                    surface_id,
                    session_id,
                    pending_chunks,
                    pending_bytes
                );
            }
            pending_output
        };

        if !pending_output.is_empty() {
            let (pending_chunks, pending_bytes) = Self::pending_stats(&pending_output);
            let merged = pending_output.into_iter().flatten().collect::<Vec<_>>();
            let ghostty_surface = surface as usize;
            let write_handle = app_handle.clone();
            tlog!(
                "CREATE",
                "surface={} writing pending output chunks={} bytes={} {}",
                surface_id,
                pending_chunks,
                pending_bytes,
                route_snapshot
            );
            let _ = write_handle.run_on_main_thread(move || unsafe {
                ghostty_surface_write_buffer(
                    ghostty_surface as ghostty_surface_t,
                    merged.as_ptr(),
                    merged.len(),
                );
            });
        }

        tlog!(
            "CREATE",
            "DONE surface={} session={} took={}µs",
            surface_id,
            session_id,
            t0.elapsed().as_micros()
        );
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

        let overlay_mode = self.effective_web_overlay_mode();
        let occlusion_rects = self.web_occlusion_rects.lock().unwrap().clone();
        let (ghostty_surface, ns_view_ptr, prev_rect, prev_visible, prev_focused, overlay_exempt) = {
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
                surface.overlay_exempt,
            )
        };

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
                tlog!(
                    "UPDATE",
                    "surface={} NO-OP (unchanged) took={}µs",
                    surface_id,
                    elapsed
                );
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
        let ns_view = ns_view_ptr as *mut AnyObject;
        unsafe {
            let _: () = objc2::msg_send![ns_view, setFrame: new_frame];
        }
        Self::apply_view_overlay(ns_view, visible, overlay_exempt, overlay_mode);
        Self::apply_view_occlusion(ns_view_ptr, &rect, &occlusion_rects);

        // Update ghostty surface size (in pixels)
        let width_px = (rect.width * rect.scale_factor) as u32;
        let height_px = (rect.height * rect.scale_factor) as u32;
        unsafe {
            ghostty_surface_set_content_scale(
                ghostty_surface,
                rect.scale_factor,
                rect.scale_factor,
            );
            ghostty_surface_set_size(ghostty_surface, width_px, height_px);
        }

        // Refocusing AppKit/Ghostty on every resize is expensive and unnecessary.
        if prev_focused != focused {
            unsafe {
                ghostty_surface_set_focus(ghostty_surface, focused);
            }
            if focused {
                let _ = unsafe { pandora_terminal_view_focus(ns_view_ptr) };
            }
        }

        // Persist state
        if let Some(surface) = self.inner.lock().unwrap().surfaces.get_mut(surface_id) {
            surface.rect = rect;
            surface.visible = visible;
            surface.focused = focused;
        }


        tlog!(
            "UPDATE",
            "surface={} vis={} foc={} overlay={:?} rect=({:.0},{:.0} {:.0}x{:.0} @{:.2}) took={}µs",
            surface_id,
            visible,
            focused,
            overlay_mode,
            prev_rect.x,
            prev_rect.y,
            prev_rect.width,
            prev_rect.height,
            prev_rect.scale_factor,
            t0.elapsed().as_micros()
        );

        Ok(())
    }

    pub fn set_surface_font_size(&self, surface_id: &str, font_size: f32) -> Result<(), String> {
        let (ghostty_surface, rect) = {
            let inner = self.inner.lock().unwrap();
            let surface = inner
                .surfaces
                .get(surface_id)
                .ok_or_else(|| format!("Surface not found: {surface_id}"))?;
            (surface.ghostty_surface, surface.rect.clone())
        };

        let config_path = std::env::temp_dir().join(format!(
            "pandora-ghostty-font-size-{}-{}.conf",
            std::process::id(),
            surface_id
        ));
        fs::write(&config_path, format!("font-size = {font_size}\n"))
            .map_err(|error| error.to_string())?;
        let config_path_cstr = CString::new(config_path.to_string_lossy().as_ref())
            .map_err(|error| error.to_string())?;

        let width_px = (rect.width * rect.scale_factor) as u32;
        let height_px = (rect.height * rect.scale_factor) as u32;

        unsafe {
            let config = ghostty_config_new();
            if config.is_null() {
                return Err("ghostty_config_new returned null".to_string());
            }
            ghostty_config_load_default_files(config);
            ghostty_config_load_file(config, config_path_cstr.as_ptr());
            ghostty_config_finalize(config);
            ghostty_surface_update_config(ghostty_surface, config);
            ghostty_surface_set_size(ghostty_surface, width_px, height_px);
            ghostty_surface_refresh(ghostty_surface);
            ghostty_config_free(config);
        }

        Ok(())
    }

    /// Apply a web overlay mode over all visible terminal surfaces. Pair with [`Self::end_web_overlay`].
    pub fn begin_web_overlay(&self, mode: WebOverlayMode) {
        let next_mode = {
            let mut state = self.web_overlay_state.lock().unwrap();
            state.increment(mode);
            let effective = state.effective_mode();
            tlog!(
                "OVERLAY",
                "begin mode={:?} counts=({}, {}) effective={:?}",
                mode,
                state.opaque,
                state.semi_transparent,
                effective
            );
            effective
        };
        let views = {
            let inner = self.inner.lock().unwrap();
            inner
                .surfaces
                .values()
                .map(|surface| {
                    (
                        Retained::as_ptr(&surface.ns_view) as *mut AnyObject,
                        surface.visible,
                        surface.overlay_exempt,
                    )
                })
                .collect::<Vec<_>>()
        };
        for (view, visible, overlay_exempt) in views {
            Self::apply_view_overlay(view, visible, overlay_exempt, next_mode);
        }
    }

    /// Apply web overlay occlusion rectangles, in web viewport coordinates, to every terminal.
    pub fn set_web_occlusion_rects(&self, rects: Vec<SurfaceRect>) {
        {
            let mut guard = self.web_occlusion_rects.lock().unwrap();
            *guard = rects.clone();
        }

        let views = {
            let inner = self.inner.lock().unwrap();
            inner
                .surfaces
                .values()
                .map(|surface| {
                    (
                        Retained::as_ptr(&surface.ns_view) as *mut c_void,
                        surface.rect.clone(),
                    )
                })
                .collect::<Vec<_>>()
        };

        for (view, surface_rect) in views {
            Self::apply_view_occlusion(view, &surface_rect, &rects);
        }
    }

    /// Restore visibility after [`Self::begin_web_overlay`]. Safe to over-pop (clamped).
    pub fn end_web_overlay(&self, mode: WebOverlayMode) {
        let next_mode = {
            let mut state = self.web_overlay_state.lock().unwrap();
            state.decrement(mode);
            let effective = state.effective_mode();
            tlog!(
                "OVERLAY",
                "end mode={:?} counts=({}, {}) effective={:?}",
                mode,
                state.opaque,
                state.semi_transparent,
                effective
            );
            effective
        };
        let views = {
            let inner = self.inner.lock().unwrap();
            inner
                .surfaces
                .values()
                .map(|surface| {
                    (
                        Retained::as_ptr(&surface.ns_view) as *mut AnyObject,
                        !surface.visible,
                        surface.overlay_exempt,
                    )
                })
                .collect::<Vec<_>>()
        };
        for (view, hidden, overlay_exempt) in views {
            Self::apply_view_overlay(view, !hidden, overlay_exempt, next_mode);
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
            let remaining_routes = routes.len();
            tlog!(
                "DESTROY",
                "removed output route session={} surface={} remaining_routes={}",
                session_id,
                surface_id,
                remaining_routes
            );
            if remaining_routes == 0 {
                tlog!("DESTROY", "output routes transitioned to empty");
            }
        }
        self.surface_queues.lock().unwrap().remove(surface_id);

        unsafe { Self::teardown_native_surface(native_surface) };

        tlog!(
            "DESTROY",
            "DONE surface={} session={} took={}µs",
            surface_id,
            session_id,
            t0.elapsed().as_micros()
        );
        Ok(())
    }

    /// Feed terminal output data to a surface, identified by session ID.
    ///
    /// Live output is queued from the daemon thread and coalesced into bounded
    /// main-thread Ghostty writes. Output that arrives before a surface is routed
    /// stays in the bounded pending buffer.
    ///
    /// Returns `true` if the surface was found and data was queued.
    pub fn feed_output(
        self: &Arc<Self>,
        app_handle: &AppHandle,
        session_id: &str,
        data: &[u8],
    ) -> bool {
        let t0 = Instant::now();

        let surface_id = {
            let routes = self.output_routes.lock().unwrap();
            match routes.get(session_id) {
                Some(id) => id.clone(),
                None => {
                    drop(routes);
                    let mut inner = self.inner.lock().unwrap();
                    let (pending_chunks, pending_bytes, dropped_chunks, dropped_bytes) =
                        Self::push_pending_output(&mut inner, session_id, data);
                    drop(inner);

                    if let Some(surface_id) =
                        self.output_routes.lock().unwrap().get(session_id).cloned()
                    {
                        let pending_output = {
                            let mut inner = self.inner.lock().unwrap();
                            Self::flush_pending_locked(&mut inner, session_id)
                        };
                        if !pending_output.is_empty() {
                            let (pending_chunks, pending_bytes) =
                                Self::pending_stats(&pending_output);
                            if let Some(output_queue) = self
                                .surface_queues
                                .lock()
                                .unwrap()
                                .get(&surface_id)
                                .cloned()
                            {
                                {
                                    let mut queue = output_queue.queue.lock().unwrap();
                                    for chunk in pending_output {
                                        output_queue
                                            .total_bytes
                                            .fetch_add(chunk.len(), Ordering::AcqRel);
                                        queue.push_back(chunk);
                                    }
                                }
                                // Data is in the queue — the timer will flush it
                                tlog!(
                                    "FEED",
                                    "session={} surface={} replayed pending after route race chunks={} bytes={} took={}µs",
                                    session_id,
                                    surface_id,
                                    pending_chunks,
                                    pending_bytes,
                                    t0.elapsed().as_micros()
                                );
                                return true;
                            }
                        }
                    }

                    tlog!(
                        "FEED",
                        "session={} bytes={} -> pending (no route) pending_chunks={} pending_bytes={} dropped_chunks={} dropped_bytes={} {} took={}µs",
                        session_id,
                        data.len(),
                        pending_chunks,
                        pending_bytes,
                        dropped_chunks,
                        dropped_bytes,
                        self.debug_route_snapshot(session_id),
                        t0.elapsed().as_micros()
                    );
                    return false;
                }
            }
        };

        let output_queue = {
            let queues = self.surface_queues.lock().unwrap();
            queues.get(&surface_id).cloned()
        };
        let Some(output_queue) = output_queue else {
            {
                let mut routes = self.output_routes.lock().unwrap();
                if routes
                    .get(session_id)
                    .map(|current| current == &surface_id)
                    .unwrap_or(false)
                {
                    routes.remove(session_id);
                }
            }
            let mut inner = self.inner.lock().unwrap();
            let (pending_chunks, pending_bytes, dropped_chunks, dropped_bytes) =
                Self::push_pending_output(&mut inner, session_id, data);
            drop(inner);
            tlog!(
                "FEED",
                "session={} surface={} bytes={} -> pending (stale route) pending_chunks={} pending_bytes={} dropped_chunks={} dropped_bytes={} {} took={}µs",
                session_id,
                surface_id,
                data.len(),
                pending_chunks,
                pending_bytes,
                dropped_chunks,
                dropped_bytes,
                self.debug_route_snapshot(session_id),
                t0.elapsed().as_micros()
            );
            return false;
        };

        {
            let mut queue = output_queue.queue.lock().unwrap();
            output_queue
                .total_bytes
                .fetch_add(data.len(), Ordering::AcqRel);
            queue.push_back(data.to_vec());

            let mut dropped_chunks = 0usize;
            let mut dropped_bytes = 0usize;
            while queue.len() > QUEUE_MAX_CHUNKS
                || output_queue.total_bytes.load(Ordering::Relaxed) > QUEUE_MAX_BYTES
            {
                let Some(old) = queue.pop_front() else {
                    break;
                };
                output_queue
                    .total_bytes
                    .fetch_sub(old.len(), Ordering::AcqRel);
                dropped_chunks += 1;
                dropped_bytes += old.len();
            }

            if dropped_chunks > 0 {
                tlog!(
                    "FEED",
                    "surface={} output queue bounded dropped_chunks={} dropped_bytes={} queue={} bytes={}",
                    surface_id,
                    dropped_chunks,
                    dropped_bytes,
                    queue.len(),
                    output_queue.total_bytes.load(Ordering::Acquire)
                );
            }
        }

        // Schedule immediate flush on a blocking thread
        self.schedule_flush(&surface_id, &output_queue);
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

        tlog!(
            "FOCUS",
            "surface={} total_surfaces={} changed={} took={}µs",
            surface_id,
            total,
            changed,
            t0.elapsed().as_micros()
        );
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
        tlog!(
            "PTY_IN",
            "session={} workspace={} bytes={} data={:?}",
            session_id,
            workspace_id,
            len,
            String::from_utf8_lossy(data)
        );
    } else {
        tlog!(
            "PTY_IN",
            "session={} workspace={} bytes={}",
            session_id,
            workspace_id,
            len
        );
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

    tlog!(
        "PTY_RESIZE",
        "session={} workspace={} cols={} rows={} px={}x{}",
        session_id,
        workspace_id,
        cols,
        rows,
        _width_px,
        _height_px
    );
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
