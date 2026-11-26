//! `/api/local/*` + `/ws/*` contract tests.
//!
//! These are the P1 acceptance tests: every file action, the envelope shape,
//! read-only mode, and both WebSocket endpoints against a real listener.

use std::time::Duration;

use clover_server::{bind, start_with_listener, Config, CorsPolicy, Handle, PortPolicy};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};

use tokio_tungstenite::tungstenite::Message;

/// Self-cleaning temp directory.
///
/// `tempfile::TempDir` fails with `PermissionDenied` in this environment
/// (dot-prefixed names), so a plain directory with an explicit name is used.
struct TestDir {
    path: std::path::PathBuf,
}

impl TestDir {
    fn new() -> Self {
        // This environment denies writes under `%TEMP%` for test binaries, so
        // use Cargo's per-target test directory (created by Cargo) instead.
        let base = std::path::PathBuf::from(env!("CARGO_TARGET_TMPDIR"));
        let path = base.join(format!("clover-test-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&path).expect("create temp dir");
        Self { path }
    }

    fn path(&self) -> &std::path::Path {
        &self.path
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

struct TestServer {
    handle: Handle,
    base: String,
    token: String,
}

async fn spawn(readonly: bool) -> TestServer {
    let listener = bind("127.0.0.1", 0, PortPolicy::Strict).expect("bind");
    let port = listener.local_addr().expect("addr").port();
    let handle = start_with_listener(
        listener,
        Config {
            host: "127.0.0.1".to_string(),
            port,
            port_policy: PortPolicy::Strict,
            readonly,
            cors: CorsPolicy::AllowAny,
            static_dir: None,
            state_dir: None,
            home_dir: None,
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
        .expect("token request")
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
    async fn post(&self, action: &str, body: Value) -> Value {
        let response = reqwest::Client::new()
            .post(format!("{}/api/local/{action}", self.base))
            .bearer_auth(&self.token)
            .json(&body)
            .send()
            .await
            .unwrap_or_else(|error| panic!("{action} request failed: {error}"));
        assert_eq!(response.status(), 200, "{action} should answer 200");
        response.json().await.expect("json body")
    }

    async fn ok(&self, action: &str, body: Value) -> Value {
        let response = self.post(action, body).await;
        assert_eq!(response["success"], true, "{action} failed: {response}");
        assert_eq!(response["type"], "file-service");
        response["data"].clone()
    }

    fn ws_url(&self, path: &str) -> String {
        format!(
            "{}{path}?token={}",
            self.base.replace("http://", "ws://"),
            self.token
        )
    }
}

fn path_of(dir: &TestDir, name: &str) -> String {
    dir.path().join(name).to_string_lossy().to_string()
}

#[tokio::test]
async fn file_operations_round_trip() {
    let server = spawn(false).await;
    let dir = TestDir::new();

    let target = path_of(&dir, "note.txt");

    // write -> read -> exists -> stat
    let written = server
        .ok("writeFile", json!({ "path": target, "content": "hello" }))
        .await;
    assert_eq!(written["size"], 5);

    let read = server.ok("readFile", json!({ "path": target })).await;
    assert_eq!(read["content"], "hello");
    assert_eq!(read["contentType"], "text/plain");
    assert_eq!(read["size"], 5);

    assert_eq!(
        server.ok("exists", json!({ "path": target })).await["exists"],
        true
    );
    assert_eq!(
        server
            .ok("exists", json!({ "path": path_of(&dir, "missing") }))
            .await["exists"],
        false
    );

    let stat = server.ok("stat", json!({ "path": target })).await;
    assert_eq!(stat["name"], "note.txt");
    assert_eq!(stat["kind"], "file");
    assert_eq!(stat["size"], 5);
    let mtime = stat["mtime"].as_str().expect("mtime");
    assert!(mtime.ends_with('Z') && mtime.contains('.'), "got {mtime}");

    // rename
    let renamed = server
        .ok("rename", json!({ "path": target, "newName": "renamed.txt" }))
        .await;
    let renamed_path = renamed["newPath"].as_str().expect("newPath").to_string();
    assert!(renamed_path.ends_with("renamed.txt"));
    assert_eq!(renamed["renamed"], true);

    // createDir / createFile / listDir
    let sub = path_of(&dir, "sub");
    assert_eq!(
        server.ok("createDir", json!({ "path": sub })).await["created"],
        true
    );
    let nested = format!("{sub}/inner.txt");
    assert_eq!(
        server
            .ok("createFile", json!({ "path": nested }))
            .await["created"],
        true
    );

    let listing = server.ok("listDir", json!({ "path": dir.path() })).await;
    let items = listing.as_array().expect("array");
    let names: Vec<&str> = items
        .iter()
        .map(|item| item["name"].as_str().unwrap_or_default())
        .collect();
    assert!(names.contains(&"sub"));
    assert!(names.contains(&"renamed.txt"));
    // Directories sort first.
    assert_eq!(items[0]["kind"], "directory");

    // scan (depth 1) reports platform/separator and sorts directories first.
    let scan = server
        .ok("scan", json!({ "path": dir.path(), "depth": 1 }))
        .await;
    assert_eq!(scan["kind"], "directory");
    assert_eq!(scan["platform"], reference_platform());
    assert_eq!(scan["separator"], std::path::MAIN_SEPARATOR.to_string());
    let children = scan["children"].as_array().expect("children");
    assert_eq!(children[0]["kind"], "directory");

    // delete (recursive)
    assert_eq!(
        server
            .ok("deleteFile", json!({ "path": dir.path() }))
            .await["deleted"],
        true
    );
    assert_eq!(
        server
            .ok("exists", json!({ "path": dir.path() }))
            .await["exists"],
        false
    );

    server.handle.shutdown().await;
}

#[tokio::test]
async fn roots_lists_the_filesystem() {
    let server = spawn(false).await;
    let data = server.ok("roots", json!({})).await;
    assert_eq!(data["platform"], reference_platform());
    assert!(!data["roots"].as_array().expect("roots").is_empty());
    server.handle.shutdown().await;
}

#[tokio::test]
async fn missing_path_is_a_400() {
    let server = spawn(false).await;
    let response = reqwest::Client::new()
        .post(format!("{}/api/local/readFile", server.base))
        .bearer_auth(&server.token)
        .json(&json!({}))
        .send()
        .await
        .expect("request");
    assert_eq!(response.status(), 400);
    let body: Value = response.json().await.expect("json");
    assert_eq!(body["success"], false);
    assert_eq!(body["message"], "path is required");
    server.handle.shutdown().await;
}

#[tokio::test]
async fn read_only_mode_rejects_writes_inside_a_200_envelope() {
    let server = spawn(true).await;
    let dir = TestDir::new();
    let response = server
        .post(
            "writeFile",
            json!({ "path": path_of(&dir, "x.txt"), "content": "nope" }),
        )
        .await;
    assert_eq!(response["success"], false);
    assert_eq!(response["message"], "Server is running in read-only mode");
    // Reads still work.
    assert!(server
        .ok("listDir", json!({ "path": dir.path() }))
        .await
        .is_array());
    server.handle.shutdown().await;
}

#[tokio::test]
async fn terminal_websocket_streams_output() {
    let server = spawn(false).await;
    let (mut socket, _) = tokio_tungstenite::connect_async(server.ws_url("/ws/terminal"))
        .await
        .expect("ws connect");

    socket
        .send(Message::text(
            json!({ "type": "pty", "cols": 80, "rows": 24, "cwd": "" }).to_string(),
        ))
        .await
        .expect("send init");

    socket
        .send(Message::text("echo p1-terminal-ok\r\n"))
        .await
        .expect("send command");

    let mut output = String::new();
    let mut answered_dsr = false;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(30);
    while tokio::time::Instant::now() < deadline {
        match tokio::time::timeout(Duration::from_secs(5), socket.next()).await {
            Ok(Some(Ok(Message::Binary(bytes)))) => {
                output.push_str(&String::from_utf8_lossy(&bytes));
                // ConPTY asks the terminal for the cursor position (DSR,
                // `ESC[6n`) and blocks until it is answered. xterm.js does this
                // automatically; the test has to reply explicitly.
                if output.contains("\u{1b}[6n") && !answered_dsr {
                    answered_dsr = true;
                    let _ = socket
                        .send(Message::text("\u{1b}[1;1R"))
                        .await;
                }
                if output.contains("p1-terminal-ok") {
                    break;
                }
            }
            Ok(Some(Ok(Message::Text(text)))) => {
                output.push_str(text.as_str());
                if output.contains("p1-terminal-ok") {
                    break;
                }
            }
            Ok(Some(Ok(_))) => {}
            Ok(Some(Err(error))) => panic!("socket error: {error}"),
            Ok(None) => break,
            Err(_) => {}
        }
    }

    assert!(
        output.contains("p1-terminal-ok"),
        "terminal output missing the echo result: {output:?}"
    );

    // Resize must be accepted without closing the socket.
    socket
        .send(Message::text(
            json!({ "type": "resize", "cols": 100, "rows": 40 }).to_string(),
        ))
        .await
        .expect("send resize");

    let _ = socket.close(None).await;
    server.handle.shutdown().await;
}

#[tokio::test]
async fn file_watch_websocket_reports_changes() {
    let server = spawn(false).await;
    let dir = TestDir::new();
    let target = path_of(&dir, "watched.txt");
    std::fs::write(&target, "v1").expect("seed file");

    let (mut socket, _) = tokio_tungstenite::connect_async(server.ws_url("/ws/file-watch"))
        .await
        .expect("ws connect");

    socket
        .send(Message::text(
            json!({ "type": "file-watch-start", "path": target, "requestId": "req-1" })
                .to_string(),
        ))
        .await
        .expect("start watch");

    // Give the watcher a moment to attach before touching the file.
    tokio::time::sleep(Duration::from_millis(400)).await;
    std::fs::write(&target, "v2-with-more-bytes").expect("modify file");

    let mut event: Option<Value> = None;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(15);
    while tokio::time::Instant::now() < deadline {
        match tokio::time::timeout(Duration::from_secs(3), socket.next()).await {
            Ok(Some(Ok(Message::Text(text)))) => {
                event = Some(serde_json::from_str(text.as_str()).expect("json event"));
                break;
            }
            Ok(Some(Ok(_))) => {}
            Ok(Some(Err(error))) => panic!("socket error: {error}"),
            Ok(None) => break,
            Err(_) => {}
        }
    }

    let event = event.expect("watch event");
    assert_eq!(event["type"], "file-watch-event");
    assert_eq!(event["path"], target);
    assert!(
        matches!(event["eventType"].as_str(), Some("change") | Some("rename")),
        "unexpected event: {event}"
    );
    assert_eq!(event["requestId"], "req-1");

    let _ = socket.close(None).await;
    server.handle.shutdown().await;
}

#[tokio::test]
async fn websockets_require_a_token() {
    let server = spawn(false).await;
    let url = server.base.replace("http://", "ws://") + "/ws/terminal";
    let result = tokio_tungstenite::connect_async(url).await;
    assert!(result.is_err(), "handshake without a token must fail");
    server.handle.shutdown().await;
}

fn reference_platform() -> &'static str {
    match std::env::consts::OS {
        "windows" => "win32",
        "macos" => "darwin",
        other => other,
    }
}