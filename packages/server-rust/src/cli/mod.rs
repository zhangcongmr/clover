//! `clover` CLI.
//!
//! Command surface matches the TypeScript CLI:
//!
//! ```text
//! clover                          # same as `clover serve`
//! clover [options]                # -h / -v / -p
//! clover run <prompt> [options]    # one task, no HTTP server
//! clover serve [options]          # start the local server
//! ```
//!
//! Exit codes: `0` success, `1` usage/ACP error, `130` interrupted.

mod run;
mod serve;

use std::process::ExitCode;

use clap::{ArgAction, Parser};

use crate::logging::{self, ConsoleTarget};

#[derive(Debug, Parser)]
#[command(
    name = "clover",
    bin_name = "clover",
    version,
    about = "Clover local agent server",
    disable_version_flag = true,
    disable_help_subcommand = true
)]
struct Cli {
    /// Set the server port (default 4200)
    #[arg(short = 'p', long, value_name = "N")]
    port: Option<u16>,

    /// Print the clover version
    #[arg(short = 'v', long, action = ArgAction::Version)]
    version: Option<bool>,

    #[command(subcommand)]
    command: Option<Subcommand>,
}

#[derive(Debug, clap::Subcommand)]
enum Subcommand {
    /// Run one task with an installed agent, then exit
    Run(run::RunArgs),
    /// Start the local server (same as no arguments)
    Serve(serve::ServeArgs),
}

/// Parse `argv` and dispatch. Returns the process exit code.
pub async fn main() -> ExitCode {
    let cli = match Cli::try_parse() {
        Ok(cli) => cli,
        Err(error) => return handle_parse_error(error),
    };

    match cli.command {
        Some(Subcommand::Run(args)) => {
            let _guard = logging::init(ConsoleTarget::Stderr);
            ExitCode::from(run::execute(args).await)
        }
        Some(Subcommand::Serve(args)) => {
            let _guard = logging::init(ConsoleTarget::Stdout);
            serve::execute(args, cli.port).await
        }
        None => {
            let _guard = logging::init(ConsoleTarget::Stdout);
            serve::execute(serve::ServeArgs::default(), cli.port).await
        }
    }
}

/// clap exits with 2 on unknown subcommands; the TS CLI used 1 and printed the
/// available commands, so keep that behaviour.
fn handle_parse_error(error: clap::Error) -> ExitCode {
    use clap::error::{ContextKind, ErrorKind};

    match error.kind() {
        // The TS CLI printed the available commands and exited 1; clap's
        // default wording/exit code (2) would be a visible change.
        ErrorKind::InvalidSubcommand => {
            let value = error
                .get(ContextKind::InvalidSubcommand)
                .map(|v| v.to_string())
                .unwrap_or_default();
            eprintln!("Unknown command: {value}");
            eprintln!("Available commands: run, serve");
            ExitCode::from(1)
        }
        ErrorKind::UnknownArgument => {
            let _ = error.print();
            ExitCode::from(1)
        }
        _ => {
            let _ = error.print();
            ExitCode::from(0)
        }
    }
}