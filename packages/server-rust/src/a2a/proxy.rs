//! Public `/a2a` middleware: forwards A2UI requests to an external A2A agent.
//!
//! Port of `packages/server/src/api/a2a.ts`. The browser posts either a text
//! `query` or a JSON UI `event`; the middleware wraps it into an A2A
//! `SendMessageRequest`, calls the remote agent's JSON-RPC endpoint and relays
//! the reply parts as `{ parts, contextId }` frames (SSE when the agent
//! streams).
//!
//! Upstream selection: `A2A_AGENT_CARD_URL` (default
//! `http://localhost:10002/.well-known/agent-card.json`); the JSON-RPC dial URL
//! comes from the card's first `supportedInterfaces[].url`.

use std::convert::Infallible;
use std::time::Duration;

use axum::body::Bytes;
use axum::http::{StatusCode, header};
use axum::response::sse::{Event, Sse};
use axum::response::{IntoResponse, Response};
use axum::Json;
use futures_util::StreamExt;
use serde_json::{json, Value};
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;

use crate::a2a::events::{data_part, text_part};

/// Default upstream agent card (the A2UI demo agent).
const DEFAULT_AGENT_CARD_URL: &str = "http://localhost:10002/.well-known/agent-card.json";
const UPSTREAM_TIMEOUT: Duration = Duration::from_secs(30);

pub async fn handle(body: Bytes) -> Response {
    let original = String::from_utf8_lossy(&body).to_string();
    let request = build_send_message_request(&original);

    let agent_card_url = std::env::var("A2A_AGENT_CARD_URL")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_AGENT_CARD_URL.to_string());

    let client = reqwest::Client::new();
    let dial_url = match resolve_dial_url(&client, &agent_card_url).await {
        Ok(url) => url,
        Err(error) => {
            tracing::error!("[a2a-middleware] Failed to resolve agent card: {error}");
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": error })))
                .into_response();
        }
    };

    let rpc_body = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "SendStreamingMessage",
        "params": request,
    });

    let upstream = client
        .post(&dial_url)
        .header(header::ACCEPT, "text/event-stream")
        // A2A v1.0 requires the version header; the SDK server rejects a
        // request without it as legacy 0.3.
        .header("A2A-Version", "1.0")
        .json(&rpc_body)
        .timeout(UPSTREAM_TIMEOUT)
        .send()
        .await;

    let upstream = match upstream {
        Ok(response) if response.status().is_success() => response,
        Ok(response) => {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            tracing::error!("[a2a-middleware] Upstream HTTP {status}: {text}");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("Upstream agent returned HTTP {status}") })),
            )
                .into_response();
        }
        Err(error) => {
            tracing::error!("[a2a-middleware] Upstream request failed: {error}");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": error.to_string() })),
            )
                .into_response();
        }
    };

    let is_sse = upstream
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.contains("text/event-stream"))
        .unwrap_or(false);

    if !is_sse {
        // Non-streaming upstream: relay the single result.
        let body: Value = match upstream.json().await {
            Ok(body) => body,
            Err(error) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": error.to_string() })),
                )
                    .into_response();
            }
        };
        if let Some(error) = body.get("error") {
            let message = error
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("Upstream agent error");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": message })),
            )
                .into_response();
        }
        let result = body.get("result").cloned().unwrap_or(body);
        let (parts, context_id) = result_parts(&result);
        return Json(json!({ "parts": parts, "contextId": context_id })).into_response();
    }

    // Streaming upstream: relay every result that carries parts.
    let (tx, rx) = mpsc::channel::<Result<Event, Infallible>>(32);
    tokio::spawn(async move {
        let mut stream = upstream.bytes_stream();
        let mut buffer = String::new();
        while let Some(chunk) = stream.next().await {
            let Ok(chunk) = chunk else { break };
            buffer.push_str(&String::from_utf8_lossy(&chunk));
            while let Some(index) = buffer.find("\n\n") {
                let frame = buffer[..index].to_string();
                buffer = buffer[index + 2..].to_string();
                let Some(payload) = parse_sse_data(&frame) else {
                    continue;
                };
                if let Some(error) = payload.get("error") {
                    let message = error
                        .get("message")
                        .and_then(Value::as_str)
                        .unwrap_or("Upstream agent error");
                    let frame = json!({ "error": message });
                    let _ = tx.send(Ok(Event::default().data(frame.to_string()))).await;
                    return;
                }
                let Some(result) = payload.get("result") else {
                    continue;
                };
                let (parts, context_id) = result_parts(result);
                if parts.is_empty() {
                    continue;
                }
                let frame = json!({ "parts": parts, "contextId": context_id });
                if tx.send(Ok(Event::default().data(frame.to_string()))).await.is_err() {
                    return;
                }
            }
        }
    });

    let mut response = Sse::new(ReceiverStream::new(rx)).into_response();
    let headers = response.headers_mut();
    headers.insert(
        header::CACHE_CONTROL,
        axum::http::HeaderValue::from_static("no-cache"),
    );
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

