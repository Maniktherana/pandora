//! Stub registry when libghostty is not linked (non–Apple Silicon or non-macOS).

use std::sync::Arc;
use tauri::AppHandle;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub scale_factor: f64,
}

pub struct SurfaceRegistry;

impl SurfaceRegistry {
    pub fn new() -> Self {
        Self
    }

    pub fn feed_output(
        self: &Arc<Self>,
        _app_handle: &AppHandle,
        _session_id: &str,
        _data: &[u8],
    ) -> bool {
        false
    }
}
