// The Tauri shell: start the agent core sidecar, tell the window where it is,
// stop it when the app quits. No agent logic lives here or in the window.
//
// The core prints ONE JSON line on stdout when it is ready:
//   {"type":"ready","url":"http://127.0.0.1:53121","launchToken":"..."}
// Everything else it says goes to stderr, which we pass through to our stderr.
// The core starts and stops LiveKit itself, so the shell only owns one child.
//
// If the core dies anyway (ticket 40: it used to exit on a DNS failure after the Mac
// slept), the shell starts it again by itself with backoff and tells the window
// (`core-restarting`, then `core-ready`). Only after RESTART_DELAYS_MS run out in a row
// is it `core-down`; the window's Retry calls `restart_core`.
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager, RunEvent};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CoreInfo {
    url: String,
    launch_token: String,
}

/// What the window sees from `core_status`.
#[derive(Clone, Serialize)]
#[serde(tag = "state", rename_all = "lowercase")]
enum CoreStatus {
    Starting,
    Ready { info: CoreInfo },
    /// It died; the shell starts it again in `retry_in_ms`.
    #[serde(rename_all = "camelCase")]
    Restarting { attempt: u32, retry_in_ms: u64, reason: String },
    Down { reason: String },
}

struct Core {
    status: Mutex<CoreStatus>,
    child: Mutex<Option<CommandChild>>,
    /// Restarts in a row without a long healthy run in between.
    restarts: Mutex<u32>,
    /// When the running core said it was ready.
    ready_at: Mutex<Option<Instant>>,
    /// Set when we stop it on purpose (quit): no restart then.
    quitting: AtomicBool,
}

/// Waits before each automatic restart: 1 s, 2 s, 5 s, 10 s, then 30 s three times.
/// After that the window shows Retry (`restart_core`).
const RESTART_DELAYS_MS: [u64; 7] = [1_000, 2_000, 5_000, 10_000, 30_000, 30_000, 30_000];

/// A core that ran this long before dying was healthy: its restarts count from the start again.
const HEALTHY_RUN: Duration = Duration::from_secs(60);

/// The wait before restart number `attempt` (0-based), or None when they are used up.
fn restart_delay(attempt: u32) -> Option<Duration> {
    RESTART_DELAYS_MS.get(attempt as usize).map(|ms| Duration::from_millis(*ms))
}

