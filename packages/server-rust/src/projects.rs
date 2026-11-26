//! `~/.clover/projects.json`, `tasks.json` and `selected-project.json`.
//!
//! Port of the project/task store that lived inline in
//! `packages/server/src/api/acp-routes.ts`. Shapes are byte-compatible with
//! the old server:
//!
//! - `projects.json` — `[{ name, path, sessions }]`;
//! - `tasks.json`    — `[{ name, path, sessions, id, createdAt }]`, newest
//!   first when listed;
//! - `selected-project.json` — `{ selectedProject, selectedSessionId }`.
//!
//! Sessions are opaque objects (`sessionId`, `agentId`, `title`, `updatedAt`,
//! plus whatever the caller sends), so they stay [`serde_json::Value`].

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::acp::stores::iso_now;

/// One entry of `projects.json`.
#[derive(Debug, Clone, Default, Serialize)]
pub struct ProjectRecord {
    pub name: String,
    pub path: String,
    pub sessions: Vec<Value>,
}

/// One entry of `tasks.json`.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskRecord {
    pub name: String,
    pub path: String,
    pub sessions: Vec<Value>,
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
}

/// Wire shape returned by the project/task endpoints.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    pub name: String,
    pub path: String,
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub sessions: Vec<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
}

impl ProjectInfo {
    pub fn project(record: ProjectRecord) -> Self {
        Self {
            name: record.name,
            path: record.path,
            kind: "project",
            sessions: record.sessions,
            id: None,
            created_at: None,
        }
    }

    pub fn task(record: TaskRecord) -> Self {
        Self {
            name: record.name,
            path: record.path,
            kind: "task",
            sessions: record.sessions,
            id: Some(record.id),
            created_at: record.created_at,
        }
    }

    /// Convert back to the on-disk `projects.json` shape.
    pub fn into_project_record(self) -> ProjectRecord {
        ProjectRecord {
            name: self.name,
            path: self.path,
            sessions: self.sessions,
        }
    }

    /// Convert back to the on-disk `tasks.json` shape.
    pub fn into_task_record(self) -> TaskRecord {
        TaskRecord {
            name: self.name,
            path: self.path,
            sessions: self.sessions,
            id: self.id.unwrap_or_default(),
            created_at: self.created_at,
        }
    }
}

pub fn projects_file(state_dir: &Path) -> PathBuf {
    state_dir.join("projects.json")
}

pub fn tasks_file(state_dir: &Path) -> PathBuf {
    state_dir.join("tasks.json")
}

pub fn selected_project_file(state_dir: &Path) -> PathBuf {
    state_dir.join("selected-project.json")
}

/// Read `projects.json`; a missing or malformed file yields an empty list.
pub fn read_projects(state_dir: &Path) -> Vec<ProjectInfo> {
    let Ok(raw) = crate::paths::read_text(projects_file(state_dir)) else {
        return Vec::new();
    };
    let Ok(Value::Array(items)) = serde_json::from_str::<Value>(&raw) else {
        return Vec::new();
    };
    items
        .into_iter()
        .filter_map(project_from_value)
        .collect()
}

/// Tolerant entry parser (`p.sessions || []`, missing names become empty).
fn project_from_value(item: Value) -> Option<ProjectInfo> {
    let Value::Object(map) = item else {
        return None;
    };
    let text = |key: &str| {
        map.get(key)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string()
    };
    Some(ProjectInfo::project(ProjectRecord {
        name: text("name"),
        path: text("path"),
        sessions: map
            .get("sessions")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default(),
    }))
}

pub fn write_projects(state_dir: &Path, projects: &[ProjectInfo]) {
    let records: Vec<ProjectRecord> = projects
        .iter()
        .filter(|project| project.kind == "project")
        .cloned()
        .map(ProjectInfo::into_project_record)
        .collect();
    write_json(&projects_file(state_dir), &records);
}

