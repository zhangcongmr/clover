//! Clover local server — the pure-Rust replacement for `packages/server`.
//!
//! This crate owns everything that used to live in the TypeScript server
//! package: the HTTP endpoints, the WebSocket endpoints, the ACP session
//! engine and the `clover` CLI. It deliberately has **no `tauri` dependency**
//! so it can run headless:
//!
//! - `clover serve` starts the full server and hosts the built Angular UI
//!   (embedded when compiled with the `web-ui` feature, or from
//!   `--static-dir`);
//! - `clover run` drives a single ACP task without an HTTP server;
//! - the desktop shell (`packages/desktop/src-tauri`) starts the same
//!   server in-process through [`start`] / [`start_with_listener`].
//!
//! Batch layout (see `docs/rust-server-migration-plan.md`):
//! P0 server skeleton, P1 local+ws, P2 mcp, P3 skills, P4/P5 ACP, P6 agent
//! management, P7 CLI, P8 A2A.

pub mod acp;
pub mod a2a;
pub mod cli;
pub mod events;
pub mod local;
pub mod logging;
pub mod mcp;
pub mod paths;
pub mod projects;
pub mod routes;
pub mod server;
pub mod skills;
mod subprocess;

pub use server::{
    bind, run, start, start_with_listener, Config, CorsPolicy, Handle, PortPolicy, TokenManager,
};