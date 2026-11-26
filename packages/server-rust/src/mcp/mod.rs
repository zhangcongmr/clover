//! MCP server configuration store and ACP resolution.

pub mod registry;
pub mod types;

pub use registry::{McpRegistry, ResolvedMcpServer};
pub use types::{McpServerConfig, McpServersStore};