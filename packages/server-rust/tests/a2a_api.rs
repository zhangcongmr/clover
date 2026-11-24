//! A2A tests (P8): collaboration spaces, agent cards, the JSON-RPC bridge and
//! the public `/a2a` proxy.
//!
//! The bridge tests drive the mock ACP agent, so the whole path runs for real:
//! space create 鈫?ACP session 鈫?prompt 鈫?streamed artifact 鈫?terminal status.
//! The proxy test spawns the real `clover serve` binary with `A2A_AGENT_CARD_URL`
//! pointing at an in-process mock upstream agent.

use std::convert::Infallible;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::response::sse::{Event, Sse};
use axum::routing::{get, post};
use axum::{Json, Router};
use clover_server::{bind, start_with_listener, Config, CorsPolicy, Handle, PortPolicy};
use futures_util::{StreamExt, stream};
use serde_json::{json, Value};

struct TestHome(PathBuf);

impl TestHome {
    fn new() -> Self {
        let path = PathBuf::from(env!("CARGO_TARGET_TMPDIR"))
            .join(format!("clover-a2a-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(path.join(".clover")).expect("create temp home");
        std::fs::create_dir_all(path.join("workspace")).expect("create workspace");
        Self(path)
    }

    fn path(&self) -> &Path {
        &self.0
    }

    fn state_dir(&self) -> PathBuf {
        self.0.join(".clover")
    }

    fn workspace(&self) -> String {
        self.0.join("workspace").to_string_lossy().to_string()
    }

    fn write_mock_agent(&self) {
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests")
            .join("fixtures")
            .join("mock-acp-agent.mjs");
        let config = json!({
            "version": "1.0.0",
            "agents": [{
                "id": "mock",
                "name": "Mock Agent",
                "command": "node",
                "args": [fixture.to_string_lossy()],
                "description": "Mock coding agent",
                "source": "disk",
                "installed": true,
            }],
        });
        std::fs::write(
            self.state_dir().join("acp.json"),
            serde_json::to_string_pretty(&config).expect("json"),
        )
        .expect("write acp.json");
    }
}

impl Drop for TestHome {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

struct TestServer {
    handle: Handle,
    base: String,
    token: String,
}

async fn spawn(home: &TestHome) -> TestServer {
    let listener = bind("127.0.0.1", 0, PortPolicy::Strict).expect("bind");
    let port = listener.local_addr().expect("addr").port();
    let handle = start_with_listener(
        listener,
        Config {
            host: "127.0.0.1".to_string(),
            port,
            port_policy: PortPolicy::Strict,
            readonly: false,
            cors: CorsPolicy::AllowAny,
            static_dir: None,
            state_dir: Some(home.state_dir()),
            home_dir: Some(home.path().to_path_buf()),
            warmup_agents: false,
        },
    )
    .await
    .expect("start");

    let base = format!("http://127.0.0.1:{port}");
    let token: Value = reqwest::Client::new()
        .get(format!("{base}/api/local/auth/token"))
        .send()
        .await
        .expect("token")
        .json()
        .await
        .expect("token json");

    TestServer {
        handle,
        base,
        token: token["token"].as_str().expect("token").to_string(),
    }
}

impl TestServer {
    async fn get(&self, path: &str) -> (u16, Value) {
        let response = reqwest::Client::new()
            .get(format!("{}{path}", self.base))
            .bearer_auth(&self.token)
            .send()
            .await
            .expect("request");
        let status = response.status().as_u16();
        (status, response.json().await.unwrap_or(Value::Null))
    }

    async fn post(&self, path: &str, body: Value) -> (u16, Value) {
        let response = reqwest::Client::new()
            .post(format!("{}{path}", self.base))
            .bearer_auth(&self.token)
            .header("A2A-Version", "1.0")
            .json(&body)
            .send()
            .await
            .expect("request");
        let status = response.status().as_u16();
        (status, response.json().await.unwrap_or(Value::Null))
    }

    async fn post_no_auth(&self, path: &str, body: Value) -> u16 {
        reqwest::Client::new()
            .post(format!("{}{path}", self.base))
            .json(&body)
            .send()
            .await
            .expect("request")
            .status()
            .as_u16()
    }

    async fn delete(&self, path: &str) -> (u16, Value) {
        let response = reqwest::Client::new()
            .delete(format!("{}{path}", self.base))
            .bearer_auth(&self.token)
            .send()
            .await
            .expect("request");
        let status = response.status().as_u16();
        (status, response.json().await.unwrap_or(Value::Null))
    }

    /// POST a JSON-RPC request and collect every SSE `result` frame.
    async fn stream_rpc(&self, path: &str, body: Value) -> Vec<Value> {
        let response = reqwest::Client::new()
            .post(format!("{}{path}", self.base))
            .bearer_auth(&self.token)
            .header("Accept", "text/event-stream")
            .header("A2A-Version", "1.0")
            .json(&body)
            .send()
            .await
            .expect("rpc response");
        assert_eq!(response.status(), 200);
        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .to_string();
        assert!(
            content_type.contains("text/event-stream"),
            "unexpected content type: {content_type}"
        );

        let mut frames = Vec::new();
        let mut stream = response.bytes_stream();
        let mut buffer = String::new();
        let deadline = tokio::time::Instant::now() + Duration::from_secs(40);
        loop {
            let chunk = tokio::time::timeout(Duration::from_secs(10), stream.next())
                .await
                .unwrap_or_else(|_| panic!("stream stalled, frames: {frames:?}"));
            let Some(Ok(chunk)) = chunk else { break };
            buffer.push_str(&String::from_utf8_lossy(&chunk));
            while let Some(index) = buffer.find("\n\n") {
                let frame = buffer[..index].to_string();
                buffer = buffer[index + 2..].to_string();
                for line in frame.lines() {
                    if let Some(data) = line.strip_prefix("data: ")
                        && let Ok(value) = serde_json::from_str::<Value>(data)
                    {
                        frames.push(value);
                    }
                }
            }
            assert!(
                tokio::time::Instant::now() < deadline,
                "stream never finished: {frames:?}"
            );
        }
        frames
    }
}

fn send_message_body(space_id: &str, prompt: &str) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": "req-1",
        "method": "SendStreamingMessage",
        "params": {
            "tenant": "",
            "message": {
                "messageId": "msg-1",
                "contextId": "",
                "taskId": "",
                "role": "ROLE_USER",
                "parts": [{ "text": prompt, "mediaType": "text/plain" }],
                "metadata": { "collab": { "spaceId": space_id } },
                "extensions": [],
                "referenceTaskIds": []
            },
            "metadata": { "collab": { "spaceId": space_id } }
        }
    })
}

