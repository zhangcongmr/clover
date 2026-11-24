//! `/api/projects` + `/api/tasks` tests (P6).
//!
//! These endpoints are public (no bearer token) and mirror the TS server's
//! `projects.json` / `tasks.json` / `selected-project.json` semantics.

use std::path::{Path, PathBuf};

use clover_server::{bind, start_with_listener, Config, CorsPolicy, Handle, PortPolicy};
use serde_json::{json, Value};

struct TestHome(PathBuf);

impl TestHome {
    fn new() -> Self {
        let path = PathBuf::from(env!("CARGO_TARGET_TMPDIR"))
            .join(format!("clover-projects-api-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(path.join(".clover")).expect("create temp home");
        Self(path)
    }

    fn path(&self) -> &Path {
        &self.0
    }

    fn state_dir(&self) -> PathBuf {
        self.0.join(".clover")
    }

    fn workspace(&self, name: &str) -> PathBuf {
        let path = self.0.join(name);
        std::fs::create_dir_all(&path).expect("create workspace");
        path
    }

    fn read_json(&self, name: &str) -> Value {
        let raw = std::fs::read_to_string(self.state_dir().join(name)).unwrap_or_default();
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

    TestServer {
        handle,
        base: format!("http://127.0.0.1:{port}"),
    }
}

impl TestServer {
    async fn post(&self, path: &str, body: Value) -> (u16, Value) {
        let response = reqwest::Client::new()
            .post(format!("{}{path}", self.base))
            .json(&body)
            .send()
            .await
            .expect("request");
        let status = response.status().as_u16();
        (status, response.json().await.unwrap_or(Value::Null))
    }

    async fn get(&self, path: &str) -> (u16, Value) {
        let response = reqwest::Client::new()
            .get(format!("{}{path}", self.base))
            .send()
            .await
            .expect("request");
        let status = response.status().as_u16();
        (status, response.json().await.unwrap_or(Value::Null))
    }
}

fn path_text(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

#[tokio::test]
async fn project_list_add_and_delete() {
    let home = TestHome::new();
    let server = spawn(&home).await;

    // Empty stores.
    let (status, body) = server.post("/api/projects", json!({})).await;
    assert_eq!(status, 200);
    assert_eq!(body, json!({ "success": true, "projects": [] }));

    let (status, body) = server.post("/api/tasks", json!({})).await;
    assert_eq!(status, 200);
    assert_eq!(body, json!({ "success": true, "tasks": [] }));

    // Validation.
    let (status, body) = server.post("/api/projects/add", json!({ "name": "No path" })).await;
    assert_eq!(status, 400);
    assert_eq!(body["error"], "name and path are required");

    let missing = path_text(&home.path().join("does-not-exist"));
    let (status, body) = server
        .post(
            "/api/projects/add",
            json!({ "name": "Missing", "path": missing }),
        )
        .await;
    assert_eq!(status, 400);
    assert_eq!(body["error"], "Directory does not exist");

    // Add two projects.
    let first = home.workspace("first");
    let second = home.workspace("second");
    let (status, body) = server
        .post(
            "/api/projects/add",
            json!({ "name": "First", "path": path_text(&first), "sessions": [] }),
        )
        .await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["success"], true);
    assert_eq!(body["projects"][0]["name"], "First");
    assert_eq!(body["projects"][0]["type"], "project");
    assert_eq!(body["projects"][0]["sessions"], json!([]));

    let (status, body) = server
        .post(
            "/api/projects/add",
            json!({ "name": "Second", "path": path_text(&second) }),
        )
        .await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["projects"].as_array().expect("projects").len(), 2);

    // Same path is a conflict (names are labels, paths identify).
    let (status, body) = server
        .post(
            "/api/projects/add",
            json!({ "name": "Second Again", "path": path_text(&second) }),
        )
        .await;
    assert_eq!(status, 409);
    assert_eq!(body["error"], "Project already exists");

    // On-disk shape stays `{ name, path, sessions }`.
    let stored = home.read_json("projects.json");
    assert_eq!(stored[0]["name"], "First");
    assert!(stored[0].get("type").is_none());

    // Listing returns the response shape with `type`.
    let (_, body) = server.post("/api/projects", json!({})).await;
    assert_eq!(body["projects"][1]["name"], "Second");
    assert_eq!(body["projects"][1]["type"], "project");

    // Delete by path (a missing path is a no-op success).
    let (status, body) = server
        .post(
            "/api/projects/delete",
            json!({ "path": path_text(&first), "type": "project" }),
        )
        .await;
    assert_eq!(status, 200);
    assert_eq!(body, json!({ "success": true }));

    let (_, body) = server.post("/api/projects", json!({})).await;
    assert_eq!(body["projects"].as_array().expect("projects").len(), 1);

    let (status, _) = server
        .post(
            "/api/projects/delete",
            json!({ "path": path_text(&first), "type": "project" }),
        )
        .await;
    assert_eq!(status, 200);

    let (status, body) = server.post("/api/projects/delete", json!({})).await;
    assert_eq!(status, 400);
    assert_eq!(body["error"], "path is required");

    server.handle.shutdown().await;
}

#[tokio::test]
async fn task_add_upserts_and_keeps_created_at() {
    let home = TestHome::new();
    let server = spawn(&home).await;

    let (status, body) = server
        .post(
            "/api/projects/add",
            json!({ "name": "No id", "type": "task" }),
        )
        .await;
    assert_eq!(status, 400);
    assert_eq!(body["error"], "id and name are required for tasks");

    let (status, body) = server
        .post(
            "/api/projects/add",
            json!({
                "id": "t1",
                "name": "First task",
                "type": "task",
                "path": "",
                "sessions": [{ "sessionId": "s1", "agentId": "a1" }]
            }),
        )
        .await;
    assert_eq!(status, 200, "{body}");
    let created_at = body["task"]["createdAt"]
        .as_str()
        .expect("createdAt")
        .to_string();
    assert!(created_at.ends_with('Z'), "{created_at}");
    assert_eq!(body["task"]["type"], "task");
    assert_eq!(body["task"]["id"], "t1");

    let (status, _) = server
        .post(
            "/api/projects/add",
            json!({ "id": "t2", "name": "Second task", "type": "task" }),
        )
        .await;
    assert_eq!(status, 200);

    // Newest first.
    let (_, body) = server.post("/api/tasks", json!({})).await;
    let tasks = body["tasks"].as_array().expect("tasks");
    assert_eq!(tasks.len(), 2);
    assert_eq!(tasks[0]["id"], "t2");
    assert_eq!(tasks[1]["id"], "t1");
    assert_eq!(tasks[1]["createdAt"], created_at);

    // Re-adding keeps the original creation time and updates the other fields.
    let (status, body) = server
        .post(
            "/api/projects/add",
            json!({
                "id": "t1",
                "name": "First task renamed",
                "type": "task",
                "path": "ignored",
                "sessions": []
            }),
        )
        .await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["task"]["createdAt"], created_at);
    assert_eq!(body["task"]["name"], "First task renamed");
    assert_eq!(body["task"]["path"], "ignored");

    let (_, body) = server.post("/api/tasks", json!({})).await;
    assert_eq!(body["tasks"].as_array().expect("tasks").len(), 2);

    // Delete by id, then by path.
    let (status, _) = server
        .post("/api/projects/delete", json!({ "type": "task", "id": "t2" }))
        .await;
    assert_eq!(status, 200);
    let (_, body) = server.post("/api/tasks", json!({})).await;
    assert_eq!(body["tasks"].as_array().expect("tasks").len(), 1);
    assert_eq!(body["tasks"][0]["id"], "t1");

    let (status, _) = server
        .post(
            "/api/projects/delete",
            json!({ "type": "task", "path": "ignored" }),
        )
        .await;
    assert_eq!(status, 200);
    let (_, body) = server.post("/api/tasks", json!({})).await;
    assert!(body["tasks"].as_array().expect("tasks").is_empty());

    let (status, body) = server
        .post("/api/projects/delete", json!({ "type": "task" }))
        .await;
    assert_eq!(status, 400);
    assert_eq!(body["error"], "id or path is required for tasks");

    server.handle.shutdown().await;
}

#[tokio::test]
async fn sessions_are_upserted_into_projects_and_tasks() {
    let home = TestHome::new();
    let server = spawn(&home).await;
    let workspace = home.workspace("project");

    // Validation.
    let (status, body) = server
        .post("/api/projects/save-session", json!({ "projectPath": "x" }))
        .await;
    assert_eq!(status, 400);
    assert_eq!(
        body["error"],
        "projectPath, sessionId, and agentId are required"
    );

    let (status, body) = server
        .post(
            "/api/projects/save-session",
            json!({
                "projectPath": path_text(&workspace),
                "session": { "sessionId": "s1", "agentId": "a1" }
            }),
        )
        .await;
    assert_eq!(status, 404);
    assert_eq!(body["error"], "Project not found");

    // Create the project, then append the session.
    let (status, _) = server
        .post(
            "/api/projects/add",
            json!({ "name": "Project", "path": path_text(&workspace) }),
        )
        .await;
    assert_eq!(status, 200);

    let (status, body) = server
        .post(
            "/api/projects/save-session",
            json!({
                "projectPath": path_text(&workspace),
                "session": { "sessionId": "s1", "agentId": "a1", "title": "Hello" }
            }),
        )
        .await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["project"]["type"], "project");
    assert_eq!(body["session"]["sessionId"], "s1");
    assert!(body["session"]["updatedAt"].as_str().is_some());
    assert_eq!(body["project"]["sessions"].as_array().expect("sessions").len(), 1);

