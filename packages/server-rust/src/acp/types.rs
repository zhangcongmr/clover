//! ACP agent types (JSON-compatible with `acp-agent.types.ts`).

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Runtime status shown in Settings → Agents.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum AgentRuntimeStatus {
    /// Not probed yet.
    #[default]
    Unknown,
    /// Installed, runtime not determined yet.
    Available,
    /// Command not found on PATH.
    Unavailable,
    /// Installed but the process is not running.
    Offline,
    /// Subprocess started and `initialize` succeeded.
    Connected,
}

/// Persisted agent definition (`~/.clover/acp.json`).
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentConfig {
    pub id: String,
    pub name: String,
    /// Empty while an install request is still unresolved (registry source).
    #[serde(default)]
    pub command: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub args: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub env: Option<IndexMap<String, String>>,
    /// `builtin` | `registry` | `disk`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub installed_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub installed: Option<bool>,
}

impl AgentConfig {
    pub fn args_vec(&self) -> Vec<String> {
        self.args.clone().unwrap_or_default()
    }
}

/// Snapshot returned by `GET /api/acp/agents` and the status SSE stream.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatusInfo {
    #[serde(flatten)]
    pub config: AgentConfig,
    pub status: AgentRuntimeStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_info: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// Resolved CLI path (shown in the settings UI).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cli_path: Option<String>,
    pub last_checked: i64,
}

/// Launch parameters used by the client.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AgentLaunchConfig {
    pub command: Option<String>,
    pub args: Option<Vec<String>>,
    pub env: Option<IndexMap<String, String>>,
}

impl AgentLaunchConfig {
    pub fn from_config(config: &AgentConfig) -> Self {
        Self {
            command: Some(config.command.clone()),
            args: config.args.clone(),
            env: config.env.clone(),
        }
    }
}