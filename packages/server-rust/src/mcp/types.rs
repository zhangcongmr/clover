//! Persisted MCP server shapes.
//!
//! JSON is byte-compatible with `packages/server/src/mcp/types.ts`:
//!
//! ```json
//! { "servers": { "name": { "type": "stdio", "name": "…", "description": "…",
//!                          "command": "…", "args": [], "env": {} } } }
//! ```
//!
//! Insertion order is preserved (both on disk and when listing) like the JS
//! object it replaces.

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};

/// One configured MCP server.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type")]
pub enum McpServerConfig {
    #[serde(rename = "stdio")]
    Stdio {
        name: String,
        #[serde(default)]
        description: String,
        command: String,
        #[serde(default)]
        args: Vec<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        env: Option<IndexMap<String, String>>,
    },
    #[serde(rename = "http")]
    Http {
        name: String,
        #[serde(default)]
        description: String,
        url: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        headers: Option<IndexMap<String, String>>,
    },
}

impl McpServerConfig {
    pub fn name(&self) -> &str {
        match self {
            McpServerConfig::Stdio { name, .. } | McpServerConfig::Http { name, .. } => name,
        }
    }

    /// Server kind as the frontend sees it (`stdio` / `http`).
    pub fn kind(&self) -> &'static str {
        match self {
            McpServerConfig::Stdio { .. } => "stdio",
            McpServerConfig::Http { .. } => "http",
        }
    }

    pub fn with_name(self, name: &str) -> Self {
        match self {
            McpServerConfig::Stdio {
                description,
                command,
                args,
                env,
                ..
            } => McpServerConfig::Stdio {
                name: name.to_string(),
                description,
                command,
                args,
                env,
            },
            McpServerConfig::Http {
                description,
                url,
                headers,
                ..
            } => McpServerConfig::Http {
                name: name.to_string(),
                description,
                url,
                headers,
            },
        }
    }

    pub fn description(&self) -> &str {
        match self {
            McpServerConfig::Stdio { description, .. }
            | McpServerConfig::Http { description, .. } => description,
        }
    }
}

/// On-disk envelope.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct McpServersStore {
    #[serde(default)]
    pub servers: IndexMap<String, McpServerConfig>,
}