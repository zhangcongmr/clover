// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

use clover_server::logging::{self, ConsoleTarget, LogGuard};
use clover_server::{Config, CorsPolicy, Handle, PortPolicy};
use serde::{Deserialize, Serialize};
use tauri::webview::{PageLoadEvent, WebviewWindowBuilder};
use tauri::{
    Manager, Monitor, PhysicalPosition, PhysicalSize, Runtime, WebviewWindow, WindowEvent,
};

/// Label of the main window declared in `tauri.conf.json`.
const MAIN_WINDOW_LABEL: &str = "main";

/// Desktop-only state file inside `~/.clover`: the last window size/position.
const WINDOW_STATE_FILE: &str = "desktop-window.json";

/// Smallest window worth restoring, in physical pixels.
///
/// A resize recorded while the window is minimized or hidden reports `0×0`;
/// anything below this is treated as "no usable geometry".
const MIN_RESTORABLE_WIDTH: u32 = 320;
const MIN_RESTORABLE_HEIGHT: u32 = 240;

/// How much of a remembered window must overlap a monitor for its position to
/// be reused, in physical pixels: enough to see it and drag it back.
const MIN_VISIBLE_WIDTH: u32 = 120;
const MIN_VISIBLE_HEIGHT: u32 = 60;

/// Upper bound on how long the shell waits for the webview's first page load
/// before showing the window anyway.
///
/// A slow (or unreachable) dev server must not leave the app invisible; if the
/// page never reports `Finished`, the user still gets a window and devtools.
const FIRST_PAINT_TIMEOUT: Duration = Duration::from_secs(5);

/// The local server handle, owned by the desktop shell.
struct ServerState(Mutex<Option<Handle>>);

/// Address the frontend must use for `/api/*` and the WebSockets.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ServerInfo {
    base_url: String,
    port: u16,
}

/// Keeps the rolling file writer alive for the process lifetime.
struct LoggerState(#[allow(dead_code)] LogGuard);

/// Size and position of the main window, in physical pixels.
///
/// Physical (not logical) pixels: the value matches what
/// `WindowEvent::Resized`/`Moved` report, and a window placed on a display with
/// a different scale factor comes back at the same on-screen size.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WindowGeometry {
    width: u32,
    height: u32,
    x: i32,
    y: i32,
    /// The window was maximized the last time the app closed.
    #[serde(default)]
    maximized: bool,
}

/// A monitor's work area (taskbar excluded) in physical pixels.
#[derive(Debug, Clone, Copy)]
struct MonitorArea {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

impl MonitorArea {
    fn from_monitor(monitor: &Monitor) -> Self {
        let area = monitor.work_area();
        Self {
            x: area.position.x,
            y: area.position.y,
            width: area.size.width,
            height: area.size.height,
        }
    }

    /// How much of `geometry` lies inside this monitor, in pixels.
    fn visible_overlap(&self, geometry: &WindowGeometry) -> (u32, u32) {
        (
            overlap(self.x, self.width, geometry.x, geometry.width),
            overlap(self.y, self.height, geometry.y, geometry.height),
        )
    }
}

/// Overlap of two 1-D intervals, in pixels.
fn overlap(a_start: i32, a_len: u32, b_start: i32, b_len: u32) -> u32 {
    let end = (i64::from(a_start) + i64::from(a_len)).min(i64::from(b_start) + i64::from(b_len));
    let start = i64::from(a_start).max(i64::from(b_start));
    u32::try_from((end - start).max(0)).unwrap_or(u32::MAX)
}

/// Reuses a remembered geometry when it still lands on a display.
///
/// Returns `None` when the window was saved on a monitor that is gone (undocked
/// laptop, changed resolution, ...) or the values are junk: the config defaults
/// are a better answer than a window parked outside the desktop.
fn restore_geometry(saved: WindowGeometry, monitors: &[MonitorArea]) -> Option<WindowGeometry> {
    if saved.width < MIN_RESTORABLE_WIDTH || saved.height < MIN_RESTORABLE_HEIGHT {
        return None;
    }

    let monitor = monitors
        .iter()
        .filter(|monitor| {
            let (width, height) = monitor.visible_overlap(&saved);
            width >= MIN_VISIBLE_WIDTH && height >= MIN_VISIBLE_HEIGHT
        })
        .max_by_key(|monitor| {
            let (width, height) = monitor.visible_overlap(&saved);
            width.saturating_mul(height)
        })?;

    // A smaller display than last time (or a lower resolution): shrink to fit
    // instead of restoring a window larger than the screen.
    Some(WindowGeometry {
        width: saved.width.min(monitor.width),
        height: saved.height.min(monitor.height),
        ..saved
    })
}

/// Reads the remembered geometry; a missing or corrupt file means "first run".
fn load_window_geometry(path: &Path) -> Option<WindowGeometry> {
    let text = clover_server::paths::read_text(path).ok()?;
    match serde_json::from_str(&text) {
        Ok(geometry) => Some(geometry),
        Err(error) => {
            tracing::warn!(
                "ignoring unreadable window geometry at {}: {error}",
                path.display()
            );
            None
        }
    }
}

/// Writes the geometry so the next launch can restore it.
fn save_window_geometry(path: &Path, geometry: &WindowGeometry) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_vec_pretty(geometry).map_err(std::io::Error::other)?;
    // Write then rename: a crash mid-write must not leave a half file that the
    // next launch then has to throw away.
    let temp = path.with_extension("tmp");
    std::fs::write(&temp, json)?;
    std::fs::rename(&temp, path)
}

