//! Server assembly, startup and graceful shutdown.

mod auth;
mod cors;
mod error;
mod state;

pub use auth::{now_ms, TokenManager};
pub use cors::CorsPolicy;
pub use error::{ApiError, ApiResult};
pub use state::AppState;

use std::io;
use std::net::{SocketAddr, TcpListener};
use std::path::PathBuf;
use std::sync::Arc;

use axum::middleware;
use axum::Router;
use tokio::sync::oneshot;
use tokio::task::JoinHandle;
use tower_http::services::{ServeDir, ServeFile};

use crate::local::{FileService, PtyManager};
use crate::mcp::McpRegistry;

/// Port selection behaviour when the preferred port is taken.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum PortPolicy {
    /// Fail instead of moving (explicit `--port` / `PORT`, like Express).
    Strict,
    /// Try the next ports until one binds (desktop app).
    #[default]
    NextFree,
}

/// How many ports to probe in [`PortPolicy::NextFree`].
const PORT_SCAN_LIMIT: u16 = 100;

/// Upper bound on graceful shutdown (leaked SSE/WS connections must not block
/// application exit).
const SHUTDOWN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

/// Server configuration. Shared by the CLI and the desktop shell.
#[derive(Clone, Debug)]
pub struct Config {
    pub host: String,
    pub port: u16,
    pub port_policy: PortPolicy,
    pub readonly: bool,
    pub cors: CorsPolicy,
    /// Optional directory with built Angular assets (`clover serve`).
    pub static_dir: Option<PathBuf>,
    /// State root (defaults to `~/.clover`). Tests point this at a temp dir so
    /// they never touch the user's real configuration.
    pub state_dir: Option<PathBuf>,
    /// User home override (defaults to the OS home). Tests point this at a
    /// temp dir so global skill sources stay isolated.
    pub home_dir: Option<PathBuf>,
    /// Pre-spawn + initialize every installed agent at startup (P4).
    pub warmup_agents: bool,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".to_string(),
            port: default_port(),
            port_policy: PortPolicy::NextFree,
            readonly: std::env::var("CLOVER_READONLY").is_ok_and(|v| v == "true"),
            cors: CorsPolicy::default(),
            static_dir: None,
            state_dir: None,
            home_dir: None,
            warmup_agents: true,
        }
    }
}

/// `PORT` env override, else 4200 (same default as the TypeScript server).
pub fn default_port() -> u16 {
    std::env::var("PORT")
        .ok()
        .and_then(|v| v.parse::<u16>().ok())
        .filter(|p| *p > 0)
        .unwrap_or(4200)
}

/// A running server.
pub struct Handle {
    addr: SocketAddr,
    shutdown: Option<oneshot::Sender<()>>,
    join: JoinHandle<()>,
    pty: Arc<PtyManager>,
    agents: Arc<crate::acp::AgentRegistry>,
    sessions: Arc<crate::acp::SessionManager>,
    sse: Arc<crate::acp::SessionStreamManager>,
}

impl Handle {
    /// Address the server actually bound to.
    pub fn addr(&self) -> SocketAddr {
        self.addr
    }

    pub fn port(&self) -> u16 {
        self.addr.port()
    }

    /// Base URL usable by the frontend (`http://127.0.0.1:<port>`).
    pub fn base_url(&self) -> String {
        format!("http://{}", self.addr)
    }

    /// Stop accepting connections and wait for in-flight requests.
    ///
    /// Bounded: a leaked long-lived connection (SSE, WebSocket) must not hang
    /// application exit, so the task is aborted after [`SHUTDOWN_TIMEOUT`].
    pub async fn shutdown(mut self) {
        if let Some(tx) = self.shutdown.take() {
            let _ = tx.send(());
        }
        // Terminals outlive the HTTP server unless they are killed explicitly
        // (the shell processes are not children of the accept loop).
        self.pty.destroy_all();
        // Close session streams and drop records, then stop every warm agent
        // connection so no subprocess outlives the app.
        self.sse.destroy();
        self.sessions.destroy();
        self.agents.destroy().await;
        if tokio::time::timeout(SHUTDOWN_TIMEOUT, &mut self.join)
            .await
            .is_err()
        {
            tracing::warn!(
                "server did not stop within {SHUTDOWN_TIMEOUT:?}; aborting the accept loop"
            );
            self.join.abort();
        }
    }
}

/// Bind the listening socket, retrying the next ports under
/// [`PortPolicy::NextFree`].
pub fn bind(host: &str, preferred: u16, policy: PortPolicy) -> io::Result<TcpListener> {
    match policy {
        PortPolicy::Strict => TcpListener::bind((host, preferred)),
        PortPolicy::NextFree => {
            // `0` means "let the OS pick", as with every other server API.
            if preferred == 0 {
                return TcpListener::bind((host, 0));
            }
            let mut last_error = None;
            for offset in 1..=PORT_SCAN_LIMIT {
                let port = preferred.saturating_add(offset - 1);
                if port == 0 {
                    continue;
                }
                match TcpListener::bind((host, port)) {
                    Ok(listener) => return Ok(listener),
                    Err(error) => last_error = Some(error),
                }
            }
            Err(last_error.unwrap_or_else(|| {
                io::Error::new(io::ErrorKind::AddrInUse, "no free port found")
            }))
        }
    }
}

