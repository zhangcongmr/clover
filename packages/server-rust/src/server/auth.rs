//! Bearer-token authentication.
//!
//! Token format is byte-compatible with the TypeScript `TokenManager`:
//!
//! ```text
//! token = base64url_nopad( "<expiresAtMs>:<nonceHex>:<hmacSha256Hex>" )
//! ```
//!
//! Keeping the format means a browser tab that cached a token from the old
//! server keeps working, and the frontend needs no change.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use axum::extract::{Query, Request, State};
use axum::http::header::AUTHORIZATION;
use axum::middleware::Next;
use axum::response::Response;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use hmac::{Hmac, Mac};
use sha2::Sha256;
use subtle::ConstantTimeEq;
use uuid::Uuid;

use crate::server::error::ApiError;
use crate::server::state::AppState;

type HmacSha256 = Hmac<Sha256>;

/// Issues and verifies short-lived local API tokens.
#[derive(Clone)]
pub struct TokenManager {
    secret: Arc<Vec<u8>>,
    ttl: Duration,
}

impl std::fmt::Debug for TokenManager {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TokenManager")
            .field("ttl", &self.ttl)
            .finish_non_exhaustive()
    }
}

impl TokenManager {
    /// `secret` defaults to a random per-process secret, like the TS version.
    pub fn new(secret: Option<String>, ttl_secs: u64) -> Self {
        let secret = secret
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| Uuid::new_v4().simple().to_string());
        Self {
            secret: Arc::new(secret.into_bytes()),
            ttl: Duration::from_secs(ttl_secs),
        }
    }

    /// Returns `(token, expires_at_ms)`.
    pub fn generate(&self) -> (String, i64) {
        let expires_at = now_ms() + self.ttl.as_millis() as i64;
        let nonce = Uuid::new_v4().simple().to_string();
        let payload = format!("{expires_at}:{nonce}");
        let signature = self.sign(&payload);
        let token = URL_SAFE_NO_PAD.encode(format!("{payload}:{signature}"));
        (token, expires_at)
    }

    /// Constant-time verification of a token (validity window included).
    pub fn verify(&self, token: &str) -> bool {
        let Ok(decoded) = URL_SAFE_NO_PAD.decode(token) else {
            return false;
        };
        let Ok(decoded) = String::from_utf8(decoded) else {
            return false;
        };

        let parts: Vec<&str> = decoded.split(':').collect();
        if parts.len() != 3 {
            return false;
        }

        let Ok(expires_at) = parts[0].parse::<i64>() else {
            return false;
        };
        if now_ms() > expires_at {
            return false;
        }

        let expected = self.sign(&format!("{}:{}", parts[0], parts[1]));
        let Ok(expected_bytes) = hex::decode(expected) else {
            return false;
        };
        let Ok(actual_bytes) = hex::decode(parts[2]) else {
            return false;
        };
        if expected_bytes.len() != actual_bytes.len() {
            return false;
        }
        expected_bytes.ct_eq(&actual_bytes).into()
    }

    fn sign(&self, payload: &str) -> String {
        let mut mac = HmacSha256::new_from_slice(&self.secret).expect("HMAC accepts any key length");
        mac.update(payload.as_bytes());
        hex::encode(mac.finalize().into_bytes())
    }
}

/// Extracts the token from `Authorization: Bearer …` or `?token=`.
fn extract_token(req: &Request) -> Option<String> {
    if let Some(value) = req
        .headers()
        .get(AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        return Some(value.to_string());
    }

    Query::<HashMap<String, String>>::try_from_uri(req.uri())
        .ok()
        .and_then(|Query(params)| params.get("token").cloned())
        .filter(|v| !v.is_empty())
}

/// Axum middleware enforcing a valid token.
pub async fn require_auth(State(state): State<AppState>, req: Request, next: Next) -> Response {
    match extract_token(&req) {
        Some(token) if state.token.verify(&token) => next.run(req).await,
        _ => ApiError::unauthorized().into_response(),
    }
}

use axum::response::IntoResponse;

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip() {
        let manager = TokenManager::new(Some("test-secret".into()), 60);
        let (token, expires_at) = manager.generate();
        assert!(manager.verify(&token));
        assert!(expires_at > now_ms());
    }

    #[test]
    fn rejects_tampering() {
        let manager = TokenManager::new(Some("test-secret".into()), 60);
        let (token, _) = manager.generate();
        let mut tampered = token.clone();
        tampered.push('A');
        assert!(!manager.verify(&tampered));
        assert!(!manager.verify("not-a-token"));
        assert!(!manager.verify(""));
    }

    #[test]
    fn rejects_expired() {
        let manager = TokenManager::new(Some("test-secret".into()), 0);
        let (token, expires_at) = manager.generate();
        assert!(expires_at <= now_ms());
        // Expiry is checked with `now > expiresAt`, exactly like the TS server,
        // so a zero-TTL token can still be valid within the same millisecond.
        std::thread::sleep(std::time::Duration::from_millis(2));
        assert!(!manager.verify(&token));
    }

    #[test]
    fn rejects_other_secret() {
        let a = TokenManager::new(Some("a".into()), 60);
        let b = TokenManager::new(Some("b".into()), 60);
        let (token, _) = a.generate();
        assert!(!b.verify(&token));
    }
}