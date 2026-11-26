//! A2A v1.0 JSON builders.
//!
//! Shapes mirror what `@a2a-js/sdk`'s `toJSON` helpers emit (camelCase fields,
//! enum **names** such as `TASK_STATE_WORKING`, empty arrays/strings omitted),
//! because the frontend's A2A client parses exactly that wire format.

use serde_json::{json, Map, Value};

use crate::acp::stores::iso_now;

pub const STATE_SUBMITTED: &str = "TASK_STATE_SUBMITTED";
pub const STATE_WORKING: &str = "TASK_STATE_WORKING";
pub const STATE_COMPLETED: &str = "TASK_STATE_COMPLETED";
pub const STATE_FAILED: &str = "TASK_STATE_FAILED";
pub const STATE_CANCELED: &str = "TASK_STATE_CANCELED";

/// Text part (`{ text, mediaType }`).
pub fn text_part(text: impl Into<String>) -> Value {
    json!({ "text": text.into(), "mediaType": "text/plain" })
}

/// Data part carrying an A2UI payload.
pub fn data_part(value: &Value) -> Value {
    json!({
        "data": value,
        "metadata": { "mimeType": "application/a2ui+json" },
        "mediaType": "application/a2ui+json",
    })
}

/// Concatenated text of a message's text parts (`extractText` in the TS bridge).
pub fn extract_text(message: &Value) -> String {
    message
        .get("parts")
        .and_then(Value::as_array)
        .map(|parts| {
            parts
                .iter()
                .filter_map(|part| part.get("text").and_then(Value::as_str))
                .filter(|text| !text.is_empty())
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default()
        .trim()
        .to_string()
}

/// Pulls an `agent_message_chunk` delta out of an ACP session event.
pub fn extract_agent_chunk(event: &Value) -> Option<String> {
    if event.get("type").and_then(Value::as_str) != Some("session_update") {
        return None;
    }
    let update = &event["payload"]["update"];
    if update.get("sessionUpdate").and_then(Value::as_str) != Some("agent_message_chunk") {
        return None;
    }
    update
        .get("content")
        .and_then(|content| content.get("text"))
        .and_then(Value::as_str)
        .map(str::to_string)
}

/// `TaskStatus` object (`{ state, message?, timestamp }`).
pub fn task_status(state: &str, message: Option<Value>) -> Value {
    let mut status = Map::new();
    status.insert("state".to_string(), json!(state));
    if let Some(message) = message {
        status.insert("message".to_string(), message);
    }
    status.insert("timestamp".to_string(), json!(iso_now()));
    Value::Object(status)
}

/// Agent-authored status message.
pub fn agent_message(task_id: &str, context_id: &str, text: &str) -> Value {
    json!({
        "messageId": format!("status-{task_id}-{}", crate::server::now_ms()),
        "role": "ROLE_AGENT",
        "parts": [text_part(text)],
        "taskId": task_id,
        "contextId": context_id,
    })
}

/// `StreamResponse` wrapping a task snapshot.
pub fn task_event(task: Value) -> Value {
    json!({ "task": task })
}

/// `StreamResponse` wrapping a status update.
pub fn status_event(
    task_id: &str,
    context_id: &str,
    status: Value,
    metadata: Option<Value>,
) -> Value {
    let mut update = json!({
        "taskId": task_id,
        "contextId": context_id,
        "status": status,
    });
    if let Some(metadata) = metadata {
        update["metadata"] = metadata;
    }
    json!({ "statusUpdate": update })
}

/// `TaskArtifactUpdateEvent` payload.
#[allow(clippy::too_many_arguments)]
pub fn artifact_event(
    task_id: &str,
    context_id: &str,
    artifact_id: &str,
    name: &str,
    description: &str,
    parts: Vec<Value>,
    metadata: Value,
    append: bool,
    last_chunk: bool,
) -> Value {
    let mut artifact = json!({
        "artifactId": artifact_id,
        "name": name,
        "description": description,
        "metadata": metadata,
    });
    if !parts.is_empty() {
        artifact["parts"] = json!(parts);
    }

    let mut update = json!({
        "taskId": task_id,
        "contextId": context_id,
        "artifact": artifact,
    });
    if append {
        update["append"] = json!(true);
    }
    if last_chunk {
        update["lastChunk"] = json!(true);
    }
    json!({ "artifactUpdate": update })
}

/// Task snapshot for the first stream event / `GetTask`.
pub fn task_snapshot(
    id: &str,
    context_id: &str,
    status: Value,
    artifacts: Vec<Value>,
    history: Vec<Value>,
    metadata: Option<Value>,
) -> Value {
    let mut task = json!({ "id": id, "contextId": context_id, "status": status });
    if !artifacts.is_empty() {
        task["artifacts"] = json!(artifacts);
    }
    if !history.is_empty() {
        task["history"] = json!(history);
    }
    if let Some(metadata) = metadata {
        task["metadata"] = metadata;
    }
    task
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_is_joined_and_trimmed() {
        let message = json!({
            "parts": [
                { "text": "  hello  " },
                { "data": { "a": 1 } },
                { "text": "" },
                { "text": "world" }
            ]
        });
        assert_eq!(extract_text(&message), "hello  \nworld");
        assert_eq!(extract_text(&json!({})), "");
    }

    #[test]
    fn agent_chunks_are_extracted() {
        let event = json!({
            "type": "session_update",
            "payload": {
                "update": {
                    "sessionUpdate": "agent_message_chunk",
                    "content": { "type": "text", "text": "hi" }
                }
            }
        });
        assert_eq!(extract_agent_chunk(&event).as_deref(), Some("hi"));

        let tool = json!({
            "type": "session_update",
            "payload": { "update": { "sessionUpdate": "tool_call", "content": { "text": "x" } } }
        });
        assert!(extract_agent_chunk(&tool).is_none());
        assert!(extract_agent_chunk(&json!({ "type": "prompt_complete" })).is_none());
    }

    #[test]
    fn status_event_omits_empty_metadata() {
        let status = task_status(STATE_WORKING, Some(agent_message("t1", "c1", "Calling…")));
        assert_eq!(status["state"], "TASK_STATE_WORKING");
        assert_eq!(status["message"]["role"], "ROLE_AGENT");
        assert_eq!(status["message"]["parts"][0]["text"], "Calling…");
        assert!(status["timestamp"].as_str().unwrap_or_default().ends_with('Z'));

        let event = status_event("t1", "c1", status, None);
        assert!(event["statusUpdate"].get("metadata").is_none());
        assert_eq!(event["statusUpdate"]["taskId"], "t1");
    }

    #[test]
    fn artifact_events_skip_false_flags_and_empty_parts() {
        let chunk = artifact_event(
            "t1",
            "c1",
            "a1",
            "AgentReply",
            "Mock's reply",
            vec![text_part("delta")],
            json!({ "turn": 1 }),
            false,
            false,
        );
        assert!(chunk["artifactUpdate"].get("append").is_none());
        assert!(chunk["artifactUpdate"].get("lastChunk").is_none());
        assert_eq!(
            chunk["artifactUpdate"]["artifact"]["parts"][0]["text"],
            "delta"
        );

        let close = artifact_event(
            "t1",
            "c1",
            "a1",
            "AgentReply",
            "Mock's reply",
            Vec::new(),
            json!({}),
            true,
            true,
        );
        assert_eq!(close["artifactUpdate"]["append"], true);
        assert_eq!(close["artifactUpdate"]["lastChunk"], true);
        assert!(close["artifactUpdate"]["artifact"].get("parts").is_none());
    }

    #[test]
    fn task_snapshots_omit_empty_collections() {
        let task = task_snapshot(
            "t1",
            "c1",
            task_status(STATE_SUBMITTED, None),
            Vec::new(),
            Vec::new(),
            None,
        );
        assert_eq!(task["id"], "t1");
        assert!(task.get("artifacts").is_none());
        assert!(task.get("history").is_none());
        assert!(task.get("metadata").is_none());
    }
}