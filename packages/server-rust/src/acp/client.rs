//! ACP client: one agent process + one JSON-RPC connection, many sessions.
//!
//! Port of the connection layer of
//! `packages/server/src/acp/sse-client.ts` (session operations live in the
//! session manager, added in P5):
//!
//! - spawn + `initialize` (30 s bound), with a serialized connect path so a
//!   burst of callers can never spawn two processes;
//! - connection generation: every connect or loss bumps it, which invalidates
//!   session bindings established on the previous connection;
//! - `session/update` notifications are appended to the session's event stream;
//! - `session/request_permission` is forwarded to the session stream and
//!   answered by the frontend (5-minute ceiling).

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

use async_trait::async_trait;
use indexmap::IndexMap;
use serde_json::{json, Value};
use tokio::sync::{broadcast, oneshot};

use crate::acp::process::{spawn_agent, AgentProcess};
use crate::acp::rpc::{JsonRpc, RpcError, RpcHandler};
use crate::acp::types::AgentLaunchConfig;
use crate::events::{EventSink, PERMISSION_TIMEOUT};

/// ACP protocol version sent in `initialize`.
pub const PROTOCOL_VERSION: u32 = 1;
const INITIALIZE_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Default)]
pub struct ConnectParams {
    pub command: Option<String>,
    pub args: Option<Vec<String>>,
    pub env: Option<IndexMap<String, String>>,
}

struct PendingPermission {
    sender: oneshot::Sender<Value>,
    session_id: Option<String>,
}

pub struct AcpClient {
    log_id: String,
    config: AgentLaunchConfig,
    sink: Arc<EventSink>,

    connection: tokio::sync::RwLock<Option<Arc<JsonRpc>>>,
    process: tokio::sync::Mutex<Option<Arc<AgentProcess>>>,
    connect_lock: tokio::sync::Mutex<()>,

    generation: AtomicU64,
    agent_info: RwLock<Option<Value>>,
    capabilities: RwLock<Option<Value>>,
    config_options: RwLock<Option<Vec<Value>>>,
    available_commands: RwLock<Vec<Value>>,
    pending_permissions: Arc<Mutex<HashMap<String, PendingPermission>>>,
    /// ACP sessions with a prompt currently in flight.
    in_flight_prompts: Mutex<std::collections::HashSet<String>>,
    state_tx: broadcast::Sender<bool>,
    notified_connected: AtomicBool,
}

impl std::fmt::Debug for AcpClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AcpClient")
            .field("log_id", &self.log_id)
            .field("generation", &self.generation.load(Ordering::SeqCst))
            .finish_non_exhaustive()
    }
}

impl AcpClient {
    pub fn new(
        log_id: impl Into<String>,
        config: AgentLaunchConfig,
        sink: Arc<EventSink>,
    ) -> Arc<Self> {
        let (state_tx, _) = broadcast::channel(32);
        Arc::new(Self {
            log_id: log_id.into(),
            config,
            sink,
            connection: tokio::sync::RwLock::new(None),
            process: tokio::sync::Mutex::new(None),
            connect_lock: tokio::sync::Mutex::new(()),
            generation: AtomicU64::new(0),
            agent_info: RwLock::new(None),
            capabilities: RwLock::new(None),
            config_options: RwLock::new(None),
            available_commands: RwLock::new(Vec::new()),
            pending_permissions: Arc::new(Mutex::new(HashMap::new())),
            in_flight_prompts: Mutex::new(std::collections::HashSet::new()),
            state_tx,
            notified_connected: AtomicBool::new(false),
        })
    }

    pub fn log_id(&self) -> &str {
        &self.log_id
    }

    /// Subscribe to connection state changes (`true` = initialized).
    pub fn subscribe_state(&self) -> broadcast::Receiver<bool> {
        self.state_tx.subscribe()
    }

    pub fn generation(&self) -> u64 {
        self.generation.load(Ordering::SeqCst)
    }

    pub fn agent_info(&self) -> Option<Value> {
        self.agent_info.read().ok().and_then(|value| value.clone())
    }

    pub fn capabilities(&self) -> Option<Value> {
        self.capabilities.read().ok().and_then(|value| value.clone())
    }

    pub fn config_options(&self) -> Option<Vec<Value>> {
        self.config_options
            .read()
            .ok()
            .and_then(|value| value.clone())
    }

    pub fn available_commands(&self) -> Vec<Value> {
        self.available_commands
            .read()
            .map(|value| value.clone())
            .unwrap_or_default()
    }

