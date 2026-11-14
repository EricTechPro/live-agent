// The Tauri shell: start the agent core sidecar, tell the window where it is,
// stop it when the app quits. No agent logic lives here or in the window.
//
// The core prints ONE JSON line on stdout when it is ready:
//   {"type":"ready","url":"http://127.0.0.1:53121","launchToken":"..."}
// Everything else it says goes to stderr, which we pass through to our stderr.
// The core starts and stops LiveKit itself, so the shell only owns one child.
use serde::Serialize;
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
    Down { reason: String },
}

struct Core {
    status: Mutex<CoreStatus>,
    child: Mutex<Option<CommandChild>>,
}

#[tauri::command]
fn core_status(core: tauri::State<'_, Core>) -> CoreStatus {
    core.status.lock().unwrap().clone()
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
                        *core.status.lock().unwrap() = CoreStatus::Ready { info };
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
                    *core.status.lock().unwrap() = CoreStatus::Down { reason: reason.clone() };
                    core.child.lock().unwrap().take();
                    let _ = app.emit("core-down", reason);
                }
                _ => {}
            }
        }
    });
    Ok(())
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

#[cfg(unix)]
extern "C" {
    #[link_name = "kill"]
    fn libc_kill(pid: i32, sig: i32) -> i32;
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(Core { status: Mutex::new(CoreStatus::Starting), child: Mutex::new(None) })
        .invoke_handler(tauri::generate_handler![core_status])
        .setup(|app| {
            if let Err(reason) = start_core(app.handle()) {
                *app.state::<Core>().status.lock().unwrap() = CoreStatus::Down { reason };
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
