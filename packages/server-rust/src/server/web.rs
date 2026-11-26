//! Embedded web UI (`web-ui` feature).
//!
//! `scripts/stage-web.mjs` copies the Angular build (`dist/clover/browser`,
//! without source maps) into `packages/server-rust/web/`, and `rust-embed`
//! bakes it into the `clover` binary. `clover serve` then hosts both the API
//! and the UI on one origin, like the desktop shell does with Tauri's asset
//! protocol.
//!
//! An explicit `--static-dir` still wins: this module is only used when the
//! caller did not provide a directory.

use axum::body::Body;
use axum::http::header::{CACHE_CONTROL, CONTENT_LENGTH, CONTENT_TYPE};
use axum::http::{Method, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use percent_encoding::percent_decode_str;

#[derive(rust_embed::RustEmbed)]
#[folder = "web"]
struct WebAssets;

/// Served when the binary was compiled without staged assets (for example a
/// plain `cargo build --features web-ui` on a fresh checkout).
const MISSING_UI_HTML: &str = r#"<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Clover web UI not embedded</title>
<style>
  body { margin: 3rem auto; max-width: 40rem; padding: 0 1.5rem;
         font: 16px/1.6 system-ui, sans-serif; color: #1f2328; }
  code { background: #f6f8fa; border-radius: 4px; padding: .15em .35em; }
  h1 { font-size: 1.35rem; }
</style>
</head>
<body>
<h1>Clover web UI is not embedded in this build</h1>
<p>This <code>clover</code> binary was compiled without the Angular assets.</p>
<p>Rebuild the CLI with <code>pnpm build:cli:npm</code>, or serve an existing
build with <code>clover serve --static-dir &lt;dir&gt;</code>.</p>
</body>
</html>
"#;

/// Serve a request from the embedded assets.
pub async fn serve_embedded(method: Method, uri: Uri) -> Response {
    if method != Method::GET && method != Method::HEAD {
        return StatusCode::METHOD_NOT_ALLOWED.into_response();
    }

    let Some(path) = normalize_path(uri.path()) else {
        return StatusCode::NOT_FOUND.into_response();
    };

    // Unknown API routes must stay 404 instead of falling back to index.html.
    if is_api_path(&path) {
        return StatusCode::NOT_FOUND.into_response();
    }

    let requested = if path.is_empty() {
        "index.html".to_string()
    } else {
        path.clone()
    };

    if let Some(file) = WebAssets::get(&requested) {
        return file_response(&requested, file, &method);
    }

    // Missing files with an extension are assets (usually a stale hashed
    // chunk); answering with HTML would surface as a confusing MIME error.
    if has_extension(&requested) {
        return StatusCode::NOT_FOUND.into_response();
    }

    match WebAssets::get("index.html") {
        Some(file) => file_response("index.html", file, &method),
        None => missing_ui_response(&method),
    }
}

/// Percent-decodes a URL path and rejects traversal.
fn normalize_path(raw: &str) -> Option<String> {
    let decoded = percent_decode_str(raw).decode_utf8().ok()?;
    if decoded.contains('\\') {
        return None;
    }

    let mut segments = Vec::new();
    for segment in decoded.trim_start_matches('/').split('/') {
        match segment {
            "" | "." => {}
            ".." => return None,
            other => segments.push(other),
        }
    }
    Some(segments.join("/"))
}

/// API, WebSocket and A2A proxy paths never fall back to the SPA.
fn is_api_path(path: &str) -> bool {
    matches!(
        path.split('/').next().unwrap_or_default(),
        "api" | "ws" | "a2a"
    )
}

fn has_extension(path: &str) -> bool {
    path.rsplit('/')
        .next()
        .is_some_and(|name| name.contains('.'))
}

/// Angular's `outputHashing: all` emits `main-<8 uppercase chars>.js`; those
/// files are content-addressed and can be cached forever.
fn is_hashed_asset(path: &str) -> bool {
    let name = path.rsplit('/').next().unwrap_or_default();
    let Some((stem, _extension)) = name.rsplit_once('.') else {
        return false;
    };
    let Some((_prefix, hash)) = stem.rsplit_once('-') else {
        return false;
    };
    hash.len() == 8
        && hash
            .chars()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
}

fn file_response(path: &str, file: rust_embed::EmbeddedFile, method: &Method) -> Response {
    let data = file.data.into_owned();
    let mime = mime_guess::from_path(path).first_or_octet_stream();
    let cache = if path == "index.html" {
        "no-cache"
    } else if is_hashed_asset(path) {
        "public, max-age=31536000, immutable"
    } else {
        "public, max-age=3600"
    };

    let builder = Response::builder()
        .status(StatusCode::OK)
        .header(CONTENT_TYPE, mime.as_ref())
        .header(CACHE_CONTROL, cache)
        .header(CONTENT_LENGTH, data.len().to_string());

    let body = if method == Method::HEAD {
        Body::empty()
    } else {
        Body::from(data)
    };

    builder
        .body(body)
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

fn missing_ui_response(method: &Method) -> Response {
    let body = if method == Method::HEAD {
        Body::empty()
    } else {
        Body::from(MISSING_UI_HTML)
    };

    Response::builder()
        .status(StatusCode::OK)
        .header(CONTENT_TYPE, "text/html; charset=utf-8")
        .header(CACHE_CONTROL, "no-store")
        .header(CONTENT_LENGTH, MISSING_UI_HTML.len().to_string())
        .body(body)
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

#[cfg(test)]
mod tests {
    use super::{has_extension, is_api_path, is_hashed_asset, normalize_path};

    #[test]
    fn normalizes_url_paths() {
        assert_eq!(normalize_path("/").as_deref(), Some(""));
        assert_eq!(
            normalize_path("/assets/logo.svg").as_deref(),
            Some("assets/logo.svg")
        );
        assert_eq!(normalize_path("/a//b/./").as_deref(), Some("a/b"));
        assert_eq!(normalize_path("/a%20b/").as_deref(), Some("a b"));
    }

    #[test]
    fn rejects_traversal() {
        assert_eq!(normalize_path("/../etc/passwd"), None);
        assert_eq!(normalize_path("/a/%2e%2e/b"), None);
        assert_eq!(normalize_path("/a\\b"), None);
    }

    #[test]
    fn classifies_api_paths() {
        assert!(is_api_path("api/local/health"));
        assert!(is_api_path("ws/terminal"));
        assert!(is_api_path("a2a"));
        assert!(!is_api_path("assets/logo.svg"));
        assert!(!is_api_path("apiary"));
    }

    #[test]
    fn classifies_assets() {
        assert!(has_extension("main-ABC12345.js"));
        assert!(!has_extension("some/client/route"));
        assert!(is_hashed_asset("main-ABC12345.js"));
        assert!(is_hashed_asset("assets/logo-DEADBEEF.svg"));
        assert!(!is_hashed_asset("main.js"));
        assert!(!is_hashed_asset("main-abc12345.js"));
    }
}