    /// Spawn (if needed) and `initialize` the agent.
    pub async fn connect(self: &Arc<Self>, params: ConnectParams) -> Result<(), RpcError> {
        let _guard = self.connect_lock.lock().await;

        let command = params
            .command
            .or_else(|| self.config.command.clone())
            .ok_or_else(|| RpcError::Agent("No agent command configured".to_string()))?;
        let args = params
            .args
            .or_else(|| self.config.args.clone())
            .unwrap_or_default();
        let env = params.env.or_else(|| self.config.env.clone());

        self.shutdown_current().await;

        let spawned = spawn_agent(&self.log_id, &command, &args, env.as_ref())
            .await
            .map_err(|error| RpcError::Io(error.to_string()))?;
        let process = Arc::new(spawned.process);

        let handler: Arc<dyn RpcHandler> = Arc::clone(self) as Arc<dyn RpcHandler>;
        let rpc = JsonRpc::start(spawned.stdout, spawned.stdin, handler);

        let initialize = json!({
            "protocolVersion": PROTOCOL_VERSION,
            "clientInfo": {
                "name": "clover-agent-sse",
                "version": "1.0.0",
            },
            "clientCapabilities": {
                "fs": { "readTextFile": true, "writeTextFile": true },
            },
        });

        let result = match rpc
            .request_with_timeout("initialize", initialize, Some(INITIALIZE_TIMEOUT))
            .await
        {
            Ok(result) => result,
            Err(error) => {
                tracing::error!("[ACP Client] {0}: initialize failed: {error}", self.log_id);
                rpc.close();
                process.kill().await;
                return Err(error);
            }
        };

        *self.connection.write().await = Some(Arc::clone(&rpc));
        *self.process.lock().await = Some(Arc::clone(&process));

        if let Ok(mut info) = self.agent_info.write() {
            *info = result.get("agentInfo").cloned();
        }
        if let Ok(mut capabilities) = self.capabilities.write() {
            *capabilities = result.get("agentCapabilities").cloned();
        }

        self.generation.fetch_add(1, Ordering::SeqCst);
        self.notified_connected.store(true, Ordering::SeqCst);
        let _ = self.state_tx.send(true);
        tracing::info!("[ACP Client] {}: agent initialized", self.log_id);

        // Watch for process exit; only the connection that is still current may
        // transition the client to "lost".
        let watcher = Arc::clone(self);
        let watched_rpc = Arc::clone(&rpc);
        tokio::spawn(async move {
            process.wait_for_exit(None).await;
            let current = watcher.connection.read().await.clone();
            if let Some(current) = current
                && Arc::ptr_eq(&current, &watched_rpc)
            {
                watcher.handle_connection_lost().await;
            }
        });

        Ok(())
    }

    /// Live connection (agent process running, pipe open).
    pub async fn is_connected(&self) -> bool {
        let connection = self.connection.read().await.clone();
        let Some(connection) = connection else {
            return false;
        };
        if connection.is_closed() {
            return false;
        }
        let process = self.process.lock().await.clone();
        match process {
            Some(process) => process.is_running().await,
            None => false,
        }
    }

    /// Send a request over the live connection.
    pub async fn request(&self, method: &str, params: Value) -> Result<Value, RpcError> {
        let connection = self.connection.read().await.clone();
        match connection {
            Some(connection) => connection.request(method, params).await,
            None => Err(RpcError::Closed),
        }
    }

    /// Fire-and-forget notification.
    pub async fn notify(&self, method: &str, params: Value) -> Result<(), RpcError> {
        let connection = self.connection.read().await.clone();
        match connection {
            Some(connection) => connection.notify(method, params).await,
            None => Err(RpcError::Closed),
        }
    }

    /// Answer a pending permission request.
    pub fn handle_permission_response(&self, request_id: &str, outcome: Value) {
        let pending = self
            .pending_permissions
            .lock()
            .ok()
            .and_then(|mut pending| pending.remove(request_id));
        match pending {
            Some(pending) => {
                let _ = pending.sender.send(outcome);
            }
            None => tracing::warn!(
                "[ACP Client] {}: unknown permission response {request_id}",
                self.log_id
            ),
        }
    }

    /// Cancel pending permissions (optionally scoped to one session).
    pub fn cancel_pending_permissions(&self, session_id: Option<&str>) {
        let drained: Vec<PendingPermission> = {
            let Ok(mut pending) = self.pending_permissions.lock() else {
                return;
            };
            let ids: Vec<String> = pending
                .iter()
                .filter(|(_, entry)| match session_id {
                    Some(session) => entry.session_id.as_deref() == Some(session),
                    None => true,
                })
                .map(|(id, _)| id.clone())
                .collect();
            ids.into_iter()
                .filter_map(|id| pending.remove(&id))
                .collect()
        };
        for entry in drained {
            let _ = entry.sender.send(json!({ "outcome": "cancelled" }));
        }
    }