async fn create_space(server: &TestServer, home: &TestHome, participant_ids: &[&str]) -> String {
    let participants: Vec<Value> = participant_ids
        .iter()
        .map(|id| json!({ "id": id, "agentId": "mock" }))
        .collect();
    let (status, body) = server
        .post(
            "/api/a2a/collab/spaces",
            json!({ "cwd": home.workspace(), "participants": participants }),
        )
        .await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["success"], true);
    body["spaceId"].as_str().expect("spaceId").to_string()
}

/// Task snapshot events carry `result.task`; status events `result.statusUpdate`.
fn event_kind(frame: &Value) -> &str {
    let result = &frame["result"];
    if result.get("task").is_some() {
        "task"
    } else if result.get("statusUpdate").is_some() {
        "statusUpdate"
    } else if result.get("artifactUpdate").is_some() {
        "artifactUpdate"
    } else if result.get("message").is_some() {
        "message"
    } else {
        "unknown"
    }
}

fn status_state(frame: &Value) -> Option<&str> {
    frame["result"]["statusUpdate"]["status"]["state"].as_str()
}

fn artifact_text(frames: &[Value]) -> String {
    frames
        .iter()
        .filter_map(|frame| {
            frame["result"]["artifactUpdate"]["artifact"]["parts"]
                .as_array()
                .map(|parts| {
                    parts
                        .iter()
                        .filter_map(|part| part.get("text").and_then(Value::as_str))
                        .collect::<String>()
                })
        })
        .collect()
}

