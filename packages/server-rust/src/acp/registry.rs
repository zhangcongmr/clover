//! Agent registry: probe, warm connections and status snapshots.
//!
//! Port of `packages/server/src/acp/agent-registry.ts`. One shared, pre-warmed
//! ACP connection per installed agent; `get_status()` feeds Settings → Agents
//! and the status SSE stream, `check_now()` is the "Check Now" button.

use std::sync::{Arc, RwLock};
use std::time::Duration;

use indexmap::IndexMap;
use serde_json::Value;
use tokio::sync::broadcast;

use crate::acp::client::{AcpClient, ConnectParams};
use crate::acp::probe::{invalidate_agent_command_cache, probe_agent_version, probe_package_version, probe_path_command};
use crate::acp::types::{AgentConfig, AgentLaunchConfig, AgentRuntimeStatus, AgentStatusInfo};
use crate::events::EventSink;

const CHANNEL_CAPACITY: usize = 256;

struct RuntimeInfo {
    status: AgentRuntimeStatus,
    installed: Option<bool>,
    error: Option<String>,
    cli_path: Option<String>,
    version: Option<String>,
    last_checked: i64,
    agent_info: Option<Value>,
    capabilities: Option<Value>,
}

impl Default for RuntimeInfo {
    fn default() -> Self {
        Self {
            status: AgentRuntimeStatus::Unknown,
            installed: None,
            error: None,
            cli_path: None,
            version: None,
            last_checked: 0,
            agent_info: None,
            capabilities: None,
        }
    }
}

struct AgentHandle {
    config: RwLock<AgentConfig>,
    info: RwLock<RuntimeInfo>,
    connection: tokio::sync::Mutex<Option<Arc<AcpClient>>>,
    /// Serializes explicit checks so "Check Now" cannot race warmup.
    check_lock: tokio::sync::Mutex<()>,
    status_tx: broadcast::Sender<AgentStatusInfo>,
    sink: Arc<EventSink>,
}

impl AgentHandle {
    fn config(&self) -> AgentConfig {
        self.config.read().map(|config| config.clone()).unwrap_or_default()
    }

    /// Snapshot for the API (config + runtime, no internals).
    fn snapshot(&self) -> AgentStatusInfo {
        let config = self.config();
        let info = self.info.read().expect("agent info poisoned");

        let merged = AgentConfig {
            version: info.version.clone().or(config.version),
            installed: info.installed.or(config.installed),
            ..config
        };

        AgentStatusInfo {
            config: merged,
            status: info.status,
            agent_info: info.agent_info.clone(),
            capabilities: info.capabilities.clone(),
            error: info.error.clone(),
            cli_path: info.cli_path.clone(),
            last_checked: info.last_checked,
        }
    }

    fn emit(&self) {
        let _ = self.status_tx.send(self.snapshot());
    }

    fn set_status(&self, status: AgentRuntimeStatus, error: Option<String>) {
        {
            let mut info = self.info.write().expect("agent info poisoned");
            info.status = status;
            info.error = error;
            info.last_checked = now_ms();
        }
        self.emit();
    }

    async fn is_connected(&self) -> bool {
        let connection = self.connection.lock().await.clone();
        match connection {
            Some(client) => client.is_connected().await,
            None => false,
        }
    }

    /// Apply a connection state transition reported by the client.
    fn apply_connection_state(&self, client: &AcpClient, connected: bool) {
        {
            let mut info = self.info.write().expect("agent info poisoned");
            if connected {
                info.status = AgentRuntimeStatus::Connected;
                info.error = None;
                info.agent_info = client.agent_info();
                info.capabilities = client.capabilities();
            } else if info.status == AgentRuntimeStatus::Connected {
                info.status = if info.installed == Some(false) {
                    AgentRuntimeStatus::Unavailable
                } else {
                    AgentRuntimeStatus::Offline
                };
                info.error = info
                    .error
                    .clone()
                    .or_else(|| Some("Agent process exited".to_string()));
                info.agent_info = None;
                info.capabilities = None;
            }
            info.last_checked = now_ms();
        }
        self.emit();
    }
}