    async fn handle_connection_lost(&self) {
        tracing::info!(
            "[ACP Client] {}: connection lost",
            self.log_id
        );
        if let Ok(mut info) = self.agent_info.write() {
            *info = None;
        }
        if let Ok(mut capabilities) = self.capabilities.write() {
            *capabilities = None;
        }
        self.generation.fetch_add(1, Ordering::SeqCst);
        if self.notified_connected.swap(false, Ordering::SeqCst) {
            let _ = self.state_tx.send(false);
        }
        self.cancel_pending_permissions(None);
    }

    /// Tear down the current connection + process (used before reconnecting).
    async fn shutdown_current(&self) {
        self.cancel_pending_permissions(None);

        if let Some(connection) = self.connection.write().await.take() {
            connection.close();
        }
        let process = self.process.lock().await.take();
        if let Some(process) = process {
            process.kill().await;
        }
        if let Ok(mut info) = self.agent_info.write() {
            *info = None;
        }
        if let Ok(mut capabilities) = self.capabilities.write() {
            *capabilities = None;
        }
    }

    /// Full teardown.
    pub async fn disconnect(&self) {
        self.shutdown_current().await;
        if self.notified_connected.swap(false, Ordering::SeqCst) {
            let _ = self.state_tx.send(false);
        }
        self.generation.fetch_add(1, Ordering::SeqCst);
    }

    /// Teardown that waits for the process to actually exit (uninstall needs
    /// this on Windows where the executable stays locked while running).
    pub async fn disconnect_and_wait(&self, timeout: Duration) {
        let process = self.process.lock().await.clone();
        self.disconnect().await;
        if let Some(process) = process {
            process.wait_for_exit(Some(timeout)).await;
        }
    }

    fn publish_to_session(&self, session_id: &str, event: Value) {
        self.sink.append(session_id, event);
    }

    // ======================================================================
    // Session operations (frontend → agent), all keyed by ACP session id
    // ======================================================================

    /// Create a new ACP session on this connection.
    pub async fn create_session(&self, cwd: &str, mcp_servers: Value) -> Result<Value, RpcError> {
        if cwd.trim().is_empty() {
            return Err(RpcError::Agent(
                "cwd is required to create an ACP session".to_string(),
            ));
        }

        let result = self
            .request(
                "session/new",
                json!({ "cwd": cwd, "mcpServers": mcp_servers }),
            )
            .await?;

        let mut map = match result {
            Value::Object(map) => map,
            _ => serde_json::Map::new(),
        };
        // Expose the resolved cwd so the frontend can persist accurate records.
        map.insert("cwd".to_string(), json!(cwd));
        // Commands may have arrived as a notification before any SSE existed.
        map.insert(
            "availableCommands".to_string(),
            Value::Array(self.available_commands()),
        );

        Ok(Value::Object(map))
    }

    /// `session/list` (connection-level operation).
    pub async fn list_sessions(
        &self,
        cwd: Option<&str>,
        cursor: Option<&str>,
    ) -> Result<Value, RpcError> {
        self.request(
            "session/list",
            json!({ "cwd": cwd, "cursor": cursor }),
        )
        .await
    }

    /// `session/load` — restores history; updates arrive as notifications.
    pub async fn load_session(
        &self,
        session_id: &str,
        cwd: &str,
        mcp_servers: Value,
    ) -> Result<Value, RpcError> {
        let result = self
            .request(
                "session/load",
                json!({
                    "sessionId": session_id,
                    "cwd": cwd,
                    "mcpServers": mcp_servers,
                }),
            )
            .await?;
        Ok(self.finish_session_response(session_id, result))
    }

    /// `session/resume` — recovery path after a connection loss.
    pub async fn resume_session(
        &self,
        session_id: &str,
        cwd: &str,
        mcp_servers: Value,
    ) -> Result<Value, RpcError> {
        if !self.supports_capability("resume") {
            return Err(RpcError::Agent(
                "Agent does not support session resume; load the previous session from history or start a new one"
                    .to_string(),
            ));
        }

        let result = self
            .request(
                "session/resume",
                json!({
                    "sessionId": session_id,
                    "cwd": cwd,
                    "mcpServers": mcp_servers,
                }),
            )
            .await?;
        Ok(self.finish_session_response(session_id, result))
    }