    // Saving again updates in place instead of appending a duplicate.
    let (status, body) = server
        .post(
            "/api/projects/save-session",
            json!({
                "projectPath": path_text(&workspace),
                "session": {
                    "sessionId": "s1",
                    "agentId": "a1",
                    "title": "Hello again",
                    "updatedAt": "2020-01-01T00:00:00.000Z"
                }
            }),
        )
        .await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["project"]["sessions"].as_array().expect("sessions").len(), 1);
    assert_eq!(body["session"]["title"], "Hello again");
    assert_eq!(body["session"]["updatedAt"], "2020-01-01T00:00:00.000Z");

    // Tasks: title syncs the task name.
    let (status, _) = server
        .post(
            "/api/projects/add",
            json!({
                "id": "task-1",
                "name": "Task",
                "type": "task",
                "path": path_text(&workspace),
                "sessions": [{ "sessionId": "s2", "agentId": "a2" }]
            }),
        )
        .await;
    assert_eq!(status, 200);

    let (status, body) = server
        .post(
            "/api/projects/save-session",
            json!({
                "projectPath": path_text(&workspace),
                "session": { "sessionId": "s2", "agentId": "a2", "title": "Synced title" }
            }),
        )
        .await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["task"]["id"], "task-1");
    assert_eq!(body["task"]["name"], "Synced title");
    assert_eq!(body["task"]["type"], "task");
    assert_eq!(body["session"]["sessionId"], "s2");

    let (_, body) = server.post("/api/tasks", json!({})).await;
    assert_eq!(body["tasks"][0]["name"], "Synced title");

    // Delete a session from the project.
    let (status, body) = server
        .post("/api/projects/delete-session", json!({ "projectPath": "x" }))
        .await;
    assert_eq!(status, 400);
    assert_eq!(body["error"], "projectPath and sessionId are required");

    let (status, body) = server
        .post(
            "/api/projects/delete-session",
            json!({ "projectPath": path_text(&workspace), "sessionId": "s1" }),
        )
        .await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body, json!({ "success": true }));

    let (_, body) = server.post("/api/projects", json!({})).await;
    assert!(
        body["projects"][0]["sessions"]
            .as_array()
            .expect("sessions")
            .is_empty()
    );

    let (status, body) = server
        .post(
            "/api/projects/delete-session",
            json!({ "projectPath": "/nope", "sessionId": "s1" }),
        )
        .await;
    assert_eq!(status, 404);
    assert_eq!(body["error"], "Project not found");

    server.handle.shutdown().await;
}