/// The restart number to use after a core that ran for `ran` dies (after `previous` restarts in a row).
fn next_restart(previous: u32, ran: Option<Duration>) -> u32 {
    match ran {
        Some(ran) if ran >= HEALTHY_RUN => 0,
        _ => previous,
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Restarting {
    attempt: u32,
    retry_in_ms: u64,
    reason: String,
}

#[tauri::command]
fn core_status(core: tauri::State<'_, Core>) -> CoreStatus {
    core.status.lock().unwrap().clone()
}

/// The key screen's link (ticket 19): open Google AI Studio's key page in the
/// browser. The URL is fixed here, so the window cannot open anything else.
#[tauri::command]
fn open_key_page() {
    let _ = std::process::Command::new("open").arg("https://aistudio.google.com/apikey").spawn();
}

fn parse_ready(line: &str) -> Option<CoreInfo> {
    let v: serde_json::Value = serde_json::from_str(line.trim()).ok()?;
    if v.get("type")?.as_str()? != "ready" {
        return None;
    }
    Some(CoreInfo {
        url: v.get("url")?.as_str()?.to_string(),
        launch_token: v.get("launchToken")?.as_str()?.to_string(),
    })
}

/// The core's home folder: $LIVE_AGENT_HOME if set, else ~/Desktop/live-agent (made by get.sh).
/// Opened from Finder there is no terminal, so the core works from here: it reads the config,
/// the brain and the Gemini key (`.env`) from this folder (see src/home.ts).
fn live_agent_home() -> String {
    std::env::var("LIVE_AGENT_HOME")
        .ok()
        .filter(|h| !h.is_empty())
        .unwrap_or_else(|| format!("{}/Desktop/live-agent", std::env::var("HOME").unwrap_or_default()))
}

/// The window's "Show log" link: reveal the core's log (src/core-log.ts) in Finder.
/// The window passes nothing: the path is fixed here, so this opens only that file
/// (or its folder before the first line is written).
#[tauri::command]
fn reveal_log() -> Result<(), String> {
    let home = live_agent_home();
    let log = format!("{home}/logs/core.log");
    let mut open = std::process::Command::new("open");
    if std::path::Path::new(&log).exists() {
        open.arg("-R").arg(&log);
    } else {
        open.arg(&home);
    }
    open.spawn().map(|_| ()).map_err(|e| e.to_string())
}

fn start_core(app: &tauri::AppHandle) -> Result<(), String> {
    // The sidecar inherits our environment; LIVE_AGENT_HOME tells it where its folder is.
    // livekit-server is bundled next to it (Contents/MacOS), so PATH does not matter.
    let (mut rx, child) = app
        .shell()
        .sidecar("live-agent-core")
        .map_err(|e| e.to_string())?
        .env("LIVE_AGENT_HOME", live_agent_home())
        // The core stops itself if this app dies without stopping it (see src/main.ts).
        .env("LIVE_AGENT_EXIT_WITH_PARENT", "1")
        .spawn()
        .map_err(|e| e.to_string())?;
    *app.state::<Core>().child.lock().unwrap() = Some(child);

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut last_err = String::new();
        while let Some(event) = rx.recv().await {
            let core = app.state::<Core>();
            match event {
                CommandEvent::Stdout(bytes) => {
                    let line = String::from_utf8_lossy(&bytes);
                    if let Some(info) = parse_ready(&line) {
                        *core.status.lock().unwrap() = CoreStatus::Ready { info: info.clone() };
                        *core.ready_at.lock().unwrap() = Some(Instant::now());
                        // After a restart the window reconnects to the new address.
                        let _ = app.emit("core-ready", info);
                    }
                }
                CommandEvent::Stderr(bytes) => {
                    let line = String::from_utf8_lossy(&bytes);
                    eprint!("[core] {line}");
                    if line.starts_with("live-agent:") {
                        last_err = line.trim().to_string();
                    }
                }
                CommandEvent::Terminated(payload) => {
                    let reason = if last_err.is_empty() {
                        format!("exited with code {:?}", payload.code)
                    } else {
                        last_err.clone()
                    };
                    core.child.lock().unwrap().take();
                    if core.quitting.load(Ordering::SeqCst) {
                        *core.status.lock().unwrap() = CoreStatus::Down { reason };
                        continue;
                    }
                    let ran = core.ready_at.lock().unwrap().take().map(|at| at.elapsed());
                    eprintln!("live-agent: the core stopped ({reason}); restarting it");
                    schedule_restart(&app, ran, reason);
                }
                _ => {}
            }
        }
    });
    Ok(())
}

/// The core died: start it again after the next backoff wait, or give up and say `core-down`.
fn schedule_restart(app: &tauri::AppHandle, ran: Option<Duration>, reason: String) {
    let core = app.state::<Core>();
    let attempt = {
        let mut restarts = core.restarts.lock().unwrap();
        *restarts = next_restart(*restarts, ran);
        let attempt = *restarts;
        *restarts += 1;
        attempt
    };
    let Some(wait) = restart_delay(attempt) else {
        *core.status.lock().unwrap() = CoreStatus::Down { reason: reason.clone() };
        let _ = app.emit("core-down", reason);
        return;
    };
    let retry_in_ms = wait.as_millis() as u64;
    *core.status.lock().unwrap() = CoreStatus::Restarting { attempt: attempt + 1, retry_in_ms, reason: reason.clone() };
    let _ = app.emit("core-restarting", Restarting { attempt: attempt + 1, retry_in_ms, reason });
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(wait);
        let core = app.state::<Core>();
        if core.quitting.load(Ordering::SeqCst) || core.child.lock().unwrap().is_some() {
            return;
        }
        *core.status.lock().unwrap() = CoreStatus::Starting;
        if let Err(reason) = start_core(&app) {
            schedule_restart(&app, None, reason);
        }
    });
}