#[tokio::test]
async fn space_lifecycle_and_validation() {
    if !clover_server::acp::probe::probe_path_command("node").await.found {
        eprintln!("skipping: node is not on PATH");
        return;
    }

    let home = TestHome::new();
    home.write_mock_agent();
    let server = spawn(&home).await;

    // Auth is required on the collab surface.
    assert_eq!(
        server
            .post_no_auth("/api/a2a/collab/spaces", json!({}))
            .await,
        401
    );

    let workspace = home.workspace();
    let (status, body) = server
        .post(
            "/api/a2a/collab/spaces",
            json!({ "participants": [{ "id": "p1", "agentId": "mock" }] }),
        )
        .await;
    assert_eq!(status, 400);
    assert_eq!(
        body["message"],
        "cwd is required to create a collaboration space"
    );

    let (status, body) = server
        .post(
            "/api/a2a/collab/spaces",
            json!({ "cwd": workspace, "participants": [] }),
        )
        .await;
    assert_eq!(status, 400);
    assert_eq!(body["message"], "participants must contain at least one session");

    let (status, body) = server
        .post(
            "/api/a2a/collab/spaces",
            json!({ "cwd": workspace, "participants": [{ "id": "p1", "agentId": "nope" }] }),
        )
        .await;
    assert_eq!(status, 400);
    assert_eq!(body["message"], "Unknown agent: nope");

    let (status, body) = server
        .post(
            "/api/a2a/collab/spaces",
            json!({
                "cwd": workspace,
                "participants": [
                    { "id": "p1", "agentId": "mock" },
                    { "id": "p1", "agentId": "mock" }
                ]
            }),
        )
        .await;
    assert_eq!(status, 400);
    assert_eq!(body["message"], "Duplicate participant id: p1");

    let (status, body) = server
        .post(
            "/api/a2a/collab/spaces",
            json!({
                "cwd": workspace,
                "participants": [{ "id": "p1", "agentId": "mock" }],
                "orchestratorId": "p2"
            }),
        )
        .await;
    assert_eq!(status, 400);
    assert_eq!(
        body["message"],
        "orchestratorId must be a participant of the collaboration space"
    );

    // Successful creation.
    let (status, body) = server
        .post(
            "/api/a2a/collab/spaces",
            json!({
                "cwd": workspace,
                "participants": [{
                    "id": "p1",
                    "agentId": "mock",
                    "role": "reviewer",
                    "responsibility": "review code"
                }],
                "orchestratorId": "p1"
            }),
        )
        .await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["success"], true);
    assert_eq!(body["cwd"], workspace);
    assert_eq!(body["orchestratorId"], "p1");
    assert_eq!(body["participants"][0]["id"], "p1");
    assert_eq!(body["participants"][0]["agentId"], "mock");
    assert_eq!(body["participants"][0]["sessionId"], "mock-session");
    assert_eq!(body["participants"][0]["configOptions"], json!([]));
    assert_eq!(body["participants"][0]["role"], "reviewer");
    let space_id = body["spaceId"].as_str().expect("spaceId").to_string();

    // Closing twice: second is a 404 with the TS wording.
    let (status, body) = server
        .delete(&format!("/api/a2a/collab/spaces/{space_id}"))
        .await;
    assert_eq!(status, 200);
    assert_eq!(body, json!({ "success": true }));
    let (status, body) = server
        .delete(&format!("/api/a2a/collab/spaces/{space_id}"))
        .await;
    assert_eq!(status, 404);
    assert_eq!(body["message"], "Collaboration space not found");

    server.handle.shutdown().await;
}

