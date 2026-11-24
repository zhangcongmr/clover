//! `/api/skills/*` contract tests (P3).
//!
//! These routes are unauthenticated by design (same as the TS server), so no
//! `Authorization` header is sent. Every test runs against an isolated home +
//! state directory.

use std::path::{Path, PathBuf};
use std::time::Duration;

use clover_server::{bind, start_with_listener, Config, CorsPolicy, Handle, PortPolicy};
use serde_json::{json, Value};

struct TestHome(PathBuf);

impl TestHome {
    fn new() -> Self {
        let path = PathBuf::from(env!("CARGO_TARGET_TMPDIR"))
            .join(format!("clover-skills-api-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(path.join(".clover")).expect("create temp home");
        Self(path)
    }

    fn path(&self) -> &Path {
        &self.0
    }

    fn state_dir(&self) -> PathBuf {
        self.0.join(".clover")
    }

    fn write(&self, relative: &str, content: &str) -> PathBuf {
        let target = self.0.join(relative);
        std::fs::create_dir_all(target.parent().expect("parent")).expect("mkdir");
        std::fs::write(&target, content).expect("write");
        target
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
async fn create_list_get_update_duplicate_delete() {
    let home = TestHome::new();
    let server = spawn(&home).await;

    let created = json!({
        "name": "review",
        "description": "Checks code",
        "content": "Look for bugs.",
        "files": { "references/api.md": "# API" }
    });
    let (status, body) = server.send("POST", "/api/skills", Some(created)).await;
    assert_eq!(status, 200);
    assert_eq!(body["success"], true);
    assert_eq!(body["name"], "review");

    // Written to the directory store, with YAML front matter.
    let markdown = std::fs::read_to_string(
        home.state_dir()
            .join("skills")
            .join("review")
            .join("SKILL.md"),
    )
    .expect("SKILL.md");
    assert!(markdown.contains("name: \"review\""), "{markdown}");
    assert!(markdown.contains("description: \"Checks code\""), "{markdown}");

    let (status, body) = server.send("GET", "/api/skills", None).await;
    assert_eq!(status, 200);
    assert_eq!(body["success"], true);
    let skills = body["skills"].as_array().expect("skills");
    let review = skills
        .iter()
        .find(|skill| skill["name"] == "review")
        .expect("review listed");
    assert_eq!(review["description"], "Checks code");
    assert_eq!(review["fileCount"], 1);
    assert_eq!(review["source"], "~/.clover/skills");
    assert!(body["sources"].is_array());
    assert!(body["configFiles"].is_array());

    let (status, body) = server.send("GET", "/api/skills/review", None).await;
    assert_eq!(status, 200);
    assert_eq!(body["writable"], true);
    assert_eq!(body["files"]["references/api.md"], "# API");
    assert_eq!(body["skill"]["content"], "Look for bugs.");

    // A reload re-scans and now reports the directory store as a source.
    let (status, body) = server.send("POST", "/api/skills/reload", None).await;
    assert_eq!(status, 200);
    assert!(
        body["sources"]
            .as_array()
            .expect("sources")
            .iter()
            .any(|source| source
                .as_str()
                .is_some_and(|value| value.ends_with("skills"))),
        "sources: {}",
        body["sources"]
    );

    // Update keeps supporting files.
    let (status, body) = server
        .send(
            "PUT",
            "/api/skills/review",
            Some(json!({ "content": "Look harder." })),
        )
        .await;
    assert_eq!(status, 200);
    assert_eq!(body["success"], true);
    let (_, body) = server.send("GET", "/api/skills/review", None).await;
    assert_eq!(body["skill"]["content"], "Look harder.");
    assert_eq!(body["skill"]["description"], "Checks code");
    assert_eq!(body["files"]["references/api.md"], "# API");

    // Duplicate lands right after the original.
    let (status, body) = server.send("POST", "/api/skills/review/duplicate", None).await;
    assert_eq!(status, 200);
    assert_eq!(body["success"], true);
    assert_eq!(body["skill"]["name"], "review-copy");
    let (_, body) = server.send("GET", "/api/skills/review-copy", None).await;
    assert_eq!(body["files"]["references/api.md"], "# API");

    let (_, body) = server.send("GET", "/api/skills", None).await;
    let names: Vec<&str> = body["skills"]
        .as_array()
        .expect("skills")
        .iter()
        .map(|skill| skill["name"].as_str().unwrap_or_default())
        .collect();
    assert_eq!(names, vec!["review", "review-copy"]);

    // Delete both.
    let (status, body) = server.send("DELETE", "/api/skills/review-copy", None).await;
    assert_eq!(status, 200);
    assert_eq!(body["success"], true);
    let (status, body) = server.send("GET", "/api/skills/review-copy", None).await;
    assert_eq!(status, 404);
    assert_eq!(body["error"], "Skill not found");

    server.handle.shutdown().await;
}

#[tokio::test]
async fn discovered_skills_are_read_only() {
    let home = TestHome::new();
    home.write(
        ".claude/skills/external/SKILL.md",
        "---\nname: External Skill\ndescription: From claude\n---\n\nExternal body\n",
    );

    let server = spawn(&home).await;

    let (status, body) = server.send("GET", "/api/skills/external", None).await;
    assert_eq!(status, 200);
    assert_eq!(body["writable"], false);
    assert_eq!(body["skill"]["displayName"], "External Skill");
    assert_eq!(body["skill"]["description"], "From claude");
    assert_eq!(body["skill"]["source"], "~/.claude/skills");

    let (status, body) = server
        .send(
            "PUT",
            "/api/skills/external",
            Some(json!({ "content": "nope" })),
        )
        .await;
    assert_eq!(status, 409);
    assert_eq!(body["error"], "Skill is read-only");
    assert_eq!(
        body["detail"],
        "This skill was discovered on disk. Edit its SKILL.md file instead."
    );

    let (status, body) = server.send("DELETE", "/api/skills/external", None).await;
    assert_eq!(status, 409);
    assert_eq!(
        body["detail"],
        "This skill was discovered on disk. Delete its SKILL.md file instead."
    );

    // The file is untouched.
    assert!(home
        .path()
        .join(".claude/skills/external/SKILL.md")
        .exists());

    server.handle.shutdown().await;
}

#[tokio::test]
async fn validation_messages() {
    let home = TestHome::new();
    let server = spawn(&home).await;

    let (status, body) = server.send("POST", "/api/skills", Some(json!({}))).await;
    assert_eq!(status, 400);
    assert_eq!(body["error"], "name is required");

    let (status, body) = server
        .send("POST", "/api/skills", Some(json!({ "name": "x" })))
        .await;
    assert_eq!(status, 400);
    assert_eq!(body["error"], "content is required");

    let (status, body) = server
        .send(
            "POST",
            "/api/skills",
            Some(json!({ "name": "x", "content": "c", "files": "nope" })),
        )
        .await;
    assert_eq!(status, 400);
    assert_eq!(body["error"], "files must be an object of relative path → content");

    let (status, body) = server
        .send(
            "POST",
            "/api/skills",
            Some(json!({ "name": "../escape", "content": "c" })),
        )
        .await;
    assert_eq!(status, 400);
    assert_eq!(
        body["error"],
        "name may only contain letters, numbers, hyphens and underscores"
    );

    let (status, body) = server
        .send(
            "POST",
            "/api/skills",
            Some(json!({
                "name": "ok",
                "content": "c",
                "files": { "../evil.txt": "x" }
            })),
        )
        .await;
    assert_eq!(status, 400);
    assert_eq!(body["error"], "unsafe supporting file path \"../evil.txt\"");

    let (status, body) = server
        .send("PUT", "/api/skills/missing", Some(json!({ "content": "c" })))
        .await;
    assert_eq!(status, 404);
    assert_eq!(body["error"], "Skill not found");

    server.handle.shutdown().await;
}

#[tokio::test]
async fn reload_reads_external_files_and_config_catalogs() {
    let home = TestHome::new();
    let server = spawn(&home).await;

    let (status, body) = server.send("GET", "/api/skills", None).await;
    assert_eq!(status, 200);
    assert!(body["skills"].as_array().expect("skills").is_empty());

    home.write(
        ".agents/skills/team/SKILL.md",
        "---\ndescription: team skill\n---\nbody",
    );
    home.write(
        ".config/opencode/opencode.json",
        r#"{
            // catalog + local path
            "skills": ["https://catalog.test/skills",]
        }"#,
    );

    let (status, body) = server.send("POST", "/api/skills/reload", None).await;
    assert_eq!(status, 200);
    assert_eq!(body["success"], true);
    assert_eq!(body["count"], 1);
    assert_eq!(body["catalogs"][0], "https://catalog.test/skills");
    assert!(
        body["configFiles"]
            .as_array()
            .expect("configFiles")
            .iter()
            .any(|file| file.as_str().is_some_and(|f| f.ends_with("opencode.json"))),
        "configFiles: {}",
        body["configFiles"]
    );
    assert!(body["errors"].as_array().expect("errors").is_empty());

    let (_, body) = server.send("GET", "/api/skills", None).await;
    assert_eq!(body["skills"][0]["name"], "team");
    assert_eq!(body["skills"][0]["description"], "team skill");

    server.handle.shutdown().await;
}

#[tokio::test]
async fn skills_survive_a_restart() {
    let home = TestHome::new();
    let server = spawn(&home).await;
    server
        .send(
            "POST",
            "/api/skills",
            Some(json!({ "name": "persisted", "description": "d", "content": "c" })),
        )
        .await;
    server.handle.shutdown().await;

    let server = spawn(&home).await;
    let (status, body) = server.send("GET", "/api/skills/persisted", None).await;
    assert_eq!(status, 200);
    assert_eq!(body["writable"], true);
    assert_eq!(body["skill"]["description"], "d");
    server.handle.shutdown().await;
}

#[tokio::test]
async fn legacy_store_entries_are_visible_and_writable() {
    let home = TestHome::new();
    home.write(
        ".clover/skills.json",
        r#"{"skills":{"legacy":{"name":"legacy","description":"from json","content":"body"}}}"#,
    );

    let server = spawn(&home).await;
    let (status, body) = server.send("GET", "/api/skills/legacy", None).await;
    assert_eq!(status, 200);
    assert_eq!(body["skill"]["source"], "store");
    assert_eq!(body["writable"], true);

    let (status, _) = server
        .send(
            "PUT",
            "/api/skills/legacy",
            Some(json!({ "content": "updated" })),
        )
        .await;
    assert_eq!(status, 200);

    // Deleting removes the legacy entry too, so it cannot come back.
    let (status, body) = server.send("DELETE", "/api/skills/legacy", None).await;
    assert_eq!(status, 200);
    assert_eq!(body["success"], true);

    let raw = std::fs::read_to_string(home.state_dir().join("skills.json")).expect("store");
    let parsed: Value = serde_json::from_str(&raw).expect("json");
    assert!(parsed["skills"].get("legacy").is_none());

    server.handle.shutdown().await;
}