/// The window's Retry (after the automatic restarts ran out): start the core again now.
#[tauri::command]
fn restart_core(app: tauri::AppHandle) -> Result<(), String> {
    let core = app.state::<Core>();
    if core.child.lock().unwrap().is_some() {
        return Ok(()); // already running
    }
    *core.restarts.lock().unwrap() = 0;
    *core.status.lock().unwrap() = CoreStatus::Starting;
    start_core(&app).map_err(|reason| {
        *core.status.lock().unwrap() = CoreStatus::Down { reason: reason.clone() };
        reason
    })
}

/// How long the core gets to stop on its own before we force it.
///
/// Why this long: on SIGTERM the core ends the chat (the model writes the
/// chat-end note, up to 8 s), queues the tidy job and waits up to 15 s for it,
/// then stops LiveKit. Killing it sooner loses the note. A tidy that cannot
/// finish in time just runs again on the next launch (src/brain/tidy.ts).
const CORE_STOP_GRACE: Duration = Duration::from_secs(30);

/// Ask the core to stop (SIGTERM: it saves the chat, stops LiveKit), then force it after the grace.
fn stop_core(core: &Core) {
    core.quitting.store(true, Ordering::SeqCst);
    let Some(child) = core.child.lock().unwrap().take() else { return };
    #[cfg(unix)]
    {
        let pid = child.pid() as i32;
        unsafe { libc_kill(pid, 15) };
        let deadline = Instant::now() + CORE_STOP_GRACE;
        while Instant::now() < deadline && unsafe { libc_kill(pid, 0) } == 0 {
            std::thread::sleep(Duration::from_millis(50));
        }
    }
    let _ = child.kill();
}

// ---- the overlay window (tickets 36, 37) -----------------------------------
//
// Jett is one full-screen transparent window over the main screen (tauri.conf.json:
// transparent, no decorations, no shadow, always on top, on every Space). Clicks pass
// through it except over the orb, its buttons and the glass pieces: the page polls
// `overlay_poll` about 20 times a second, hit-tests the cursor (app/src/overlay.ts) and
// calls `set_click_through`. Why polling: while the window ignores the mouse, the page
// gets no mouse events at all, so it can't notice the pointer arriving over the orb.
// The window starts click-through, so a page that fails to load never blocks the desktop.
//
// The same poll reports whether Ctrl+Option is held: push to talk, like a dictation
// app (hold to talk, let go to send). Why the modifier flags and not a global shortcut:
// a shortcut needs a key, and "Ctrl+Option alone" has none. Reading the flags needs no
// permission. Ctrl+Option+S (a real global shortcut) shows or hides Jett.
// No Dock icon (macOS accessory app): a menu-bar icon opens the panel or quits.

/// Cover the main screen's work area (under the menu bar, above the Dock).
fn cover_main_screen(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    if let Some(monitor) = window.primary_monitor()? {
        let area = monitor.work_area();
        window.set_position(area.position)?;
        window.set_size(area.size)?;
    }
    window.set_ignore_cursor_events(true)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OverlayPoll {
    /// The cursor inside the window in CSS (logical) pixels, or None when it is outside.
    point: Option<(f64, f64)>,
    /// Ctrl+Option held (and no Cmd or Shift): push to talk.
    talk_keys: bool,
}

fn cursor_in(window: &tauri::WebviewWindow) -> Option<(f64, f64)> {
    let cursor = window.cursor_position().ok()?;
    let at = window.inner_position().ok()?;
    let size = window.inner_size().ok()?;
    let scale = window.scale_factor().ok()?;
    let (x, y) = (cursor.x - at.x as f64, cursor.y - at.y as f64);
    if x < 0.0 || y < 0.0 || x >= size.width as f64 || y >= size.height as f64 {
        return None;
    }
    Some((x / scale, y / scale))
}

#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    /// The modifier keys held right now. 0 = kCGEventSourceStateCombinedSessionState.
    fn CGEventSourceFlagsState(state_id: i32) -> u64;
}

