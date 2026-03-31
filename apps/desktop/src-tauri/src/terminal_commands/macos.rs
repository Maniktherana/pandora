use crate::surface_registry::{SurfaceRect, SurfaceRegistry};
use std::sync::Arc;
use tauri::WebviewWindow;

#[tauri::command]
pub fn terminal_surface_create(
    window: WebviewWindow,
    app: tauri::AppHandle,
    registry: tauri::State<'_, Arc<SurfaceRegistry>>,
    surface_id: String,
    workspace_id: String,
    session_id: String,
    rect: SurfaceRect,
) -> Result<(), String> {
    let ns_window = window.ns_window().map_err(|e| e.to_string())? as usize;
    let registry = registry.inner().clone();
    let (tx, rx) = std::sync::mpsc::channel();
    window
        .run_on_main_thread(move || {
            registry.set_window(ns_window as *mut _);
            let _ = tx.send(registry.create_surface(surface_id, workspace_id, session_id, rect, app));
        })
        .map_err(|e| e.to_string())?;
    rx.recv().map_err(|e| e.to_string())?
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
    let registry = registry.inner().clone();
    let (tx, rx) = std::sync::mpsc::channel();
    window.run_on_main_thread(move || {
        let _ = tx.send(registry.update_surface(&surface_id, rect, visible, focused));
    })
    .map_err(|e| e.to_string())?;
    rx.recv().map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn terminal_surface_destroy(
    window: WebviewWindow,
    registry: tauri::State<'_, Arc<SurfaceRegistry>>,
    surface_id: String,
) -> Result<(), String> {
    let registry = registry.inner().clone();
    let (tx, rx) = std::sync::mpsc::channel();
    window.run_on_main_thread(move || {
        let _ = tx.send(registry.destroy_surface(&surface_id));
    })
    .map_err(|e| e.to_string())?;
    rx.recv().map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn terminal_surface_focus(
    window: WebviewWindow,
    registry: tauri::State<'_, Arc<SurfaceRegistry>>,
    surface_id: String,
) -> Result<(), String> {
    let registry = registry.inner().clone();
    let (tx, rx) = std::sync::mpsc::channel();
    window.run_on_main_thread(move || {
        let _ = tx.send(registry.focus_surface(&surface_id));
    })
    .map_err(|e| e.to_string())?;
    rx.recv().map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn terminal_surfaces_begin_web_overlay(
    window: WebviewWindow,
    registry: tauri::State<'_, Arc<SurfaceRegistry>>,
) -> Result<(), String> {
    let registry = registry.inner().clone();
    let (tx, rx) = std::sync::mpsc::channel();
    window
        .run_on_main_thread(move || {
            registry.begin_web_overlay();
            let _ = tx.send(Ok(()));
        })
        .map_err(|e| e.to_string())?;
    rx.recv().map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn terminal_surfaces_end_web_overlay(
    window: WebviewWindow,
    registry: tauri::State<'_, Arc<SurfaceRegistry>>,
) -> Result<(), String> {
    let registry = registry.inner().clone();
    let (tx, rx) = std::sync::mpsc::channel();
    window
        .run_on_main_thread(move || {
            registry.end_web_overlay();
            let _ = tx.send(Ok(()));
        })
        .map_err(|e| e.to_string())?;
    rx.recv().map_err(|e| e.to_string())?
}
