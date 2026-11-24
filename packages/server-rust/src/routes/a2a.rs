//! `/api/a2a` routes (P8).
//!
//! | method | path | purpose |
//! |---|---|---|
//! | POST   | `/api/a2a/collab/spaces` | create a space (one ACP session per participant) |
//! | DELETE | `/api/a2a/collab/spaces/{spaceId}` | close a space and release its sessions |
//! | GET    | `/api/a2a/orchestrator/.well-known/agent-card.json` | orchestrator card |
//! | POST   | `/api/a2a/orchestrator/` | orchestrator JSON-RPC (A2A v1.0) |
//! | GET    | `/api/a2a/agents/{agentId}/.well-known/agent-card.json` | per-agent card |
//! | POST   | `/api/a2a/agents/{agentId}/` | per-agent JSON-RPC (forces that agent) |
//!
//! All of them require the bearer token (mounted behind the auth middleware).
//! Streaming replies use the SDK wire format: SSE frames whose `data:` payload
//! is `{"jsonrpc":"2.0","id":…,"result":{…}}`.

use std::convert::Infallible;

use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::sse::{Event, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use futures_util::StreamExt;
use serde_json::{json, Map, Value};
use tokio::sync::mpsc;
use tokio_stream::wrappers::UnboundedReceiverStream;

use crate::a2a::cards::{agent_skill, build_collab_card, orchestrator_skill};
use crate::a2a::bridge::RunInput;
use crate::a2a::proxy;
use crate::server::AppState;

/// Public `/a2a` proxy (no token: mounted with the public routes).
pub fn public_router() -> Router<AppState> {
    Router::new().route("/a2a", post(proxy_handler))
}

/// Wire version advertised by the JSON-RPC surface (A2A v1.0).
const SUPPORTED_PROTOCOL_VERSION: &str = "1.0";
/// The SDK treats a missing `A2A-Version` header as the legacy 0.3 version.
const ABSENT_PROTOCOL_VERSION: &str = "0.3";

/// Collaboration surface (mounted under the auth middleware).
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/a2a/collab/spaces", post(create_space))
        .route("/api/a2a/collab/spaces/{space_id}", delete(remove_space))
        .route(
            "/api/a2a/orchestrator/.well-known/agent-card.json",
            get(orchestrator_card),
        )
        .route("/api/a2a/orchestrator", post(orchestrator_rpc))
        .route("/api/a2a/orchestrator/", post(orchestrator_rpc))
        .route(
            "/api/a2a/agents/{agent_id}/.well-known/agent-card.json",
            get(agent_card),
        )
        .route("/api/a2a/agents/{agent_id}", post(agent_rpc))
        .route("/api/a2a/agents/{agent_id}/", post(agent_rpc))
}

// ==========================================================================
// Public proxy
// ==========================================================================

async fn proxy_handler(body: Bytes) -> Response {
    proxy::handle(body).await
}

// ==========================================================================
// Collaboration spaces
// ==========================================================================

async fn create_space(State(state): State<AppState>, Json(body): Json<Value>) -> Response {
    let cwd = body.get("cwd").and_then(Value::as_str).unwrap_or_default();
    let participants = body
        .get("participants")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let orchestrator_id = body.get("orchestratorId").and_then(Value::as_str);

    match state
        .a2a
        .spaces
        .create(cwd, &participants, orchestrator_id)
        .await
    {
        Ok(space) => {
            let participants: Vec<Value> = space
                .members
                .values()
                .map(|member| {
                    let mut entry = Map::new();
                    entry.insert("id".to_string(), json!(member.id));
                    entry.insert("agentId".to_string(), json!(member.agent_id));
                    entry.insert(
                        "sessionId".to_string(),
                        json!(space.sessions.get(&member.id).cloned().unwrap_or_default()),
                    );
                    entry.insert(
                        "configOptions".to_string(),
                        json!(space
                            .config_options
                            .get(&member.id)
                            .cloned()
                            .unwrap_or_default()),
                    );
                    if let Some(role) = &member.role {
                        entry.insert("role".to_string(), json!(role));
                    }
                    if let Some(responsibility) = &member.responsibility {
                        entry.insert("responsibility".to_string(), json!(responsibility));
                    }
                    if let Some(capabilities) = &member.capabilities {
                        entry.insert("capabilities".to_string(), json!(capabilities));
                    }
                    Value::Object(entry)
                })
                .collect();

            Json(json!({
                "success": true,
                "spaceId": space.id,
                "cwd": space.cwd,
                "orchestratorId": space.orchestrator_id,
                "participants": participants,
            }))
            .into_response()
        }
        Err(message) => {
            tracing::error!(
                "[A2A Collab] Create space error (cwd: {cwd}, sessions: {}): {message}",
                participants
                    .iter()
                    .map(|participant| participant
                        .get("agentId")
                        .and_then(|value| value.as_str())
                        .unwrap_or("?"))
                    .collect::<Vec<_>>()
                    .join(", ")
            );
            (
                StatusCode::BAD_REQUEST,
                Json(json!({ "success": false, "message": message })),
            )
                .into_response()
        }
    }
}