#[tokio::test]
async fn agent_cards_advertise_the_dial_url() {
    let home = TestHome::new();
    home.write_mock_agent();
    let server = spawn(&home).await;

    let (status, card) = server
        .get("/api/a2a/orchestrator/.well-known/agent-card.json")
        .await;
    assert_eq!(status, 200);
    assert_eq!(card["name"], "Collaboration Orchestrator");
    assert_eq!(card["supportedInterfaces"][0]["protocolBinding"], "JSONRPC");
    assert_eq!(
        card["supportedInterfaces"][0]["url"],
        format!("{}/api/a2a/orchestrator/", server.base)
    );
    assert_eq!(card["capabilities"]["streaming"], true);
    assert_eq!(card["skills"][0]["id"], "multi_agent_collab");

    let (status, card) = server
        .get("/api/a2a/agents/mock/.well-known/agent-card.json")
        .await;
    assert_eq!(status, 200);
    assert_eq!(card["name"], "Mock Agent");
    assert_eq!(card["description"], "Mock coding agent");
    assert_eq!(
        card["supportedInterfaces"][0]["url"],
        format!("{}/api/a2a/agents/mock/", server.base)
    );
    assert_eq!(card["skills"][0]["id"], "mock");

    let (status, body) = server
        .get("/api/a2a/agents/nope/.well-known/agent-card.json")
        .await;
    assert_eq!(status, 404);
    assert_eq!(body["message"], "Unknown agent: nope");

    server.handle.shutdown().await;
}

#[tokio::test]
async fn streaming_single_collaboration_streams_status_and_artifact() {
    if !clover_server::acp::probe::probe_path_command("node").await.found {
        eprintln!("skipping: node is not on PATH");
        return;
    }

    let home = TestHome::new();
    home.write_mock_agent();
    let server = spawn(&home).await;
    let space_id = create_space(&server, &home, &["p1"]).await;

    let frames = server
        .stream_rpc("/api/a2a/orchestrator/", send_message_body(&space_id, "hello"))
        .await
        .expect_frames();

    let kinds: Vec<&str> = frames.iter().map(event_kind).collect();
    assert_eq!(kinds[0], "task", "{frames:?}");
    assert!(kinds.contains(&"statusUpdate"));
    assert!(kinds.contains(&"artifactUpdate"));

    // Task snapshot starts in SUBMITTED.
    assert_eq!(
        frames[0]["result"]["task"]["status"]["state"],
        "TASK_STATE_SUBMITTED"
    );
    let task_id = frames[0]["result"]["task"]["id"]
        .as_str()
        .expect("task id")
        .to_string();

    let states: Vec<&str> = frames.iter().filter_map(status_state).collect();
    assert_eq!(states.first(), Some(&"TASK_STATE_WORKING"), "{states:?}");
    assert_eq!(states.last(), Some(&"TASK_STATE_COMPLETED"), "{states:?}");

    // The agent's text arrives as appended artifact chunks.
    assert_eq!(artifact_text(&frames), "hello from mock");
    let last_artifact = frames
        .iter()
        .rev()
        .find_map(|frame| frame["result"]["artifactUpdate"].as_object())
        .expect("artifact update");
    assert_eq!(last_artifact["lastChunk"], true);
    assert_eq!(last_artifact["append"], true);
    assert_eq!(last_artifact["artifact"]["artifactId"], format!("{task_id}-reply"));
    assert_eq!(last_artifact["artifact"]["metadata"]["participantId"], "p1");
    assert_eq!(last_artifact["artifact"]["metadata"]["agentId"], "mock");

    // Every frame echoes the JSON-RPC id.
    assert!(frames.iter().all(|frame| frame["id"] == "req-1"), "{frames:?}");

    // GetTask returns the stored snapshot.
    let (status, body) = server
        .post(
            "/api/a2a/orchestrator/",
            json!({ "jsonrpc": "2.0", "id": 2, "method": "GetTask", "params": { "id": task_id } }),
        )
        .await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(
        body["result"]["status"]["state"],
        "TASK_STATE_COMPLETED",
        "{body}"
    );
    assert_eq!(body["result"]["contextId"], frames[0]["result"]["task"]["contextId"]);

    server.handle.shutdown().await;
}

