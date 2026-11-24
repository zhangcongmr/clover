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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, server_info])
        .setup(|app| {
            app.manage(LoggerState(logging::init(ConsoleTarget::Stdout)));

            // Bind synchronously so the port is known before the window loads
            // (the frontend queries `server_info` on bootstrap).
            let preferred = std::env::var("CLOVER_PORT")
                .ok()
                .and_then(|v| v.parse::<u16>().ok())
                .unwrap_or_else(clover_server::server::default_port);

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