async fn remove_space(State(state): State<AppState>, Path(space_id): Path<String>) -> Response {
    if state.a2a.spaces.remove(&space_id).await {
        Json(json!({ "success": true })).into_response()
    } else {
        (
            StatusCode::NOT_FOUND,
            Json(json!({ "success": false, "message": "Collaboration space not found" })),
        )
            .into_response()
    }
}

// ==========================================================================
// Agent cards
// ==========================================================================

fn base_url(state: &AppState, headers: &HeaderMap) -> String {
    if let Some(override_url) = &state.a2a.base_url_override {
        return override_url.clone();
    }
    let proto = headers
        .get("x-forwarded-proto")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("http");
    let host = headers
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| format!("localhost:{}", crate::server::default_port()));
    format!("{proto}://{host}")
}

async fn orchestrator_card(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let base = base_url(&state, &headers);
    Json(build_collab_card(
        "Collaboration Orchestrator",
        "Routes each collaboration prompt to a target coding agent inside a shared workspace and streams the agent reply back as a task artifact.",
        &format!("{base}/api/a2a/orchestrator/"),
        orchestrator_skill(),
    ))
    .into_response()
}

async fn agent_card(
    State(state): State<AppState>,
    Path(agent_id): Path<String>,
    headers: HeaderMap,
) -> Response {
    let Some(config) = state.agents.get_agent_config(&agent_id) else {
        return unknown_agent(&agent_id);
    };
    let base = base_url(&state, &headers);
    let description = config
        .description
        .clone()
        .unwrap_or_else(|| format!("{} coding agent bridge", config.name));
    Json(build_collab_card(
        &config.name,
        &description,
        &format!(
            "{base}/api/a2a/agents/{}/",
            urlencode_component(&agent_id)
        ),
        // The TS card uses "… coding agent" for the skill and "… coding agent
        // bridge" for the card itself.
        agent_skill(
            &agent_id,
            &config.name,
            config
                .description
                .as_deref()
                .unwrap_or(&format!("{} coding agent", config.name)),
        ),
    ))
    .into_response()
}

fn unknown_agent(agent_id: &str) -> Response {
    (
        StatusCode::NOT_FOUND,
        Json(json!({ "success": false, "message": format!("Unknown agent: {agent_id}") })),
    )
        .into_response()
}

/// `encodeURIComponent` for the agent path segment.
fn urlencode_component(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'!' | b'~' | b'*'
            | b'\'' | b'(' | b')' => encoded.push(byte as char),
            other => encoded.push_str(&format!("%{other:02X}")),
        }
    }
    encoded
}

// ==========================================================================
// JSON-RPC endpoints
// ==========================================================================

async fn orchestrator_rpc(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    handle_rpc(state, None, headers, body).await
}

