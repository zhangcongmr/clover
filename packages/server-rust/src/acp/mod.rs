//! ACP: agent probing, process lifecycle, JSON-RPC transport, registry.

pub mod activity;
pub mod client;
pub mod install;
pub mod probe;
pub mod process;
pub mod registry;
pub mod rpc;
pub mod sessions;
pub mod sse;
pub mod stores;
pub mod types;

pub use activity::SessionActivityHub;
pub use client::{AcpClient, ConnectParams};
pub use install::AgentInstaller;
pub use registry::AgentRegistry;
pub use sessions::{SessionManager, SessionStatus};
pub use sse::SessionStreamManager;
pub use types::{AgentConfig, AgentLaunchConfig, AgentRuntimeStatus, AgentStatusInfo};