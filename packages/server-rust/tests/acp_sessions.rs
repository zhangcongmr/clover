//! ACP session tests (P5): create → stream → prompt/permission/cancel, replay,
//! ownership release and the session listing endpoints.
//!
//! Everything runs against the mock agent in `tests/fixtures/mock-acp-agent.mjs`.

use std::path::{Path, PathBuf};
use std::time::Duration;

use clover_server::acp::probe::probe_path_command;
use clover_server::{bind, start_with_listener, Config, CorsPolicy, Handle, PortPolicy};
use futures_util::StreamExt;
use serde_json::{json, Value};
use tokio::sync::mpsc;

struct TestHome(PathBuf);

impl TestHome {
    fn new() -> Self {
        let path = PathBuf::from(env!("CARGO_TARGET_TMPDIR"))
            .join(format!("clover-acp-sessions-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(path.join(".clover")).expect("create temp home");
        Self(path)
    }

    fn path(&self) -> &Path {
        &self.0
    }

    fn state_dir(&self) -> PathBuf {
        self.0.join(".clover")
    }

    fn write_acp_config(&self, agent: Value) {
        let config = json!({ "version": "1.0.0", "agents": [agent] });
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
    home: PathBuf,
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
            warmup_agents: true,
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
        home: home.path().to_path_buf(),
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
            .json(&body)
            .send()
            .await
            .expect("request");
        let status = response.status().as_u16();
        (status, response.json().await.unwrap_or(Value::Null))
    }

    async fn delete(&self, path: &str) -> u16 {
        reqwest::Client::new()
            .delete(format!("{}{path}", self.base))
            .bearer_auth(&self.token)
            .send()
            .await
            .expect("request")
            .status()
            .as_u16()
    }

    /// Release with explicit ownership credentials (the epoch fence).
    async fn delete_stream(
        &self,
        session_id: &str,
        client_id: Option<&str>,
        epoch: Option<u64>,
    ) -> u16 {
        let mut request = reqwest::Client::new()
            .delete(format!("{}/api/acp/stream/{session_id}", self.base))
            .bearer_auth(&self.token);
        if let Some(client_id) = client_id {
            request = request.header("X-Client-Id", client_id);
        }
        if let Some(epoch) = epoch {
            request = request.header("X-Epoch", epoch.to_string());
        }
        request.send().await.expect("request").status().as_u16()
    }

    /// Open the session event stream and return decoded events.
    async fn open_stream(
        &self,
        session_id: &str,
        last_event_id: Option<u64>,
    ) -> mpsc::Receiver<Value> {
        let mut request = reqwest::Client::new()
            .get(format!(
                "{}/api/acp/stream/{session_id}",
                self.base
            ))
            .bearer_auth(&self.token)
            .header("Accept", "text/event-stream")
            .header("X-Client-Id", "test-page");
        if let Some(seq) = last_event_id {
            request = request.header("Last-Event-ID", seq.to_string());
        }

        let response = request.send().await.expect("sse response");
        assert_eq!(response.status(), 200);

        let (tx, rx) = mpsc::channel(64);
        tokio::spawn(async move {
            let mut stream = response.bytes_stream();
            let mut buffer = String::new();
            while let Some(Ok(chunk)) = stream.next().await {
                buffer.push_str(&String::from_utf8_lossy(&chunk));
                while let Some(index) = buffer.find("\n\n") {
                    let frame = buffer[..index].to_string();
                    buffer = buffer[index + 2..].to_string();
                    for line in frame.lines() {
                        if let Some(data) = line.strip_prefix("data: ")
                            && let Ok(value) = serde_json::from_str::<Value>(data)
                            && tx.send(value).await.is_err()
                        {
                            return;
                        }
                    }
                }
            }
        });
        rx
    }
}

fn mock_agent_config() -> Value {
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("mock-acp-agent.mjs");
    json!({
        "id": "mock",
        "name": "Mock Agent",
        "command": "node",
        "args": [fixture.to_string_lossy()],
        "source": "disk",
        "installed": true,
    })
}

async fn next_event(events: &mut mpsc::Receiver<Value>, timeout: Duration) -> Value {
    tokio::time::timeout(timeout, events.recv())
        .await
        .unwrap_or_else(|_| panic!("no SSE event within {timeout:?}"))
        .expect("stream closed")
}

/// Read events until one has the requested `type`.
async fn next_of_type(events: &mut mpsc::Receiver<Value>, event_type: &str) -> Value {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(15);
    loop {
        assert!(
            tokio::time::Instant::now() < deadline,
            "event {event_type} never arrived"
        );
        let event = next_event(events, Duration::from_secs(5)).await;
        if event["type"] == event_type {
            return event;
        }
    }
}

async fn create_session(server: &TestServer, cwd: &str) -> Value {
    let (status, body) = server
        .post(
            "/api/acp/session/create",
            json!({ "agentId": "mock", "cwd": cwd }),
        )
        .await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["success"], true);
    assert_eq!(body["agentId"], "mock");
    assert_eq!(body["sessionId"], "mock-session");
    body
}

#[tokio::test]
async fn session_prompt_streams_updates_and_completion() {
    if !probe_path_command("node").await.found {
        eprintln!("skipping: node is not on PATH");
        return;
    }

    let home = TestHome::new();
    home.write_acp_config(mock_agent_config());
    let server = spawn(&home).await;

    let cwd = server.home.join("workspace");
    std::fs::create_dir_all(&cwd).expect("workspace");
    let created = create_session(&server, &cwd.to_string_lossy()).await;
    assert_eq!(created["cwd"], cwd.to_string_lossy().as_ref());
    // Commands are delivered as a notification that races the response, so the
    // response only guarantees an array (same best-effort shape as the TS impl).
    assert!(created["availableCommands"].is_array());

    let mut events = server.open_stream("mock-session", None).await;

    // Ownership handshake, then the agent status event.
    let connected = next_event(&mut events, Duration::from_secs(5)).await;
    assert_eq!(connected["type"], "connected");
    assert_eq!(connected["payload"]["sessionId"], "mock-session");
    assert_eq!(connected["payload"]["clientId"], "test-page");
    assert_eq!(connected["payload"]["epoch"], 1);

    let status = next_of_type(&mut events, "status").await;
    assert_eq!(status["payload"]["connected"], true);
    assert_eq!(status["payload"]["agentInfo"]["name"], "mock-agent");

    // Prompt → processing → chunk → complete.
    let (status, body) = server
        .post(
            "/api/acp/stream/mock-session",
            json!({
                "id": "req-1",
                "method": "prompt",
                "params": { "content": [{ "type": "text", "text": "hello" }] },
            }),
        )
        .await;
    assert_eq!(status, 202);
    assert_eq!(body["accepted"], true);
    assert_eq!(body["id"], "req-1");

    let processing = next_of_type(&mut events, "prompt_processing").await;
    assert_eq!(processing["payload"]["requestId"], "req-1");

    let chunk = next_of_type(&mut events, "session_update").await;
    assert_eq!(chunk["payload"]["update"]["sessionUpdate"], "agent_message_chunk");
    assert_eq!(
        chunk["payload"]["update"]["content"]["text"],
        "hello from mock"
    );

    let complete = next_of_type(&mut events, "prompt_complete").await;
    assert_eq!(complete["payload"]["stopReason"], "end_turn");
    assert_eq!(complete["payload"]["acpSessionId"], "mock-session");

    // Session status + counts.
    let (status, body) = server.get("/api/acp/session/mock-session").await;
    assert_eq!(status, 200);
    assert_eq!(body["sessionId"], "mock-session");
    assert_eq!(body["hasConnection"], true);
    assert!(body["createdAt"].as_i64().unwrap_or(0) > 0);

    let (_, body) = server.get("/api/acp/status").await;
    assert_eq!(body["sessions"], 1);
    assert_eq!(body["connections"], 1);

    server.handle.shutdown().await;
}

#[tokio::test]
async fn permission_round_trip_through_the_stream() {
    if !probe_path_command("node").await.found {
        eprintln!("skipping: node is not on PATH");
        return;
    }

    let home = TestHome::new();
    home.write_acp_config(mock_agent_config());
    let server = spawn(&home).await;

    let cwd = server.home.join("workspace");
    std::fs::create_dir_all(&cwd).expect("workspace");
    create_session(&server, &cwd.to_string_lossy()).await;

    let mut events = server.open_stream("mock-session", None).await;
    let _ = next_event(&mut events, Duration::from_secs(5)).await; // connected

    let (status, _) = server
        .post(
            "/api/acp/stream/mock-session",
            json!({
                "method": "prompt",
                "params": { "content": [{ "type": "text", "text": "permission please" }] },
            }),
        )
        .await;
    assert_eq!(status, 202);

    let permission = next_of_type(&mut events, "permission_request").await;
    let request_id = permission["payload"]["requestId"]
        .as_str()
        .expect("requestId")
        .to_string();
    assert_eq!(permission["payload"]["sessionId"], "mock-session");
    assert_eq!(permission["payload"]["options"][0]["kind"], "allow_once");

    let (status, _) = server
        .post(
            "/api/acp/stream/mock-session",
            json!({
                "method": "permission",
                "params": {
                    "requestId": request_id,
                    "outcome": { "outcome": "selected", "optionId": "allow" },
                },
            }),
        )
        .await;
    assert_eq!(status, 202);

    let chunk = next_of_type(&mut events, "session_update").await;
    assert_eq!(
        chunk["payload"]["update"]["content"]["text"],
        "permission:selected:allow"
    );
    let complete = next_of_type(&mut events, "prompt_complete").await;
    assert_eq!(complete["payload"]["stopReason"], "end_turn");

    server.handle.shutdown().await;
}

#[tokio::test]
async fn cancel_publishes_cancel_complete() {
    if !probe_path_command("node").await.found {
        eprintln!("skipping: node is not on PATH");
        return;
    }

    let home = TestHome::new();
    home.write_acp_config(mock_agent_config());
    let server = spawn(&home).await;

    let cwd = server.home.join("workspace");
    std::fs::create_dir_all(&cwd).expect("workspace");
    create_session(&server, &cwd.to_string_lossy()).await;

    let mut events = server.open_stream("mock-session", None).await;
    let _ = next_event(&mut events, Duration::from_secs(5)).await;

    let (status, _) = server
        .post(
            "/api/acp/stream/mock-session",
            json!({
                "method": "prompt",
                "params": { "content": [{ "type": "text", "text": "slow prompt" }] },
            }),
        )
        .await;
    assert_eq!(status, 202);

    let (status, _) = server
        .post(
            "/api/acp/stream/mock-session",
            json!({ "method": "cancel" }),
        )
        .await;
    assert_eq!(status, 202);

    let cancel = next_of_type(&mut events, "cancel_complete").await;
    assert_eq!(cancel["payload"], json!({}));

    server.handle.shutdown().await;
}

#[tokio::test]
async fn last_event_id_replays_the_missed_window() {
    if !probe_path_command("node").await.found {
        eprintln!("skipping: node is not on PATH");
        return;
    }

    let home = TestHome::new();
    home.write_acp_config(mock_agent_config());
    let server = spawn(&home).await;

    let cwd = server.home.join("workspace");
    std::fs::create_dir_all(&cwd).expect("workspace");
    create_session(&server, &cwd.to_string_lossy()).await;

    let mut events = server.open_stream("mock-session", None).await;
    let _ = next_event(&mut events, Duration::from_secs(5)).await;

    server
        .post(
            "/api/acp/stream/mock-session",
            json!({
                "method": "prompt",
                "params": { "content": [{ "type": "text", "text": "hello" }] },
            }),
        )
        .await;

    let processing = next_of_type(&mut events, "prompt_processing").await;
    let cursor = processing["seq"].as_u64().expect("seq");
    let _ = next_of_type(&mut events, "prompt_complete").await;

    // Reconnect with the cursor: every event after it is replayed.
    let mut replay = server.open_stream("mock-session", Some(cursor)).await;
    let connected = next_event(&mut replay, Duration::from_secs(5)).await;
    assert_eq!(connected["type"], "connected");

    let replayed = next_event(&mut replay, Duration::from_secs(5)).await;
    assert_eq!(replayed["type"], "session_update");
    assert!(
        replayed["seq"].as_u64().unwrap_or(0) > cursor,
        "replay must start after the cursor: {replayed}"
    );

    server.handle.shutdown().await;
}

#[tokio::test]
async fn stream_release_and_session_cleanup() {
    if !probe_path_command("node").await.found {
        eprintln!("skipping: node is not on PATH");
        return;
    }

    let home = TestHome::new();
    home.write_acp_config(mock_agent_config());
    let server = spawn(&home).await;

    let cwd = server.home.join("workspace");
    std::fs::create_dir_all(&cwd).expect("workspace");
    create_session(&server, &cwd.to_string_lossy()).await;

    let mut events = server.open_stream("mock-session", None).await;
    let _ = next_event(&mut events, Duration::from_secs(5)).await;

    // Stream ownership is released with matching credentials; a different page
    // gets a 409 (epoch fence), and the call is idempotent afterwards.
    assert_eq!(
        server.delete_stream("mock-session", Some("other-page"), Some(1)).await,
        409
    );
    assert_eq!(
        server
            .delete_stream("mock-session", Some("test-page"), Some(1))
            .await,
        204
    );
    assert_eq!(server.delete("/api/acp/stream/mock-session").await, 204);

    let (status, body) = server.get("/api/acp/session/mock-session").await;
    assert_eq!(status, 200);
    assert_eq!(body["hasConnection"], false);

    // Deleting the server-side record keeps the agent session intact.
    assert_eq!(server.delete("/api/acp/session/mock-session").await, 200);
    let (status, body) = server.get("/api/acp/session/mock-session").await;
    assert_eq!(status, 404);
    assert_eq!(body["error"], "Session not found");

    server.handle.shutdown().await;
}

#[tokio::test]
async fn session_activity_stream_reports_processing() {
    if !probe_path_command("node").await.found {
        eprintln!("skipping: node is not on PATH");
        return;
    }

    let home = TestHome::new();
    home.write_acp_config(mock_agent_config());
    let server = spawn(&home).await;

    let cwd = server.home.join("workspace");
    std::fs::create_dir_all(&cwd).expect("workspace");
    create_session(&server, &cwd.to_string_lossy()).await;

    let response = reqwest::Client::new()
        .get(format!("{}/api/acp/sessions/events", server.base))
        .bearer_auth(&server.token)
        .header("Accept", "text/event-stream")
        .send()
        .await
        .expect("activity stream");
    assert_eq!(response.status(), 200);

    let (tx, mut rx) = mpsc::channel(16);
    tokio::spawn(async move {
        let mut stream = response.bytes_stream();
        let mut buffer = String::new();
        while let Some(Ok(chunk)) = stream.next().await {
            buffer.push_str(&String::from_utf8_lossy(&chunk));
            while let Some(index) = buffer.find("\n\n") {
                let frame = buffer[..index].to_string();
                buffer = buffer[index + 2..].to_string();
                for line in frame.lines() {
                    if let Some(data) = line.strip_prefix("data: ")
                        && let Ok(value) = serde_json::from_str::<Value>(data)
                    {
                        let _ = tx.send(value).await;
                    }
                }
            }
        }
    });

    let snapshot = next_event(&mut rx, Duration::from_secs(5)).await;
    assert_eq!(snapshot["type"], "sessions_processing_snapshot");
    assert_eq!(snapshot["payload"]["sessionIds"], json!([]));

    server
        .post(
            "/api/acp/stream/mock-session",
            json!({
                "method": "prompt",
                "params": { "content": [{ "type": "text", "text": "hello" }] },
            }),
        )
        .await;

    let started = next_of_type(&mut rx, "session_processing_changed").await;
    assert_eq!(started["payload"]["sessionId"], "mock-session");
    assert_eq!(started["payload"]["processing"], true);

    let finished = next_of_type(&mut rx, "session_processing_changed").await;
    assert_eq!(finished["payload"]["processing"], false);

    server.handle.shutdown().await;
}

#[tokio::test]
async fn list_load_resume_and_config_endpoints() {
    if !probe_path_command("node").await.found {
        eprintln!("skipping: node is not on PATH");
        return;
    }

    let home = TestHome::new();
    home.write_acp_config(mock_agent_config());
    let server = spawn(&home).await;

    let cwd = server.home.join("workspace");
    std::fs::create_dir_all(&cwd).expect("workspace");
    let cwd_text = cwd.to_string_lossy().to_string();

    // Validation messages first.
    let (status, body) = server.post("/api/acp/session/create", json!({})).await;
    assert_eq!(status, 400);
    assert_eq!(body["error"], "agentId is required");

    let (status, body) = server
        .post("/api/acp/list-all-sessions", json!({ "agents": [] }))
        .await;
    assert_eq!(status, 400);
    assert_eq!(body["error"], "cwd (working directory) is required");

    let (status, body) = server
        .post("/api/acp/list-all-sessions", json!({ "cwd": cwd_text }))
        .await;
    assert_eq!(status, 400);
    assert_eq!(body["error"], "agents is required");

    create_session(&server, &cwd_text).await;

    // session/list
    let (status, body) = server
        .post("/api/acp/session/list", json!({ "agentId": "mock", "cwd": cwd_text }))
        .await;
    assert_eq!(status, 200);
    assert_eq!(body["success"], true);
    assert_eq!(body["sessions"][0]["sessionId"], "mock-session");

    // list-all-sessions aggregates per agent and reports failures.
    let (status, body) = server
        .post(
            "/api/acp/list-all-sessions",
            json!({
                "cwd": cwd_text,
                "agents": [
                    { "id": "mock", "command": "node", "args": mock_agent_config()["args"] },
                    { "id": "broken", "command": "clover-definitely-missing-binary" }
                ]
            }),
        )
        .await;
    assert_eq!(status, 200);
    assert_eq!(body["sessions"][0]["sessionId"], "mock-session");
    assert_eq!(body["sessions"][0]["agentId"], "mock");
    assert_eq!(body["failures"][0]["agentId"], "broken");

    // load / resume keep the session usable.
    let (status, body) = server
        .post(
            "/api/acp/session/load",
            json!({ "sessionId": "mock-session", "agentId": "mock", "cwd": cwd_text }),
        )
        .await;
    assert_eq!(status, 200);
    assert_eq!(body["success"], true);
    assert_eq!(body["prompting"], false);

    let (status, body) = server
        .post(
            "/api/acp/session/resume",
            json!({ "sessionId": "mock-session", "agentId": "mock", "cwd": cwd_text }),
        )
        .await;
    assert_eq!(status, 200);
    assert_eq!(body["sessionId"], "mock-session");

    // config option
    let (status, body) = server
        .post(
            "/api/acp/config",
            json!({
                "sessionId": "mock-session",
                "configId": "model",
                "type": "id",
                "value": "gpt-5",
            }),
        )
        .await;
    assert_eq!(status, 200);
    assert_eq!(body["success"], true);
    assert_eq!(body["configOptions"][0]["currentValue"], "gpt-5");

    let (status, body) = server
        .post("/api/acp/config", json!({ "sessionId": "mock-session" }))
        .await;
    assert_eq!(status, 400);
    assert_eq!(
        body["error"],
        "sessionId, configId, type, and value are required"
    );

    // session/delete removes the session on the agent.
    let (status, body) = server
        .post(
            "/api/acp/session/delete",
            json!({ "sessionId": "mock-session", "agentId": "mock" }),
        )
        .await;
    assert_eq!(status, 200);
    assert_eq!(body["message"], "Session deleted");

    server.handle.shutdown().await;
}