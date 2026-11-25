// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

use std::sync::Mutex;

use clover_server::logging::{self, ConsoleTarget, LogGuard};
use clover_server::{Config, CorsPolicy, Handle, PortPolicy};
use serde::Serialize;
use tauri::Manager;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, server_info])
        .setup(|app| {
            app.manage(LoggerState(logging::init(ConsoleTarget::Stdout)));

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
    use super::resolve_preferred_port;

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
}
