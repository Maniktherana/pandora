use crate::surface_registry::{
    backing_scale_for_ns_window, SurfaceRect, SurfaceRegistry, WebOverlayMode,
};
use std::sync::Arc;
use std::time::Instant;
use tauri::WebviewWindow;

/// Backing scale for the window's current display (same source as native terminal surfaces).
#[tauri::command]
pub fn native_window_scale_factor(window: WebviewWindow) -> Result<f64, String> {
    let ptr = window.ns_window().map_err(|e| e.to_string())? as usize;
    let (tx, rx) = std::sync::mpsc::channel();
    window
        .run_on_main_thread(move || {
            let s = backing_scale_for_ns_window(ptr as *mut _);
            let _ = tx.send(s);
        })
        .map_err(|e| e.to_string())?;
    rx.recv().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn terminal_surface_create(
    window: WebviewWindow,
    app: tauri::AppHandle,
    registry: tauri::State<'_, Arc<SurfaceRegistry>>,
    surface_id: String,
    workspace_id: String,
    session_id: String,
    rect: SurfaceRect,
    font_size: Option<f32>,
    overlay_exempt: bool,
) -> Result<(), String> {
    let t0 = Instant::now();
    tlog!(
        "CMD",
        "terminal_surface_create DISPATCH surface={} session={}",
        surface_id,
        session_id
    );

    let ns_window = window.ns_window().map_err(|e| e.to_string())? as usize;
    let registry = registry.inner().clone();
    let sid = surface_id.clone();
    let (tx, rx) = std::sync::mpsc::channel();
    tlog!(
        "CMD",
        "terminal_surface_create WAITING_FOR_MAIN surface={}",
        sid
    );
    window
        .run_on_main_thread(move || {
            registry.set_window(ns_window as *mut _);
            let _ = tx.send(registry.create_surface(
                surface_id,
                workspace_id,
                session_id,
                rect,
                app,
                font_size,
                overlay_exempt,
            ));
        })
        .map_err(|e| e.to_string())?;
    let dispatch_us = t0.elapsed().as_micros();
    tlog!(
        "CMD",
        "terminal_surface_create DISPATCHED surface={} dispatch={}µs, WAITING_FOR_RESULT",
        sid,
        dispatch_us
    );

    let result = rx.recv().map_err(|e| e.to_string())?;
    let total_us = t0.elapsed().as_micros();
    tlog!(
        "CMD",
        "terminal_surface_create DONE surface={} dispatch={}µs total={}µs ok={}",
        sid,
        dispatch_us,
        total_us,
        result.is_ok()
    );
    result
}

#[tauri::command]
pub fn terminal_surface_update(
    window: WebviewWindow,
    registry: tauri::State<'_, Arc<SurfaceRegistry>>,
    surface_id: String,
    rect: SurfaceRect,
    visible: bool,
    focused: bool,
) -> Result<(), String> {
    let t0 = Instant::now();

    let registry = registry.inner().clone();
    let sid = surface_id.clone();
    let (tx, rx) = std::sync::mpsc::channel();
    tlog!(
        "CMD",
        "terminal_surface_update WAITING_FOR_MAIN surface={} vis={} foc={}",
        sid,
        visible,
        focused
    );
    window
        .run_on_main_thread(move || {
            let _ = tx.send(registry.update_surface(&surface_id, rect, visible, focused));
        })
        .map_err(|e| e.to_string())?;
    let dispatch_us = t0.elapsed().as_micros();

    let result = rx.recv().map_err(|e| e.to_string())?;
    let total_us = t0.elapsed().as_micros();

    tlog!(
        "CMD",
        "terminal_surface_update DONE surface={} vis={} foc={} dispatch={}µs total={}µs",
        sid,
        visible,
        focused,
        dispatch_us,
        total_us
    );
    result
}

#[tauri::command]
pub fn terminal_surface_set_font_size(
    window: WebviewWindow,
    registry: tauri::State<'_, Arc<SurfaceRegistry>>,
    surface_id: String,
    font_size: f32,
) -> Result<(), String> {
    let registry = registry.inner().clone();
    let sid = surface_id.clone();
    let (tx, rx) = std::sync::mpsc::channel();
    window
        .run_on_main_thread(move || {
            let _ = tx.send(registry.set_surface_font_size(&surface_id, font_size));
        })
        .map_err(|e| e.to_string())?;
    rx.recv().map_err(|e| e.to_string())??;
    tlog!(
        "CMD",
        "terminal_surface_set_font_size surface={} font_size={}",
        sid,
        font_size
    );
    Ok(())
}

#[tauri::command]
pub fn terminal_surface_destroy(
    window: WebviewWindow,
    registry: tauri::State<'_, Arc<SurfaceRegistry>>,
    surface_id: String,
) -> Result<(), String> {
    let t0 = Instant::now();
    let registry = registry.inner().clone();
    let sid = surface_id.clone();
    let (tx, rx) = std::sync::mpsc::channel();
    tlog!(
        "CMD",
        "terminal_surface_destroy WAITING_FOR_MAIN surface={}",
        sid
    );
    window
        .run_on_main_thread(move || {
            let _ = tx.send(registry.destroy_surface(&surface_id));
        })
        .map_err(|e| e.to_string())?;
    tlog!(
        "CMD",
        "terminal_surface_destroy DISPATCHED surface={}, WAITING_FOR_RESULT",
        sid
    );
    let result = rx.recv().map_err(|e| e.to_string())?;
    tlog!(
        "CMD",
        "terminal_surface_destroy DONE surface={} took={}µs",
        sid,
        t0.elapsed().as_micros()
    );
    result
}

#[tauri::command]
pub fn terminal_surface_focus(
    window: WebviewWindow,
    registry: tauri::State<'_, Arc<SurfaceRegistry>>,
    surface_id: String,
) -> Result<(), String> {
    let t0 = Instant::now();

    let registry = registry.inner().clone();
    let sid = surface_id.clone();
    let (tx, rx) = std::sync::mpsc::channel();
    tlog!(
        "CMD",
        "terminal_surface_focus WAITING_FOR_MAIN surface={}",
        sid
    );
    window
        .run_on_main_thread(move || {
            let _ = tx.send(registry.focus_surface(&surface_id));
        })
        .map_err(|e| e.to_string())?;
    let dispatch_us = t0.elapsed().as_micros();
    tlog!(
        "CMD",
        "terminal_surface_focus DISPATCHED surface={} dispatch={}µs, WAITING_FOR_RESULT",
        sid,
        dispatch_us
    );

    let result = rx.recv().map_err(|e| e.to_string())?;
    let total_us = t0.elapsed().as_micros();
    tlog!(
        "CMD",
        "terminal_surface_focus DONE surface={} dispatch={}µs total={}µs",
        sid,
        dispatch_us,
        total_us
    );
    result
}

#[tauri::command]
pub fn terminal_surfaces_begin_web_overlay(
    window: WebviewWindow,
    registry: tauri::State<'_, Arc<SurfaceRegistry>>,
    mode: String,
) -> Result<(), String> {
    let mode = WebOverlayMode::parse(&mode)?;
    tlog!("CMD", "begin_web_overlay DISPATCH mode={:?}", mode);
    let registry = registry.inner().clone();
    let (tx, rx) = std::sync::mpsc::channel();
    window
        .run_on_main_thread(move || {
            registry.begin_web_overlay(mode);
            let _ = tx.send(Ok(()));
        })
        .map_err(|e| e.to_string())?;
    rx.recv().map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn terminal_surfaces_end_web_overlay(
    window: WebviewWindow,
    registry: tauri::State<'_, Arc<SurfaceRegistry>>,
    mode: String,
) -> Result<(), String> {
    let mode = WebOverlayMode::parse(&mode)?;
    tlog!("CMD", "end_web_overlay DISPATCH mode={:?}", mode);
    let registry = registry.inner().clone();
    let (tx, rx) = std::sync::mpsc::channel();
    window
        .run_on_main_thread(move || {
            registry.end_web_overlay(mode);
            let _ = tx.send(Ok(()));
        })
        .map_err(|e| e.to_string())?;
    rx.recv().map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn terminal_surfaces_set_web_occlusion_rects(
    window: WebviewWindow,
    registry: tauri::State<'_, Arc<SurfaceRegistry>>,
    rects: Vec<SurfaceRect>,
) -> Result<(), String> {
    let registry = registry.inner().clone();
    let (tx, rx) = std::sync::mpsc::channel();
    window
        .run_on_main_thread(move || {
            registry.set_web_occlusion_rects(rects);
            let _ = tx.send(Ok(()));
        })
        .map_err(|e| e.to_string())?;
    rx.recv().map_err(|e| e.to_string())?
}