#[cfg(target_os = "macos")]
fn talk_keys_held() -> bool {
    const SHIFT: u64 = 0x2_0000;
    const CONTROL: u64 = 0x4_0000;
    const OPTION: u64 = 0x8_0000;
    const COMMAND: u64 = 0x10_0000;
    let flags = unsafe { CGEventSourceFlagsState(0) };
    flags & CONTROL != 0 && flags & OPTION != 0 && flags & (SHIFT | COMMAND) == 0
}

#[cfg(not(target_os = "macos"))]
fn talk_keys_held() -> bool {
    false
}

#[tauri::command]
fn overlay_poll(window: tauri::WebviewWindow) -> OverlayPoll {
    OverlayPoll { point: cursor_in(&window), talk_keys: talk_keys_held() }
}

/// Click-through on (clicks reach the apps below) or off (the window takes the mouse).
#[tauri::command]
fn set_click_through(window: tauri::WebviewWindow, on: bool) -> Result<(), String> {
    window.set_ignore_cursor_events(on).map_err(|e| e.to_string())
}

/// The menu-bar "Hide / Show Jett" item, kept so its words can follow the page's state.
struct TrayToggle(Mutex<Option<tauri::menu::MenuItem<tauri::Wry>>>);

fn toggle_label(shown: bool) -> &'static str {
    if shown {
        "Hide Jett (⌃⌥S)"
    } else {
        "Show Jett (⌃⌥S)"
    }
}

/// Ctrl+Option+S and the menu-bar item (ticket 38): the page minimises Jett to a small dot,
/// or brings it back. The window itself stays up (it is click-through around the dot).
fn toggle_overlay(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if !window.is_visible().unwrap_or(true) {
            let _ = window.show();
        }
    }
    let _ = app.emit("toggle-mini", ());
}

/// The page says whether Jett is shown (true) or minimised: the menu-bar item's words follow.
#[tauri::command]
fn set_tray_shown(toggle: tauri::State<'_, TrayToggle>, shown: bool) -> Result<(), String> {
    match toggle.0.lock().unwrap().as_ref() {
        Some(item) => item.set_text(toggle_label(shown)).map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

/// The menu-bar icon: a click opens the panel; its menu starts a new chat, hides / shows Jett, lists the shortcuts or quits.
fn add_tray(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    let open = MenuItem::with_id(app, "open", "Open Jett", true, None::<&str>)?;
    let toggle = MenuItem::with_id(app, "toggle", toggle_label(true), true, None::<&str>)?;
    let new_chat = MenuItem::with_id(app, "new-chat", "New chat", true, None::<&str>)?;
    let shortcuts = MenuItem::with_id(app, "shortcuts", "Shortcuts", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit Jett", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &new_chat, &toggle, &shortcuts, &quit_item])?;
    *app.state::<TrayToggle>().0.lock().unwrap() = Some(toggle.clone());
    let mut tray = TrayIconBuilder::with_id("jett").tooltip("Jett").menu(&menu).show_menu_on_left_click(false);
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.on_menu_event(|app, event| match event.id.as_ref() {
        "open" => open_panel(app),
        "toggle" => toggle_overlay(app),
        // Ticket 39: the page saves this chat and starts a fresh one.
        "new-chat" => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
            }
            let _ = app.emit("new-chat", ());
        }
        "shortcuts" => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
            }
            let _ = app.emit("show-shortcuts", ());
        }
        "quit" => quit(app),
        _ => {}
    })
    .on_tray_icon_event(|tray, event| {
        if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
            open_panel(tray.app_handle());
        }
    })
    .build(app)?;
    Ok(())
}

