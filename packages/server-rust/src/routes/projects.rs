//! `/api/projects` and `/api/tasks` routes (P6).
//!
//! These are **public** (no bearer token), exactly like the TS server: the
//! frontend's project sidebar calls them with `postNoAuth`.
//!
//! | method | path | response |
//! |---|---|---|
//! | POST | `/api/projects` | `{ success, projects }` |
//! | POST | `/api/tasks` | `{ success, tasks }` |
//! | POST | `/api/projects/add` | `{ success, projects }` / `{ success, task }` |
//! | POST | `/api/projects/delete` | `{ success }` |
//! | POST | `/api/projects/save-session` | `{ success, project \| task, session }` |
//! | POST | `/api/projects/delete-session` | `{ success }` |
//! | GET  | `/api/projects/selected` | `{ success, selectedProject, selectedSessionId }` |
//! | POST | `/api/projects/selected` | `{ success }` |

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::{json, Value};

use crate::acp::stores::iso_now;
use crate::projects::{
    ProjectInfo, ProjectRecord, SelectedProject, TaskRecord, merge_objects, read_projects,
    read_selected, read_tasks, session_matches, stamp_session, write_projects, write_selected,
    write_tasks,
};
use crate::server::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/projects", post(list_projects))
        .route("/api/tasks", post(list_tasks))
        .route("/api/projects/add", post(add_project))
        .route("/api/projects/delete", post(delete_project))
        .route("/api/projects/save-session", post(save_session))
        .route("/api/projects/delete-session", post(delete_session))
        .route(
            "/api/projects/selected",
            get(get_selected).post(set_selected),
        )
}

async fn list_projects(State(state): State<AppState>) -> Json<Value> {
    Json(json!({ "success": true, "projects": read_projects(&state.state_dir) }))
}

async fn list_tasks(State(state): State<AppState>) -> Json<Value> {
    Json(json!({ "success": true, "tasks": read_tasks(&state.state_dir) }))
}

async fn add_project(State(state): State<AppState>, Json(body): Json<Value>) -> Response {
    let kind = body.get("type").and_then(Value::as_str).unwrap_or_default();
    let text = |key: &str| {
        body.get(key)
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    };
    let sessions = body
        .get("sessions")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    if kind == "task" {
        let (Some(id), Some(name)) = (text("id"), text("name")) else {
            return bad_request("id and name are required for tasks");
        };
        let mut tasks = read_tasks(&state.state_dir);
        let existing = tasks.iter().position(|task| task.id.as_deref() == Some(&id));
        let created_at = existing
            .and_then(|index| tasks[index].created_at.clone())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(iso_now);
        let task = ProjectInfo::task(TaskRecord {
            name,
            path: text("path").unwrap_or_default(),
            sessions,
            id,
            created_at: Some(created_at),
        });
        match existing {
            Some(index) => tasks[index] = task.clone(),
            None => tasks.insert(0, task.clone()),
        }
        write_tasks(&state.state_dir, &tasks);
        return Json(json!({ "success": true, "task": task })).into_response();
    }

    let (Some(name), Some(project_path)) = (text("name"), text("path")) else {
        return bad_request("name and path are required");
    };
    if !std::path::Path::new(&project_path).exists() {
        return bad_request("Directory does not exist");
    }

    let mut projects = read_projects(&state.state_dir);
    if projects.iter().any(|project| project.path == project_path) {
        return (
            StatusCode::CONFLICT,
            Json(json!({ "error": "Project already exists" })),
        )
            .into_response();
    }
    projects.push(ProjectInfo::project(ProjectRecord {
        name,
        path: project_path,
        sessions,
    }));
    write_projects(&state.state_dir, &projects);
    Json(json!({ "success": true, "projects": projects })).into_response()
}

async fn delete_project(State(state): State<AppState>, Json(body): Json<Value>) -> Response {
    let kind = body.get("type").and_then(Value::as_str).unwrap_or_default();
    let path = body
        .get("path")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let id = body
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    if kind == "task" {
        if id.is_empty() && path.is_empty() {
            return bad_request("id or path is required for tasks");
        }
        let tasks: Vec<ProjectInfo> = read_tasks(&state.state_dir)
            .into_iter()
            .filter(|task| {
                if id.is_empty() {
                    task.path != path
                } else {
                    task.id.as_deref() != Some(&id)
                }
            })
            .collect();
        write_tasks(&state.state_dir, &tasks);
        return Json(json!({ "success": true })).into_response();
    }

    if path.is_empty() {
        return bad_request("path is required");
    }
    let projects: Vec<ProjectInfo> = read_projects(&state.state_dir)
        .into_iter()
        .filter(|project| project.path != path)
        .collect();
    write_projects(&state.state_dir, &projects);
    Json(json!({ "success": true })).into_response()
}

