//! `/api/acp` routes: agent management, session CRUD and the session SSE stream.

use std::convert::Infallible;
use std::sync::Arc;
use std::time::Duration;

use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use tokio_stream::wrappers::ReceiverStream;

use crate::acp::install::{parse_install_request, uninstall_agent};
use crate::acp::probe::probe_path_command;
use crate::acp::sessions::SessionOptions;
use crate::acp::sse::AttachOptions;
use crate::acp::stores::{
    iso_now, read_acp_config, read_agent_options, upsert_acp_agent, write_agent_options,
    AgentOptionsEntry,
};
use crate::events::EventSink;
use crate::server::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        // Session event streams
        .route(
            "/stream/{session_id}",
            get(open_stream).post(stream_command).delete(release_stream),
        )
        // Session records
        .route(
            "/session/{session_id}",
            get(session_status).delete(delete_session_record),
        )
        .route("/session/create", post(create_session))
        .route("/session/list", post(list_sessions))
        .route("/session/load", post(load_session))
        .route("/session/resume", post(resume_session))
        .route("/session/delete", post(delete_session))
        .route("/config", post(set_config))
        .route("/list-all-sessions", post(list_all_sessions))
        .route("/sessions/events", get(session_activity_events))
        // Agent management
        .route("/agents", get(list_agents))
        .route("/agents/events", get(agent_events))
        .route("/agents/install", post(install_agent))
        .route("/agents/install/{job_id}", get(get_install_job))
        .route("/agents/{id}/check", post(check_agent))
        .route("/agents/{id}/uninstall", delete(uninstall_agent_route))
        .route("/agents/{id}/update", post(update_agent))
        .route("/status", get(status))
        .route("/health", get(health))
        .route("/ping", post(ping))
        .route("/agent-config", get(get_agent_config).post(save_agent_config))
}

// ==========================================================================
// Session event stream
// ==========================================================================

#[derive(Debug, Deserialize, Default)]
struct StreamQuery {
    #[serde(default, rename = "agentId")]
    agent_id: Option<String>,
}