/// The size and position the window has in its normal (not maximized, not
/// minimized) state.
fn normal_geometry<R: Runtime>(window: &WebviewWindow<R>) -> Option<WindowGeometry> {
    // Unknown state (a window already destroyed) counts as "not normal": keep
    // whatever was remembered instead of recording a size we cannot trust.
    if window.is_maximized().unwrap_or(true) || window.is_minimized().unwrap_or(false) {
        return None;
    }
    let size = window.inner_size().ok()?;
    let position = window.outer_position().ok()?;
    if size.width < MIN_RESTORABLE_WIDTH || size.height < MIN_RESTORABLE_HEIGHT {
        return None;
    }
    Some(WindowGeometry {
        width: size.width,
        height: size.height,
        x: position.x,
        y: position.y,
        maximized: false,
    })
}

/// Window geometry kept in memory during the session and written to disk when
/// the window closes.
///
/// Only the geometry seen in the normal state is remembered: a maximized window
/// reports the screen size and a minimized one `0×0`, neither of which is the
/// size the user gets back on unmaximize.
struct WindowMemory {
    /// `~/.clover/desktop-window.json`.
    path: PathBuf,
    geometry: Mutex<Option<WindowGeometry>>,
}

impl WindowMemory {
    fn new(path: PathBuf) -> Self {
        Self {
            path,
            geometry: Mutex::new(None),
        }
    }

    fn lock(&self) -> MutexGuard<'_, Option<WindowGeometry>> {
        // A panic elsewhere must not lose the remembered window for the whole
        // session; the value is plain data, so reuse it.
        self.geometry
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
    }

    /// Seeds the memory with the geometry applied at startup.
    fn remember(&self, geometry: WindowGeometry) {
        *self.lock() = Some(geometry);
    }

    /// Refreshes the memory from the live window after a resize or a move.
    fn observe<R: Runtime>(&self, window: &WebviewWindow<R>) {
        // Minimizing on Windows reports `SIZE_MINIMIZED`, which also clears the
        // maximized flag: keep the previous flag unless the window is visible.
        let minimized = window.is_minimized().unwrap_or(false);
        let maximized = window.is_maximized().ok();
        let normal = normal_geometry(window);
        let mut slot = self.lock();
        match (slot.as_mut(), normal) {
            (Some(geometry), Some(normal)) => {
                geometry.width = normal.width;
                geometry.height = normal.height;
                geometry.x = normal.x;
                geometry.y = normal.y;
            }
            (None, Some(normal)) => *slot = Some(normal),
            // Maximized or minimized: keep the last normal size, the flag below
            // still records that the window was maximized.
            _ => {}
        }
        if !minimized {
            if let (Some(geometry), Some(maximized)) = (slot.as_mut(), maximized) {
                geometry.maximized = maximized;
            }
        }
    }

    /// Writes the remembered geometry to disk when the window closes.
    fn persist<R: Runtime>(&self, window: &WebviewWindow<R>) {
        self.observe(window);
        self.persist_remembered();
    }

    /// Writes what the memory holds, without touching the live window.
    fn persist_remembered(&self) {
        let Some(geometry) = *self.lock() else {
            // Nothing reliable was ever observed (the window spent its whole
            // life maximized): leave the file alone so the config defaults stay
            // in effect.
            return;
        };
        if let Err(error) = save_window_geometry(&self.path, &geometry) {
            tracing::warn!("failed to remember the window geometry: {error}");
        }
    }
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// Frontend bootstrap: which origin serves the API.
///
/// The webview loads the bundled assets from `tauri://localhost`, so relative
/// `/api` calls would hit the asset protocol — the frontend asks for the real
/// server origin instead.
#[tauri::command]
fn server_info(info: tauri::State<'_, ServerInfo>) -> ServerInfo {
    info.inner().clone()
}