/// Wraps the request body into an A2A `SendMessageRequest`.
pub fn build_send_message_request(original: &str) -> Value {
    let parsed = serde_json::from_str::<Value>(original)
        .ok()
        .filter(Value::is_object);

    let (parts, context_id) = match parsed {
        Some(Value::Object(map)) => {
            let context_id = map.get("contextId").cloned().filter(|value| !value.is_null());
            let event = map.get("event").filter(|value| is_truthy(value)).cloned();
            let query = map
                .get("query")
                .and_then(Value::as_str)
                .filter(|query| !query.is_empty())
                .map(str::to_string);
            let parts = if let Some(event) = event {
                vec![data_part(&event)]
            } else if let Some(query) = query {
                vec![text_part(query)]
            } else {
                // Legacy: the whole object is the UI payload.
                vec![data_part(&Value::Object(map.clone()))]
            };
            (parts, context_id)
        }
        _ => (vec![text_part(original)], None),
    };

    json!({
        "tenant": "",
        "message": {
            "messageId": uuid::Uuid::new_v4().to_string(),
            "contextId": context_id.unwrap_or_else(|| json!("")),
            "taskId": "",
            "role": "ROLE_USER",
            "parts": parts,
            "extensions": [],
            "referenceTaskIds": [],
        },
    })
}

/// Truthiness of a JSON value, as the TS middleware's `if (requestData.event)`.
fn is_truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(flag) => *flag,
        Value::Number(number) => number.as_f64().map(|value| value != 0.0).unwrap_or(true),
        Value::String(text) => !text.is_empty(),
        Value::Array(items) => !items.is_empty(),
        Value::Object(map) => !map.is_empty(),
    }
}