async fn save_session(State(state): State<AppState>, Json(body): Json<Value>) -> Response {
    let project_path = body
        .get("projectPath")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let session = body.get("session").cloned().unwrap_or(Value::Null);
    let session_id = session
        .get("sessionId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let agent_id = session
        .get("agentId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if project_path.is_empty() || session_id.is_empty() || agent_id.is_empty() {
        return bad_request("projectPath, sessionId, and agentId are required");
    }

    let stamped = stamp_session(&session);

    // 1. A project that already contains this session.
    let mut projects = read_projects(&state.state_dir);
    let owner = projects.iter().position(|project| {
        project.path == project_path
            && project
                .sessions
                .iter()
                .any(|entry| session_matches(entry, session_id, agent_id))
    });
    if let Some(owner) = owner {
        let index = projects[owner]
            .sessions
            .iter()
            .position(|entry| session_matches(entry, session_id, agent_id))
            .unwrap_or(0);
        projects[owner].sessions[index] =
            merge_objects(&projects[owner].sessions[index], &stamped);
        let stored = projects[owner].sessions[index].clone();
        let project = projects[owner].clone();
        write_projects(&state.state_dir, &projects);
        return Json(json!({ "success": true, "project": project, "session": stored }))
            .into_response();
    }

    // 2. Otherwise it may belong to a task record — keep titles in sync.
    let mut tasks = read_tasks(&state.state_dir);
    let owner = tasks.iter().position(|task| {
        task.path == project_path
            && task
                .sessions
                .iter()
                .any(|entry| session_matches(entry, session_id, agent_id))
    });
    if let Some(owner) = owner {
        let index = tasks[owner]
            .sessions
            .iter()
            .position(|entry| session_matches(entry, session_id, agent_id))
            .unwrap_or(0);
        tasks[owner].sessions[index] = merge_objects(&tasks[owner].sessions[index], &stamped);
        if let Some(title) = session
            .get("title")
            .and_then(Value::as_str)
            .filter(|title| !title.is_empty())
        {
            tasks[owner].name = title.to_string();
        }
        let stored = tasks[owner].sessions[index].clone();
        let task = tasks[owner].clone();
        write_tasks(&state.state_dir, &tasks);
        return Json(json!({ "success": true, "task": task, "session": stored }))
            .into_response();
    }

    // 3. Legacy behaviour: the path matches a project, append the session.
    if let Some(project) = projects
        .iter_mut()
        .find(|project| project.path == project_path)
    {
        project.sessions.push(stamped.clone());
        let project = project.clone();
        write_projects(&state.state_dir, &projects);
        return Json(json!({ "success": true, "project": project, "session": stamped }))
            .into_response();
    }

    not_found("Project not found")
}

async fn delete_session(State(state): State<AppState>, Json(body): Json<Value>) -> Response {
    let project_path = body
        .get("projectPath")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let session_id = body
        .get("sessionId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if project_path.is_empty() || session_id.is_empty() {
        return bad_request("projectPath and sessionId are required");
    }

    let mut projects = read_projects(&state.state_dir);
    let Some(project) = projects
        .iter_mut()
        .find(|project| project.path == project_path)
    else {
        return not_found("Project not found");
    };
    project
        .sessions
        .retain(|entry| entry.get("sessionId").and_then(Value::as_str) != Some(session_id));
    write_projects(&state.state_dir, &projects);
    Json(json!({ "success": true })).into_response()
}

async fn get_selected(State(state): State<AppState>) -> Json<Value> {
    let selected = read_selected(&state.state_dir);
    Json(json!({
        "success": true,
        "selectedProject": selected.selected_project,
        "selectedSessionId": selected.selected_session_id,
    }))
}

async fn set_selected(State(state): State<AppState>, Json(body): Json<Value>) -> Response {
    // `selectedProject || null`: empty strings fall back to null.
    let text = |key: &str| {
        body.get(key)
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    };
    let selected = SelectedProject {
        selected_project: text("selectedProject"),
        selected_session_id: text("selectedSessionId"),
    };
    write_selected(&state.state_dir, &selected);
    Json(json!({ "success": true })).into_response()
}

fn bad_request(message: &str) -> Response {
    (
        StatusCode::BAD_REQUEST,
        Json(json!({ "error": message })),
    )
        .into_response()
}

fn not_found(message: &str) -> Response {
    (StatusCode::NOT_FOUND, Json(json!({ "error": message }))).into_response()
}