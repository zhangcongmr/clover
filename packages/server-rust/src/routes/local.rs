//! `/api/local` routes.
//!
//! Response contract (unchanged from the TS server):
//!
//! - `GET /api/local/auth/token` and `GET /api/local/health` are public;
//! - every file action returns the `{ type: "file-service", … }` envelope with
//!   HTTP `200`, failures included;
//! - a missing/empty `path` is the only `400`, with `{ success: false, message }`.

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::{json, Value};

use crate::local::FileRequest;
use crate::routes::ws;
use crate::server::AppState;

/// Routes that must stay reachable without a token.
pub fn public_router() -> Router<AppState> {
    Router::new()
        .route("/api/local/auth/token", get(token))
        .route("/api/local/health", get(health))
}

/// Routes behind the bearer-token middleware.
pub fn protected_router() -> Router<AppState> {
    Router::new()
        .route("/api/local/scan", file_route("scan"))
        .route("/api/local/roots", file_route("roots"))
        .route("/api/local/listDir", file_route("listDir"))
        .route("/api/local/readFile", file_route("readFile"))
        .route("/api/local/writeFile", file_route("writeFile"))
        .route("/api/local/deleteFile", file_route("deleteFile"))
        .route("/api/local/createFile", file_route("createFile"))
        .route("/api/local/createDir", file_route("createDir"))
        .route("/api/local/rename", file_route("rename"))
        .route("/api/local/stat", file_route("stat"))
        .route("/api/local/exists", file_route("exists"))
        .route(
            "/api/local/openInFileExplorer",
            file_route("openInFileExplorer"),
        )
        // WebSocket endpoints share the same token check (`?token=`).
        .route("/ws/terminal", get(ws::terminal))
        .route("/ws/file-watch", get(ws::file_watch))
}

async fn token(State(state): State<AppState>) -> Json<Value> {
    let (token, expires_at) = state.token.generate();
    let expires_in = ((expires_at - crate::server::now_ms()) / 1000).max(0);
    Json(json!({ "token": token, "expiresIn": expires_in }))
}

async fn health(State(state): State<AppState>) -> Json<Value> {
    Json(json!({ "status": "ok", "readonly": state.readonly }))
}

fn file_route(action: &'static str) -> axum::routing::MethodRouter<AppState> {
    post(
        move |State(state): State<AppState>, Json(body): Json<Value>| async move {
            handle_file(&state, action, body).await
        },
    )
}

async fn handle_file(state: &AppState, action: &str, body: Value) -> Response {
    let text = |key: &str| {
        body.get(key)
            .and_then(Value::as_str)
            .map(str::to_string)
            .filter(|value| !value.is_empty())
    };

    let path = text("path");

    if action != "roots" && path.is_none() {
        return bad_request("path is required");
    }
    if action == "rename" && text("newName").is_none() {
        return bad_request("path and newName are required");
    }

    let request = FileRequest {
        action: action.to_string(),
        path: path.unwrap_or_default(),
        content: text("content"),
        new_name: text("newName"),
        depth: body.get("depth").and_then(Value::as_i64),
        ignore: body.get("ignore").and_then(Value::as_array).map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_string))
                .collect()
        }),
        request_id: text("requestId"),
    };

    Json(state.files.handle(request).await).into_response()
}

fn bad_request(message: &str) -> Response {
    (
        StatusCode::BAD_REQUEST,
        Json(json!({ "success": false, "message": message })),
    )
        .into_response()
}