async fn open_stream(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    Query(query): Query<StreamQuery>,
    headers: HeaderMap,
) -> Response {
    let accepts = headers
        .get(axum::http::header::ACCEPT)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    if !accepts.contains("text/event-stream") && !accepts.contains("*/*") {
        return bad_request("Accept: text/event-stream is required");
    }

    // A record may be missing after a backend restart; `agentId` lets the
    // route recreate it so the client can connect before `session/load`.
    if !state.sessions.has_session(&session_id)
        && let Some(agent_id) = query.agent_id.as_deref()
        && let Err(error) = state
            .sessions
            .ensure_record(&session_id, Some(agent_id))
            .await
    {
        tracing::warn!("[ACP Routes] ensure session record failed ({session_id}): {error}");
    }

    if !state.sessions.has_session(&session_id) {
        return not_found("Session not found");
    }

    let client_id = header_string(&headers, "X-Client-Id");
    let takeover = matches!(header_string(&headers, "X-Takeover").as_deref(), Some("1") | Some("true"));
    let last_event_id = header_string(&headers, "Last-Event-ID").and_then(|value| value.parse::<u64>().ok());

    let attach = match state.sse.attach(
        &session_id,
        AttachOptions {
            last_event_id,
            client_id,
            takeover,
        },
    ) {
        Ok(attach) => attach,
        Err(conflict) => {
            return (
                StatusCode::CONFLICT,
                Json(json!({ "error": conflict.message(), "code": "SUPERSEDED" })),
            )
                .into_response();
        }
    };

    let (tx, rx) = tokio::sync::mpsc::channel::<Result<Event, Infallible>>(128);

    // Initial ownership event, then the replay window.
    let connected = json!({
        "type": "connected",
        "payload": {
            "sessionId": session_id,
            "clientId": attach.client_id,
            "connectionId": attach.connection_id,
            "epoch": attach.epoch,
            "timestamp": crate::events::sink::now_ms(),
        },
        "timestamp": crate::events::sink::now_ms(),
    });
    let _ = tx.send(Ok(sse_event(&connected))).await;

    for event in &attach.replay {
        let _ = tx.send(Ok(sse_event(event))).await;
    }
    if let Some(oldest) = attach.gap {
        let gap = json!({
            "type": "replay_gap",
            "payload": { "requestedAfter": last_event_id, "oldestRetainedSeq": oldest },
            "timestamp": crate::events::sink::now_ms(),
        });
        let _ = tx.send(Ok(sse_event(&gap))).await;
    }

    // Tell the client whether the agent is live (or recover it in the
    // background), like the TS `openStream` helper.
    if state.sessions.is_agent_connected(&session_id).await {
        publish_status(&state, &session_id).await;
    } else {
        let recover_state = state.clone();
        let recover_id = session_id.clone();
        tokio::spawn(async move {
            match recover_state.sessions.ensure_agent_session(&recover_id).await {
                Ok(()) => publish_status(&recover_state, &recover_id).await,
                Err(error) => {
                    recover_state
                        .sessions
                        .publish_event(
                            &recover_id,
                            EventSink::event(
                                "error",
                                json!({ "message": format!("Agent recovery failed: {error}") }),
                            ),
                        )
                        .await;
                }
            }
        });
    }

    let manager = Arc::clone(&state.sse);
    let stream_session = session_id.clone();
    let connection_id = attach.connection_id.clone();
    let mut events = attach.events;
    let mut stop = attach.stop;

    tokio::spawn(async move {
        let mut heartbeat = tokio::time::interval(Duration::from_secs(25));
        // First tick fires immediately; skip it.
        heartbeat.tick().await;

        loop {
            tokio::select! {
                event = events.recv() => {
                    match event {
                        Ok(event) => {
                            if tx.send(Ok(sse_event(&event))).await.is_err() {
                                break;
                            }
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                        Err(_) => break,
                    }
                }
                _ = &mut stop => break,
                _ = heartbeat.tick() => {
                    if tx.send(Ok(Event::default().comment("heartbeat"))).await.is_err() {
                        break;
                    }
                    manager.touch(&stream_session);
                }
            }
        }

        manager.detach(&stream_session, &connection_id);
    });

    Sse::new(ReceiverStream::new(rx)).into_response()
}

fn sse_event(event: &Value) -> Event {
    let mut frame = Event::default();
    if let Some(seq) = event.get("seq").and_then(Value::as_u64) {
        frame = frame.id(seq.to_string());
    }
    frame.data(event.to_string())
}

async fn publish_status(state: &AppState, session_id: &str) {
    let Some((agent_info, capabilities)) = state.sessions.agent_snapshot(session_id) else {
        return;
    };
    state
        .sessions
        .publish_event(
            session_id,
            EventSink::event(
                "status",
                json!({
                    "connected": true,
                    "agentInfo": agent_info,
                    "capabilities": capabilities,
                }),
            ),
        )
        .await;
}

#[derive(Debug, Deserialize)]
struct StreamCommand {
    #[serde(default)]
    id: Option<Value>,
    #[serde(default)]
    method: Option<String>,
    #[serde(default)]
    params: Option<Value>,
}

async fn stream_command(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    Json(body): Json<StreamCommand>,
) -> Response {
    let Some(method) = body.method.as_deref() else {
        return bad_request("method is required");
    };
    if !state.sessions.has_session(&session_id) {
        return not_found("Session not found");
    }

    let params = body.params.unwrap_or_else(|| json!({}));
    match method {
        "prompt" => {
            let content = params.get("content").cloned().unwrap_or_else(|| json!([]));
            let request_id = body
                .id
                .as_ref()
                .and_then(|id| id.as_str().map(str::to_string))
                .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
            state
                .sessions
                .dispatch_prompt(&session_id, content, request_id);
        }
        "cancel" => state.sessions.dispatch_cancel(&session_id),
        "permission" => {
            let request_id = params
                .get("requestId")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let outcome = params.get("outcome").cloned().unwrap_or(Value::Null);
            state
                .sessions
                .dispatch_permission_response(&session_id, &request_id, outcome);
        }
        other => return bad_request(&format!("Unknown method: {other}")),
    }

    let id = body.id.unwrap_or(Value::Null);
    (StatusCode::ACCEPTED, Json(json!({ "accepted": true, "id": id }))).into_response()
}

async fn release_stream(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    headers: HeaderMap,
) -> Response {
    let client_id = header_string(&headers, "X-Client-Id");
    let epoch = header_string(&headers, "X-Epoch").and_then(|value| value.parse::<u64>().ok());

    if state.sse.release(&session_id, client_id.as_deref(), epoch) {
        StatusCode::NO_CONTENT.into_response()
    } else {
        (
            StatusCode::CONFLICT,
            Json(json!({ "error": "Not the stream owner", "code": "SUPERSEDED" })),
        )
            .into_response()
    }
}

fn header_string(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

// ==========================================================================
// Session records / operations
// ==========================================================================

async fn session_status(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> Response {
    let Some(mut status) = state.sessions.status_json(&session_id) else {
        return not_found("Session not found");
    };
    if let Value::Object(map) = &mut status {
        map.insert(
            "hasConnection".to_string(),
            Value::Bool(state.sse.has_connection(&session_id)),
        );
    }
    Json(status).into_response()
}

async fn delete_session_record(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
) -> Response {
    state.sessions.remove_session(&session_id);
    Json(json!({ "success": true, "message": "Session deleted" })).into_response()
}

async fn create_session(State(state): State<AppState>, Json(body): Json<Value>) -> Response {
    let agent_id = body
        .get("agentId")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();
    if agent_id.is_empty() {
        return bad_request("agentId is required");
    }

    let cwd = resolve_cwd(&state, body.get("cwd").and_then(Value::as_str));
    if let Err(error) = std::fs::create_dir_all(&cwd) {
        return server_error(&error.to_string());
    }

    let mcp_servers = resolve_mcp_servers(&state, &body);
    match state
        .sessions
        .create(&agent_id, cwd, mcp_servers)
        .await
    {
        Ok(result) => {
            let mut response = json!({ "success": true, "agentId": agent_id });
            if let (Value::Object(target), Value::Object(source)) = (&mut response, result) {
                for (key, value) in source {
                    target.insert(key, value);
                }
            }
            Json(response).into_response()
        }
        Err(error) => server_error(&error),
    }
}

async fn list_sessions(State(state): State<AppState>, Json(body): Json<Value>) -> Response {
    let agent_id = body
        .get("agentId")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    if agent_id.is_empty() {
        return bad_request("agentId is required");
    }

    let cwd = body.get("cwd").and_then(Value::as_str);
    let cursor = body.get("cursor").and_then(Value::as_str);

    match state.sessions.list(&agent_id, cwd, cursor).await {
        Ok(result) => merge_success(result, json!({ "success": true })),
        Err(error) => server_error(&error),
    }
}

async fn load_session(State(state): State<AppState>, Json(body): Json<Value>) -> Response {
    let Some(session_id) = body.get("sessionId").and_then(Value::as_str) else {
        return bad_request("sessionId is required");
    };

    let options = SessionOptions {
        agent_id: body
            .get("agentId")
            .and_then(Value::as_str)
            .map(str::to_string),
        cwd: body.get("cwd").and_then(Value::as_str).map(str::to_string),
        mcp_servers: resolve_mcp_servers(&state, &body),
    };

    match state.sessions.load(session_id, options).await {
        Ok(result) => merge_success(result, json!({ "success": true })),
        Err(error) => server_error(&error),
    }
}

async fn resume_session(State(state): State<AppState>, Json(body): Json<Value>) -> Response {
    let Some(session_id) = body.get("sessionId").and_then(Value::as_str) else {
        return bad_request("sessionId is required");
    };

    let options = SessionOptions {
        agent_id: body
            .get("agentId")
            .and_then(Value::as_str)
            .map(str::to_string),
        cwd: body.get("cwd").and_then(Value::as_str).map(str::to_string),
        mcp_servers: resolve_mcp_servers(&state, &body),
    };

    match state.sessions.resume(session_id, options).await {
        Ok(result) => merge_success(result, json!({ "success": true })),
        Err(error) => server_error(&error),
    }
}

async fn delete_session(State(state): State<AppState>, Json(body): Json<Value>) -> Response {
    let Some(session_id) = body.get("sessionId").and_then(Value::as_str) else {
        return bad_request("sessionId is required");
    };
    let agent_id = body.get("agentId").and_then(Value::as_str);

    match state.sessions.delete(session_id, agent_id).await {
        Ok(()) => Json(json!({ "success": true, "message": "Session deleted" })).into_response(),
        Err(error) => server_error(&error),
    }
}

async fn set_config(State(state): State<AppState>, Json(body): Json<Value>) -> Response {
    let session_id = body.get("sessionId").and_then(Value::as_str);
    let config_id = body.get("configId").and_then(Value::as_str);
    let value_type = body.get("type").and_then(Value::as_str);
    let value = body.get("value").cloned();

    let (Some(session_id), Some(config_id), Some(value_type), Some(value)) =
        (session_id, config_id, value_type, value)
    else {
        return bad_request("sessionId, configId, type, and value are required");
    };

    match state
        .sessions
        .set_config(session_id, config_id, value_type, value)
        .await
    {
        Ok(result) => merge_success(result, json!({ "success": true })),
        Err(error) => server_error(&error),
    }
}

async fn list_all_sessions(State(state): State<AppState>, Json(body): Json<Value>) -> Response {
    let Some(cwd) = body
        .get("cwd")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return bad_request("cwd (working directory) is required");
    };

    let Some(agents) = body.get("agents").and_then(Value::as_array) else {
        return bad_request("agents is required");
    };
    if agents.is_empty() {
        return bad_request("agents is required");
    }

    let mut sessions: Vec<Value> = Vec::new();
    let mut failures: Vec<Value> = Vec::new();

    for agent in agents {
        let (Some(agent_id), Some(command)) = (
            agent.get("id").and_then(Value::as_str),
            agent.get("command").and_then(Value::as_str),
        ) else {
            continue;
        };

        let args = agent.get("args").and_then(Value::as_array).map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_string))
                .collect::<Vec<String>>()
        });
        let env = agent.get("env").and_then(Value::as_object).map(|map| {
            map.iter()
                .filter_map(|(key, value)| value.as_str().map(|value| (key.clone(), value.to_string())))
                .collect::<indexmap::IndexMap<String, String>>()
        });

        match state
            .sessions
            .list_for_command(command, args, env, cwd)
            .await
        {
            Ok(result) => {
                let items = result
                    .get("sessions")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();
                for mut session in items {
                    if let Value::Object(map) = &mut session {
                        map.insert("agentId".to_string(), json!(agent_id));
                    }
                    sessions.push(session);
                }
            }
            Err(error) => {
                tracing::warn!("[ACP Routes] list sessions failed for {agent_id}: {error}");
                failures.push(json!({ "agentId": agent_id, "error": error }));
            }
        }
    }

    Json(json!({ "success": true, "sessions": sessions, "failures": failures })).into_response()
}