/// Fetches the agent card and returns its JSON-RPC dial URL.
async fn resolve_dial_url(client: &reqwest::Client, card_url: &str) -> Result<String, String> {
    let card: Value = client
        .get(card_url)
        .timeout(UPSTREAM_TIMEOUT)
        .send()
        .await
        .map_err(|error| format!("{card_url}: {error}"))?
        .json()
        .await
        .map_err(|error| format!("{card_url}: {error}"))?;

    if let Some(url) = card
        .get("supportedInterfaces")
        .and_then(Value::as_array)
        .and_then(|interfaces| interfaces.first())
        .and_then(|interface| interface.get("url"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|url| !url.is_empty())
    {
        return Ok(url.to_string());
    }

    // Fall back to the card's origin.
    Ok(card_url
        .strip_suffix("/.well-known/agent-card.json")
        .unwrap_or(card_url)
        .to_string())
}

/// Extracts `{ parts, contextId }` from any A2A stream result / response.
pub fn result_parts(result: &Value) -> (Vec<Value>, Value) {
    let empty = Vec::new();
    if let Some(task) = result.get("task") {
        let parts = task
            .get("status")
            .and_then(|status| status.get("message"))
            .and_then(|message| message.get("parts"))
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or(empty);
        return (parts, task.get("contextId").cloned().unwrap_or(Value::Null));
    }
    if let Some(message) = result.get("message") {
        let parts = message
            .get("parts")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or(empty);
        return (
            parts,
            message.get("contextId").cloned().unwrap_or(Value::Null),
        );
    }
    for key in ["statusUpdate", "status_update"] {
        if let Some(update) = result.get(key) {
            let parts = update
                .get("status")
                .and_then(|status| status.get("message"))
                .and_then(|message| message.get("parts"))
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or(empty);
            return (
                parts,
                update.get("contextId").cloned().unwrap_or(Value::Null),
            );
        }
    }
    for key in ["artifactUpdate", "artifact_update"] {
        if let Some(update) = result.get(key) {
            let parts = update
                .get("artifact")
                .and_then(|artifact| artifact.get("parts"))
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or(empty);
            return (
                parts,
                update.get("contextId").cloned().unwrap_or(Value::Null),
            );
        }
    }
    (empty, Value::Null)
}

/// Parses one SSE frame's `data:` payload.
fn parse_sse_data(frame: &str) -> Option<Value> {
    let data = frame
        .lines()
        .filter_map(|line| line.strip_prefix("data: "))
        .collect::<Vec<_>>()
        .join("\n");
    if data.trim().is_empty() {
        return None;
    }
    serde_json::from_str(&data).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_queries_become_text_parts() {
        let request = build_send_message_request(r#"{"query":"hello","contextId":"ctx-1"}"#);
        assert_eq!(request["message"]["role"], "ROLE_USER");
        assert_eq!(request["message"]["parts"][0]["text"], "hello");
        assert_eq!(request["message"]["parts"][0]["mediaType"], "text/plain");
        assert_eq!(request["message"]["contextId"], "ctx-1");
        assert_eq!(request["message"]["extensions"], json!([]));
    }

    #[test]
    fn ui_events_become_data_parts() {
        let request = build_send_message_request(
            r#"{"event":{"version":"v0.9","createSurface":{}},"contextId":"ctx"}"#,
        );
        assert_eq!(
            request["message"]["parts"][0]["mediaType"],
            "application/a2ui+json"
        );
        assert_eq!(
            request["message"]["parts"][0]["metadata"]["mimeType"],
            "application/a2ui+json"
        );
        // The part's `data` is the UI event itself (no wrapper object).
        assert_eq!(request["message"]["parts"][0]["data"]["version"], "v0.9");
        assert_eq!(
            request["message"]["parts"][0]["data"]["createSurface"],
            json!({})
        );
        assert_eq!(request["message"]["contextId"], "ctx");
    }

    #[test]
    fn legacy_json_and_plain_text_are_supported() {
        let legacy = build_send_message_request(r#"{"foo":"bar"}"#);
        assert_eq!(legacy["message"]["parts"][0]["data"]["foo"], "bar");

        let plain = build_send_message_request("just text");
        assert_eq!(plain["message"]["parts"][0]["text"], "just text");
        assert_eq!(plain["message"]["contextId"], "");
    }

    #[test]
    fn result_parts_cover_every_stream_shape() {
        let (parts, context) = result_parts(&json!({
            "task": { "contextId": "c1", "status": { "message": { "parts": [{ "text": "a" }] } } }
        }));
        assert_eq!(parts[0]["text"], "a");
        assert_eq!(context, "c1");

        let (parts, _) = result_parts(&json!({
            "message": { "contextId": "c2", "parts": [{ "text": "b" }] }
        }));
        assert_eq!(parts[0]["text"], "b");

        let (parts, _) = result_parts(&json!({
            "statusUpdate": { "contextId": "c3", "status": { "message": { "parts": [{ "text": "c" }] } } }
        }));
        assert_eq!(parts[0]["text"], "c");

        let (parts, _) = result_parts(&json!({
            "artifactUpdate": { "contextId": "c4", "artifact": { "parts": [{ "data": 1 }] } }
        }));
        assert_eq!(parts[0]["data"], 1);

        let (parts, _) = result_parts(&json!({}));
        assert!(parts.is_empty());
    }

    #[test]
    fn sse_frames_are_parsed() {
        assert_eq!(
            parse_sse_data("event: message\ndata: {\"a\":1}"),
            Some(json!({"a": 1}))
        );
        assert_eq!(parse_sse_data("event: ping"), None);
    }
}