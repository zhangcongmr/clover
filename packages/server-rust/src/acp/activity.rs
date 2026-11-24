//! Client-level "processing" broadcast.
//!
//! Session event streams are per-session, but the UI only subscribes to one
//! session at a time — after switching from A to B, A's `prompt_complete` has
//! no channel left. This hub lifts prompt lifecycle events to one global
//! stream (`GET /api/acp/sessions/events`) so every session's spinner can be
//! cleared without keeping a stream per session.

use serde_json::{json, Value};
use tokio::sync::broadcast;

const CHANNEL_CAPACITY: usize = 256;

#[derive(Debug)]
pub struct SessionActivityHub {
    tx: broadcast::Sender<Value>,
}

impl Default for SessionActivityHub {
    fn default() -> Self {
        Self::new()
    }
}

impl SessionActivityHub {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(CHANNEL_CAPACITY);
        Self { tx }
    }

    /// Broadcast one state transition (`processing = true/false`).
    pub fn publish(&self, session_id: &str, processing: bool) {
        if session_id.is_empty() {
            return;
        }
        let event = json!({
            "type": "session_processing_changed",
            "payload": { "sessionId": session_id, "processing": processing },
            "timestamp": crate::events::sink::now_ms(),
        });
        let _ = self.tx.send(event);
    }

    pub fn subscribe(&self) -> broadcast::Receiver<Value> {
        self.tx.subscribe()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn publishes_processing_transitions() {
        let hub = SessionActivityHub::new();
        let mut rx = hub.subscribe();
        hub.publish("s1", true);
        hub.publish("s1", false);

        let first = rx.recv().await.expect("event");
        assert_eq!(first["type"], "session_processing_changed");
        assert_eq!(first["payload"]["sessionId"], "s1");
        assert_eq!(first["payload"]["processing"], true);

        let second = rx.recv().await.expect("event");
        assert_eq!(second["payload"]["processing"], false);
    }

    #[tokio::test]
    async fn ignores_empty_session_ids() {
        let hub = SessionActivityHub::new();
        let mut rx = hub.subscribe();
        hub.publish("", true);
        assert!(rx.try_recv().is_err());
    }
}