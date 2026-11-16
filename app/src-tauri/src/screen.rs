// Screen awareness (slice 2): where the pointer is in global screen points, for the ink
// drawn while Ctrl+Option is held. Kept in its own module so lib.rs only registers it.
//
// One coordinate space: global points, top-left origin, main display at 0,0 (the space
// macOS's window list and the jett-eyes helper use). The page subtracts the window's own
// origin (`origin_x`, `origin_y`, same space) to draw the ink in CSS pixels.
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PointerGlobal {
    x: f64,
    y: f64,
    origin_x: f64,
    origin_y: f64,
}

/// The pointer anywhere on the main screen (not just over Jett), plus the window's origin.
#[tauri::command]
pub fn pointer_global(window: tauri::WebviewWindow) -> Option<PointerGlobal> {
    let cursor = window.cursor_position().ok()?;
    let at = window.inner_position().ok()?;
    let scale = window.scale_factor().ok()?;
    Some(PointerGlobal { x: cursor.x / scale, y: cursor.y / scale, origin_x: at.x as f64 / scale, origin_y: at.y as f64 / scale })
}

/// The "Screen Recording is off" notice's button: open that Settings pane. The URL is fixed
/// here, so the page cannot open anything else.
#[tauri::command]
pub fn open_screen_settings() {
    let _ = std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
        .spawn();
}