#[tokio::test]
async fn non_streaming_send_message_returns_the_task() {
    if !clover_server::acp::probe::probe_path_command("node").await.found {
        eprintln!("skipping: node is not on PATH");
        return;
    }

    let home = TestHome::new();
    home.write_mock_agent();
    let server = spawn(&home).await;
    let space_id = create_space(&server, &home, &["p1"]).await;

    let mut body = send_message_body(&space_id, "hello");
    body["method"] = json!("SendMessage");

    let (status, body) = server.post("/api/a2a/orchestrator/", body).await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["jsonrpc"], "2.0");
    assert_eq!(body["id"], "req-1");
    assert_eq!(
        body["result"]["task"]["status"]["state"],
        "TASK_STATE_COMPLETED",
        "{body}"
    );
    let artifacts = body["result"]["task"]["artifacts"]
        .as_array()
        .expect("artifacts");
    assert_eq!(artifacts[0]["parts"][0]["text"], "hello from mock");

    server.handle.shutdown().await;
}

#[tokio::test]
async fn pipeline_mode_runs_every_stage_in_order() {
    if !clover_server::acp::probe::probe_path_command("node").await.found {
        eprintln!("skipping: node is not on PATH");
        return;
    }

    let home = TestHome::new();
    home.write_mock_agent();
    let server = spawn(&home).await;
    let space_id = create_space(&server, &home, &["p1", "p2"]).await;

    let mut body = send_message_body(&space_id, "start");
    let collab = json!({
        "spaceId": space_id,
        "pipeline": { "mode": "static", "order": ["p1", "p2"], "maxTurns": 4 }
    });
    body["params"]["message"]["metadata"]["collab"] = collab.clone();
    body["params"]["metadata"]["collab"] = collab;

    let frames = server.stream_rpc("/api/a2a/orchestrator/", body).await.expect_frames();

    let states: Vec<&str> = frames.iter().filter_map(status_state).collect();
    assert_eq!(states.last(), Some(&"TASK_STATE_COMPLETED"), "{states:?}");

    let texts: Vec<String> = frames
        .iter()
        .filter_map(|frame| {
            frame["result"]["statusUpdate"]["status"]["message"]["parts"][0]["text"]
                .as_str()
                .map(str::to_string)
        })
        .collect();
    assert!(texts.iter().any(|text| text.contains("Turn 1: calling")), "{texts:?}");
    assert!(texts.iter().any(|text| text.contains("Turn 2: calling")), "{texts:?}");
    assert!(
        texts.iter().any(|text| text.contains("Pipeline collaboration task finished")),
        "{texts:?}"
    );

    // Both turns streamed an artifact (first chunk has no `append` flag).
    let artifacts: Vec<&str> = frames
        .iter()
        .filter_map(|frame| frame["result"]["artifactUpdate"]["artifact"]["artifactId"].as_str())
        .collect();
    assert!(artifacts.iter().any(|id| id.ends_with("-reply-1")), "{artifacts:?}");
    assert!(artifacts.iter().any(|id| id.ends_with("-reply-2")), "{artifacts:?}");

    server.handle.shutdown().await;
}

