//! ACP agent install/uninstall/update tests (P6).
//!
//! Registry installs are exercised end-to-end against a local archive server:
//! download → sha256 → extraction → `acp.json` → registry registration. Disk
//! installs and the update/uninstall endpoints run against real executables on
//! PATH (`node`, which the rest of the ACP suite already requires).

use std::path::{Path, PathBuf};
use std::time::Duration;

use clover_server::acp::install::binary_platform_target;
use clover_server::acp::probe::probe_path_command;
use clover_server::{bind, start_with_listener, Config, CorsPolicy, Handle, PortPolicy};
use serde_json::{json, Value};
use sha2::Digest;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

struct TestHome(PathBuf);

impl TestHome {
    fn new() -> Self {
        let path = PathBuf::from(env!("CARGO_TARGET_TMPDIR"))
            .join(format!("clover-agent-install-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(path.join(".clover")).expect("create temp home");
        Self(path)
    }

    fn path(&self) -> &Path {
        &self.0
    }

    fn state_dir(&self) -> PathBuf {
        self.0.join(".clover")
    }

    fn acp_config(&self) -> Value {
        let raw = std::fs::read_to_string(self.state_dir().join("acp.json")).unwrap_or_default();
        serde_json::from_str(&raw).unwrap_or(Value::Null)
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
            // No startup warmup: these tests only care about install flows.
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
            .json(&body)
            .send()
            .await
            .expect("request");
        let status = response.status().as_u16();
        (status, response.json().await.unwrap_or(Value::Null))
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

    /// Poll the install job until it leaves `running`.
    async fn wait_job(&self, job_id: &str) -> Value {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(30);
        loop {
            let (status, body) = self
                .get(&format!("/api/acp/agents/install/{job_id}"))
                .await;
            assert_eq!(status, 200, "{body}");
            let job = body["job"].clone();
            if job["status"] != "running" {
                return job;
            }
            assert!(
                tokio::time::Instant::now() < deadline,
                "install job never finished: {job}"
            );
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }
}

/// Minimal single-blob HTTP server for archive downloads.
struct BlobServer {
    url: String,
    handle: tokio::task::JoinHandle<()>,
}

impl Drop for BlobServer {
    fn drop(&mut self) {
        self.handle.abort();
    }
}

async fn serve_blob(name: &str, bytes: Vec<u8>, delay: Duration) -> BlobServer {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind blob");
    let addr = listener.local_addr().expect("blob addr");
    let path = format!("/{name}");
    let handle = tokio::spawn(async move {
        loop {
            let Ok((mut socket, _)) = listener.accept().await else {
                break;
            };
            let bytes = bytes.clone();
            tokio::spawn(async move {
                let mut buffer = Vec::new();
                let mut chunk = [0u8; 1024];
                loop {
                    match socket.read(&mut chunk).await {
                        Ok(0) => break,
                        Ok(read) => {
                            buffer.extend_from_slice(&chunk[..read]);
                            if buffer.windows(4).any(|window| window == b"\r\n\r\n") {
                                break;
                            }
                        }
                        Err(_) => return,
                    }
                }
                if !delay.is_zero() {
                    tokio::time::sleep(delay).await;
                }
                let header = format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nContent-Type: application/octet-stream\r\nConnection: close\r\n\r\n",
                    bytes.len()
                );
                let _ = socket.write_all(header.as_bytes()).await;
                let _ = socket.write_all(&bytes).await;
                let _ = socket.shutdown().await;
            });
        }
    });
    BlobServer {
        url: format!("http://{addr}{path}"),
        handle,
    }
}

fn zip_archive(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    let options = zip::write::SimpleFileOptions::default().unix_permissions(0o755);
    for (name, data) in entries {
        writer.start_file(*name, options).expect("zip entry");
        std::io::Write::write_all(&mut writer, data).expect("zip write");
    }
    writer.finish().expect("zip finish").into_inner()
}

fn tar_gz_archive(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
    let mut builder = tar::Builder::new(encoder);
    for (name, data) in entries {
        let mut header = tar::Header::new_gnu();
        header.set_size(data.len() as u64);
        header.set_mode(0o755);
        header.set_cksum();
        builder
            .append_data(&mut header, name, *data)
            .expect("tar entry");
    }
    builder.into_inner().expect("tar inner").finish().expect("gz")
}

fn sha256(bytes: &[u8]) -> String {
    hex::encode(sha2::Sha256::digest(bytes))
}

fn binary_distribution(archive_url: &str, digest: Option<String>, cmd: &str) -> Value {
    let target = binary_platform_target();
    json!({
        "id": "zip-agent",
        "name": "Zip Agent",
        "source": "registry",
        "distribution": {
            "binary": {
                (target): {
                    "archive": archive_url,
                    "sha256": digest,
                    "cmd": cmd,
                    "args": ["--acp"]
                }
            }
        }
    })
}

#[tokio::test]
async fn binary_install_downloads_verifies_and_extracts() {
    let home = TestHome::new();
    let server = spawn(&home).await;

    let archive = zip_archive(&[
        ("tool/tool.exe", b"#!/bin/sh\necho tool 1.0\n"),
        ("tool/README.md", b"readme"),
    ]);
    let digest = sha256(&archive);
    let blob = serve_blob("tool.zip", archive.clone(), Duration::ZERO).await;

    let (status, body) = server
        .post(
            "/api/acp/agents/install",
            binary_distribution(&blob.url, Some(digest.clone()), "tool/tool.exe"),
        )
        .await;
    assert_eq!(status, 200, "{body}");
    let job = &body["job"];
    assert_eq!(job["agentId"], "zip-agent");
    assert_eq!(job["status"], "running");
    assert!(job["command"].as_str().unwrap_or_default().starts_with("download "));
    let job_id = job["id"].as_str().expect("job id").to_string();

    let finished = server.wait_job(&job_id).await;
    assert_eq!(finished["status"], "succeeded", "{finished}");
    assert!(finished["finishedAt"].as_i64().unwrap_or(0) > 0);

    let steps = finished["steps"].as_array().expect("steps");
    let labels: Vec<&str> = steps
        .iter()
        .filter_map(|step| step["label"].as_str())
        .collect();
    assert!(labels.iter().any(|label| label.starts_with("Download archive")));
    assert!(labels.contains(&"Extract archive"));
    assert!(steps.iter().all(|step| step["status"] == "succeeded"));

    let install_dir = home.state_dir().join("agents").join("zip-agent");
    let executable = install_dir.join("tool").join("tool.exe");
    assert!(executable.exists(), "executable missing: {}", executable.display());
    assert!(install_dir.join("tool").join("README.md").exists());

    let config = home.acp_config();
    let entry = &config["agents"][0];
    assert_eq!(entry["id"], "zip-agent");
    assert_eq!(entry["source"], "registry");
    assert_eq!(entry["command"], executable.to_string_lossy().as_ref());
    assert_eq!(entry["args"], json!(["--acp"]));
    assert_eq!(entry["installed"], true);

    server.handle.shutdown().await;
}

#[tokio::test]
async fn binary_install_supports_tar_gz_and_relative_cmd() {
    let home = TestHome::new();
    let server = spawn(&home).await;

    let archive = tar_gz_archive(&[("./bin/tool", b"#!/bin/sh\necho tool\n")]);
    let blob = serve_blob("tool.tar.gz", archive.clone(), Duration::ZERO).await;

    let mut payload = binary_distribution(&blob.url, Some(sha256(&archive)), "./bin/tool");
    payload["id"] = json!("tar-agent");
    let (status, body) = server.post("/api/acp/agents/install", payload).await;
    assert_eq!(status, 200, "{body}");
    let job_id = body["job"]["id"].as_str().expect("job id").to_string();

    let finished = server.wait_job(&job_id).await;
    assert_eq!(finished["status"], "succeeded", "{finished}");

    let executable = home
        .state_dir()
        .join("agents")
        .join("tar-agent")
        .join("bin")
        .join("tool");
    assert!(executable.exists(), "{}", executable.display());
    assert_eq!(
        home.acp_config()["agents"][0]["command"],
        executable.to_string_lossy().as_ref()
    );

    server.handle.shutdown().await;
}

#[tokio::test]
async fn sha256_mismatch_fails_without_persisting_config() {
    let home = TestHome::new();
    let server = spawn(&home).await;

    let archive = zip_archive(&[("tool.exe", b"binary")]);
    let blob = serve_blob("tool.zip", archive, Duration::ZERO).await;

    let (status, body) = server
        .post(
            "/api/acp/agents/install",
            binary_distribution(
                &blob.url,
                Some("0000000000000000000000000000000000000000000000000000000000000000".to_string()),
                "tool.exe",
            ),
        )
        .await;
    assert_eq!(status, 200, "{body}");
    let job_id = body["job"]["id"].as_str().expect("job id").to_string();

    let finished = server.wait_job(&job_id).await;
    assert_eq!(finished["status"], "failed");
    assert_eq!(finished["error"], "Archive sha256 verification failed");
    let steps = finished["steps"].as_array().expect("steps");
    assert_eq!(steps.len(), 1);
    assert_eq!(steps[0]["status"], "failed");
    assert!(
        steps[0]["output"]
            .as_array()
            .expect("output")
            .iter()
            .any(|line| line.as_str().unwrap_or_default().contains("sha256 mismatch"))
    );

    assert!(
        home.acp_config()["agents"].is_null(),
        "failed installs must not write acp.json"
    );
    assert!(!home.state_dir().join("agents").join("zip-agent").exists());

    server.handle.shutdown().await;
}

#[tokio::test]
async fn missing_platform_target_fails_the_job() {
    let home = TestHome::new();
    let server = spawn(&home).await;

    let payload = json!({
        "id": "other-agent",
        "name": "Other Agent",
        "source": "registry",
        "distribution": {
            "binary": {
                "plan9-vax": { "archive": "http://127.0.0.1:1/none.zip", "cmd": "tool" }
            }
        }
    });
    let (status, body) = server.post("/api/acp/agents/install", payload).await;
    assert_eq!(status, 200, "{body}");
    let job_id = body["job"]["id"].as_str().expect("job id").to_string();

    let finished = server.wait_job(&job_id).await;
    assert_eq!(finished["status"], "failed");
    let error = finished["error"].as_str().unwrap_or_default();
    assert!(
        error.starts_with("No binary distribution of this agent for "),
        "{error}"
    );

    server.handle.shutdown().await;
}

#[tokio::test]
async fn duplicate_install_returns_the_running_job() {
    let home = TestHome::new();
    let server = spawn(&home).await;

    let archive = zip_archive(&[("tool.exe", b"binary")]);
    let blob = serve_blob("tool.zip", archive.clone(), Duration::from_millis(400)).await;
    let payload = binary_distribution(&blob.url, Some(sha256(&archive)), "tool.exe");

    let (status, first) = server.post("/api/acp/agents/install", payload.clone()).await;
    assert_eq!(status, 200, "{first}");
    let (status, second) = server.post("/api/acp/agents/install", payload).await;
    assert_eq!(status, 200, "{second}");
    assert_eq!(first["job"]["id"], second["job"]["id"]);

    let job_id = first["job"]["id"].as_str().expect("job id").to_string();
    assert_eq!(server.wait_job(&job_id).await["status"], "succeeded");

    server.handle.shutdown().await;
}

#[tokio::test]
async fn install_validation_and_unknown_jobs() {
    let home = TestHome::new();
    let server = spawn(&home).await;

    let (status, body) = server.post("/api/acp/agents/install", json!({})).await;
    assert_eq!(status, 400);
    assert_eq!(
        body["error"],
        "body must be a full AgentConfig with at least id and name"
    );

    let (status, body) = server
        .post(
            "/api/acp/agents/install",
            json!({ "id": "builtin", "name": "Builtin", "source": "builtin" }),
        )
        .await;
    assert_eq!(status, 501);
    assert_eq!(
        body["error"],
        "Installing source=\"builtin\" agents is not implemented yet"
    );

    let (status, body) = server
        .post(
            "/api/acp/agents/install",
            json!({ "id": "registry", "name": "Registry", "source": "registry" }),
        )
        .await;
    assert_eq!(status, 400);
    assert_eq!(
        body["error"],
        "body.distribution is required for source=registry installs"
    );

    let (status, body) = server
        .post(
            "/api/acp/agents/install",
            json!({ "id": "disk", "name": "Disk", "source": "disk" }),
        )
        .await;
    assert_eq!(status, 400);
    assert_eq!(
        body["error"],
        "body.command (path to the executable) is required for source=disk installs"
    );

    // No source + no distribution block: not installable at all.
    let (status, body) = server
        .post("/api/acp/agents/install", json!({ "id": "npx", "name": "Npx" }))
        .await;
    assert_eq!(status, 400);
    assert_eq!(
        body["error"],
        "No installable distribution for agent: npx"
    );

    // An empty distribution block is accepted and fails asynchronously, like
    // the TS server (which throws inside the background job).
    let (status, body) = server
        .post(
            "/api/acp/agents/install",
            json!({ "id": "empty", "name": "Empty", "source": "registry", "distribution": {} }),
        )
        .await;
    assert_eq!(status, 200, "{body}");
    let job_id = body["job"]["id"].as_str().expect("job id").to_string();
    let finished = server.wait_job(&job_id).await;
    assert_eq!(finished["status"], "failed");
    assert_eq!(
        finished["error"],
        "Distribution block has none of: npx, uvx, binary"
    );

    let (status, body) = server.get("/api/acp/agents/install/install-nope").await;
    assert_eq!(status, 404);
    assert_eq!(body["error"], "Install job not found");

    server.handle.shutdown().await;
}

#[tokio::test]
async fn disk_install_update_and_uninstall() {
    if !probe_path_command("node").await.found {
        eprintln!("skipping: node is not on PATH");
        return;
    }

    let home = TestHome::new();
    let server = spawn(&home).await;

    // Disk install completes synchronously.
    let (status, body) = server
        .post(
            "/api/acp/agents/install",
            json!({
                "id": "disk-agent",
                "name": "Disk Agent",
                "source": "disk",
                "command": "node",
                "args": ["--version"]
            }),
        )
        .await;
    assert_eq!(status, 200, "{body}");
    let job = &body["job"];
    assert_eq!(job["status"], "succeeded");
    assert_eq!(job["command"], "node");
    assert_eq!(job["steps"][0]["label"], "Verify executable");

    let entry = &home.acp_config()["agents"][0];
    assert_eq!(entry["id"], "disk-agent");
    assert_eq!(entry["source"], "disk");
    assert_eq!(entry["description"], "Agent added from disk");
    assert_eq!(entry["installed"], true);

    // Update: name/args/env/description (env replaces the whole map).
    let (status, body) = server
        .post(
            "/api/acp/agents/disk-agent/update",
            json!({
                "name": "Renamed Agent",
                "command": "node",
                "args": ["--version", "--help"],
                "env": { "CLOVER_AGENT": "1", "EMPTY": null },
                "description": "edited"
            }),
        )
        .await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["success"], true);
    assert_eq!(body["agent"]["id"], "disk-agent");
    assert_eq!(body["agent"]["name"], "Renamed Agent");

    let entry = home.acp_config()["agents"][0].clone();
    assert_eq!(entry["name"], "Renamed Agent");
    assert_eq!(entry["args"], json!(["--version", "--help"]));
    assert_eq!(entry["env"], json!({ "CLOVER_AGENT": "1" }));
    assert_eq!(entry["description"], "edited");

    // Update validation.
    let (status, body) = server
        .post("/api/acp/agents/disk-agent/update", json!({ "command": "" }))
        .await;
    assert_eq!(status, 400);
    assert_eq!(body["error"], "command (path to the executable) is required");

    let (status, body) = server
        .post(
            "/api/acp/agents/missing/update",
            json!({ "command": "node" }),
        )
        .await;
    assert_eq!(status, 404);
    assert_eq!(body["error"], "Agent not found: missing");

    let (status, body) = server
        .post(
            "/api/acp/agents/disk-agent/update",
            json!({ "command": "clover-definitely-missing-binary" }),
        )
        .await;
    assert_eq!(status, 400);
    assert_eq!(
        body["error"],
        "Executable not found: clover-definitely-missing-binary"
    );

    // Uninstall drops the entry (no managed artifacts for disk agents).
    let (status, body) = server.delete("/api/acp/agents/disk-agent/uninstall").await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["success"], true);
    assert!(home.acp_config()["agents"].as_array().is_none_or(Vec::is_empty));

    let (status, body) = server.delete("/api/acp/agents/disk-agent/uninstall").await;
    assert_eq!(status, 404);
    assert_eq!(body["error"], "Agent not found: disk-agent");

    server.handle.shutdown().await;
}

#[tokio::test]
async fn uninstall_removes_binary_install_dir() {
    let home = TestHome::new();
    let server = spawn(&home).await;

    let archive = zip_archive(&[("tool.exe", b"binary")]);
    let blob = serve_blob("tool.zip", archive.clone(), Duration::ZERO).await;
    let (status, body) = server
        .post(
            "/api/acp/agents/install",
            binary_distribution(&blob.url, Some(sha256(&archive)), "tool.exe"),
        )
        .await;
    assert_eq!(status, 200, "{body}");
    let job_id = body["job"]["id"].as_str().expect("job id").to_string();
    assert_eq!(server.wait_job(&job_id).await["status"], "succeeded");

    let install_dir = home.state_dir().join("agents").join("zip-agent");
    assert!(install_dir.exists());

    let (status, body) = server.delete("/api/acp/agents/zip-agent/uninstall").await;
    assert_eq!(status, 200, "{body}");
    assert!(!install_dir.exists(), "install dir should be removed");
    assert!(home.acp_config()["agents"].as_array().is_none_or(Vec::is_empty));

    server.handle.shutdown().await;
}

#[tokio::test]
async fn npx_install_reports_a_missing_runtime_or_verifies_the_package() {
    let home = TestHome::new();
    let server = spawn(&home).await;

    let (status, body) = server
        .post(
            "/api/acp/agents/install",
            json!({
                "id": "npx-agent",
                "name": "Npx Agent",
                "source": "registry",
                "distribution": { "npx": { "package": "clover-package-that-does-not-exist-xyz" } }
            }),
        )
        .await;
    assert_eq!(status, 200, "{body}");
    let job_id = body["job"]["id"].as_str().expect("job id").to_string();
    let finished = server.wait_job(&job_id).await;

    // Either the runtime is missing (first step fails) or npm rejects the
    // package (second step fails); both are valid outcomes and neither may
    // persist a config entry.
    assert_eq!(finished["status"], "failed", "{finished}");
    let error = finished["error"].as_str().unwrap_or_default();
    assert!(
        error.contains("Node.js / npx is required")
            || error.contains("via npx (exit code"),
        "{error}"
    );
    assert!(home.acp_config()["agents"].is_null());

    server.handle.shutdown().await;
}