/// Quit from the menu bar (an accessory app has no Cmd+Q menu): hide at once, let the
/// core finish the chat in the background, then exit. Same as the ExitRequested path.
fn quit(app: &tauri::AppHandle) {
    for window in app.webview_windows().values() {
        let _ = window.hide();
    }
    let app = app.clone();
    std::thread::spawn(move || {
        stop_core(&app.state::<Core>());
        app.exit(0);
    });
}

/// Show Jett and ask the page to open its panel (main.ts listens for `open-panel`).
fn open_panel(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
    let _ = app.emit("open-panel", ());
}

#[cfg(unix)]
extern "C" {
    #[link_name = "kill"]
    fn libc_kill(pid: i32, sig: i32) -> i32;
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    use tauri_plugin_global_shortcut::{Code, Modifiers, ShortcutState};
                    if event.state == ShortcutState::Pressed && shortcut.matches(Modifiers::CONTROL | Modifiers::ALT, Code::KeyS) {
                        toggle_overlay(app);
                    }
                })
                .build(),
        )
        .manage(Core {
            status: Mutex::new(CoreStatus::Starting),
            child: Mutex::new(None),
            restarts: Mutex::new(0),
            ready_at: Mutex::new(None),
            quitting: AtomicBool::new(false),
        })
        .manage(TrayToggle(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![core_status, restart_core, open_key_page, reveal_log, overlay_poll, set_click_through, set_tray_shown])
        .setup(|app| {
            // No Dock icon: Jett lives in the menu bar and floats over everything.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            if let Err(err) = add_tray(app) {
                eprintln!("live-agent: no menu-bar icon: {err}");
            }
            {
                use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};
                let show_hide = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyS);
                if let Err(err) = app.global_shortcut().register(show_hide) {
                    eprintln!("live-agent: Ctrl+Option+S is taken: {err}");
                }
            }
            if let Some(window) = app.get_webview_window("main") {
                if let Err(err) = cover_main_screen(&window) {
                    eprintln!("live-agent: could not place the overlay window: {err}");
                }
            }
            if let Err(reason) = start_core(app.handle()) {
                schedule_restart(app.handle(), None, reason);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building live-agent")
        .run(|app, event| match event {
            // Quit (Cmd+Q, closing the window): hide the window at once, let the
            // core finish the chat in the background, then really exit. Why not
            // just block in Exit: the app would hang there, frozen, for as long
            // as the core needs.
            RunEvent::ExitRequested { api, .. } => {
                if app.state::<Core>().child.lock().unwrap().is_none() {
                    return; // the core is already stopped: exit now
                }
                api.prevent_exit();
                for window in app.webview_windows().values() {
                    let _ = window.hide();
                }
                let app = app.clone();
                std::thread::spawn(move || {
                    stop_core(&app.state::<Core>());
                    app.exit(0);
                });
            }
            // Safety net (e.g. a forced exit that skipped ExitRequested).
            RunEvent::Exit => stop_core(&app.state::<Core>()),
            _ => {}
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restarts_back_off_then_run_out() {
        let waits: Vec<_> = (0..8).map(|n| restart_delay(n).map(|d| d.as_millis() as u64)).collect();
        assert_eq!(waits, vec![Some(1_000), Some(2_000), Some(5_000), Some(10_000), Some(30_000), Some(30_000), Some(30_000), None]);
    }

    #[test]
    fn a_long_healthy_run_resets_the_count() {
        assert_eq!(next_restart(5, Some(Duration::from_secs(120))), 0);
        assert_eq!(next_restart(5, Some(Duration::from_secs(3))), 5);
        assert_eq!(next_restart(2, None), 2);
    }

    #[test]
    fn reads_the_ready_line() {
        let info = parse_ready(r#"{"type":"ready","url":"http://127.0.0.1:1","launchToken":"t"}"#).unwrap();
        assert_eq!(info.url, "http://127.0.0.1:1");
        assert!(parse_ready("live-agent: hi").is_none());
    }
}