    /// `session/delete` (agent must advertise the capability).
    pub async fn delete_session(&self, session_id: &str) -> Result<(), RpcError> {
        if !self.supports_capability("delete") {
            return Err(RpcError::Agent(
                "Agent does not support session deletion".to_string(),
            ));
        }
        self.request("session/delete", json!({ "sessionId": session_id }))
            .await?;
        Ok(())
    }

    /// `session/set_config_option`, caching the returned config state.
    pub async fn set_config_option(
        &self,
        session_id: &str,
        config_id: &str,
        value_type: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        let result = self
            .request(
                "session/set_config_option",
                json!({
                    "sessionId": session_id,
                    "configId": config_id,
                    "type": value_type,
                    "value": value,
                }),
            )
            .await?;

        if let Some(options) = result.get("configOptions").and_then(Value::as_array)
            && let Ok(mut cache) = self.config_options.write()
        {
            *cache = Some(options.clone());
        }

        Ok(result)
    }

    /// Send a prompt and wait for the turn to finish.
    pub async fn prompt(&self, session_id: &str, content: Value) -> Result<Value, RpcError> {
        if let Ok(mut prompts) = self.in_flight_prompts.lock() {
            prompts.insert(session_id.to_string());
        }

        let result = self
            .request(
                "session/prompt",
                json!({ "sessionId": session_id, "prompt": content }),
            )
            .await;

        if let Ok(mut prompts) = self.in_flight_prompts.lock() {
            prompts.remove(session_id);
        }

        result
    }

    /// Whether a prompt is currently running for the given ACP session.
    pub fn is_prompting(&self, session_id: &str) -> bool {
        self.in_flight_prompts
            .lock()
            .map(|prompts| prompts.contains(session_id))
            .unwrap_or(false)
    }

    /// Cancel the in-flight prompt of a session.
    pub async fn cancel(&self, session_id: &str) -> Result<(), RpcError> {
        self.cancel_pending_permissions(Some(session_id));
        self.notify("session/cancel", json!({ "sessionId": session_id }))
            .await
    }

    fn supports_capability(&self, capability: &str) -> bool {
        let capabilities = self.capabilities.read().ok().and_then(|value| value.clone());
        capabilities
            .as_ref()
            .and_then(|value| value.get("sessionCapabilities"))
            .and_then(|value| value.get(capability))
            .is_some_and(|value| !value.is_null())
    }

    /// Overlay the cached config state (the agent may return stale values).
    fn finish_session_response(&self, session_id: &str, result: Value) -> Value {
        let mut map = match result {
            Value::Object(map) => map,
            _ => serde_json::Map::new(),
        };
        map.insert("sessionId".to_string(), json!(session_id));

        let cache = self
            .config_options
            .read()
            .ok()
            .and_then(|value| value.clone())
            .unwrap_or_default();
        if !cache.is_empty() {
            let current = map
                .get("configOptions")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            if current.is_empty() {
                map.insert("configOptions".to_string(), Value::Array(cache));
            } else {
                let merged: Vec<Value> = current
                    .into_iter()
                    .map(|option| {
                        let id = option.get("id").and_then(Value::as_str);
                        match id.and_then(|id| {
                            cache
                                .iter()
                                .find(|cached| cached.get("id").and_then(Value::as_str) == Some(id))
                        }) {
                            Some(cached) => cached.clone(),
                            None => option,
                        }
                    })
                    .collect();
                map.insert("configOptions".to_string(), Value::Array(merged));
            }
        }

        map.insert(
            "availableCommands".to_string(),
            Value::Array(self.available_commands()),
        );
        Value::Object(map)
    }
}

#[async_trait]
impl RpcHandler for AcpClient {
    async fn on_notification(&self, method: &str, params: Value) {
        if method != "session/update" {
            tracing::debug!("[ACP Client] {}: notification {method}", self.log_id);
            return;
        }

        let session_id = params
            .get("sessionId")
            .and_then(Value::as_str)
            .map(str::to_string);
        let update = params.get("update");

        if let Some(update) = update {
            match update.get("sessionUpdate").and_then(Value::as_str) {
                Some("config_option_update") => {
                    if let Some(options) = update.get("configOptions").and_then(Value::as_array)
                        && let Ok(mut cache) = self.config_options.write()
                    {
                        *cache = Some(options.clone());
                    }
                }
                Some("available_commands_update") => {
                    if let Some(commands) = update.get("availableCommands").and_then(Value::as_array)
                        && let Ok(mut cache) = self.available_commands.write()
                    {
                        *cache = commands.clone();
                    }
                }
                _ => {}
            }
        }

        match session_id {
            Some(session_id) => {
                self.publish_to_session(
                    &session_id,
                    EventSink::event("session_update", params),
                );
            }
            None => tracing::warn!(
                "[ACP Client] {}: dropped session/update without a session id",
                self.log_id
            ),
        }
    }