/// First port the API server tries.
///
/// `CLOVER_PORT` (or `PORT`) wins. In a dev build the webview loads `devUrl`
/// — in this project `http://localhost:4200`, the frontend dev server. The API
/// must never bind that origin: if it does, the window shows the API's own
/// 404/401 JSON instead of the Angular app (and `ng serve` cannot start).
/// Moving one port up keeps both addresses fixed and predictable.
fn preferred_port(dev_url_port: Option<u16>) -> u16 {
    let requested = std::env::var("CLOVER_PORT")
        .ok()
        .and_then(|v| v.parse::<u16>().ok())
        .unwrap_or_else(clover_server::server::default_port);
    resolve_preferred_port(requested, dev_url_port)
}

/// `requested` unless it is the dev-server origin (then one port up).
fn resolve_preferred_port(requested: u16, dev_url_port: Option<u16>) -> u16 {
    if requested != 0 && dev_url_port == Some(requested) {
        requested.saturating_add(1)
    } else {
        requested
    }
}

/// Creates the main window hidden and shows it once the webview has painted.
///
/// The window ships with `visible: false` / `create: false` in
/// `tauri.conf.json` so the shell controls when it becomes visible. Showing a
/// Tauri window before the webview has any content flashes an empty frame —
/// on Windows that frame is the bare window background (black) around the
/// half-sized webview, i.e. the "black box" users see during startup.
///
/// `PageLoadEvent::Finished` is the first moment the document and its CSS are
/// in place, so showing there reveals the real UI instead of a blank frame.
///
/// The size and position from the previous session (`desktop-window.json`) win
/// over the config defaults. The window is built unmaximized at that geometry
/// and maximized afterwards, so unmaximizing still lands on the remembered
/// size instead of the config default.
fn create_main_window<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> tauri::Result<tauri::WebviewWindow<R>> {
    let mut config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == MAIN_WINDOW_LABEL)
        .cloned()
        .ok_or(tauri::Error::WindowNotFound)?;

    let memory = app.state::<WindowMemory>();
    let monitors: Vec<MonitorArea> = app
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .map(MonitorArea::from_monitor)
        .collect();
    let remembered =
        load_window_geometry(&memory.path).and_then(|saved| restore_geometry(saved, &monitors));
    if remembered.is_some() {
        config.center = false;
        config.maximized = false;
    }

    let window = WebviewWindowBuilder::from_config(app, &config)?
        .on_page_load(|window, payload| {
            // `show` is idempotent: reloads and in-app navigation fire this
            // event again, and the window is already visible by then.
            if matches!(payload.event(), PageLoadEvent::Finished) {
                let _ = window.show();
            }
        })
        .build()?;

    if let Some(geometry) = remembered {
        window.set_size(PhysicalSize::new(geometry.width, geometry.height))?;
        window.set_position(PhysicalPosition::new(geometry.x, geometry.y))?;
        if geometry.maximized {
            window.maximize()?;
        }
        memory.remember(geometry);
    }

    // Track the window for the next launch. The closure owns its own handle:
    // `on_window_event` is registered on the window, not on the builder.
    let observed = window.clone();
    window.on_window_event(move |event| {
        let memory = observed.state::<WindowMemory>();
        match event {
            WindowEvent::Resized(_) | WindowEvent::Moved(_) => memory.observe(&observed),
            WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed => {
                memory.persist(&observed);
            }
            _ => {}
        }
    });

    // Safety net: reveal the window even when the page never finishes loading
    // (dev server down, broken bundle, ...), otherwise the app stays invisible.
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(FIRST_PAINT_TIMEOUT);
        if let Some(window) = handle.get_webview_window(MAIN_WINDOW_LABEL) {
            let _ = window.show();
        }
    });

    Ok(window)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, server_info])
        .setup(|app| {
            app.manage(LoggerState(logging::init(ConsoleTarget::Stdout)));

            // Remembered window geometry lives next to the other app state;
            // `create_main_window` restores it and updates it on close.
            app.manage(WindowMemory::new(
                clover_server::paths::clover_dir().join(WINDOW_STATE_FILE),
            ));

            // Build the hidden main window first so the webview starts loading
            // while the API server binds; `create_main_window` shows it as soon
            // as the first frame is ready.
            create_main_window(app.handle())?;

            // Bind synchronously so the port is known before the window loads
            // (the frontend queries `server_info` on bootstrap).
            let dev_url_port = if cfg!(dev) {
                app.config()
                    .build
                    .dev_url
                    .as_ref()
                    .and_then(tauri::Url::port_or_known_default)
            } else {
                None
            };
            let preferred = preferred_port(dev_url_port);

            let listener = clover_server::bind("127.0.0.1", preferred, PortPolicy::NextFree)?;
            let addr = listener.local_addr()?;

            let config = Config {
                host: "127.0.0.1".to_string(),
                port: addr.port(),
                port_policy: PortPolicy::NextFree,
                readonly: std::env::var("CLOVER_READONLY").is_ok_and(|v| v == "true"),
                // Desktop shell: the webview origin varies (dev server, tauri://).
                cors: CorsPolicy::AllowAny,
                static_dir: None,
                // Shared with the CLI and the legacy server: `~/.clover`.
                state_dir: None,
                home_dir: None,
                warmup_agents: true,
            };

            let handle = tauri::async_runtime::block_on(clover_server::start_with_listener(
                listener, config,
            ))?;

            app.manage(ServerState(Mutex::new(Some(handle))));
            app.manage(ServerInfo {
                base_url: format!("http://{addr}"),
                port: addr.port(),
            });

            tracing::info!("Clover server ready at http://{addr}");
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            // Closing the last window already persisted the geometry; this
            // covers quit paths that skip the close event (`app.exit()`, OS
            // shutdown, ...) while the window still exists.
            if let Some(window) = app_handle.get_webview_window(MAIN_WINDOW_LABEL) {
                app_handle.state::<WindowMemory>().persist(&window);
            }

            let state = app_handle.state::<ServerState>();
            let handle = state.0.lock().ok().and_then(|mut slot| slot.take());
            if let Some(handle) = handle {
                tauri::async_runtime::block_on(handle.shutdown());
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{MonitorArea, WindowGeometry, restore_geometry, resolve_preferred_port};

    #[test]
    fn skips_the_dev_server_port() {
        // `devUrl` is http://localhost:4200: the API takes 4201 instead of
        // shadowing the frontend dev server.
        assert_eq!(resolve_preferred_port(4200, Some(4200)), 4201);
    }

    #[test]
    fn keeps_other_ports() {
        assert_eq!(resolve_preferred_port(4200, Some(5173)), 4200);
        assert_eq!(resolve_preferred_port(4200, None), 4200);
        // 0 asks the OS for a free port and must not be offset.
        assert_eq!(resolve_preferred_port(0, Some(4200)), 0);
    }

    fn monitor(x: i32, y: i32, width: u32, height: u32) -> MonitorArea {
        MonitorArea {
            x,
            y,
            width,
            height,
        }
    }

    fn geometry(x: i32, y: i32, width: u32, height: u32) -> WindowGeometry {
        WindowGeometry {
            width,
            height,
            x,
            y,
            maximized: false,
        }
    }

    #[test]
    fn restores_a_window_that_still_fits_the_monitor() {
        let monitors = [monitor(0, 0, 1920, 1040)];
        let saved = geometry(120, 80, 1280, 800);
        assert_eq!(restore_geometry(saved, &monitors), Some(saved));
    }

    #[test]
    fn restores_on_a_second_monitor() {
        // Virtual desktop: 1920×1080 on the left, 2560×1440 on the right.
        let monitors = [monitor(0, 0, 1920, 1040), monitor(1920, 0, 2560, 1400)];
        let saved = geometry(2000, 100, 1600, 1000);
        assert_eq!(restore_geometry(saved, &monitors), Some(saved));
    }

    #[test]
    fn drops_a_window_saved_on_a_display_that_is_gone() {
        let monitors = [monitor(0, 0, 1920, 1040)];
        let saved = geometry(2600, 200, 1280, 800);
        assert_eq!(restore_geometry(saved, &monitors), None);
    }

    #[test]
    fn drops_a_window_that_is_almost_entirely_offscreen() {
        // Only a 40 px strip of the title bar remains: not enough to grab.
        let monitors = [monitor(0, 0, 1920, 1040)];
        let saved = geometry(1880, 300, 1280, 800);
        assert_eq!(restore_geometry(saved, &monitors), None);
    }

    #[test]
    fn drops_a_junk_geometry() {
        let monitors = [monitor(0, 0, 1920, 1040)];
        assert_eq!(restore_geometry(geometry(0, 0, 0, 0), &monitors), None);
        assert_eq!(restore_geometry(geometry(0, 0, 100, 100), &monitors), None);
    }

    #[test]
    fn shrinks_a_window_to_a_smaller_monitor() {
        // Saved on a 2560-wide display, reopened on a 1366-wide laptop.
        let monitors = [monitor(0, 0, 1366, 728)];
        let saved = geometry(100, 100, 2000, 900);
        let restored = restore_geometry(saved, &monitors).expect("restored");
        assert_eq!((restored.width, restored.height), (1366, 728));
        // The position is kept: the window is still on screen.
        assert_eq!((restored.x, restored.y), (100, 100));
    }

    #[test]
    fn keeps_the_maximized_flag() {
        let monitors = [monitor(0, 0, 1920, 1040)];
        let saved = WindowGeometry {
            maximized: true,
            ..geometry(50, 50, 1280, 800)
        };
        assert_eq!(restore_geometry(saved, &monitors), Some(saved));
    }
}
