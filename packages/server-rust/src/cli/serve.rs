//! `clover serve`

use std::path::{Path, PathBuf};
use std::process::ExitCode;

use clap::Args;

use crate::server::{self, Config, PortPolicy};

#[derive(Debug, Default, Args)]
pub struct ServeArgs {
    /// Set the server port (default 4200, or `PORT`)
    #[arg(short = 'p', long, value_name = "N")]
    pub port: Option<u16>,

    /// Serve in read-only mode (no file writes)
    #[arg(long)]
    pub readonly: bool,

    /// Directory with the built web assets to serve on `/`
    /// (default: `./dist/clover/browser` when it exists)
    #[arg(long, value_name = "DIR")]
    pub static_dir: Option<PathBuf>,
}

/// Resolve the effective port: `--port` > `PORT` env > 4200.
fn resolve_port(explicit: Option<u16>) -> u16 {
    explicit.unwrap_or_else(server::default_port)
}

pub async fn execute(args: ServeArgs, global_port: Option<u16>) -> ExitCode {
    let explicit = args.port.or(global_port);
    let port = resolve_port(explicit);

    let config = Config {
        port,
        // An explicitly requested port must fail loudly when busy, like
        // Express did; otherwise fall back to the next free port.
        port_policy: if explicit.is_some() {
            PortPolicy::Strict
        } else {
            PortPolicy::NextFree
        },
        readonly: args.readonly || std::env::var("CLOVER_READONLY").is_ok_and(|v| v == "true"),
        static_dir: args.static_dir.or_else(default_static_dir),
        ..Config::default()
    };

    if let Some(dir) = &config.static_dir {
        tracing::info!("serving static assets from {}", dir.display());
    }

    match server::run(config).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("clover serve: {error}");
            ExitCode::FAILURE
        }
    }
}

/// `./dist/clover/browser` when present — the layout produced by
/// `pnpm --filter ./packages/assistant build`.
fn default_static_dir() -> Option<PathBuf> {
    let candidate = Path::new("dist/clover/browser");
    candidate.is_dir().then(|| candidate.to_path_buf())
}