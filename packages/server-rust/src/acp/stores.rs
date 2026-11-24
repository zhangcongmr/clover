//! Persisted ACP state files.
//!
//! - `~/.clover/acp.json`          installed agents (`{ version, agents }`)
//! - `~/.clover/agent-config.json` cached per-agent `configOptions`

use std::path::{Path, PathBuf};

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::acp::types::AgentConfig;

pub const ACP_CONFIG_VERSION: &str = "1.0.0";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcpConfigFile {
    #[serde(default = "default_version")]
    pub version: String,
    #[serde(default)]
    pub agents: Vec<AgentConfig>,
}

fn default_version() -> String {
    ACP_CONFIG_VERSION.to_string()
}

impl Default for AcpConfigFile {
    fn default() -> Self {
        Self {
            version: default_version(),
            agents: Vec::new(),
        }
    }
}

pub fn acp_config_file(state_dir: &Path) -> PathBuf {
    state_dir.join("acp.json")
}

pub fn agent_options_file(state_dir: &Path) -> PathBuf {
    state_dir.join("agent-config.json")
}

/// Read `acp.json`; a missing or malformed file yields an empty list.
pub fn read_acp_config(state_dir: &Path) -> AcpConfigFile {
    let file = acp_config_file(state_dir);
    let Ok(raw) = crate::paths::read_text(&file) else {
        return AcpConfigFile::default();
    };
    match serde_json::from_str::<AcpConfigFile>(&raw) {
        Ok(config) => config,
        Err(error) => {
            tracing::error!("[ACP] Failed to parse {}: {error}", file.display());
            AcpConfigFile::default()
        }
    }
}

pub fn write_acp_config(state_dir: &Path, config: &AcpConfigFile) {
    write_json(&acp_config_file(state_dir), config);
}

/// Insert or update one agent entry (matched by id).
pub fn upsert_acp_agent(state_dir: &Path, entry: AgentConfig) {
    let mut config = read_acp_config(state_dir);
    match config.agents.iter_mut().find(|agent| agent.id == entry.id) {
        Some(existing) => {
            let installed_at = existing.installed_at.clone();
            let installed = existing.installed;
            *existing = entry;
            existing.installed_at = existing.installed_at.clone().or(installed_at);
            existing.installed = existing.installed.or(installed);
        }
        None => config.agents.push(entry),
    }
    write_acp_config(state_dir, &config);
}

/// Remove one agent entry; returns false when the id was absent.
pub fn remove_acp_agent(state_dir: &Path, agent_id: &str) -> bool {
    let mut config = read_acp_config(state_dir);
    let before = config.agents.len();
    config.agents.retain(|agent| agent.id != agent_id);
    if config.agents.len() == before {
        return false;
    }
    write_acp_config(state_dir, &config);
    true
}

/// Per-agent cached config options (`{ agentId: { configOptions, updatedAt } }`).
pub type AgentOptionsFile = IndexMap<String, AgentOptionsEntry>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentOptionsEntry {
    pub config_options: Vec<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

pub fn read_agent_options(state_dir: &Path) -> AgentOptionsFile {
    let file = agent_options_file(state_dir);
    let Ok(raw) = crate::paths::read_text(&file) else {
        return AgentOptionsFile::new();
    };
    match serde_json::from_str::<AgentOptionsFile>(&raw) {
        Ok(options) => options,
        Err(error) => {
            tracing::error!("[ACP] Failed to parse {}: {error}", file.display());
            AgentOptionsFile::new()
        }
    }
}

pub fn write_agent_options(state_dir: &Path, options: &AgentOptionsFile) {
    write_json(&agent_options_file(state_dir), options);
}

/// Atomic JSON write (temp file + rename) shared by both stores.
fn write_json<T: Serialize>(file: &Path, value: &T) {
    let Some(parent) = file.parent() else {
        return;
    };
    if std::fs::create_dir_all(parent).is_err() {
        return;
    }
    let Ok(json) = serde_json::to_string_pretty(value) else {
        return;
    };
    let temp = file.with_extension("json.tmp");
    if std::fs::write(&temp, json).is_ok() {
        let _ = std::fs::rename(&temp, file);
    }
}

/// ISO-8601 timestamp with millisecond precision (`toISOString` equivalent).
pub fn iso_now() -> String {
    let now: chrono::DateTime<chrono::Utc> = std::time::SystemTime::now().into();
    now.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("target")
            .join("test-tmp")
            .join(format!(
                "clover-acp-store-{tag}-{}",
                uuid::Uuid::new_v4().simple()
            ));
        std::fs::create_dir_all(&path).expect("create temp dir");
        path
    }

    #[test]
    fn missing_file_reads_as_empty() {
        let dir = temp_dir("missing");
        let config = read_acp_config(&dir);
        assert!(config.agents.is_empty());
        assert_eq!(config.version, ACP_CONFIG_VERSION);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn upsert_and_remove_round_trip() {
        let dir = temp_dir("crud");
        upsert_acp_agent(
            &dir,
            AgentConfig {
                id: "codex".to_string(),
                name: "Codex".to_string(),
                command: "codex-acp".to_string(),
                ..Default::default()
            },
        );
        upsert_acp_agent(
            &dir,
            AgentConfig {
                id: "codex".to_string(),
                name: "Codex (updated)".to_string(),
                command: "codex-acp".to_string(),
                ..Default::default()
            },
        );

        let config = read_acp_config(&dir);
        assert_eq!(config.agents.len(), 1);
        assert_eq!(config.agents[0].name, "Codex (updated)");

        assert!(remove_acp_agent(&dir, "codex"));
        assert!(!remove_acp_agent(&dir, "codex"));
        assert!(read_acp_config(&dir).agents.is_empty());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn malformed_file_is_tolerated() {
        let dir = temp_dir("broken");
        std::fs::write(acp_config_file(&dir), "{ not json").expect("seed");
        assert!(read_acp_config(&dir).agents.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn agent_options_round_trip() {
        let dir = temp_dir("options");
        let mut options = AgentOptionsFile::new();
        options.insert(
            "codex".to_string(),
            AgentOptionsEntry {
                config_options: vec![serde_json::json!({ "id": "model", "currentValue": "gpt" })],
                updated_at: Some(iso_now()),
            },
        );
        write_agent_options(&dir, &options);

        let loaded = read_agent_options(&dir);
        assert_eq!(loaded["codex"].config_options.len(), 1);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn iso_timestamps_match_javascript() {
        let stamp = iso_now();
        assert!(stamp.ends_with('Z'), "{stamp}");
        assert!(stamp.contains('.'), "{stamp}");
    }
}