/// Read `tasks.json`, newest first (stable for equal timestamps).
pub fn read_tasks(state_dir: &Path) -> Vec<ProjectInfo> {
    let Ok(raw) = crate::paths::read_text(tasks_file(state_dir)) else {
        return Vec::new();
    };
    let Ok(Value::Array(items)) = serde_json::from_str::<Value>(&raw) else {
        return Vec::new();
    };
    let mut tasks: Vec<ProjectInfo> = items
        .into_iter()
        .filter_map(task_from_value)
        .collect();
    // `new Date(b.createdAt || 0) - new Date(a.createdAt || 0)`.
    tasks.sort_by(|a, b| {
        let left = a.created_at.as_deref().and_then(parse_ms).unwrap_or(0);
        let right = b.created_at.as_deref().and_then(parse_ms).unwrap_or(0);
        right.cmp(&left)
    });
    tasks
}

/// Tolerant task parser; `createdAt` is kept only when it is a string.
fn task_from_value(item: Value) -> Option<ProjectInfo> {
    let Value::Object(map) = item else {
        return None;
    };
    let text = |key: &str| {
        map.get(key)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string()
    };
    Some(ProjectInfo::task(TaskRecord {
        name: text("name"),
        path: text("path"),
        sessions: map
            .get("sessions")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default(),
        id: text("id"),
        created_at: map
            .get("createdAt")
            .and_then(Value::as_str)
            .map(str::to_string),
    }))
}

pub fn write_tasks(state_dir: &Path, tasks: &[ProjectInfo]) {
    let records: Vec<TaskRecord> = tasks
        .iter()
        .cloned()
        .map(ProjectInfo::into_task_record)
        .collect();
    write_json(&tasks_file(state_dir), &records);
}

/// `{ selectedProject, selectedSessionId }` (`null` when never saved).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectedProject {
    #[serde(default)]
    pub selected_project: Option<String>,
    #[serde(default)]
    pub selected_session_id: Option<String>,
}

pub fn read_selected(state_dir: &Path) -> SelectedProject {
    let Ok(raw) = crate::paths::read_text(selected_project_file(state_dir)) else {
        return SelectedProject::default();
    };
    serde_json::from_str::<SelectedProject>(&raw).unwrap_or_default()
}

pub fn write_selected(state_dir: &Path, selected: &SelectedProject) {
    write_json(&selected_project_file(state_dir), selected);
}

/// JS object spread (`{ ...base, ...over }`) for two JSON values.
pub fn merge_objects(base: &Value, over: &Value) -> Value {
    let mut merged = match base {
        Value::Object(map) => map.clone(),
        _ => serde_json::Map::new(),
    };
    if let Value::Object(over) = over {
        for (key, value) in over {
            merged.insert(key.clone(), value.clone());
        }
    }
    Value::Object(merged)
}

/// Build the `ProjectSession` value: copy of `session` with `updatedAt`
/// populated (an agent-reported timestamp wins over the server clock).
pub fn stamp_session(session: &Value) -> Value {
    match session.get("updatedAt").and_then(Value::as_str) {
        Some(value) if !value.is_empty() => session.clone(),
        _ => merge_objects(session, &json!({ "updatedAt": iso_now() })),
    }
}

/// Does `session` belong to the given `sessionId` + `agentId` pair?
pub fn session_matches(session: &Value, session_id: &str, agent_id: &str) -> bool {
    session.get("sessionId").and_then(Value::as_str) == Some(session_id)
        && session.get("agentId").and_then(Value::as_str) == Some(agent_id)
}

fn parse_ms(value: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|stamp| stamp.timestamp_millis())
}