pub struct AgentRegistry {
    handles: RwLock<IndexMap<String, Arc<AgentHandle>>>,
    /// Ad-hoc launch configs (session/list for unregistered agents); never
    /// listed by `get_status`.
    adhoc: RwLock<IndexMap<String, Arc<AgentHandle>>>,
    status_tx: broadcast::Sender<AgentStatusInfo>,
    removed_tx: broadcast::Sender<String>,
    sink: Arc<EventSink>,
}

impl AgentRegistry {
    pub fn new(agents: Vec<AgentConfig>, sink: Arc<EventSink>) -> Arc<Self> {
        let (status_tx, _) = broadcast::channel(CHANNEL_CAPACITY);
        let (removed_tx, _) = broadcast::channel(CHANNEL_CAPACITY);

        let registry = Arc::new(Self {
            handles: RwLock::new(IndexMap::new()),
            adhoc: RwLock::new(IndexMap::new()),
            status_tx: status_tx.clone(),
            removed_tx,
            sink,
        });

        for config in agents {
            let handle = registry.build_handle(config);
            if let Ok(mut handles) = registry.handles.write() {
                handles.insert(handle.config().id.clone(), handle);
            }
        }

        registry
    }

    fn build_handle(&self, config: AgentConfig) -> Arc<AgentHandle> {
        Arc::new(AgentHandle {
            config: RwLock::new(config),
            info: RwLock::new(RuntimeInfo::default()),
            connection: tokio::sync::Mutex::new(None),
            check_lock: tokio::sync::Mutex::new(()),
            // Status transitions must reach the registry-level subscribers
            // (SSE), not a per-agent channel.
            status_tx: self.status_tx.clone(),
            sink: Arc::clone(&self.sink),
        })
    }

    fn handle(&self, agent_id: &str) -> Option<Arc<AgentHandle>> {
        self.handles
            .read()
            .ok()
            .and_then(|handles| handles.get(agent_id).cloned())
    }

    fn handles(&self) -> Vec<Arc<AgentHandle>> {
        self.handles
            .read()
            .map(|handles| handles.values().cloned().collect())
            .unwrap_or_default()
    }

    // ------------------------------------------------------------------
    // Read API
    // ------------------------------------------------------------------

    pub fn get_status(&self) -> Vec<AgentStatusInfo> {
        self.handles().iter().map(|handle| handle.snapshot()).collect()
    }

    pub fn get_agent_config(&self, agent_id: &str) -> Option<AgentConfig> {
        self.handle(agent_id).map(|handle| handle.config())
    }

    pub fn subscribe_status(&self) -> broadcast::Receiver<AgentStatusInfo> {
        self.status_tx.subscribe()
    }

    pub fn subscribe_removed(&self) -> broadcast::Receiver<String> {
        self.removed_tx.subscribe()
    }

