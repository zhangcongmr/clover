//! Logging setup.
//!
//! Mirrors the TypeScript logger's environment contract:
//!
//! - `CLOVER_LOG_DIR`      target directory (default `~/.clover/logs`)
//! - `CLOVER_LOG_TO_FILE`  set to `false` to disable file output
//! - `CLOVER_LOG_PREFIX`   filename prefix (default `agent`)
//! - `CLOVER_LOG_MAX_FILES` files to keep (default 10)
//! - `RUST_LOG`            console filter (default `info`)
//!
//! The library never installs a global subscriber on its own: the caller
//! (CLI or the desktop shell) decides where console output goes, so
//! `clover run` can keep stdout clean for agent output.

use std::io;

use tracing_appender::non_blocking::WorkerGuard;
use tracing_appender::rolling;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::{EnvFilter, Layer};

use crate::paths;

/// Where tracing console output is written.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ConsoleTarget {
    #[default]
    Stdout,
    Stderr,
}

/// Keeps the non-blocking file writer alive for the lifetime of the process.
#[derive(Debug, Default)]
pub struct LogGuard {
    _file: Option<WorkerGuard>,
}

fn env_filter() -> EnvFilter {
    EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"))
}

/// Install the global subscriber. Calling this twice is a no-op.
pub fn init(console: ConsoleTarget) -> LogGuard {
    let registry = tracing_subscriber::registry().with(console_layer(console));

    match file_layer() {
        Some((layer, guard)) => {
            // `try_init` keeps a second call from panicking (e.g. the desktop
            // shell installing logging before starting the server).
            let _ = registry.with(layer).try_init();
            LogGuard {
                _file: Some(guard),
            }
        }
        None => {
            let _ = registry.try_init();
            LogGuard::default()
        }
    }
}

fn console_layer(console: ConsoleTarget) -> impl Layer<tracing_subscriber::Registry> + Send + Sync {
    tracing_subscriber::fmt::layer()
        .with_ansi(true)
        .with_target(true)
        .with_writer(move || -> Box<dyn io::Write + Send> {
            match console {
                ConsoleTarget::Stdout => Box::new(io::stdout()),
                ConsoleTarget::Stderr => Box::new(io::stderr()),
            }
        })
        .with_filter(env_filter())
}

/// Rolling file layer, disabled when `CLOVER_LOG_TO_FILE=false`.
fn file_layer<S>() -> Option<(impl Layer<S> + Send + Sync + 'static, WorkerGuard)>
where
    S: tracing::Subscriber + for<'a> tracing_subscriber::registry::LookupSpan<'a>,
{
    if std::env::var("CLOVER_LOG_TO_FILE").is_ok_and(|v| v.eq_ignore_ascii_case("false")) {
        return None;
    }

    let dir = paths::log_dir();
    if paths::ensure_dir(&dir).is_err() {
        return None;
    }

    let prefix = std::env::var("CLOVER_LOG_PREFIX").unwrap_or_else(|_| "agent".to_string());
    let max_files = std::env::var("CLOVER_LOG_MAX_FILES")
        .ok()
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(10)
        .max(1);

    let appender = rolling::Builder::new()
        .rotation(rolling::Rotation::DAILY)
        .filename_prefix(&prefix)
        .filename_suffix("log")
        .max_log_files(max_files)
        .build(&dir)
        .ok()?;

    let (writer, guard) = tracing_appender::non_blocking(appender);
    let layer = tracing_subscriber::fmt::layer()
        .with_ansi(false)
        .with_writer(writer)
        .with_filter(env_filter());

    Some((layer, guard))
}