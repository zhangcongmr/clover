//! ACP session manager.
//!
//! Port of `packages/server/src/acp/session-manager.ts`. It owns the server-side
//! session records (which agent connection hosts a session, cwd, status,
//! binding generation), publishes every event to the session's stream, and maps
//! prompt lifecycle transitions to the client-level activity hub.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use indexmap::IndexMap;
use serde_json::{json, Value};

use crate::acp::activity::SessionActivityHub;
use crate::acp::client::AcpClient;
use crate::acp::registry::AgentRegistry;
use crate::events::EventSink;

/// Event types that end the "processing" state.
const PROCESSING_END_EVENTS: [&str; 3] = ["prompt_complete", "error", "cancel_complete"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionStatus {
    Active,
    Idle,
    Disconnected,
}

impl SessionStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            SessionStatus::Active => "active",
            SessionStatus::Idle => "idle",
            SessionStatus::Disconnected => "disconnected",
        }
    }
}

pub struct SessionRecord {
    pub session_id: String,
    pub client: Arc<AcpClient>,
    pub agent_id: Option<String>,
    pub cwd: Option<String>,
    pub created_at: i64,
    pub last_activity: i64,
    pub status: SessionStatus,
    /// Connection generation the session is bound at (`-1` = unbound).
    pub bound_generation: i64,
    listener: Option<tokio::task::JoinHandle<()>>,
    removed: bool,
}

