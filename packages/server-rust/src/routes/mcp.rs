//! `/api/mcp` routes.
//!
//! **These routes are unauthenticated on purpose**: the settings UI calls them
//! without a bearer token, exactly like the TS server did (`createMcpRoutes`
//! was mounted without `requireAuth`). Adding auth here would break
//! Settings → MCP for every existing build.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use indexmap::IndexMap;
use serde_json::{json, Value};

use crate::mcp::McpServerConfig;
use crate::server::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/servers", get(list).post(create))
        .route("/servers/{name}", get(get_one).put(update).delete(remove))
}

async fn list(State(state): State<AppState>) -> Json<Value> {
    Json(json!({ "servers": state.mcp.list() }))
}

async fn get_one(State(state): State<AppState>, Path(name): Path<String>) -> Response {
    match state.mcp.get(&name) {
        Some(server) => Json(json!({ "server": server })).into_response(),
        None => error(StatusCode::NOT_FOUND, "Server not found"),
    }
}

async fn create(State(state): State<AppState>, Json(body): Json<Value>) -> Response {
    let name = text(&body, "name").unwrap_or_default();
    if name.trim().is_empty() {
        return error(StatusCode::BAD_REQUEST, "name is required");
    }

    match text(&body, "type").as_deref() {
        Some("stdio") => {
            let Some(command) = text(&body, "command") else {
                return error(
                    StatusCode::BAD_REQUEST,
                    "command is required for stdio type",
                );
            };
            state.mcp.upsert(
                &name,
                McpServerConfig::Stdio {
                    name: name.clone(),
                    description: raw_text(&body, "description"),
                    command,
                    args: string_list(&body, "args").unwrap_or_default(),
                    env: string_map(&body, "env"),
                },
            );
        }
        Some("http") => {
            let Some(url) = text(&body, "url") else {
                return error(StatusCode::BAD_REQUEST, "url is required for http type");
            };
            state.mcp.upsert(
                &name,
                McpServerConfig::Http {
                    name: name.clone(),
                    description: raw_text(&body, "description"),
                    url,
                    headers: string_map(&body, "headers"),
                },
            );
        }
        _ => return error(StatusCode::BAD_REQUEST, "type must be stdio or http"),
    }

    // The response echoes the untrimmed name, like the TS route.
    Json(json!({ "success": true, "name": name })).into_response()
}

async fn update(
    State(state): State<AppState>,
    Path(name): Path<String>,
    Json(body): Json<Value>,
) -> Response {
    let Some(existing) = state.mcp.get(&name) else {
        return error(StatusCode::NOT_FOUND, "Server not found");
    };

    let requested_type = text(&body, "type");
    let target_kind = match (requested_type.as_deref(), existing.kind()) {
        (Some("stdio"), _) | (None, "stdio") => "stdio",
        (Some("http"), _) | (None, "http") => "http",
        _ => return error(StatusCode::BAD_REQUEST, "Invalid type"),
    };

    let config = match target_kind {
        "stdio" => {
            let (existing_command, existing_args, existing_env) = match &existing {
                McpServerConfig::Stdio {
                    command, args, env, ..
                } => (command.clone(), args.clone(), env.clone()),
                _ => (String::new(), Vec::new(), None),
            };
            McpServerConfig::Stdio {
                name: name.clone(),
                description: text(&body, "description")
                    .unwrap_or_else(|| existing.description().to_string()),
                command: text(&body, "command").unwrap_or(existing_command),
                // An explicit (even empty) array replaces the old one; this
                // matches JS `args || existing.args` where `[]` is truthy.
                args: string_list(&body, "args").unwrap_or(existing_args),
                env: string_map(&body, "env").or(existing_env),
            }
        }
        _ => {
            let (existing_url, existing_headers) = match &existing {
                McpServerConfig::Http { url, headers, .. } => (url.clone(), headers.clone()),
                _ => (String::new(), None),
            };
            McpServerConfig::Http {
                name: name.clone(),
                description: text(&body, "description")
                    .unwrap_or_else(|| existing.description().to_string()),
                url: text(&body, "url").unwrap_or(existing_url),
                headers: string_map(&body, "headers").or(existing_headers),
            }
        }
    };

    state.mcp.upsert(&name, config);
    Json(json!({ "success": true, "name": name })).into_response()
}

async fn remove(State(state): State<AppState>, Path(name): Path<String>) -> Response {
    if state.mcp.remove(&name) {
        Json(json!({ "success": true })).into_response()
    } else {
        error(StatusCode::NOT_FOUND, "Server not found")
    }
}

fn error(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({ "error": message }))).into_response()
}

fn text(body: &Value, key: &str) -> Option<String> {
    body.get(key)
        .and_then(Value::as_str)
        .map(str::to_string)
        .filter(|value| !value.is_empty())
}

fn raw_text(body: &Value, key: &str) -> String {
    body.get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn string_list(body: &Value, key: &str) -> Option<Vec<String>> {
    body.get(key)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_string))
                .collect()
        })
}

fn string_map(body: &Value, key: &str) -> Option<IndexMap<String, String>> {
    body.get(key)
        .and_then(Value::as_object)
        .map(|map| {
            map.iter()
                .filter_map(|(key, value)| value.as_str().map(|value| (key.clone(), value.to_string())))
                .collect()
        })
}