#[tokio::test]
async fn parallel_mode_runs_sub_tasks_and_reports_completion() {
    if !clover_server::acp::probe::probe_path_command("node").await.found {
        eprintln!("skipping: node is not on PATH");
        return;
    }

    let home = TestHome::new();
    home.write_mock_agent();
    let server = spawn(&home).await;
    let space_id = create_space(&server, &home, &["p1", "p2"]).await;

    let mut body = send_message_body(&space_id, "");
    let collab = json!({
        "spaceId": space_id,
        "parallel": {
            "enabled": true,
            "maxConcurrency": 2,
            "subTasks": [
                { "id": "s1", "prompt": "first", "targetAgentId": "p1" },
                { "id": "s2", "prompt": "second", "targetAgentId": "p2" }
            ]
        }
    });
    body["params"]["message"]["parts"] = json!([{ "text": "", "mediaType": "text/plain" }]);
    body["params"]["message"]["metadata"]["collab"] = collab.clone();
    body["params"]["metadata"]["collab"] = collab;

    let frames = server.stream_rpc("/api/a2a/orchestrator/", body).await.expect_frames();

    let states: Vec<&str> = frames.iter().filter_map(status_state).collect();
    assert_eq!(states.last(), Some(&"TASK_STATE_COMPLETED"), "{states:?}");

    let artifacts: Vec<&str> = frames
        .iter()
        .filter_map(|frame| frame["result"]["artifactUpdate"].as_object())
        .filter(|artifact| artifact["artifact"]["artifactId"].as_str().is_some())
        .filter_map(|artifact| artifact["artifact"]["artifactId"].as_str())
        .collect();
    assert!(artifacts.iter().any(|id| id.ends_with("-sub-s1")), "{artifacts:?}");
    assert!(artifacts.iter().any(|id| id.ends_with("-sub-s2")), "{artifacts:?}");

    let texts: Vec<String> = frames
        .iter()
        .filter_map(|frame| {
            frame["result"]["statusUpdate"]["status"]["message"]["parts"][0]["text"]
                .as_str()
                .map(str::to_string)
        })
        .collect();
    assert!(texts.iter().any(|text| text == "Parallel task finished"), "{texts:?}");

    server.handle.shutdown().await;
}

#[tokio::test]
async fn jsonrpc_errors_match_the_protocol() {
    let home = TestHome::new();
    home.write_mock_agent();
    let server = spawn(&home).await;

    // Unknown method.
    let (status, body) = server
        .post(
            "/api/a2a/orchestrator/",
            json!({ "jsonrpc": "2.0", "id": 7, "method": "UnknownMethod", "params": {} }),
        )
        .await;
    assert_eq!(status, 200);
    assert_eq!(body["id"], 7);
    assert_eq!(body["error"]["code"], -32601);
    assert_eq!(body["error"]["message"], "Invalid method.");

    // Wrong protocol version (the SDK rejects both the absent header and 0.3).
    let (_, body) = server
        .post(
            "/api/a2a/orchestrator/",
            json!({ "jsonrpc": "1.0", "id": 8, "method": "GetTask", "params": {} }),
        )
        .await;
    assert_eq!(body["error"]["code"], -32602);
    assert_eq!(body["error"]["message"], "Invalid JSON-RPC Request.");

    // A missing `A2A-Version` header means the legacy 0.3 wire version.
    let response = reqwest::Client::new()
        .post(format!("{}/api/a2a/orchestrator/", server.base))
        .bearer_auth(&server.token)
        .json(&json!({ "jsonrpc": "2.0", "id": 8, "method": "GetTask", "params": { "id": "x" } }))
        .send()
        .await
        .expect("request");
    let body: Value = response.json().await.expect("json");
    assert_eq!(body["error"]["code"], -32009);
    assert_eq!(
        body["error"]["message"],
        "The requested A2A protocol version '0.3' is not supported. Supported versions: 1.0"
    );

    // Incomplete parameters.
    let (_, body) = server
        .post(
            "/api/a2a/orchestrator/",
            json!({ "jsonrpc": "2.0", "id": 9, "method": "SendMessage", "params": {} }),
        )
        .await;
    assert_eq!(body["error"]["code"], -32602);
    assert_eq!(body["error"]["message"], "message.messageId is required.");

    // Unknown task.
    let (_, body) = server
        .post(
            "/api/a2a/orchestrator/",
            json!({ "jsonrpc": "2.0", "id": 10, "method": "GetTask", "params": { "id": "nope" } }),
        )
        .await;
    assert_eq!(body["error"]["code"], -32001);
    assert_eq!(body["error"]["message"], "Task not found: nope");

    // Continuing an unknown task is rejected before any prompt runs.
    let mut body = send_message_body("space", "hello");
    body["params"]["message"]["taskId"] = json!("missing-task");
    let (_, response) = server.post("/api/a2a/orchestrator/", body).await;
    assert_eq!(response["error"]["code"], -32001);
    assert_eq!(
        response["error"]["message"],
        "Task not found: missing-task"
    );

    // Unsupported operations: a subscription to an unknown task 404s, a known
    // task cannot be re-subscribed (event streams are not replayed).
    let (_, body) = server
        .post(
            "/api/a2a/orchestrator/",
            json!({ "jsonrpc": "2.0", "id": 11, "method": "SubscribeToTask", "params": { "id": "nope" } }),
        )
        .await;
    assert_eq!(body["error"]["code"], -32001);

    let (_, body) = server
        .post(
            "/api/a2a/orchestrator/",
            json!({ "jsonrpc": "2.0", "id": 11, "method": "GetExtendedAgentCard", "params": {} }),
        )
        .await;
    assert_eq!(body["error"]["code"], -32004);
    assert_eq!(
        body["error"]["message"],
        "Agent does not support authenticated extended card."
    );

    // Malformed JSON 鈫?parse error.
    let response = reqwest::Client::new()
        .post(format!("{}/api/a2a/orchestrator/", server.base))
        .bearer_auth(&server.token)
        .header("Content-Type", "application/json")
        .body("{not json")
        .send()
        .await
        .expect("request");
    let body: Value = response.json().await.expect("json");
    assert_eq!(body["error"]["code"], -32700);

    // Unknown agent on the per-agent bridge is an HTTP 404.
    let (status, body) = server
        .post(
            "/api/a2a/agents/nope/",
            json!({ "jsonrpc": "2.0", "id": 12, "method": "GetTask", "params": {} }),
        )
        .await;
    assert_eq!(status, 404);
    assert_eq!(body["message"], "Unknown agent: nope");

    server.handle.shutdown().await;
}

