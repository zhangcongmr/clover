//! HTTP error type shared by every route.
//!
//! The TypeScript server returns one of two shapes depending on the route:
//!
//! - `{ "error": "..." }`     (acp / mcp / skills)
//! - `{ "success": false, "message": "..." }` (local / a2a-collab)
//!
//! Both are supported so response bodies stay byte-compatible.

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::{json, Value};

#[derive(Debug)]
pub struct ApiError {
    pub status: StatusCode,
    pub body: Value,
}

impl ApiError {
    /// `{ "error": message }` — the ACP / MCP / skills shape.
    pub fn message(status: StatusCode, message: impl Into<String>) -> Self {
        Self {
            status,
            body: json!({ "error": message.into() }),
        }
    }

    /// `{ "success": false, "message": message }` — the local / collab shape.
    pub fn failure(status: StatusCode, message: impl Into<String>) -> Self {
        Self {
            status,
            body: json!({ "success": false, "message": message.into() }),
        }
    }

    pub fn bad_request(message: impl Into<String>) -> Self {
        Self::message(StatusCode::BAD_REQUEST, message)
    }

    pub fn unauthorized() -> Self {
        Self::failure(StatusCode::UNAUTHORIZED, "Unauthorized")
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::message(StatusCode::NOT_FOUND, message)
    }

    pub fn internal(error: impl std::fmt::Display) -> Self {
        Self::message(StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, axum::Json(self.body)).into_response()
    }
}

pub type ApiResult<T> = Result<T, ApiError>;