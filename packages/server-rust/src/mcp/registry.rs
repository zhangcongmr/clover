//! MCP server registry.
//!
//! Port of `packages/server/src/mcp/registry.ts`: a JSON file
//! (`~/.clover/mcp-servers.json`), CRUD for the settings UI, and resolution
//! into the shape ACP expects when a session asks for MCP servers.
//!
//! `${VAR}` placeholders in `env` / `headers` are expanded from the process
//! environment at resolution time (never persisted expanded).

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use anyhow::{Context, Result};
use indexmap::IndexMap;
use serde::Serialize;

use crate::mcp::types::{McpServerConfig, McpServersStore};

/// One `env` / `header` entry in the ACP shape.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct EnvVar {
    pub name: String,
    pub value: String,
}

/// Config resolved for an ACP session.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum ResolvedMcpServer {
    Stdio {
        name: String,
        command: String,
        args: Vec<String>,
        env: Vec<EnvVar>,
    },
    Http {
        #[serde(rename = "type")]
        kind: String,
        name: String,
        url: String,
        headers: Vec<EnvVar>,
    },
}

#[derive(Debug)]
pub struct McpRegistry {
    file: PathBuf,
    store: Mutex<McpServersStore>,
}

impl McpRegistry {
    /// Load from `file`; a missing or malformed file yields an empty store
    /// (same as the TS registry, which logs and continues).
    pub fn open(file: impl Into<PathBuf>) -> Self {
        let file = file.into();
        let store = match crate::paths::read_text(&file) {
            Ok(raw) => match serde_json::from_str::<McpServersStore>(&raw) {
                Ok(store) => store,
                Err(error) => {
                    tracing::error!(
                        "[MCP Registry] Failed to parse {}: {error}",
                        file.display()
                    );
                    McpServersStore::default()
                }
            },
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => McpServersStore::default(),
            Err(error) => {
                tracing::error!(
                    "[MCP Registry] Failed to read {}: {error}",
                    file.display()
                );
                McpServersStore::default()
            }
        };

        Self {
            file,
            store: Mutex::new(store),
        }
    }

    pub fn path(&self) -> &Path {
        &self.file
    }

    pub fn list(&self) -> Vec<McpServerConfig> {
        self.store
            .lock()
            .map(|store| store.servers.values().cloned().collect())
            .unwrap_or_default()
    }

    pub fn get(&self, name: &str) -> Option<McpServerConfig> {
        self.store
            .lock()
            .ok()
            .and_then(|store| store.servers.get(name).cloned())
    }

    /// Insert or replace by (trimmed) name.
    pub fn upsert(&self, name: &str, config: McpServerConfig) {
        let clean = name.trim();
        let Ok(mut store) = self.store.lock() else {
            return;
        };
        store.servers.insert(clean.to_string(), config.with_name(clean));
        if let Err(error) = self.save(&store) {
            tracing::error!("[MCP Registry] Failed to save store: {error}");
        }
    }

    pub fn remove(&self, name: &str) -> bool {
        let Ok(mut store) = self.store.lock() else {
            return false;
        };
        if store.servers.shift_remove(name).is_none() {
            return false;
        }
        if let Err(error) = self.save(&store) {
            tracing::error!("[MCP Registry] Failed to save store: {error}");
        }
        true
    }

    /// Resolve one server for an ACP session (env placeholders expanded).
    pub fn resolve(&self, name: &str) -> Option<ResolvedMcpServer> {
        let config = self.get(name)?;
        Some(match config {
            McpServerConfig::Stdio {
                command, args, env, ..
            } => ResolvedMcpServer::Stdio {
                name: name.to_string(),
                command,
                args,
                env: expand_all(env),
            },
            McpServerConfig::Http { url, headers, .. } => ResolvedMcpServer::Http {
                kind: "http".to_string(),
                name: name.to_string(),
                url,
                headers: expand_all(headers),
            },
        })
    }

    /// Resolve several servers, dropping unknown names (TS `resolveAll`).
    pub fn resolve_all(&self, names: &[String]) -> Vec<ResolvedMcpServer> {
        names
            .iter()
            .filter_map(|name| self.resolve(name))
            .collect()
    }

    /// Atomic write: temp file in the same directory, then rename.
    fn save(&self, store: &McpServersStore) -> Result<()> {
        if let Some(parent) = self.file.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("create {}", parent.display()))?;
        }
        let json = serde_json::to_string_pretty(store)?;
        let temp = self.file.with_extension("json.tmp");
        std::fs::write(&temp, json).with_context(|| format!("write {}", temp.display()))?;
        std::fs::rename(&temp, &self.file)
            .with_context(|| format!("replace {}", self.file.display()))?;
        Ok(())
    }
}