// ==========================================================================
// `/a2a` proxy against a mock upstream agent
// ==========================================================================

trait FrameList {
    fn expect_frames(self) -> Vec<Value>;
}

impl FrameList for Vec<Value> {
    fn expect_frames(self) -> Vec<Value> {
        assert!(!self.is_empty(), "no SSE frames received");
        self
    }
}

async fn start_upstream(record: Arc<Mutex<Vec<Value>>>) -> (String, tokio::task::JoinHandle<()>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind upstream");
    let addr = listener.local_addr().expect("upstream addr");

    let card = json!({
        "name": "Upstream Agent",
        "supportedInterfaces": [{
            "url": format!("http://{addr}/"),
            "protocolBinding": "JSONRPC",
            "protocolVersion": "1.0"
        }],
    });
    let card_router = {
        let card = card.clone();
        get(move || {
            let card = card.clone();
            async move { Json(card) }
        })
    };
    let rpc = {
        let record = Arc::clone(&record);
        post(move |Json(body): Json<Value>| {
            let record = Arc::clone(&record);
            async move {
                record
                    .lock()
                    .unwrap_or_else(|error| error.into_inner())
                    .push(body);
                let frames = vec![
                    Ok::<_, Infallible>(Event::default().data(
                        json!({
                            "jsonrpc": "2.0",
                            "id": 1,
                            "result": {
                                "statusUpdate": {
                                    "taskId": "t1",
                                    "contextId": "ctx-upstream",
                                    "status": { "state": "TASK_STATE_WORKING" }
                                }
                            }
                        })
                        .to_string(),
                    )),
                    Ok::<_, Infallible>(Event::default().data(
                        json!({
                            "jsonrpc": "2.0",
                            "id": 1,
                            "result": {
                                "artifactUpdate": {
                                    "taskId": "t1",
                                    "contextId": "ctx-upstream",
                                    "artifact": {
                                        "artifactId": "a1",
                                        "parts": [{ "data": { "surfaceId": "main" } }]
                                    },
                                    "append": true
                                }
                            }
                        })
                        .to_string(),
                    )),
                ];
                Sse::new(stream::iter(frames))
            }
        })
    };

    let app = Router::new()
        .route("/.well-known/agent-card.json", card_router)
        .route("/", rpc);
    let handle = tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    (format!("http://{addr}"), handle)
}

/// Spawn the real `clover serve` binary with an isolated state root.
struct ServeProcess {
    child: tokio::process::Child,
    base: String,
}