/// Bind and start in one call.
pub async fn start(config: Config) -> anyhow::Result<Handle> {
    let listener = bind(&config.host, config.port, config.port_policy)?;
    start_with_listener(listener, config).await
}

/// Start on an already-bound listener.
///
/// The desktop shell uses this so the port is known *before* the window
/// loads (no race between the frontend and the server).
pub async fn start_with_listener(
    listener: std::net::TcpListener,
    config: Config,
) -> anyhow::Result<Handle> {
    listener.set_nonblocking(true)?;
    let addr = listener.local_addr()?;
    let listener = tokio::net::TcpListener::from_std(listener)?;

    let pty = Arc::new(PtyManager::new());
    pty.spawn_cleanup();

    let state_dir = config
        .state_dir
        .clone()
        .unwrap_or_else(crate::paths::clover_dir);
    let home_dir = config
        .home_dir
        .clone()
        .unwrap_or_else(crate::paths::home_dir);

    let mut skill_options = crate::skills::SkillRegistryOptions::new(home_dir, state_dir.clone());
    skill_options.cwd = Some(
        std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from(".")),
    );

    let event_sink = Arc::new(crate::events::EventSink::default());
    let acp_agents = crate::acp::stores::read_acp_config(&state_dir).agents;
    let agents = crate::acp::AgentRegistry::new(acp_agents, Arc::clone(&event_sink));
    let installs = crate::acp::AgentInstaller::new(state_dir.clone(), Arc::clone(&agents));
    let activity = Arc::new(crate::acp::SessionActivityHub::new());
    let sessions = crate::acp::SessionManager::new(
        Arc::clone(&agents),
        Arc::clone(&event_sink),
        Arc::clone(&activity),
    );
    let sse = Arc::new(crate::acp::SessionStreamManager::new(Arc::clone(&event_sink)));
    let a2a = crate::a2a::A2aService::new(Arc::clone(&sessions), Arc::clone(&agents));

    let state = AppState {
        token: Arc::new(TokenManager::new(
            std::env::var("CLOVER_TOKEN_SECRET").ok(),
            30,
        )),
        readonly: config.readonly,
        files: Arc::new(FileService::new(config.readonly)),
        pty: Arc::clone(&pty),
        mcp: Arc::new(McpRegistry::open(state_dir.join("mcp-servers.json"))),
        skills: Arc::new(crate::skills::SkillRegistry::open(skill_options)),
        agents: Arc::clone(&agents),
        installs,
        sessions: Arc::clone(&sessions),
        sse: Arc::clone(&sse),
        activity,
        a2a,
        events: event_sink,
        state_dir: state_dir.clone(),
    };

    if config.warmup_agents {
        let registry = Arc::clone(&agents);
        tokio::spawn(async move { registry.warmup_all().await });
    }

    let app = build_router(state, config.cors.clone(), config.static_dir.clone());

    let (tx, rx) = oneshot::channel();
    let join = tokio::spawn(async move {
        let server = axum::serve(listener, app).with_graceful_shutdown(async move {
            let _ = rx.await;
        });
        if let Err(error) = server.await {
            tracing::error!("server error: {error}");
        }
    });

    tracing::info!("Clover server listening on http://{addr}");

    Ok(Handle {
        addr,
        shutdown: Some(tx),
        join,
        pty,
        agents,
        sessions,
        sse,
    })
}

/// Start and block until Ctrl-C. Used by `clover serve`.
pub async fn run(config: Config) -> anyhow::Result<()> {
    let handle = start(config).await?;
    let addr = handle.addr();
    tracing::info!("ready on http://{addr} (Ctrl-C to stop)");

    wait_for_shutdown_signal().await;
    tracing::info!("shutting down");
    handle.shutdown().await;
    Ok(())
}

async fn wait_for_shutdown_signal() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};
        let mut term = signal(SignalKind::terminate()).expect("install SIGTERM handler");
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {}
            _ = term.recv() => {}
        }
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}

fn build_router(state: AppState, cors: CorsPolicy, static_dir: Option<PathBuf>) -> Router {
    // MCP and Skills are mounted without the bearer middleware on purpose:
    // their UI code calls them without a token (same as the TS server).
    let public = crate::routes::local::public_router()
        .merge(crate::routes::a2a::public_router())
        .merge(crate::routes::projects::router())
        .nest("/api/mcp", crate::routes::mcp::router())
        .nest("/api/skills", crate::routes::skills::router());

    let protected = crate::routes::local::protected_router()
        .merge(crate::routes::a2a::router())
        .nest("/api/acp", crate::routes::acp::router())
        // `route_layer` (not `layer`): auth must guard registered routes only.
        // `layer` would also wrap this router's 404 fallback, so *unknown*
        // paths would answer 401 — including `/`, which the static handler (or
        // the browser) needs to see as 404.
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            auth::require_auth,
        ));

    let mut app: Router = Router::new()
        .merge(public)
        .merge(protected)
        .with_state(state)
        // CORS is outermost so `OPTIONS` short-circuits before auth.
        .layer(middleware::from_fn_with_state(cors, cors::layer));

    if let Some(dir) = static_dir {
        let index = dir.join("index.html");
        app = app.fallback_service(ServeDir::new(dir).not_found_service(ServeFile::new(index)));
    }

    app
}