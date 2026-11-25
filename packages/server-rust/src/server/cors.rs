//! CORS middleware.
//!
//! Mirrors `createCORSMiddleware` from the TypeScript server:
//!
//! - no `Origin` header → `Access-Control-Allow-Origin: *` (non-browser caller);
//! - `AllowAny` policy → echo the request origin and add `Vary: Origin`
//!   (a wildcard is illegal together with `Allow-Credentials: true`);
//! - whitelist policy → echo only origins built from allowed host × port pairs.
//!
//! The header list must stay in sync with the frontend: `Last-Event-ID`,
//! `X-Client-Id`, `X-Epoch` and `X-Takeover` are used by the ACP stream, and
//! `A2A-Version` / `A2A-Extensions` are sent by the A2A SDK on every card and
//! JSON-RPC request (a missing entry makes the browser reject the preflight).

use axum::extract::{Request, State};
use axum::http::header::{self, HeaderValue};
use axum::http::Method;
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};

const ALLOW_METHODS: &str = "GET, POST, DELETE, OPTIONS";
const ALLOW_HEADERS: &str =
    "Content-Type, Authorization, Last-Event-ID, X-Client-Id, X-Epoch, X-Takeover, A2A-Version, A2A-Extensions";

/// Which origins may read responses.
#[derive(Clone, Debug, Default)]
pub enum CorsPolicy {
    /// Echo any origin (desktop app, trusted LAN deployment).
    #[default]
    AllowAny,
    /// Only origins matching one of the precomputed `scheme://host:port`
    /// prefixes.
    Whitelist(Vec<String>),
}

impl CorsPolicy {
    /// Build the whitelist from ports × hosts, exactly like the TS version.
    pub fn whitelist(ports: &[u16], extra_hosts: &[String]) -> Self {
        let mut hosts = vec!["localhost".to_string(), "127.0.0.1".to_string()];
        hosts.extend(extra_hosts.iter().cloned());

        let mut origins = Vec::new();
        for host in &hosts {
            for port in ports {
                origins.push(format!("http://{host}:{port}"));
                origins.push(format!("https://{host}:{port}"));
            }
        }
        Self::Whitelist(origins)
    }

    fn allows(&self, origin: &str) -> bool {
        match self {
            CorsPolicy::AllowAny => true,
            CorsPolicy::Whitelist(origins) => {
                if origins.iter().any(|o| origin.starts_with(o.as_str())) {
                    return true;
                }
                // Origin without an explicit port (e.g. behind nginx).
                match origin.split_once("://") {
                    Some((scheme, rest)) if !rest.contains(':') => origins
                        .iter()
                        .any(|o| o.starts_with(&format!("{scheme}://{rest}"))),
                    _ => false,
                }
            }
        }
    }
}

/// Axum middleware.
pub async fn layer(State(policy): State<CorsPolicy>, req: Request, next: Next) -> Response {
    let origin = req
        .headers()
        .get(header::ORIGIN)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);

    let mut response = if req.method() == Method::OPTIONS {
        axum::http::StatusCode::NO_CONTENT.into_response()
    } else {
        next.run(req).await
    };

    let headers = response.headers_mut();
    match origin {
        None => {
            headers.insert(
                header::ACCESS_CONTROL_ALLOW_ORIGIN,
                HeaderValue::from_static("*"),
            );
        }
        Some(origin) if policy.allows(&origin) => {
            if let Ok(value) = HeaderValue::from_str(&origin) {
                headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, value);
            }
            headers.append(header::VARY, HeaderValue::from_static("Origin"));
        }
        // Disallowed origin: no CORS headers at all (browser blocks the read).
        Some(_) => {}
    }

    headers.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static(ALLOW_METHODS),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static(ALLOW_HEADERS),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_CREDENTIALS,
        HeaderValue::from_static("true"),
    );

    response
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allow_any_accepts_everything() {
        assert!(CorsPolicy::AllowAny.allows("http://evil.example:1234"));
    }

    #[test]
    fn whitelist_matches_host_and_port() {
        let policy = CorsPolicy::whitelist(&[4200], &["192.168.1.10".to_string()]);
        assert!(policy.allows("http://localhost:4200"));
        assert!(policy.allows("https://127.0.0.1:4200"));
        assert!(policy.allows("http://192.168.1.10:4200"));
        assert!(!policy.allows("http://localhost:4201"));
        assert!(!policy.allows("http://other:4200"));
    }

    #[test]
    fn whitelist_allows_portless_origin() {
        let policy = CorsPolicy::whitelist(&[4200], &[]);
        assert!(policy.allows("https://localhost"));
    }

    #[test]
    fn allows_the_a2a_sdk_request_headers() {
        // The A2A client sends `A2A-Version` (and `A2A-Extensions`) on card and
        // JSON-RPC requests; both must survive the browser preflight.
        for header in ["a2a-version", "a2a-extensions", "authorization"] {
            assert!(
                ALLOW_HEADERS
                    .split(',')
                    .any(|allowed| allowed.trim().eq_ignore_ascii_case(header)),
                "{header} must be allowed"
            );
        }
    }
}