impl Drop for ServeProcess {
    fn drop(&mut self) {
        let _ = self.child.start_kill();
    }
}

async fn spawn_cli_server(home: &TestHome, extra_env: &[(&str, &str)]) -> ServeProcess {
    let port = {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("probe port");
        listener.local_addr().expect("probe addr").port()
    };
    let mut command = tokio::process::Command::new(env!("CARGO_BIN_EXE_clover"));
    command
        .args(["serve", "-p", &port.to_string()])
        .env("CLOVER_STATE_DIR", home.state_dir())
        .env("CLOVER_LOG_TO_FILE", "false")
        .env("RUST_LOG", "warn")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    for (key, value) in extra_env {
        command.env(key, value);
    }
    let child = command.spawn().expect("spawn clover serve");

    let base = format!("http://127.0.0.1:{port}");
    let deadline = tokio::time::Instant::now() + Duration::from_secs(30);
    loop {
        if reqwest::Client::new()
            .get(format!("{base}/api/local/health"))
            .send()
            .await
            .is_ok()
        {
            break;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "clover serve did not become ready"
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    ServeProcess { child, base }
}

#[tokio::test]
async fn a2a_proxy_relays_parts_from_the_upstream_agent() {
    let home = TestHome::new();
    let record = Arc::new(Mutex::new(Vec::new()));
    let (upstream, upstream_handle) = start_upstream(Arc::clone(&record)).await;
    let card_url = format!("{upstream}/.well-known/agent-card.json");
    let server = spawn_cli_server(&home, &[("A2A_AGENT_CARD_URL", &card_url)]).await;

    // Text query 鈫?text part upstream 鈫?parts relayed back as SSE.
    let response = reqwest::Client::new()
        .post(format!("{}/a2a", server.base))
        .json(&json!({ "query": "hello upstream", "contextId": "ctx-1" }))
        .send()
        .await
        .expect("proxy response");
    assert_eq!(response.status(), 200);
    assert!(
        response
            .headers()
            .get("content-type")
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .contains("text/event-stream")
    );
    let body = response.text().await.expect("sse body");
    assert!(body.contains("surfaceId"), "{body}");
    assert!(body.contains("ctx-upstream"), "{body}");

    let requests = record
        .lock()
        .map(|record| record.clone())
        .unwrap_or_default();
    assert_eq!(requests.len(), 1);
    let request = &requests[0];
    assert_eq!(request["method"], "SendStreamingMessage");
    let message = &request["params"]["message"];
    assert_eq!(message["role"], "ROLE_USER");
    assert_eq!(message["parts"][0]["text"], "hello upstream");
    assert_eq!(message["parts"][0]["mediaType"], "text/plain");
    assert_eq!(message["contextId"], "ctx-1");

    // Plain-text body 鈫?same wrapping.
    let response = reqwest::Client::new()
        .post(format!("{}/a2a", server.base))
        .body("plain prompt")
        .send()
        .await
        .expect("proxy response");
    assert_eq!(response.status(), 200);
    let _ = response.text().await;
    let requests = record
        .lock()
        .map(|record| record.clone())
        .unwrap_or_default();
    assert_eq!(requests.len(), 2);
    assert_eq!(requests[1]["params"]["message"]["parts"][0]["text"], "plain prompt");
    assert_eq!(requests[1]["params"]["message"]["contextId"], "");

    // Unreachable upstream 鈫?500 with an error body.
    let dead = spawn_cli_server(
        &home,
        &[("A2A_AGENT_CARD_URL", "http://127.0.0.1:1/none.json")],
    )
    .await;
    let response = reqwest::Client::new()
        .post(format!("{}/a2a", dead.base))
        .json(&json!({ "query": "hi" }))
        .send()
        .await
        .expect("proxy response");
    assert_eq!(response.status(), 500);
    let body: Value = response.json().await.expect("json");
    assert!(body["error"].as_str().unwrap_or_default().contains("127.0.0.1:1"));

    upstream_handle.abort();
}