async fn agent_rpc(
    State(state): State<AppState>,
    Path(agent_id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if state.agents.get_agent_config(&agent_id).is_none() {
        return unknown_agent(&agent_id);
    }
    handle_rpc(state, Some(agent_id), headers, body).await
}

async fn handle_rpc(
    state: AppState,
    forced_agent_id: Option<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let request: Value = match serde_json::from_slice(&body) {
        Ok(value) => value,
        Err(_) => return jsonrpc_error(&Value::Null, -32700, "Invalid JSON payload."),
    };

    let id = request.get("id").cloned().unwrap_or(Value::Null);

    // A2A v1.0 requires the `A2A-Version` header. The SDK defaults an absent
    // header to the legacy 0.3 wire version and refuses it; mirror that so a
    // stale client fails with the same actionable error instead of a silent
    // protocol mismatch.
    let requested_version = headers
        .get("A2A-Version")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(ABSENT_PROTOCOL_VERSION);
    if requested_version != SUPPORTED_PROTOCOL_VERSION {
        return jsonrpc_error(
            &id,
            -32009,
            &format!(
                "The requested A2A protocol version '{requested_version}' is not supported. \
                 Supported versions: {SUPPORTED_PROTOCOL_VERSION}"
            ),
        );
    }

    let Some(method) = request.get("method").and_then(Value::as_str) else {
        return jsonrpc_error(&id, -32602, "Invalid JSON-RPC Request.");
    };
    if request.get("jsonrpc").and_then(Value::as_str) != Some("2.0") {
        return jsonrpc_error(&id, -32602, "Invalid JSON-RPC Request.");
    }
    if let Some(id_value) = request.get("id")
        && !id_value.is_null()
        && !id_value.is_number()
        && !id_value.is_string()
    {
        return jsonrpc_error(&Value::Null, -32602, "Invalid JSON-RPC Request.");
    }

    let params = request.get("params").cloned().unwrap_or(Value::Null);
    let params_valid = params.is_object() || params.is_null();

    match method {
        "SendStreamingMessage" | "SendMessage" => {
            if !params_valid {
                return jsonrpc_error(&id, -32602, "Invalid method parameters.");
            }
            let Some(message) = params
                .get("message")
                .filter(|message| message.is_object())
                .cloned()
            else {
                return jsonrpc_error(&id, -32602, "message.messageId is required.");
            };
            let message_id = message.get("messageId").and_then(Value::as_str);
            if !message_id.is_some_and(|value| !value.trim().is_empty()) {
                return jsonrpc_error(&id, -32602, "message.messageId is required.");
            }

            let resolved = match resolve_task(&state, &message) {
                Ok(resolved) => resolved,
                Err(error) => return jsonrpc_error(&id, error.0, &error.1),
            };
            let request_metadata = params.get("metadata").cloned();
            let streaming = method == "SendStreamingMessage";
            let run_input = RunInput {
                task_id: resolved.task_id,
                context_id: resolved.context_id,
                user_message: resolved.user_message,
                request_metadata,
                forced_agent_id,
                sink: None,
            };

            if streaming {
                let bridge = state.a2a.bridge.clone();
                let (tx, rx) = mpsc::unbounded_channel::<Value>();
                let run_input = RunInput {
                    sink: Some(tx),
                    ..run_input
                };
                tokio::spawn(async move { bridge.run(run_input).await });
                sse_response(id, rx)
            } else {
                run_input_blocking(state, run_input, id).await
            }
        }
        "GetTask" => {
            if !params_valid {
                return jsonrpc_error(&id, -32602, "Invalid method parameters.");
            }
            let Some(task_id) = params
                .get("id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
            else {
                return jsonrpc_error(&id, -32602, "Task ID is required");
            };
            match state.a2a.bridge.task(task_id) {
                Some(task) => jsonrpc_ok(&id, task),
                None => jsonrpc_error(&id, -32001, &format!("Task not found: {task_id}")),
            }
        }
        "CancelTask" => {
            if !params_valid {
                return jsonrpc_error(&id, -32602, "Invalid method parameters.");
            }
            let Some(task_id) = params
                .get("id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
            else {
                return jsonrpc_error(&id, -32602, "Task ID is required");
            };
            let Some(task) = state.a2a.bridge.task(task_id) else {
                return jsonrpc_error(&id, -32001, &format!("Task not found: {task_id}"));
            };
            if !state.a2a.bridge.is_active(task_id) {
                return jsonrpc_error(&id, -32002, "Task cannot be canceled");
            }
            state.a2a.bridge.cancel(task_id).await;
            let snapshot = state.a2a.bridge.task(task_id).unwrap_or(task);
            jsonrpc_ok(&id, snapshot)
        }
        "SubscribeToTask" => {
            if !params_valid {
                return jsonrpc_error(&id, -32602, "Invalid method parameters.");
            }
            let Some(task_id) = params
                .get("id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
            else {
                return jsonrpc_error(&id, -32602, "Task ID is required");
            };
            if state.a2a.bridge.task(task_id).is_none() {
                return jsonrpc_error(&id, -32001, &format!("Task not found: {task_id}"));
            }
            // Event streams are not replayed; the frontend only uses the
            // streaming call that started the task.
            jsonrpc_error(&id, -32004, "This operation is not supported")
        }
        "GetExtendedAgentCard" => jsonrpc_error(
            &id,
            -32004,
            "Agent does not support authenticated extended card.",
        ),
        _ => jsonrpc_error(&id, -32601, "Invalid method."),
    }
}

struct ResolvedTask {
    task_id: String,
    context_id: String,
    user_message: Value,
}

/// Resolves task / context ids exactly like `DefaultRequestHandler`.
fn resolve_task(state: &AppState, message: &Value) -> Result<ResolvedTask, (i64, String)> {
    let incoming_task_id = message
        .get("taskId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());

    let mut existing = None;
    if let Some(task_id) = incoming_task_id {
        let Some(task) = state.a2a.bridge.task(task_id) else {
            return Err((-32001, format!("Task not found: {task_id}")));
        };
        if let Some(state_name) = task["status"]["state"].as_str()
            && is_terminal_state(state_name)
        {
            return Err((
                -32004,
                format!("Task {task_id} is in a terminal state ({state_name}) and cannot be modified."),
            ));
        }
        existing = Some(task);
    }

    let task_id = incoming_task_id
        .map(str::to_string)
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let context_id = message
        .get("contextId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| {
            existing
                .as_ref()
                .and_then(|task| task.get("contextId"))
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    let mut user_message = message.clone();
    user_message["contextId"] = json!(context_id);
    user_message["taskId"] = json!(task_id);

    Ok(ResolvedTask {
        task_id,
        context_id,
        user_message,
    })
}

fn is_terminal_state(state: &str) -> bool {
    matches!(
        state,
        "TASK_STATE_COMPLETED"
            | "TASK_STATE_FAILED"
            | "TASK_STATE_CANCELED"
            | "TASK_STATE_REJECTED"
    )
}

async fn run_input_blocking(state: AppState, run_input: RunInput, id: Value) -> Response {
    let task_id = run_input.task_id.clone();
    state.a2a.bridge.run(run_input).await;
    match state.a2a.bridge.task(&task_id) {
        Some(task) => jsonrpc_ok(&id, json!({ "task": task })),
        None => jsonrpc_error(&id, -32603, "Execution finished before a task was produced."),
    }
}

fn sse_response(id: Value, rx: mpsc::UnboundedReceiver<Value>) -> Response {
    let stream = UnboundedReceiverStream::new(rx).map(move |payload| {
        let frame = json!({ "jsonrpc": "2.0", "id": id, "result": payload });
        Ok::<_, Infallible>(Event::default().data(frame.to_string()))
    });
    let mut response = Sse::new(stream).into_response();
    let headers = response.headers_mut();
    headers.insert(
        header::CONNECTION,
        axum::http::HeaderValue::from_static("keep-alive"),
    );
    headers.insert(
        "X-Accel-Buffering",
        axum::http::HeaderValue::from_static("no"),
    );
    response
}

fn jsonrpc_ok(id: &Value, result: Value) -> Response {
    Json(json!({ "jsonrpc": "2.0", "id": id, "result": result })).into_response()
}

/// `google.rpc.ErrorInfo` reason for the A2A error codes the SDK annotates.
/// `-32700` / `-32601` carry no `data`, matching the SDK.
fn error_reason(code: i64) -> Option<&'static str> {
    match code {
        -32602 => Some("INVALID_PARAMS"),
        -32001 => Some("TASK_NOT_FOUND"),
        -32002 => Some("TASK_NOT_CANCELABLE"),
        -32004 => Some("UNSUPPORTED_OPERATION"),
        -32007 => Some("EXTENDED_CARD_NOT_CONFIGURED"),
        -32009 => Some("VERSION_NOT_SUPPORTED"),
        _ => None,
    }
}

fn jsonrpc_error(id: &Value, code: i64, message: &str) -> Response {
    let mut error = json!({ "code": code, "message": message });
    if let Some(reason) = error_reason(code) {
        error["data"] = json!([{
            "@type": "type.googleapis.com/google.rpc.ErrorInfo",
            "reason": reason,
            "domain": "a2a-protocol.org",
        }]);
    }
    Json(json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": error,
    }))
    .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn component_encoding_matches_encodeuri_component() {
        assert_eq!(urlencode_component("codex"), "codex");
        assert_eq!(urlencode_component("a b/c"), "a%20b%2Fc");
        assert_eq!(urlencode_component("a-b_c.d!~*'()"), "a-b_c.d!~*'()");
        assert_eq!(urlencode_component("中文"), "%E4%B8%AD%E6%96%87");
    }

    #[test]
    fn terminal_states_are_recognised() {
        for state in [
            "TASK_STATE_COMPLETED",
            "TASK_STATE_FAILED",
            "TASK_STATE_CANCELED",
            "TASK_STATE_REJECTED",
        ] {
            assert!(is_terminal_state(state), "{state}");
        }
        assert!(!is_terminal_state("TASK_STATE_WORKING"));
        assert!(!is_terminal_state("TASK_STATE_SUBMITTED"));
    }
}