//! `/api/skills` routes.
//!
//! Like `/api/mcp`, these routes are **unauthenticated on purpose**: the
//! settings UI calls them without a bearer token in the TS server too.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use indexmap::IndexMap;
use serde_json::{json, Value};

use crate::server::AppState;
use crate::skills::discovery::DIR_STORE_LABEL;
use crate::skills::registry::skill_json;

const READ_ONLY_EDIT_DETAIL: &str =
    "This skill was discovered on disk. Edit its SKILL.md file instead.";
const READ_ONLY_DELETE_DETAIL: &str =
    "This skill was discovered on disk. Delete its SKILL.md file instead.";

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list).post(create))
        .route("/reload", post(reload))
        .route("/{name}", get(get_one).put(update).delete(remove))
        .route("/{name}/duplicate", post(duplicate))
}

async fn list(State(state): State<AppState>) -> Json<Value> {
    let discovery = state.skills.discovery();
    let skills: Vec<Value> = state
        .skills
        .list()
        .iter()
        .map(|skill| {
            let file_count = if skill.source.as_deref() == Some(DIR_STORE_LABEL) {
                state.skills.file_count(&skill.name)
            } else {
                0
            };
            skill_json(skill, file_count)
        })
        .collect();

    Json(json!({
        "success": true,
        "skills": skills,
        "sources": discovery.as_ref().map(|d| d.sources.clone()).unwrap_or_default(),
        "configFiles": discovery.as_ref().map(|d| d.config_files.clone()).unwrap_or_default(),
        "catalogs": discovery.as_ref().map(|d| d.catalogs.clone()).unwrap_or_default(),
    }))
}

async fn get_one(State(state): State<AppState>, Path(name): Path<String>) -> Response {
    match state.skills.get(&name) {
        Some(skill) => Json(json!({
            "skill": skill,
            "writable": state.skills.can_modify(&name),
            "files": state.skills.list_skill_files(&name),
        }))
        .into_response(),
        None => error(StatusCode::NOT_FOUND, "Skill not found"),
    }
}

async fn create(State(state): State<AppState>, Json(body): Json<Value>) -> Response {
    let name = body
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    if name.trim().is_empty() {
        return error(StatusCode::BAD_REQUEST, "name is required");
    }

    let content = body
        .get("content")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    if content.trim().is_empty() {
        return error(StatusCode::BAD_REQUEST, "content is required");
    }

    let files = match parse_files(&body) {
        Ok(files) => files,
        Err(message) => return error(StatusCode::BAD_REQUEST, message),
    };

    let description = body
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    if let Err(message) = state.skills.upsert(&name, &description, &content, files) {
        return error(StatusCode::BAD_REQUEST, &message);
    }

    Json(json!({ "success": true, "name": name.trim() })).into_response()
}

async fn update(
    State(state): State<AppState>,
    Path(name): Path<String>,
    Json(body): Json<Value>,
) -> Response {
    let Some(existing) = state.skills.get(&name) else {
        return error(StatusCode::NOT_FOUND, "Skill not found");
    };

    let content = match body.get("content") {
        None | Some(Value::Null) => existing.content.clone(),
        Some(Value::String(text)) if !text.trim().is_empty() => text.clone(),
        Some(_) => {
            return error(
                StatusCode::BAD_REQUEST,
                "content must be a non-empty string",
            );
        }
    };

    if !state.skills.can_modify(&name) {
        return read_only(READ_ONLY_EDIT_DETAIL);
    }

    let description = body
        .get("description")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| existing.description.clone());

    // Supporting files are preserved by writing the current map back.
    let files = state.skills.list_skill_files(&name);
    if let Err(message) = state
        .skills
        .upsert(&name, &description, &content, Some(files))
    {
        return error(StatusCode::BAD_REQUEST, &message);
    }

    Json(json!({ "success": true, "name": name })).into_response()
}

async fn reload(State(state): State<AppState>) -> Json<Value> {
    let discovery = state.skills.reload();
    Json(json!({
        "success": true,
        "count": state.skills.count(),
        "sources": discovery.as_ref().map(|d| d.sources.clone()).unwrap_or_default(),
        "configFiles": discovery.as_ref().map(|d| d.config_files.clone()).unwrap_or_default(),
        "catalogs": discovery.as_ref().map(|d| d.catalogs.clone()).unwrap_or_default(),
        "errors": discovery.as_ref().map(|d| d.errors.clone()).unwrap_or_default(),
    }))
}

async fn duplicate(State(state): State<AppState>, Path(name): Path<String>) -> Response {
    match state.skills.duplicate(&name) {
        Ok(Some(skill)) => Json(json!({ "success": true, "skill": skill })).into_response(),
        Ok(None) => error(StatusCode::NOT_FOUND, "Skill not found"),
        Err(message) => error(StatusCode::BAD_REQUEST, &message),
    }
}

async fn remove(State(state): State<AppState>, Path(name): Path<String>) -> Response {
    if state.skills.get(&name).is_none() {
        return error(StatusCode::NOT_FOUND, "Skill not found");
    }
    if !state.skills.can_modify(&name) {
        return read_only(READ_ONLY_DELETE_DETAIL);
    }
    Json(json!({ "success": state.skills.remove(&name) })).into_response()
}

fn parse_files(body: &Value) -> Result<Option<IndexMap<String, String>>, &'static str> {
    let Some(value) = body.get("files") else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }
    let Some(object) = value.as_object() else {
        return Err("files must be an object of relative path → content");
    };

    let mut files = IndexMap::new();
    for (path, content) in object {
        match content.as_str() {
            Some(text) => {
                files.insert(path.clone(), text.to_string());
            }
            None => {
                // `validateSkillFiles` reports this as a validation error; the
                // static message keeps the same wording.
                return Err("supporting file must be a string");
            }
        }
    }
    Ok(Some(files))
}

fn error(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({ "error": message }))).into_response()
}

fn read_only(detail: &str) -> Response {
    (
        StatusCode::CONFLICT,
        Json(json!({ "error": "Skill is read-only", "detail": detail })),
    )
        .into_response()
}