/// Atomic JSON write (temp file + rename).
fn write_json<T: Serialize>(file: &Path, value: &T) {
    let Some(parent) = file.parent() else {
        return;
    };
    if std::fs::create_dir_all(parent).is_err() {
        return;
    }
    let Ok(json) = serde_json::to_string_pretty(value) else {
        return;
    };
    let temp = file.with_extension("json.tmp");
    if std::fs::write(&temp, json).is_ok() {
        let _ = std::fs::rename(&temp, file);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("target")
            .join("test-tmp")
            .join(format!(
                "clover-projects-{tag}-{}",
                uuid::Uuid::new_v4().simple()
            ));
        std::fs::create_dir_all(&path).expect("create temp dir");
        path
    }

    #[test]
    fn missing_files_read_as_empty() {
        let dir = temp_dir("missing");
        assert!(read_projects(&dir).is_empty());
        assert!(read_tasks(&dir).is_empty());
        let selected = read_selected(&dir);
        assert!(selected.selected_project.is_none());
        assert!(selected.selected_session_id.is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn projects_round_trip_without_extra_fields() {
        let dir = temp_dir("projects");
        let projects = vec![ProjectInfo::project(ProjectRecord {
            name: "Clover".to_string(),
            path: "/tmp/clover".to_string(),
            sessions: vec![json!({ "sessionId": "s1", "agentId": "a1" })],
        })];
        write_projects(&dir, &projects);

        let raw: Value =
            serde_json::from_str(&std::fs::read_to_string(projects_file(&dir)).expect("file"))
                .expect("json");
        assert_eq!(raw[0]["name"], "Clover");
        assert!(raw[0].get("type").is_none(), "type is a response-only field");
        assert_eq!(raw[0]["sessions"][0]["sessionId"], "s1");

        let loaded = read_projects(&dir);
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].kind, "project");
        assert_eq!(loaded[0].sessions.len(), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn tasks_are_sorted_newest_first_and_keep_fields() {
        let dir = temp_dir("tasks");
        let tasks = vec![
            ProjectInfo::task(TaskRecord {
                name: "old".to_string(),
                path: String::new(),
                sessions: Vec::new(),
                id: "t1".to_string(),
                created_at: Some("2024-01-01T00:00:00.000Z".to_string()),
            }),
            ProjectInfo::task(TaskRecord {
                name: "new".to_string(),
                path: String::new(),
                sessions: Vec::new(),
                id: "t2".to_string(),
                created_at: Some("2024-06-01T00:00:00.000Z".to_string()),
            }),
        ];
        write_tasks(&dir, &tasks);

        let loaded = read_tasks(&dir);
        assert_eq!(loaded[0].name, "new");
        assert_eq!(loaded[1].name, "old");
        assert_eq!(loaded[0].id.as_deref(), Some("t2"));
        assert_eq!(loaded[0].kind, "task");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn malformed_files_are_tolerated() {
        let dir = temp_dir("broken");
        std::fs::write(projects_file(&dir), "{ not json").expect("seed projects");
        std::fs::write(tasks_file(&dir), "[\"nope\"]").expect("seed tasks");
        assert!(read_projects(&dir).is_empty());
        assert!(read_tasks(&dir).is_empty());

        // A null `sessions` field (and a missing one) must not drop the entry.
        std::fs::write(
            projects_file(&dir),
            r#"[{"name":"A","path":"/a","sessions":null},{"name":"B","path":"/b"}]"#,
        )
        .expect("seed tolerant projects");
        let projects = read_projects(&dir);
        assert_eq!(projects.len(), 2);
        assert!(projects[0].sessions.is_empty());
        assert!(projects[1].sessions.is_empty());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn stamping_keeps_agent_timestamps() {
        let agent_stamped =
            stamp_session(&json!({ "sessionId": "s", "updatedAt": "2020-01-01T00:00:00.000Z" }));
        assert_eq!(agent_stamped["updatedAt"], "2020-01-01T00:00:00.000Z");

        let server_stamped = stamp_session(&json!({ "sessionId": "s" }));
        assert!(
            server_stamped["updatedAt"]
                .as_str()
                .unwrap_or_default()
                .ends_with('Z')
        );
        assert_eq!(server_stamped["sessionId"], "s");
    }

    #[test]
    fn merge_objects_overrides_keys() {
        let merged = merge_objects(&json!({ "a": 1, "b": 2 }), &json!({ "b": 3 }));
        assert_eq!(merged, json!({ "a": 1, "b": 3 }));
        assert_eq!(merge_objects(&json!(null), &json!({ "a": 1 })), json!({ "a": 1 }));
    }

    #[test]
    fn session_matching_is_exact() {
        let session = json!({ "sessionId": "s1", "agentId": "a1" });
        assert!(session_matches(&session, "s1", "a1"));
        assert!(!session_matches(&session, "s1", "a2"));
        assert!(!session_matches(&json!({}), "s1", "a1"));
    }
}