// ==========================================================================
// Client-level activity stream
// ==========================================================================

async fn session_activity_events(State(state): State<AppState>) -> Response {
    let (tx, rx) = tokio::sync::mpsc::channel::<Result<Event, Infallible>>(64);

    let snapshot = json!({
        "type": "sessions_processing_snapshot",
        "payload": { "sessionIds": state.sessions.get_processing_session_ids() },
        "timestamp": crate::events::sink::now_ms(),
    });
    let _ = tx.send(Ok(Event::default().data(snapshot.to_string()))).await;

    let mut activity = state.activity.subscribe();
    tokio::spawn(async move {
        let mut heartbeat = tokio::time::interval(Duration::from_secs(25));
        heartbeat.tick().await;
        loop {
            tokio::select! {
                event = activity.recv() => {
                    match event {
                        Ok(event) => {
                            if tx.send(Ok(Event::default().data(event.to_string()))).await.is_err() {
                                break;
                            }
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                        Err(_) => break,
                    }
                }
                _ = heartbeat.tick() => {
                    if tx.send(Ok(Event::default().comment("heartbeat"))).await.is_err() {
                        break;
                    }
                }
            }
        }
    });

    Sse::new(ReceiverStream::new(rx)).into_response()
}

// ==========================================================================
// Helpers
// ==========================================================================

fn resolve_cwd(state: &AppState, requested: Option<&str>) -> String {
    match requested.map(str::trim).filter(|value| !value.is_empty()) {
        Some(value) if value.starts_with('~') => crate::paths::expand_home(value)
            .to_string_lossy()
            .to_string(),
        Some(value) => value.to_string(),
        None => state
            .state_dir
            .join(format!(
                "session-{}",
                chrono::Utc::now().format("%Y-%m-%dT%H-%M-%S")
            ))
            .to_string_lossy()
            .to_string(),
    }
}

/// `mcpServers` may be a list of names or full objects.
fn resolve_mcp_servers(state: &AppState, body: &Value) -> Value {
    let Some(items) = body.get("mcpServers").and_then(Value::as_array) else {
        return json!([]);
    };
    if items.is_empty() {
        return json!([]);
    }

    if items.iter().all(Value::is_string) {
        let names: Vec<String> = items
            .iter()
            .filter_map(|item| item.as_str().map(str::to_string))
            .collect();
        let resolved = state.mcp.resolve_all(&names);
        return serde_json::to_value(resolved).unwrap_or_else(|_| json!([]));
    }

    Value::Array(items.clone())
}

fn merge_success(result: Value, mut base: Value) -> Response {
    if let (Value::Object(target), Value::Object(source)) = (&mut base, result) {
        for (key, value) in source {
            target.insert(key, value);
        }
    }
    Json(base).into_response()
}

// ==========================================================================
// Agent management (P4)
// ==========================================================================

async fn list_agents(State(state): State<AppState>) -> Json<Value> {
    Json(json!({ "agents": state.agents.get_status() }))
}

async fn check_agent(State(state): State<AppState>, Path(agent_id): Path<String>) -> Response {
    match state.agents.check_now(&agent_id).await {
        Ok(agent) => Json(json!({ "agent": agent })).into_response(),
        Err(error) => {
            let status = if error.starts_with("Unknown agent") {
                StatusCode::NOT_FOUND
            } else {
                StatusCode::INTERNAL_SERVER_ERROR
            };
            (status, Json(json!({ "error": error }))).into_response()
        }
    }
}

// --------------------------------------------------------------------------
// Agent install / uninstall / update (P6)
// --------------------------------------------------------------------------

async fn install_agent(State(state): State<AppState>, Json(body): Json<Value>) -> Response {
    let text = |key: &str| body.get(key).and_then(Value::as_str).unwrap_or_default();
    if text("id").trim().is_empty() || text("name").trim().is_empty() {
        return bad_request("body must be a full AgentConfig with at least id and name");
    }

    let source = text("source");
    if source == "builtin" {
        return (
            StatusCode::NOT_IMPLEMENTED,
            Json(json!({ "error": "Installing source=\"builtin\" agents is not implemented yet" })),
        )
            .into_response();
    }
    if source == "registry"
        && !body
            .get("distribution")
            .map(Value::is_object)
            .unwrap_or(false)
    {
        return bad_request("body.distribution is required for source=registry installs");
    }
    if source == "disk" && text("command").trim().is_empty() {
        return bad_request("body.command (path to the executable) is required for source=disk installs");
    }

    let (config, distribution) = match parse_install_request(&body) {
        Ok(parsed) => parsed,
        Err(error) => return bad_request(&error),
    };

    match state.installs.start(config.clone(), distribution).await {
        Some(job) => Json(json!({ "job": job })).into_response(),
        None => bad_request(&format!(
            "No installable distribution for agent: {}",
            config.id
        )),
    }
}

async fn get_install_job(State(state): State<AppState>, Path(job_id): Path<String>) -> Response {
    match state.installs.get_job(&job_id) {
        Some(job) => Json(json!({ "job": job })).into_response(),
        None => not_found("Install job not found"),
    }
}

async fn uninstall_agent_route(
    State(state): State<AppState>,
    Path(agent_id): Path<String>,
) -> Response {
    let entry = read_acp_config(&state.state_dir)
        .agents
        .into_iter()
        .find(|agent| agent.id == agent_id);
    let Some(entry) = entry else {
        return not_found(&format!("Agent not found: {agent_id}"));
    };

    // Stop the process first: Windows keeps the executable locked while it
    // runs, which would make the artifact cleanup fail.
    state.agents.remove_config(&agent_id).await;
    match uninstall_agent(&state.state_dir, &entry).await {
        Ok(_) => Json(json!({ "success": true })).into_response(),
        Err(error) => {
            tracing::error!("[ACP Routes] Uninstall agent error (agent: {agent_id}): {error}");
            server_error(&error)
        }
    }
}

async fn update_agent(
    State(state): State<AppState>,
    Path(agent_id): Path<String>,
    body: Bytes,
) -> Response {
    // Express' `express.json()` leaves `req.body` as `{}` when no body was
    // sent; accept the same so an update without a payload fails on the
    // missing command rather than on the content type.
    let body: Value = if body.is_empty() {
        Value::Object(Map::new())
    } else {
        match serde_json::from_slice(&body) {
            Ok(value) => value,
            Err(_) => return bad_request("Invalid JSON payload."),
        }
    };
    let command = body
        .get("command")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if command.trim().is_empty() {
        return bad_request("command (path to the executable) is required");
    }

    let entry = read_acp_config(&state.state_dir)
        .agents
        .into_iter()
        .find(|agent| agent.id == agent_id);
    let Some(entry) = entry else {
        return not_found(&format!("Agent not found: {agent_id}"));
    };
    if entry.source.as_deref() != Some("disk") {
        return bad_request("Only disk-source agents can be edited");
    }
    if !probe_path_command(command).await.found {
        return bad_request(&format!("Executable not found: {command}"));
    }

    // The old command may be running: disconnect and wait before editing.
    state.agents.remove_config(&agent_id).await;

    let mut updated = entry;
    if let Some(name) = body
        .get("name")
        .and_then(Value::as_str)
        .filter(|name| !name.trim().is_empty())
    {
        updated.name = name.to_string();
    }
    updated.command = command.to_string();
    if let Some(args) = body.get("args").and_then(Value::as_array) {
        updated.args = Some(
            args.iter()
                .map(|arg| {
                    arg.as_str()
                        .map(str::to_string)
                        .unwrap_or_else(|| arg.to_string())
                })
                .collect(),
        );
    }
    // `env` replaces the whole map (an empty object clears it); omitted keeps.
    if let Some(env) = body.get("env").filter(|env| env.is_object()) {
        updated.env = Some(normalize_env(env));
    }
    if let Some(description) = body.get("description").and_then(Value::as_str) {
        updated.description = Some(description.to_string());
    }

    upsert_acp_agent(&state.state_dir, updated.clone());
    state.agents.add_config(updated).await;
    let registry = Arc::clone(&state.agents);
    let check_id = agent_id.clone();
    tokio::spawn(async move {
        let _ = registry.check_now(&check_id).await;
    });

    let agent = state
        .agents
        .get_status()
        .into_iter()
        .find(|agent| agent.config.id == agent_id);
    Json(json!({ "success": true, "agent": agent })).into_response()
}

/// `Record<string, string>` normalization: drop empty keys / null values and
/// stringify the rest.
fn normalize_env(env: &Value) -> indexmap::IndexMap<String, String> {
    let mut result = indexmap::IndexMap::new();
    if let Value::Object(map) = env {
        for (key, value) in map {
            if key.is_empty() || value.is_null() {
                continue;
            }
            let text = match value {
                Value::String(text) => text.clone(),
                other => other.to_string(),
            };
            result.insert(key.clone(), text);
        }
    }
    result
}

async fn agent_events(State(state): State<AppState>) -> Response {
    let registry = state.agents.clone();
    let (tx, rx) = tokio::sync::mpsc::channel::<Result<Event, Infallible>>(64);

    let snapshot = json!({
        "type": "agents_status_snapshot",
        "payload": { "agents": registry.get_status() },
        "timestamp": crate::events::sink::now_ms(),
    });
    let _ = tx
        .send(Ok(Event::default().data(snapshot.to_string())))
        .await;

    let mut status_rx = registry.subscribe_status();
    let mut removed_rx = registry.subscribe_removed();

    tokio::spawn(async move {
        loop {
            tokio::select! {
                changed = status_rx.recv() => {
                    match changed {
                        Ok(info) => {
                            let event = json!({
                                "type": "agent_status_changed",
                                "payload": { "agent": info },
                                "timestamp": crate::events::sink::now_ms(),
                            });
                            if tx.send(Ok(Event::default().data(event.to_string()))).await.is_err() {
                                break;
                            }
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                        Err(_) => break,
                    }
                }
                removed = removed_rx.recv() => {
                    match removed {
                        Ok(agent_id) => {
                            let event = json!({
                                "type": "agent_removed",
                                "payload": { "agentId": agent_id },
                                "timestamp": crate::events::sink::now_ms(),
                            });
                            if tx.send(Ok(Event::default().data(event.to_string()))).await.is_err() {
                                break;
                            }
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                        Err(_) => break,
                    }
                }
            }
        }
    });

    Sse::new(ReceiverStream::new(rx))
        .keep_alive(
            KeepAlive::new()
                .interval(Duration::from_secs(25))
                .text("heartbeat"),
        )
        .into_response()
}

async fn status(State(state): State<AppState>) -> Json<Value> {
    Json(json!({
        "sessions": state.sessions.session_count(),
        "activeSessions": state.sessions.active_session_count(),
        "connections": state.sse.count(),
        "eventSink": "in-process",
    }))
}

async fn health() -> Json<Value> {
    Json(json!({
        "status": "healthy",
        "eventSink": "in-process",
        "timestamp": crate::events::sink::now_ms(),
    }))
}

async fn ping(State(_state): State<AppState>, Json(body): Json<Value>) -> Response {
    let session_id = body
        .get("sessionId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if session_id.is_empty() {
        return bad_request("sessionId is required");
    }
    Json(json!({
        "success": true,
        "pong": true,
        "timestamp": crate::events::sink::now_ms(),
    }))
    .into_response()
}

#[derive(Debug, Deserialize)]
struct AgentConfigQuery {
    #[serde(default, rename = "agentId")]
    agent_id: String,
}

async fn get_agent_config(
    State(state): State<AppState>,
    Query(query): Query<AgentConfigQuery>,
) -> Response {
    let agent_id = query.agent_id.trim();
    if agent_id.is_empty() {
        return bad_request("agentId is required");
    }

    let options = read_agent_options(&state.state_dir);
    let config_options = options
        .get(agent_id)
        .map(|entry| Value::Array(entry.config_options.clone()))
        .unwrap_or(Value::Null);

    Json(json!({ "success": true, "configOptions": config_options })).into_response()
}

async fn save_agent_config(State(state): State<AppState>, Json(body): Json<Value>) -> Response {
    let agent_id = match body.get("agentId").and_then(Value::as_str) {
        Some(agent_id) if !agent_id.is_empty() => agent_id.to_string(),
        _ => return bad_request("agentId is required"),
    };

    let Some(config_options) = body.get("configOptions").and_then(Value::as_array) else {
        return bad_request("configOptions must be an array");
    };

    let mut options = read_agent_options(&state.state_dir);
    if let Some(previous) = options.get(&agent_id)
        && previous.config_options == *config_options
    {
        return Json(json!({ "success": true, "unchanged": true })).into_response();
    }

    options.insert(
        agent_id,
        AgentOptionsEntry {
            config_options: config_options.clone(),
            updated_at: Some(iso_now()),
        },
    );
    write_agent_options(&state.state_dir, &options);

    Json(json!({ "success": true })).into_response()
}

fn bad_request(message: &str) -> Response {
    (
        StatusCode::BAD_REQUEST,
        Json(json!({ "error": message })),
    )
        .into_response()
}

fn not_found(message: &str) -> Response {
    (StatusCode::NOT_FOUND, Json(json!({ "error": message }))).into_response()
}

fn server_error(message: &str) -> Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({ "error": message })),
    )
        .into_response()
}