    pub fn len(&self) -> usize {
        self.handles.read().map(|handles| handles.len()).unwrap_or(0)
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    // ------------------------------------------------------------------
    // Warmup / connections
    // ------------------------------------------------------------------

    /// Probe + connect every known agent in parallel (server startup).
    pub async fn warmup_all(self: &Arc<Self>) {
        let ids: Vec<String> = self.handles().iter().map(|h| h.config().id).collect();
        if ids.is_empty() {
            return;
        }
        tracing::info!("[AgentRegistry] warming up {} agents in parallel", ids.len());

        let mut tasks = Vec::new();
        for id in ids {
            let registry = Arc::clone(self);
            tasks.push(tokio::spawn(async move {
                registry.warmup_one(&id).await;
            }));
        }
        for task in tasks {
            let _ = task.await;
        }

        let summary: Vec<String> = self
            .get_status()
            .iter()
            .map(|agent| format!("{}={:?}", agent.config.id, agent.status))
            .collect();
        tracing::info!("[AgentRegistry] warmup finished: {}", summary.join(", "));
    }

    async fn warmup_one(self: &Arc<Self>, agent_id: &str) {
        let Some(handle) = self.handle(agent_id) else {
            return;
        };
        let config = handle.config();
        let probe = probe_command(&config).await;

        {
            let mut info = handle.info.write().expect("agent info poisoned");
            info.installed = Some(probe.installed);
            info.cli_path = probe.cli_path.clone();
            if let Some(version) = probe.version.clone() {
                info.version = Some(version);
            }
            info.last_checked = now_ms();
        }

        if !probe.installed {
            if handle.is_connected().await {
                handle.set_status(AgentRuntimeStatus::Connected, None);
            } else {
                handle.set_status(
                    AgentRuntimeStatus::Unavailable,
                    Some(
                        probe
                            .error
                            .clone()
                            .unwrap_or_else(|| missing_hint(&config.command)),
                    ),
                );
            }
            return;
        }

        if handle.is_connected().await {
            handle.set_status(AgentRuntimeStatus::Connected, None);
            return;
        }

        handle.set_status(AgentRuntimeStatus::Available, None);
        match self.ensure_connected(agent_id).await {
            Ok(_) => handle.set_status(AgentRuntimeStatus::Connected, None),
            Err(error) => {
                let status = if handle.info.read().ok().and_then(|i| i.installed) == Some(false) {
                    AgentRuntimeStatus::Unavailable
                } else {
                    AgentRuntimeStatus::Offline
                };
                handle.set_status(status, Some(error));
            }
        }
    }

    /// Reuse the warm connection, or spawn + initialize on the spot.
    pub async fn ensure_connected(
        self: &Arc<Self>,
        agent_id: &str,
    ) -> Result<Arc<AcpClient>, String> {
        let handle = self
            .handle(agent_id)
            .ok_or_else(|| format!("Unknown agent: {agent_id}"))?;
        self.connect_handle(&handle).await
    }

    /// Same, but for an agent that is not registered (session listing by
    /// command/args/env). The ad-hoc connection is cached per launch config.
    pub async fn ensure_connected_by_command(
        self: &Arc<Self>,
        command: &str,
        args: Option<Vec<String>>,
        env: Option<IndexMap<String, String>>,
    ) -> Result<Arc<AcpClient>, String> {
        let key = format!(
            "{command}|{}|{}",
            serde_json::to_string(&args).unwrap_or_default(),
            serde_json::to_string(&env).unwrap_or_default()
        );

        let handle = {
            let mut adhoc = self.adhoc.write().expect("registry poisoned");
            match adhoc.get(&key) {
                Some(handle) => Arc::clone(handle),
                None => {
                    let handle = self.build_handle(AgentConfig {
                        id: format!("adhoc:{command}"),
                        name: command.to_string(),
                        command: command.to_string(),
                        args,
                        env,
                        ..Default::default()
                    });
                    adhoc.insert(key, Arc::clone(&handle));
                    handle
                }
            }
        };

        self.connect_handle(&handle).await
    }

    async fn connect_handle(
        self: &Arc<Self>,
        handle: &Arc<AgentHandle>,
    ) -> Result<Arc<AcpClient>, String> {
        // Per-agent lock: concurrent callers queue here, so only one process
        // is ever spawned.
        let mut slot = handle.connection.lock().await;
        if let Some(client) = slot.as_ref()
            && client.is_connected().await
        {
            return Ok(Arc::clone(client));
        }

        let config = handle.config();
        let agent_id = config.id.clone();
        let client = AcpClient::new(
            format!("agent:{agent_id}"),
            AgentLaunchConfig::from_config(&config),
            Arc::clone(&handle.sink),
        );

        // Track transitions driven by the connection itself.
        let mut state_rx = client.subscribe_state();
        let listener_handle = Arc::clone(handle);
        let listener_client = Arc::clone(&client);
        tokio::spawn(async move {
            while let Ok(connected) = state_rx.recv().await {
                listener_handle.apply_connection_state(&listener_client, connected);
            }
        });

        *slot = Some(Arc::clone(&client));
        drop(slot);

        let needs_available = handle
            .info
            .read()
            .map(|info| {
                info.status == AgentRuntimeStatus::Unknown && info.installed != Some(false)
            })
            .unwrap_or(false);
        if needs_available {
            handle.set_status(AgentRuntimeStatus::Available, None);
        }

        match client.connect(ConnectParams::default()).await {
            Ok(()) => {
                handle.set_status(AgentRuntimeStatus::Connected, None);
                Ok(client)
            }
            Err(error) => {
                let status = if handle.info.read().ok().and_then(|info| info.installed)
                    == Some(false)
                {
                    AgentRuntimeStatus::Unavailable
                } else {
                    AgentRuntimeStatus::Offline
                };
                handle.set_status(status, Some(error.to_string()));
                Err(error.to_string())
            }
        }
    }

    /// Check Now: re-probe and try to reach `connected`.
    pub async fn check_now(self: &Arc<Self>, agent_id: &str) -> Result<AgentStatusInfo, String> {
        let handle = self
            .handle(agent_id)
            .ok_or_else(|| format!("Unknown agent: {agent_id}"))?;

        let _guard = handle.check_lock.lock().await;
        invalidate_agent_command_cache();
        self.warmup_one(agent_id).await;
        Ok(handle.snapshot())
    }

    // ------------------------------------------------------------------
    // Mutation (Settings)
    // ------------------------------------------------------------------

    /// Register a new agent (after install) and probe it immediately.
    pub async fn add_config(self: &Arc<Self>, config: AgentConfig) -> bool {
        if self.handle(&config.id).is_some() {
            return false;
        }

        let handle = self.build_handle(config.clone());
        if let Ok(mut handles) = self.handles.write() {
            handles.insert(config.id.clone(), Arc::clone(&handle));
        }

        let probe = probe_command(&config).await;
        {
            let mut info = handle.info.write().expect("agent info poisoned");
            info.installed = Some(probe.installed);
            info.cli_path = probe.cli_path.clone();
            if let Some(version) = probe.version {
                info.version = Some(version);
            }
            info.last_checked = now_ms();
            info.status = if probe.installed {
                AgentRuntimeStatus::Available
            } else {
                AgentRuntimeStatus::Unavailable
            };
            info.error = Some(
                probe
                    .error
                    .unwrap_or_else(|| missing_hint(&config.command)),
            );
        }
        handle.emit();
        true
    }

    /// Remove an agent (uninstall). Stops the process first so Windows can
    /// delete the install directory afterwards.
    pub async fn remove_config(&self, agent_id: &str) -> bool {
        let handle = match self.handle(agent_id) {
            Some(handle) => handle,
            None => return false,
        };

        let connection = handle.connection.lock().await.take();
        if let Some(client) = connection {
            client
                .disconnect_and_wait(Duration::from_secs(8))
                .await;
        }

        if let Ok(mut handles) = self.handles.write() {
            handles.shift_remove(agent_id);
        }
        let _ = self.removed_tx.send(agent_id.to_string());
        true
    }

    /// Tear every connection down (server shutdown).
    pub async fn destroy(&self) {
        for handle in self.handles() {
            let connection = handle.connection.lock().await.take();
            if let Some(client) = connection {
                client.disconnect().await;
            }
            let status = {
                let info = handle.info.read().expect("agent info poisoned");
                match info.installed {
                    Some(false) => AgentRuntimeStatus::Unavailable,
                    Some(true) => AgentRuntimeStatus::Offline,
                    None => AgentRuntimeStatus::Unknown,
                }
            };
            handle.set_status(status, None);
        }
    }
}

struct ProbeOutcome {
    installed: bool,
    error: Option<String>,
    cli_path: Option<String>,
    version: Option<String>,
}

async fn probe_command(config: &AgentConfig) -> ProbeOutcome {
    if config.command == "npx" || config.command == "uvx" {
        let package = config.args_vec().into_iter().next().unwrap_or_default();
        if package.is_empty() {
            return ProbeOutcome {
                installed: false,
                error: Some(format!("No package specified for {} agent", config.command)),
                cli_path: None,
                version: None,
            };
        }

        let runner_path = probe_path_command(&config.command).await.path;
        let result = probe_package_version(&config.command, &package).await;
        return if result.ok {
            ProbeOutcome {
                installed: true,
                error: None,
                cli_path: runner_path,
                version: result.version,
            }
        } else {
            ProbeOutcome {
                installed: false,
                error: Some(result.error.unwrap_or_else(|| {
                    format!("{} package not runnable: {package}", config.command)
                })),
                cli_path: runner_path,
                version: None,
            }
        };
    }

    let probe = probe_path_command(&config.command).await;
    if !probe.found {
        return ProbeOutcome {
            installed: false,
            error: Some(missing_hint(&config.command)),
            cli_path: None,
            version: None,
        };
    }

    let cli_path = probe.path;
    let version = match cli_path.as_deref() {
        Some(path) => probe_agent_version(path).await,
        None => None,
    };

    ProbeOutcome {
        installed: true,
        error: None,
        cli_path,
        version,
    }
}

fn missing_hint(command: &str) -> String {
    format!("Command not found in PATH: {command}")
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

/// Start time helper used by tests to bound waits.
pub fn elapsed(start: std::time::Instant) -> Duration {
    start.elapsed()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::{Path, PathBuf};

    fn temp_dir(tag: &str) -> PathBuf {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("target")
            .join("test-tmp")
            .join(format!(
                "clover-registry-p4-{tag}-{}",
                uuid::Uuid::new_v4().simple()
            ));
        std::fs::create_dir_all(&path).expect("create temp dir");
        path
    }

    fn agent(id: &str, command: &str, args: Option<Vec<String>>) -> AgentConfig {
        AgentConfig {
            id: id.to_string(),
            name: id.to_string(),
            command: command.to_string(),
            args,
            ..Default::default()
        }
    }

    #[tokio::test]
    async fn lists_agents_with_unknown_status_before_probe() {
        let registry = AgentRegistry::new(
            vec![agent("codex", "codex-acp", None)],
            Arc::new(EventSink::default()),
        );
        let status = registry.get_status();
        assert_eq!(status.len(), 1);
        assert_eq!(status[0].status, AgentRuntimeStatus::Unknown);
        assert_eq!(status[0].config.id, "codex");
        assert_eq!(status[0].last_checked, 0);
    }

    #[tokio::test]
    async fn unknown_agents_report_a_clear_error() {
        let registry = AgentRegistry::new(vec![], Arc::new(EventSink::default()));
        let error = registry.ensure_connected("missing").await.unwrap_err();
        assert_eq!(error, "Unknown agent: missing");
        let error = registry.check_now("missing").await.unwrap_err();
        assert_eq!(error, "Unknown agent: missing");
    }

    #[tokio::test]
    async fn missing_command_becomes_unavailable() {
        let registry = AgentRegistry::new(
            vec![agent("ghost", "clover-definitely-missing-binary", None)],
            Arc::new(EventSink::default()),
        );
        let status = registry.check_now("ghost").await.expect("checked");
        assert_eq!(status.status, AgentRuntimeStatus::Unavailable);
        assert_eq!(status.config.installed, Some(false));
        assert!(
            status.error.unwrap_or_default().contains("Command not found"),
            "unexpected error"
        );
    }

    #[tokio::test]
    async fn status_changes_are_broadcast() {
        let registry = AgentRegistry::new(
            vec![agent("ghost", "clover-definitely-missing-binary", None)],
            Arc::new(EventSink::default()),
        );
        let mut rx = registry.subscribe_status();
        registry.check_now("ghost").await.expect("checked");

        let mut saw_unavailable = false;
        while let Ok(event) = tokio::time::timeout(Duration::from_millis(500), rx.recv()).await {
            let Ok(event) = event else { break };
            if event.status == AgentRuntimeStatus::Unavailable {
                saw_unavailable = true;
                break;
            }
        }
        assert!(saw_unavailable, "expected an unavailable status event");
    }

    #[tokio::test]
    async fn add_and_remove_agents() {
        let dir = temp_dir("crud");
        let registry = AgentRegistry::new(vec![], Arc::new(EventSink::default()));

        assert!(
            registry
                .add_config(agent("ghost", "clover-definitely-missing-binary", None))
                .await
        );
        assert_eq!(registry.len(), 1);
        // Duplicate ids are rejected.
        assert!(
            !registry
                .add_config(agent("ghost", "clover-definitely-missing-binary", None))
                .await
        );

        assert!(registry.get_agent_config("ghost").is_some());
        assert!(registry.remove_config("ghost").await);
        assert!(registry.get_agent_config("ghost").is_none());
        assert!(!registry.remove_config("ghost").await);

        let _ = std::fs::remove_dir_all(&dir);
    }
}