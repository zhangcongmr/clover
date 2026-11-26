//! ACP agent management tests (P4) against a mock agent process.
//!
//! The mock (`tests/fixtures/mock-acp-agent.mjs`) speaks NDJSON JSON-RPC and
//! implements `initialize` + session methods, so these tests cover the real
//! spawn → initialize → status pipeline.

use std::path::{Path, PathBuf};
use std::time::Duration;

use clover_server::acp::probe::probe_path_command;
use clover_server::{bind, start_with_listener, Config, CorsPolicy, Handle, PortPolicy};
use serde_json::{json, Value};

struct TestHome(PathBuf);

impl TestHome {
    fn new() -> Self {
        let path = PathBuf::from(env!("CARGO_TARGET_TMPDIR"))
            .join(format!("clover-acp-api-{}", uuid::Uuid::new_v4().simple()));
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

    async fn post(&self, path: &str, body: Option<Value>) -> (u16, Value) {
        let client = reqwest::Client::new();
        let mut request = client.post(format!("{}{path}", self.base)).bearer_auth(&self.token);
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request.send().await.expect("request");
        let status = response.status().as_u16();
        (status, response.json().await.unwrap_or(Value::Null))
    }

    fn ws_events_url(&self, path: &str) -> String {
        format!("{}{path}?token={}", self.base, self.token)
    }

    /// Wait until the mock agent reports `connected`.
    async fn wait_connected(&self, agent_id: &str) -> Value {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(20);
        let mut last = Value::Null;
        while tokio::time::Instant::now() < deadline {
            let (status, body) = self.get("/api/acp/agents").await;
            assert_eq!(status, 200);
            if let Some(agent) = body["agents"]
                .as_array()
                .and_then(|agents| agents.iter().find(|agent| agent["id"] == agent_id))
            {
                let state = agent["status"].as_str().unwrap_or_default();
                if state == "connected" {
                    return agent.clone();
                }
                if state == "unavailable" || state == "offline" {
                    panic!("agent {agent_id} ended in state {state}: {agent}");
                }
            }
            last = body;
            tokio::time::sleep(Duration::from_millis(150)).await;
        }
        panic!("agent {agent_id} never connected; last status: {last}");
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

async fn node_available() -> bool {
    probe_path_command("node").await.found
}

#[tokio::test]
async fn agent_lifecycle_and_status_surface() {
    if !node_available().await {
        eprintln!("skipping: node is not on PATH");
        return;
    }

    let home = TestHome::new();
    home.write_acp_config(mock_agent_config());
    let server = spawn(&home).await;

    let agent = server.wait_connected("mock").await;
    assert_eq!(agent["name"], "Mock Agent");
    assert_eq!(agent["source"], "disk");
    assert_eq!(agent["installed"], true);
    assert_eq!(agent["agentInfo"]["name"], "mock-agent");
    assert_eq!(agent["agentInfo"]["version"], "9.9.9");
    assert_eq!(
        agent["capabilities"]["sessionCapabilities"]["resume"],
        json!({})
    );
    assert!(agent["lastChecked"].as_i64().unwrap_or(0) > 0);
    assert!(agent["cliPath"].as_str().is_some_and(|path| !path.is_empty()));

    // Check Now keeps the connection and returns the snapshot.
    let (status, body) = server.post("/api/acp/agents/mock/check", Some(json!({}))).await;
    assert_eq!(status, 200);
    assert_eq!(body["agent"]["status"], "connected");

    // Unknown agent → 404 with the TS wording.
    let (status, body) = server
        .post("/api/acp/agents/nope/check", Some(json!({})))
        .await;
    assert_eq!(status, 404);
    assert_eq!(body["error"], "Unknown agent: nope");

    // Status/health/ping.
    let (status, body) = server.get("/api/acp/status").await;
    assert_eq!(status, 200);
    assert_eq!(body["sessions"], 0);
    assert_eq!(body["eventSink"], "in-process");

    let (status, body) = server.get("/api/acp/health").await;
    assert_eq!(status, 200);
    assert_eq!(body["status"], "healthy");
    assert!(body["timestamp"].as_i64().unwrap_or(0) > 0);

    let (status, body) = server.post("/api/acp/ping", Some(json!({}))).await;
    assert_eq!(status, 400);
    assert_eq!(body["error"], "sessionId is required");

    let (status, body) = server
        .post("/api/acp/ping", Some(json!({ "sessionId": "s1" })))
        .await;
    assert_eq!(status, 200);
    assert_eq!(body["pong"], true);

    server.handle.shutdown().await;
}

#[tokio::test]
async fn agent_status_sse_streams_a_snapshot() {
    if !node_available().await {
        eprintln!("skipping: node is not on PATH");
        return;
    }

    let home = TestHome::new();
    home.write_acp_config(mock_agent_config());
    let server = spawn(&home).await;

    let response = reqwest::Client::new()
        .get(server.ws_events_url("/api/acp/agents/events"))
        .bearer_auth(&server.token)
        .send()
        .await
        .expect("sse request");
    assert_eq!(response.status(), 200);

    let event = read_sse_json(response, Duration::from_secs(10)).await;
    assert_eq!(event["type"], "agents_status_snapshot");
    let agents = event["payload"]["agents"].as_array().expect("agents");
    assert_eq!(agents.len(), 1);
    assert_eq!(agents[0]["id"], "mock");

    server.handle.shutdown().await;
}

#[tokio::test]
async fn agent_config_store_round_trip() {
    let home = TestHome::new();
    let server = spawn(&home).await;

    let (status, body) = server.get("/api/acp/agent-config").await;
    assert_eq!(status, 400);
    assert_eq!(body["error"], "agentId is required");

    let (status, body) = server.get("/api/acp/agent-config?agentId=mock").await;
    assert_eq!(status, 200);
    assert_eq!(body["success"], true);
    assert_eq!(body["configOptions"], Value::Null);

    let options = json!([{ "id": "model", "currentValue": "gpt-5" }]);
    let (status, body) = server
        .post(
            "/api/acp/agent-config",
            Some(json!({ "agentId": "mock", "configOptions": options })),
        )
        .await;
    assert_eq!(status, 200);
    assert_eq!(body["success"], true);

    let (_, body) = server.get("/api/acp/agent-config?agentId=mock").await;
    assert_eq!(body["configOptions"], options);

    // Unchanged payload is reported without rewriting.
    let (status, body) = server
        .post(
            "/api/acp/agent-config",
            Some(json!({ "agentId": "mock", "configOptions": options })),
        )
        .await;
    assert_eq!(status, 200);
    assert_eq!(body["unchanged"], true);

    let (status, body) = server
        .post(
            "/api/acp/agent-config",
            Some(json!({ "agentId": "mock", "configOptions": "nope" })),
        )
        .await;
    assert_eq!(status, 400);
    assert_eq!(body["error"], "configOptions must be an array");

    server.handle.shutdown().await;
}

#[tokio::test]
async fn acp_routes_require_a_token() {
    let home = TestHome::new();
    let server = spawn(&home).await;

    let response = reqwest::Client::new()
        .get(format!("{}/api/acp/agents", server.base))
        .send()
        .await
        .expect("request");
    assert_eq!(response.status(), 401);

    server.handle.shutdown().await;
}

#[tokio::test]
async fn shutdown_stops_the_agent_process() {
    if !node_available().await {
        eprintln!("skipping: node is not on PATH");
        return;
    }

    let home = TestHome::new();
    home.write_acp_config(mock_agent_config());
    let server = spawn(&home).await;
    server.wait_connected("mock").await;

    let port = server.base.rsplit(':').next().unwrap().to_string();
    server.handle.shutdown().await;

    // Nothing may keep listening after shutdown.
    tokio::time::sleep(Duration::from_millis(200)).await;
    let closed = tokio::net::TcpStream::connect(("127.0.0.1", port.parse().unwrap()))
        .await
        .is_err();
    assert!(closed, "port still accepting connections after shutdown");
}

/// Read one SSE `data:` payload from a streaming response.
async fn read_sse_json(response: reqwest::Response, timeout: Duration) -> Value {
    use futures_util::StreamExt;

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();

    let deadline = tokio::time::Instant::now() + timeout;
    while tokio::time::Instant::now() < deadline {
        let chunk = tokio::time::timeout(Duration::from_secs(5), stream.next()).await;
        let Ok(Some(Ok(bytes))) = chunk else {
            continue;
        };
        buffer.push_str(&String::from_utf8_lossy(&bytes));

        while let Some(index) = buffer.find("\n\n") {
            let frame = buffer[..index].to_string();
            buffer = buffer[index + 2..].to_string();
            for line in frame.lines() {
                if let Some(data) = line.strip_prefix("data: ")
                    && let Ok(value) = serde_json::from_str::<Value>(data)
                {
                    return value;
                }
            }
        }
    }

    panic!("no SSE event received within {timeout:?}");
}