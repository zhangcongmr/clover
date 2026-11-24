// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::ExitCode;

#[tokio::main]
async fn main() -> ExitCode {
    clover_server::cli::main().await
}