impl SessionRecord {
    fn new(
        session_id: String,
        client: Arc<AcpClient>,
        agent_id: Option<String>,
        cwd: Option<String>,
        bound_generation: i64,
    ) -> Self {
        let now = now_ms();
        Self {
            session_id,
            client,
            agent_id,
            cwd,
            created_at: now,
            last_activity: now,
            // Records are only created right after a successful connect, so
            // "active" is accurate; the connection listener corrects it on loss.
            status: SessionStatus::Active,
            bound_generation,
            listener: None,
            removed: false,
        }
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

#[derive(Debug, Clone, Default)]
pub struct SessionOptions {
    pub agent_id: Option<String>,
    pub cwd: Option<String>,
    /// Resolved MCP servers (`[]` when none).
    pub mcp_servers: Value,
}

pub struct SessionManager {
    records: Mutex<IndexMap<String, Arc<Mutex<SessionRecord>>>>,
    registry: Arc<AgentRegistry>,
    sink: Arc<EventSink>,
    activity: Arc<SessionActivityHub>,
}

impl SessionManager {
    pub fn new(
        registry: Arc<AgentRegistry>,
        sink: Arc<EventSink>,
        activity: Arc<SessionActivityHub>,
    ) -> Arc<Self> {
        Arc::new(Self {
            records: Mutex::new(IndexMap::new()),
            registry,
            sink,
            activity,
        })
    }

    fn record(&self, session_id: &str) -> Option<Arc<Mutex<SessionRecord>>> {
        self.records
            .lock()
            .ok()
            .and_then(|records| records.get(session_id).cloned())
    }

    fn records(&self) -> Vec<Arc<Mutex<SessionRecord>>> {
        self.records
            .lock()
            .map(|records| records.values().cloned().collect())
            .unwrap_or_default()
    }

    // ------------------------------------------------------------------
    // Records
    // ------------------------------------------------------------------

    fn register(
        self: &Arc<Self>,
        session_id: &str,
        client: Arc<AcpClient>,
        agent_id: Option<String>,
        cwd: Option<String>,
        bound_generation: i64,
    ) -> Arc<Mutex<SessionRecord>> {
        // Same id already tracked: drop the stale record first.
        if self.record(session_id).is_some() {
            self.remove_session(session_id);
        }

        let record = Arc::new(Mutex::new(SessionRecord::new(
            session_id.to_string(),
            Arc::clone(&client),
            agent_id,
            cwd,
            bound_generation,
        )));

        self.attach_listener(&record, &client);

        if let Ok(mut records) = self.records.lock() {
            records.insert(session_id.to_string(), Arc::clone(&record));
            tracing::info!(
                "[ACP Session] registered {session_id} (total: {})",
                records.len()
            );
        }

        record
    }

    /// Subscribe to the connection's state transitions for one record.
    fn attach_listener(self: &Arc<Self>, record: &Arc<Mutex<SessionRecord>>, client: &Arc<AcpClient>) {
        // Stop the previous listener (rebind).
        if let Ok(mut guard) = record.lock()
            && let Some(listener) = guard.listener.take()
        {
            listener.abort();
        }

        let mut state_rx = client.subscribe_state();
        let listener_record = Arc::clone(record);
        let listener_client = Arc::clone(client);
        let sink = Arc::clone(&self.sink);

        let task = tokio::spawn(async move {
            while let Ok(connected) = state_rx.recv().await {
                let session_id = {
                    let Ok(mut guard) = listener_record.lock() else {
                        break;
                    };
                    if guard.removed {
                        break;
                    }
                    guard.status = if connected {
                        SessionStatus::Active
                    } else {
                        SessionStatus::Disconnected
                    };
                    if !connected {
                        guard.bound_generation = -1;
                    }
                    guard.last_activity = now_ms();
                    guard.session_id.clone()
                };

                sink.append(
                    &session_id,
                    EventSink::event(
                        "status",
                        json!({
                            "connected": connected,
                            "agentInfo": listener_client.agent_info(),
                            "capabilities": listener_client.capabilities(),
                        }),
                    ),
                );
            }
        });

        if let Ok(mut guard) = record.lock() {
            guard.listener = Some(task);
        }
    }

    fn set_bound(&self, record: &Arc<Mutex<SessionRecord>>, client: &Arc<AcpClient>) {
        if let Ok(mut guard) = record.lock() {
            guard.client = Arc::clone(client);
            guard.bound_generation = -1;
            guard.status = SessionStatus::Active;
            guard.last_activity = now_ms();
        }
    }

    /// Whether the session is hosted on a live connection.
    async fn ensure_connected(self: &Arc<Self>, record: &Arc<Mutex<SessionRecord>>) -> Result<Arc<AcpClient>, String> {
        let (client, agent_id) = {
            let Ok(guard) = record.lock() else {
                return Err("session record poisoned".to_string());
            };
            (Arc::clone(&guard.client), guard.agent_id.clone())
        };

        if client.is_connected().await {
            return Ok(client);
        }

        let agent_id = agent_id.ok_or_else(|| "Unknown agent for session".to_string())?;
        let client = self.registry.ensure_connected(&agent_id).await?;
        self.attach_listener(record, &client);
        self.set_bound(record, &client);
        Ok(client)
    }

    // ------------------------------------------------------------------
    // Session operations
    // ------------------------------------------------------------------

    /// `session/create`: spawn/reuse a connection and create the ACP session.
    pub async fn create(
        self: &Arc<Self>,
        agent_id: &str,
        cwd: String,
        mcp_servers: Value,
    ) -> Result<Value, String> {
        self.registry
            .get_agent_config(agent_id)
            .ok_or_else(|| format!("Unknown agent: {agent_id}"))?;

        let client = self.registry.ensure_connected(agent_id).await?;
        let result = client
            .create_session(&cwd, mcp_servers)
            .await
            .map_err(|error| error.to_string())?;

        let session_id = result
            .get("sessionId")
            .and_then(Value::as_str)
            .ok_or_else(|| "agent did not return a sessionId".to_string())?
            .to_string();

        let resolved_cwd = result
            .get("cwd")
            .and_then(Value::as_str)
            .map(str::to_string)
            .or(Some(cwd));

        self.register(
            &session_id,
            Arc::clone(&client),
            Some(agent_id.to_string()),
            resolved_cwd,
            client.generation() as i64,
        );

        Ok(result)
    }

    /// Create (or refresh) a record without contacting the agent.
    pub async fn ensure_record(
        self: &Arc<Self>,
        session_id: &str,
        agent_id: Option<&str>,
    ) -> Result<Arc<Mutex<SessionRecord>>, String> {
        if let Some(record) = self.record(session_id) {
            return Ok(record);
        }

        let agent_id = agent_id
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "agentId is required".to_string())?;
        self.registry
            .get_agent_config(agent_id)
            .ok_or_else(|| format!("Unknown agent: {agent_id}"))?;

        let client = self.registry.ensure_connected(agent_id).await?;
        Ok(self.register(
            session_id,
            client,
            Some(agent_id.to_string()),
            None,
            -1,
        ))
    }

    pub async fn load(
        self: &Arc<Self>,
        session_id: &str,
        options: SessionOptions,
    ) -> Result<Value, String> {
        let record = match self.record(session_id) {
            Some(record) => record,
            None => self
                .ensure_record(session_id, options.agent_id.as_deref())
                .await?,
        };

        let result = async {
            let client = self.ensure_connected(&record).await?;
            let cwd = options
                .cwd
                .clone()
                .or_else(|| record.lock().ok().and_then(|guard| guard.cwd.clone()))
                .unwrap_or_else(|| {
                    std::env::current_dir()
                        .map(|path| path.to_string_lossy().to_string())
                        .unwrap_or_else(|_| ".".to_string())
                });

            let result = client
                .load_session(session_id, &cwd, options.mcp_servers.clone())
                .await
                .map_err(|error| error.to_string())?;

            if let Ok(mut guard) = record.lock() {
                guard.cwd = Some(cwd);
                guard.last_activity = now_ms();
                guard.bound_generation = client.generation() as i64;
            }

            self.publish_replay_complete(session_id, "session_loaded")
                .await;
            Ok::<Value, String>(with_prompting(result, client.is_prompting(session_id)))
        }
        .await;

        if result.is_err()
            && let Ok(mut guard) = record.lock()
        {
            guard.bound_generation = -1;
        }
        result
    }

    pub async fn resume(
        self: &Arc<Self>,
        session_id: &str,
        options: SessionOptions,
    ) -> Result<Value, String> {
        let record = match self.record(session_id) {
            Some(record) => record,
            None => self
                .ensure_record(session_id, options.agent_id.as_deref())
                .await?,
        };

        let result = async {
            let client = self.ensure_connected(&record).await?;
            let cwd = options
                .cwd
                .clone()
                .or_else(|| record.lock().ok().and_then(|guard| guard.cwd.clone()))
                .unwrap_or_else(|| {
                    std::env::current_dir()
                        .map(|path| path.to_string_lossy().to_string())
                        .unwrap_or_else(|_| ".".to_string())
                });

            let result = client
                .resume_session(session_id, &cwd, options.mcp_servers.clone())
                .await
                .map_err(|error| error.to_string())?;

            if let Ok(mut guard) = record.lock() {
                guard.cwd = Some(cwd);
                guard.last_activity = now_ms();
                guard.bound_generation = client.generation() as i64;
            }

            self.publish_replay_complete(session_id, "session_resumed")
                .await;
            Ok::<Value, String>(with_prompting(result, client.is_prompting(session_id)))
        }
        .await;

        if result.is_err()
            && let Ok(mut guard) = record.lock()
        {
            guard.bound_generation = -1;
        }
        result
    }

    /// `POST /api/acp/session/delete`: delete on the agent, then drop the record.
    pub async fn delete(
        self: &Arc<Self>,
        session_id: &str,
        agent_id: Option<&str>,
    ) -> Result<(), String> {
        if let Some(record) = self.record(session_id) {
            let client = {
                let Ok(guard) = record.lock() else {
                    return Err("session record poisoned".to_string());
                };
                Arc::clone(&guard.client)
            };
            client
                .delete_session(session_id)
                .await
                .map_err(|error| error.to_string())?;
            self.remove_session(session_id);
            return Ok(());
        }

        let agent_id = agent_id.ok_or_else(|| "agentId is required".to_string())?;
        self.registry
            .get_agent_config(agent_id)
            .ok_or_else(|| format!("Unknown agent: {agent_id}"))?;
        let client = self.registry.ensure_connected(agent_id).await?;
        client
            .delete_session(session_id)
            .await
            .map_err(|error| error.to_string())
    }

    pub async fn set_config(
        &self,
        session_id: &str,
        config_id: &str,
        value_type: &str,
        value: Value,
    ) -> Result<Value, String> {
        let record = self
            .record(session_id)
            .ok_or_else(|| format!("Session {session_id} not found"))?;
        let client = {
            let Ok(guard) = record.lock() else {
                return Err("session record poisoned".to_string());
            };
            Arc::clone(&guard.client)
        };

        let result = client
            .set_config_option(session_id, config_id, value_type, value)
            .await
            .map_err(|error| error.to_string())?;

        if let Ok(mut guard) = record.lock() {
            guard.last_activity = now_ms();
        }
        Ok(result)
    }

    pub async fn list(
        self: &Arc<Self>,
        agent_id: &str,
        cwd: Option<&str>,
        cursor: Option<&str>,
    ) -> Result<Value, String> {
        self.registry
            .get_agent_config(agent_id)
            .ok_or_else(|| format!("Unknown agent: {agent_id}"))?;
        let client = self.registry.ensure_connected(agent_id).await?;
        client
            .list_sessions(cwd, cursor)
            .await
            .map_err(|error| error.to_string())
    }

    /// `list-all-sessions`: list via an ad-hoc connection per launch config.
    pub async fn list_for_command(
        self: &Arc<Self>,
        command: &str,
        args: Option<Vec<String>>,
        env: Option<indexmap::IndexMap<String, String>>,
        cwd: &str,
    ) -> Result<Value, String> {
        let client = self
            .registry
            .ensure_connected_by_command(command, args, env)
            .await?;
        client
            .list_sessions(Some(cwd), None)
            .await
            .map_err(|error| error.to_string())
    }

    // ------------------------------------------------------------------
    // Commands (fire and forget)
    // ------------------------------------------------------------------

    /// Dispatch a prompt; the result arrives through the session event stream.
    pub fn dispatch_prompt(self: &Arc<Self>, session_id: &str, content: Value, request_id: String) {
        let Some(record) = self.record(session_id) else {
            tracing::warn!("[ACP Session] dropped prompt for unknown session: {session_id}");
            return;
        };

        let manager = Arc::clone(self);
        let session_id = session_id.to_string();
        tokio::spawn(async move {
            let client = {
                let Ok(guard) = record.lock() else { return };
                Arc::clone(&guard.client)
            };

            manager
                .publish_event(
                    &session_id,
                    EventSink::event(
                        "prompt_processing",
                        json!({ "requestId": request_id.clone() }),
                    ),
                )
                .await;

            match client.prompt(&session_id, content).await {
                Ok(result) => {
                    // `acpSessionId` lets the client ignore late completions
                    // after switching sessions (same contract as the TS server).
                    let payload = with_acp_session_id(result, &session_id);
                    manager
                        .publish_event(&session_id, EventSink::event("prompt_complete", payload))
                        .await;
                }
                Err(error) => {
                    manager
                        .publish_event(
                            &session_id,
                            EventSink::event(
                                "error",
                                json!({
                                    "message": error.to_string(),
                                    "requestId": request_id,
                                    "acpSessionId": session_id,
                                }),
                            ),
                        )
                        .await;
                }
            }

            if let Ok(mut guard) = record.lock() {
                guard.last_activity = now_ms();
            }
        });
    }

    /// Dispatch a cancel (fire and forget, ends with `cancel_complete`).
    pub fn dispatch_cancel(self: &Arc<Self>, session_id: &str) {
        let Some(record) = self.record(session_id) else {
            tracing::warn!("[ACP Session] dropped cancel for unknown session: {session_id}");
            return;
        };

        let manager = Arc::clone(self);
        let session_id = session_id.to_string();
        tokio::spawn(async move {
            let client = {
                let Ok(guard) = record.lock() else { return };
                Arc::clone(&guard.client)
            };
            match client.cancel(&session_id).await {
                Ok(()) => {
                    manager
                        .publish_event(
                            &session_id,
                            EventSink::event("cancel_complete", json!({})),
                        )
                        .await;
                }
                Err(error) => {
                    tracing::error!("[ACP Session] cancel failed ({session_id}): {error}");
                }
            }
        });
    }

    /// Dispatch a permission response to the agent.
    pub fn dispatch_permission_response(&self, session_id: &str, request_id: &str, outcome: Value) {
        let Some(record) = self.record(session_id) else {
            tracing::warn!(
                "[ACP Session] dropped permission response for unknown session: {session_id}"
            );
            return;
        };
        let client = match record.lock() {
            Ok(guard) => Arc::clone(&guard.client),
            Err(_) => return,
        };
        client.handle_permission_response(request_id, outcome);
    }

    // ------------------------------------------------------------------
    // Direct prompt (CLI / A2A): wait for the turn to finish
    // ------------------------------------------------------------------

    pub async fn prompt_and_wait(
        self: &Arc<Self>,
        session_id: &str,
        content: Value,
        on_event: Option<Arc<dyn Fn(Value) + Send + Sync>>,
    ) -> Result<Value, String> {
        let record = self
            .record(session_id)
            .ok_or_else(|| format!("Session {session_id} not found"))?;

        self.ensure_agent_session(session_id).await?;

        // Subscribe to the session stream for the duration of the prompt.
        let (_, mut receiver) = self.sink.attach(session_id, None);
        let listener = on_event.map(|on_event| {
            tokio::spawn(async move {
                // Events are delivered in publish order, so a terminal event
                // guarantees every chunk of this turn was already forwarded.
                // Stopping there keeps the listener from living (and firing)
                // past the turn it was created for.
                while let Ok(event) = receiver.recv().await {
                    let terminal = event
                        .get("type")
                        .and_then(Value::as_str)
                        .map(|kind| PROCESSING_END_EVENTS.contains(&kind))
                        .unwrap_or(false);
                    on_event(event);
                    if terminal {
                        break;
                    }
                }
            })
        });

        self.publish_event(session_id, EventSink::event("prompt_processing", json!({})))
            .await;

        let client = {
            let Ok(guard) = record.lock() else {
                return Err("session record poisoned".to_string());
            };
            Arc::clone(&guard.client)
        };

        let result = client.prompt(session_id, content).await;
        if let Ok(mut guard) = record.lock() {
            guard.last_activity = now_ms();
        }

        match result {
            Ok(value) => {
                let payload = with_acp_session_id(value.clone(), session_id);
                self.publish_event(session_id, EventSink::event("prompt_complete", payload))
                    .await;
                drain_listener(listener).await;
                Ok(with_acp_session_id(value, session_id))
            }
            Err(error) => {
                self.publish_event(
                    session_id,
                    EventSink::event("error", json!({ "message": error.to_string() })),
                )
                .await;
                drain_listener(listener).await;
                Err(error.to_string())
            }
        }
    }

    /// Ensure the connection is live and the session is bound on it.
    pub async fn ensure_agent_session(self: &Arc<Self>, session_id: &str) -> Result<(), String> {
        let record = self
            .record(session_id)
            .ok_or_else(|| format!("Session {session_id} not found"))?;
        let client = self.ensure_connected(&record).await?;

        let bound = record
            .lock()
            .map(|guard| guard.bound_generation)
            .unwrap_or(-1);
        if bound == client.generation() as i64 {
            return Ok(());
        }

        let cwd = record
            .lock()
            .ok()
            .and_then(|guard| guard.cwd.clone())
            .unwrap_or_else(|| {
                std::env::current_dir()
                    .map(|path| path.to_string_lossy().to_string())
                    .unwrap_or_else(|_| ".".to_string())
            });

        client
            .resume_session(session_id, &cwd, json!([]))
            .await
            .map_err(|error| error.to_string())?;

        if let Ok(mut guard) = record.lock() {
            guard.bound_generation = client.generation() as i64;
            guard.last_activity = now_ms();
            guard.status = SessionStatus::Active;
        }
        Ok(())
    }

    // ------------------------------------------------------------------
    // Event publishing / teardown / introspection
    // ------------------------------------------------------------------

    pub async fn publish_event(&self, session_id: &str, event: Value) {
        self.sink.append(session_id, event.clone());

        let event_type = event.get("type").and_then(Value::as_str).unwrap_or("");
        if event_type == "prompt_processing" {
            self.activity.publish(session_id, true);
        } else if PROCESSING_END_EVENTS.contains(&event_type) {
            self.activity.publish(session_id, false);
        }
    }

    async fn publish_replay_complete(&self, session_id: &str, event_type: &str) {
        self.publish_event(
            session_id,
            EventSink::event(event_type, json!({ "sessionId": session_id })),
        )
        .await;
    }

    pub fn remove_session(&self, session_id: &str) {
        let record = self
            .records
            .lock()
            .ok()
            .and_then(|mut records| records.shift_remove(session_id));
        let Some(record) = record else {
            return;
        };

        let (listener, client) = match record.lock() {
            Ok(mut guard) => {
                guard.removed = true;
                (guard.listener.take(), Some(Arc::clone(&guard.client)))
            }
            Err(_) => (None, None),
        };

        if let Some(listener) = listener {
            listener.abort();
        }
        if let Some(client) = client {
            client.cancel_pending_permissions(Some(session_id));
        }
        tracing::info!("[ACP Session] removed {session_id}");
    }

    pub fn has_session(&self, session_id: &str) -> bool {
        self.record(session_id).is_some()
    }

    pub fn session_count(&self) -> usize {
        self.records
            .lock()
            .map(|records| records.len())
            .unwrap_or(0)
    }

    pub fn active_session_count(&self) -> usize {
        self.records()
            .iter()
            .filter(|record| {
                record
                    .lock()
                    .map(|guard| guard.status == SessionStatus::Active)
                    .unwrap_or(false)
            })
            .count()
    }

    pub fn get_processing_session_ids(&self) -> Vec<String> {
        self.records()
            .iter()
            .filter_map(|record| {
                let guard = record.lock().ok()?;
                guard
                    .client
                    .is_prompting(&guard.session_id)
                    .then(|| guard.session_id.clone())
            })
            .collect()
    }

    /// Status snapshot for `GET /api/acp/session/:sessionId`.
    pub fn status_json(&self, session_id: &str) -> Option<Value> {
        let record = self.record(session_id)?;
        let guard = record.lock().ok()?;
        Some(json!({
            "sessionId": guard.session_id,
            "status": guard.status.as_str(),
            "createdAt": guard.created_at,
            "lastActivity": guard.last_activity,
        }))
    }

    pub async fn is_agent_connected(&self, session_id: &str) -> bool {
        let Some(record) = self.record(session_id) else {
            return false;
        };
        let client = match record.lock() {
            Ok(guard) => Arc::clone(&guard.client),
            Err(_) => return false,
        };
        client.is_connected().await
    }

    /// Session id + agent info for the stream route's status event.
    pub fn agent_snapshot(&self, session_id: &str) -> Option<(Option<Value>, Option<Value>)> {
        let record = self.record(session_id)?;
        let guard = record.lock().ok()?;
        Some((guard.client.agent_info(), guard.client.capabilities()))
    }

    /// Drop every record (server shutdown). Warm connections stay in the registry.
    pub fn destroy(&self) {
        let records: Vec<(String, Arc<Mutex<SessionRecord>>)> = self
            .records
            .lock()
            .map(|mut records| records.drain(..).collect())
            .unwrap_or_default();

        for (_, record) in records {
            if let Ok(mut guard) = record.lock() {
                guard.removed = true;
                if let Some(listener) = guard.listener.take() {
                    listener.abort();
                }
            }
        }
    }

    /// Diagnostics used by tests.
    pub fn session_ids(&self) -> Vec<String> {
        self.records
            .lock()
            .map(|records| records.keys().cloned().collect())
            .unwrap_or_default()
    }

    pub fn counts_by_status(&self) -> HashMap<String, usize> {
        let mut counts: HashMap<String, usize> = HashMap::new();
        for record in self.records() {
            if let Ok(guard) = record.lock() {
                *counts.entry(guard.status.as_str().to_string()).or_insert(0) += 1;
            }
        }
        counts
    }
}

fn with_prompting(mut value: Value, prompting: bool) -> Value {
    if let Value::Object(map) = &mut value {
        map.insert("prompting".to_string(), Value::Bool(prompting));
    }
    value
}

/// Attach the owning ACP session id to a prompt result.
fn with_acp_session_id(mut value: Value, session_id: &str) -> Value {
    if let Value::Object(map) = &mut value {
        map.insert(
            "acpSessionId".to_string(),
            Value::String(session_id.to_string()),
        );
    }
    value
}

/// Wait (bounded) for the event-forwarding task of one turn to finish.
///
/// The listener stops at the turn's terminal event, so this is normally
/// immediate; the bound only protects against a listener that never saw one
/// (e.g. a connection that died mid-prompt).
async fn drain_listener(listener: Option<tokio::task::JoinHandle<()>>) {
    if let Some(listener) = listener {
        let _ = tokio::time::timeout(Duration::from_secs(5), listener).await;
    }
}