    async fn on_request(&self, method: &str, params: Value) -> Result<Value, RpcError> {
        match method {
            "session/request_permission" => Ok(self.handle_permission_request(params).await),
            "fs/read_text_file" => {
                let path = params
                    .get("path")
                    .and_then(|value| value.as_str())
                    .unwrap_or("-");
                tracing::info!("[ACP Client] {}: fs/read_text_file {path}", self.log_id);
                Ok(json!({ "content": "" }))
            }
            "fs/write_text_file" => {
                let path = params
                    .get("path")
                    .and_then(|value| value.as_str())
                    .unwrap_or("-");
                tracing::info!("[ACP Client] {}: fs/write_text_file {path}", self.log_id);
                Ok(json!({}))
            }
            other => Err(RpcError::Agent(format!("unsupported agent request: {other}"))),
        }
    }
}

impl AcpClient {
    async fn handle_permission_request(&self, params: Value) -> Value {
        let session_id = params
            .get("sessionId")
            .and_then(Value::as_str)
            .map(str::to_string);

        let Some(session_id) = session_id else {
            tracing::warn!(
                "[ACP Client] {}: permission request without a session id; cancelling",
                self.log_id
            );
            return json!({ "outcome": { "outcome": "cancelled" } });
        };

        let request_id = new_permission_id();
        tracing::info!(
            "[ACP Client] {}: permission requested {request_id} (session: {session_id})",
            self.log_id
        );

        // Register the pending request *before* publishing it: an in-process
        // consumer (CLI, A2A bridge) may answer from inside the event callback,
        // and a response that arrives before registration would be dropped.
        let (tx, rx) = oneshot::channel();
        if let Ok(mut pending) = self.pending_permissions.lock() {
            pending.insert(
                request_id.clone(),
                PendingPermission {
                    sender: tx,
                    session_id: Some(session_id.clone()),
                },
            );
        }

        self.publish_to_session(
            &session_id,
            EventSink::event(
                "permission_request",
                json!({
                    "requestId": request_id,
                    "sessionId": session_id,
                    "options": params.get("options").cloned().unwrap_or(Value::Null),
                    "toolCall": params.get("toolCall").cloned().unwrap_or(Value::Null),
                }),
            ),
        );

        // Ceiling: an unanswered prompt must not hang forever.
        let timeout_id = request_id.clone();
        let pending_map = Arc::clone(&self.pending_permissions);
        tokio::spawn(async move {
            tokio::time::sleep(PERMISSION_TIMEOUT).await;
            let pending = pending_map
                .lock()
                .ok()
                .and_then(|mut pending| pending.remove(&timeout_id));
            if let Some(pending) = pending {
                tracing::info!("[ACP Client] permission request timed out: {timeout_id}");
                let _ = pending.sender.send(json!({ "outcome": "cancelled" }));
            }
        });

        let outcome = rx.await.unwrap_or_else(|_| json!({ "outcome": "cancelled" }));
        tracing::info!(
            "[ACP Client] {}: permission response {request_id}: {outcome}",
            self.log_id
        );
        json!({ "outcome": outcome })
    }
}

fn new_permission_id() -> String {
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let suffix = uuid::Uuid::new_v4().simple().to_string();
    format!("perm_{millis}_{}", &suffix[..8])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn permission_ids_are_unique() {
        let a = new_permission_id();
        let b = new_permission_id();
        assert!(a.starts_with("perm_"));
        assert_ne!(a, b);
    }

    #[tokio::test]
    async fn pending_permissions_are_cancelled() {
        let client = AcpClient::new(
            "test",
            AgentLaunchConfig::default(),
            Arc::new(EventSink::default()),
        );
        let (tx, rx) = oneshot::channel();
        client
            .pending_permissions
            .lock()
            .unwrap()
            .insert(
                "perm_1".to_string(),
                PendingPermission {
                    sender: tx,
                    session_id: Some("s1".to_string()),
                },
            );

        client.cancel_pending_permissions(Some("s1"));
        let outcome = rx.await.expect("outcome");
        assert_eq!(outcome["outcome"], "cancelled");
        assert!(client.pending_permissions.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn disconnect_is_idempotent() {
        let client = AcpClient::new(
            "test",
            AgentLaunchConfig::default(),
            Arc::new(EventSink::default()),
        );
        client.disconnect().await;
        client.disconnect().await;
        assert!(!client.is_connected().await);
    }
}