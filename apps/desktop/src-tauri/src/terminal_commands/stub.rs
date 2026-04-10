use crate::surface_registry::{SurfaceRect, SurfaceRegistry};
use std::sync::Arc;
use tauri::WebviewWindow;

const MSG: &str = "Native Ghostty terminal is only available on macOS with Apple Silicon (arm64).";

#[tauri::command]
pub fn native_window_scale_factor(window: WebviewWindow) -> Result<f64, String> {
    window.scale_factor().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn terminal_surface_create(
    _window: WebviewWindow,
    _app: tauri::AppHandle,
    _registry: tauri::State<'_, Arc<SurfaceRegistry>>,
    _surface_id: String,
    _workspace_id: String,
    _session_id: String,
    _rect: SurfaceRect,
    _font_size: Option<f32>,
    _overlay_exempt: bool,
) -> Result<(), String> {
    Err(MSG.into())
}

#[tauri::command]
pub fn terminal_surface_update(
    _window: WebviewWindow,
    _registry: tauri::State<'_, Arc<SurfaceRegistry>>,
    _surface_id: String,
    _rect: SurfaceRect,
    _visible: bool,
    _focused: bool,
) -> Result<(), String> {
    Err(MSG.into())
}

#[tauri::command]
pub fn terminal_surface_destroy(
    _window: WebviewWindow,
    _registry: tauri::State<'_, Arc<SurfaceRegistry>>,
    _surface_id: String,
) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub fn terminal_surface_set_font_size(
    _window: WebviewWindow,
    _registry: tauri::State<'_, Arc<SurfaceRegistry>>,
    _surface_id: String,
    _font_size: f32,
) -> Result<(), String> {
    Err(MSG.into())
}

#[tauri::command]
pub fn terminal_surface_focus(
    _window: WebviewWindow,
    _registry: tauri::State<'_, Arc<SurfaceRegistry>>,
    _surface_id: String,
) -> Result<(), String> {
    Err(MSG.into())
}

#[tauri::command]
pub fn terminal_surfaces_begin_web_overlay(
    _window: WebviewWindow,
    _registry: tauri::State<'_, Arc<SurfaceRegistry>>,
    _mode: String,
) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub fn terminal_surfaces_end_web_overlay(
    _window: WebviewWindow,
    _registry: tauri::State<'_, Arc<SurfaceRegistry>>,
    _mode: String,
) -> Result<(), String> {
    Ok(())
}
