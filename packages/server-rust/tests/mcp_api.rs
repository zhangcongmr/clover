//! `/api/mcp/*` contract tests (P2).
//!
//! These routes are intentionally unauthenticated (the settings UI never sends
//! a token), so every request here goes out without an `Authorization` header.

use std::path::PathBuf;
use std::time::Duration;

use clover_server::{bind, start_with_listener, Config, CorsPolicy, Handle, PortPolicy};
use serde_json::{json, Value};

struct TestDir(PathBuf);

impl TestDir {
    fn new() -> Self {
        let path = PathBuf::from(env!("CARGO_TARGET_TMPDIR"))
            .join(format!("clover-mcp-api-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&path).expect("create temp dir");
        Self(path)
    }

    fn path(&self) -> &std::path::Path {
        &self.0
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

struct TestServer {
    handle: Handle,
    base: String,
}

async fn spawn(state_dir: PathBuf) -> TestServer {
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
            state_dir: Some(state_dir.clone()),
            home_dir: Some(state_dir),
            warmup_agents: false,
        },
    )
    .await
    .expect("start");

    // Give the accept loop a beat (the listener is already bound, so requests
    // would queue, but this keeps failures readable).
    tokio::time::sleep(Duration::from_millis(10)).await;

    TestServer {
        handle,
        base: format!("http://127.0.0.1:{port}"),
    }
}

impl TestServer {
    async fn send(&self, method: &str, path: &str, body: Option<Value>) -> (u16, Value) {
        let client = reqwest::Client::new();
        let url = format!("{}{path}", self.base);
        let request = match method {
            "GET" => client.get(url),
            "POST" => client.post(url),
            "PUT" => client.put(url),
            "DELETE" => client.delete(url),
            other => panic!("unsupported method {other}"),
        };
        let request = match body {
            Some(body) => request.json(&body),
            None => request,
        };
        let response = request.send().await.expect("request");
        let status = response.status().as_u16();
        let body = response.json().await.unwrap_or(Value::Null);
        (status, body)
    }
}

#[tokio::test]
async fn crud_round_trip_matches_the_ts_contract() {
    let dir = TestDir::new();
    let server = spawn(dir.path().to_path_buf()).await;

    let created = json!({
        "name": "fs",
        "type": "stdio",
        "description": "filesystem server",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem"],
        "env": { "TOKEN": "${SOME_TOKEN}" }
    });
    let (status, body) = server.send("POST", "/api/mcp/servers", Some(created)).await;
    assert_eq!(status, 200);
    assert_eq!(body["success"], true);
    assert_eq!(body["name"], "fs");

    let (status, body) = server.send("GET", "/api/mcp/servers", None).await;
    assert_eq!(status, 200);
    let servers = body["servers"].as_array().expect("servers");
    assert_eq!(servers.len(), 1);
    assert_eq!(servers[0]["name"], "fs");
    assert_eq!(servers[0]["type"], "stdio");
    assert_eq!(servers[0]["description"], "filesystem server");

    let (status, body) = server.send("GET", "/api/mcp/servers/fs", None).await;
    assert_eq!(status, 200);
    assert_eq!(body["server"]["command"], "npx");

    // Update: keep type, change description and clear args.
    let (status, body) = server
        .send(
            "PUT",
            "/api/mcp/servers/fs",
            Some(json!({ "description": "updated", "args": [] })),
        )
        .await;
    assert_eq!(status, 200);
    assert_eq!(body["success"], true);

    let (_, body) = server.send("GET", "/api/mcp/servers/fs", None).await;
    assert_eq!(body["server"]["description"], "updated");
    assert_eq!(body["server"]["args"], json!([]));
    assert_eq!(body["server"]["command"], "npx");

    // Delete + 404 afterwards.
    let (status, body) = server.send("DELETE", "/api/mcp/servers/fs", None).await;
    assert_eq!(status, 200);
    assert_eq!(body["success"], true);
    let (status, body) = server.send("GET", "/api/mcp/servers/fs", None).await;
    assert_eq!(status, 404);
    assert_eq!(body["error"], "Server not found");
    let (status, _) = server.send("DELETE", "/api/mcp/servers/fs", None).await;
    assert_eq!(status, 404);

    server.handle.shutdown().await;
}

#[tokio::test]
async fn stdio_and_http_validation_messages() {
    let dir = TestDir::new();
    let server = spawn(dir.path().to_path_buf()).await;

    let (status, body) = server.send("POST", "/api/mcp/servers", Some(json!({}))).await;
    assert_eq!(status, 400);
    assert_eq!(body["error"], "name is required");

    let (status, body) = server
        .send(
            "POST",
            "/api/mcp/servers",
            Some(json!({ "name": "a", "type": "stdio" })),
        )
        .await;
    assert_eq!(status, 400);
    assert_eq!(body["error"], "command is required for stdio type");

    let (status, body) = server
        .send(
            "POST",
            "/api/mcp/servers",
            Some(json!({ "name": "a", "type": "http" })),
        )
        .await;
    assert_eq!(status, 400);
    assert_eq!(body["error"], "url is required for http type");

    let (status, body) = server
        .send(
            "POST",
            "/api/mcp/servers",
            Some(json!({ "name": "a", "type": "grpc" })),
        )
        .await;
    assert_eq!(status, 400);
    assert_eq!(body["error"], "type must be stdio or http");

    // PUT on a missing server.
    let (status, body) = server
        .send("PUT", "/api/mcp/servers/nope", Some(json!({ "type": "stdio" })))
        .await;
    assert_eq!(status, 404);
    assert_eq!(body["error"], "Server not found");

    server.handle.shutdown().await;
}

#[tokio::test]
async fn http_servers_and_type_switch() {
    let dir = TestDir::new();
    let server = spawn(dir.path().to_path_buf()).await;

    let (status, _) = server
        .send(
            "POST",
            "/api/mcp/servers",
            Some(json!({
                "name": "remote",
                "type": "http",
                "url": "https://example.test/mcp",
                "headers": { "Authorization": "Bearer x" }
            })),
        )
        .await;
    assert_eq!(status, 200);

    let (_, body) = server.send("GET", "/api/mcp/servers/remote", None).await;
    assert_eq!(body["server"]["type"], "http");
    assert_eq!(body["server"]["headers"]["Authorization"], "Bearer x");

    // Invalid explicit type on update.
    let (status, body) = server
        .send(
            "PUT",
            "/api/mcp/servers/remote",
            Some(json!({ "type": "websocket" })),
        )
        .await;
    assert_eq!(status, 400);
    assert_eq!(body["error"], "Invalid type");

    server.handle.shutdown().await;
}

#[tokio::test]
async fn servers_persist_to_the_state_directory() {
    let dir = TestDir::new();
    let state = dir.path().to_path_buf();

    let server = spawn(state.clone()).await;
    server
        .send(
            "POST",
            "/api/mcp/servers",
            Some(json!({ "name": "fs", "type": "stdio", "command": "uvx", "args": ["x"] })),
        )
        .await;
    server.handle.shutdown().await;

    // On-disk shape is the same JSON the TS server wrote.
    let raw = std::fs::read_to_string(state.join("mcp-servers.json")).expect("store file");
    let parsed: Value = serde_json::from_str(&raw).expect("valid json");
    assert_eq!(parsed["servers"]["fs"]["type"], "stdio");
    assert_eq!(parsed["servers"]["fs"]["command"], "uvx");

    // A fresh server on the same directory sees the server again.
    let server = spawn(state).await;
    let (_, body) = server.send("GET", "/api/mcp/servers", None).await;
    assert_eq!(body["servers"].as_array().expect("servers").len(), 1);
    server.handle.shutdown().await;
}

#[tokio::test]
async fn names_are_trimmed_when_stored() {
    let dir = TestDir::new();
    let server = spawn(dir.path().to_path_buf()).await;

    let (status, body) = server
        .send(
            "POST",
            "/api/mcp/servers",
            Some(json!({ "name": "  fs  ", "type": "stdio", "command": "npx" })),
        )
        .await;
    assert_eq!(status, 200);
    // Response echoes the raw name; the store key is trimmed.
    assert_eq!(body["name"], "  fs  ");

    let (_, body) = server.send("GET", "/api/mcp/servers/fs", None).await;
    assert_eq!(body["server"]["name"], "fs");

    server.handle.shutdown().await;
}