#[tokio::test]
async fn selected_project_round_trip() {
    let home = TestHome::new();
    let server = spawn(&home).await;

    let (status, body) = server.get("/api/projects/selected").await;
    assert_eq!(status, 200);
    assert_eq!(
        body,
        json!({ "success": true, "selectedProject": null, "selectedSessionId": null })
    );

    let (status, body) = server
        .post(
            "/api/projects/selected",
            json!({ "selectedProject": "Clover", "selectedSessionId": "s1" }),
        )
        .await;
    assert_eq!(status, 200);
    assert_eq!(body, json!({ "success": true }));

    let (_, body) = server.get("/api/projects/selected").await;
    assert_eq!(body["selectedProject"], "Clover");
    assert_eq!(body["selectedSessionId"], "s1");

    let stored = home.read_json("selected-project.json");
    assert_eq!(
        stored,
        json!({ "selectedProject": "Clover", "selectedSessionId": "s1" })
    );

    // Empty strings are stored as null (matching `|| null`).
    let (status, _) = server
        .post(
            "/api/projects/selected",
            json!({ "selectedProject": "", "selectedSessionId": null }),
        )
        .await;
    assert_eq!(status, 200);
    let (_, body) = server.get("/api/projects/selected").await;
    assert_eq!(body["selectedProject"], Value::Null);
    assert_eq!(body["selectedSessionId"], Value::Null);

    server.handle.shutdown().await;
}