fn expand_all(values: Option<IndexMap<String, String>>) -> Vec<EnvVar> {
    values
        .map(|map| {
            map.into_iter()
                .map(|(name, value)| EnvVar {
                    name,
                    value: expand(&value),
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Replace `${VAR}` with the environment value (missing → empty string),
/// matching the TS `/\$\{(\w+)\}/g` replacement.
fn expand(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut rest = value;

    while let Some(start) = rest.find("${") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        match after.find('}') {
            Some(end) => {
                let name = &after[..end];
                let valid = !name.is_empty()
                    && name.chars().all(|c| c.is_alphanumeric() || c == '_');
                if valid {
                    out.push_str(&std::env::var(name).unwrap_or_default());
                    rest = &after[end + 1..];
                } else {
                    // Not a placeholder: keep `${` literally.
                    out.push_str("${");
                    rest = after;
                }
            }
            None => {
                out.push_str("${");
                rest = after;
            }
        }
    }

    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_registry() -> (McpRegistry, tempdir_like::TempDirLike) {
        let dir = tempdir_like::TempDirLike::new();
        let registry = McpRegistry::open(dir.path().join("mcp-servers.json"));
        (registry, dir)
    }

    fn stdio(name: &str) -> McpServerConfig {
        McpServerConfig::Stdio {
            name: name.to_string(),
            description: "desc".to_string(),
            command: "npx".to_string(),
            args: vec!["-y".to_string(), "server".to_string()],
            env: None,
        }
    }

    #[test]
    fn upsert_persists_and_reloads() {
        let (registry, dir) = temp_registry();
        registry.upsert("fs", stdio("fs"));
        assert_eq!(registry.list().len(), 1);

        let reopened = McpRegistry::open(dir.path().join("mcp-servers.json"));
        let stored = reopened.get("fs").expect("persisted");
        assert_eq!(stored.name(), "fs");
        assert_eq!(stored.kind(), "stdio");
    }

    #[test]
    fn names_are_trimmed_for_storage() {
        let (registry, _dir) = temp_registry();
        registry.upsert("  fs  ", stdio("fs"));
        assert!(registry.get("fs").is_some());
        assert_eq!(registry.list()[0].name(), "fs");
    }

    #[test]
    fn remove_reports_whether_it_existed() {
        let (registry, _dir) = temp_registry();
        registry.upsert("fs", stdio("fs"));
        assert!(registry.remove("fs"));
        assert!(!registry.remove("fs"));
        assert!(registry.get("fs").is_none());
    }

    #[test]
    fn resolves_placeholders_from_the_environment() {
        let (registry, _dir) = temp_registry();
        // SAFETY: test-only, unique variable name.
        unsafe { std::env::set_var("CLOVER_TEST_TOKEN", "secret-value") };

        registry.upsert(
            "gh",
            McpServerConfig::Http {
                name: "gh".to_string(),
                description: String::new(),
                url: "https://example.test/mcp".to_string(),
                headers: Some(IndexMap::from([(
                    "Authorization".to_string(),
                    "Bearer ${CLOVER_TEST_TOKEN}".to_string(),
                )])),
            },
        );

        let resolved = registry.resolve("gh").expect("resolved");
        match resolved {
            ResolvedMcpServer::Http {
                kind, headers, url, ..
            } => {
                assert_eq!(kind, "http");
                assert_eq!(url, "https://example.test/mcp");
                assert_eq!(
                    headers,
                    vec![EnvVar {
                        name: "Authorization".to_string(),
                        value: "Bearer secret-value".to_string(),
                    }]
                );
            }
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn unresolved_placeholders_become_empty() {
        assert_eq!(expand("x${CLOVER_DEFINITELY_MISSING}y"), "xy");
        assert_eq!(expand("no placeholders"), "no placeholders");
        // Not a valid `\w+` name: kept verbatim.
        assert_eq!(expand("${NOT VALID}"), "${NOT VALID}");
    }

    #[test]
    fn malformed_store_falls_back_to_empty() {
        let dir = tempdir_like::TempDirLike::new();
        let file = dir.path().join("mcp-servers.json");
        std::fs::write(&file, "{not json").expect("seed");
        let registry = McpRegistry::open(file);
        assert!(registry.list().is_empty());
    }

    #[test]
    fn resolve_all_skips_unknown_names() {
        let (registry, _dir) = temp_registry();
        registry.upsert("fs", stdio("fs"));
        let resolved = registry.resolve_all(&["fs".to_string(), "missing".to_string()]);
        assert_eq!(resolved.len(), 1);
    }

    /// Minimal temp dir helper (see `tests/local_api.rs` for why `tempfile`
    /// is not used).
    mod tempdir_like {
        use std::path::{Path, PathBuf};

        pub struct TempDirLike(PathBuf);

        impl TempDirLike {
            pub fn new() -> Self {
                // `%TEMP%` is not writable for test binaries here; use the
                // workspace target dir (already gitignored).
                let path = Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join("..")
                    .join("..")
                    .join("target")
                    .join("test-tmp")
                    .join(format!("clover-mcp-{}", uuid::Uuid::new_v4().simple()));
                std::fs::create_dir_all(&path).expect("create temp dir");
                Self(path)
            }

            pub fn path(&self) -> &Path {
                &self.0
            }
        }

        impl Drop for TempDirLike {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
    }
}