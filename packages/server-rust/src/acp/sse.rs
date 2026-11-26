//! Session SSE ownership bookkeeping.
//!
//! Port of the parts of `packages/server/src/acp/sse-manager.ts` that matter for
//! the Rust transport: one owner per session stream, stable `connectionId` /
//! `epoch` for same-client reconnects, explicit takeover/release, and replay
//! cursors (`Last-Event-ID`).
//!
//! The HTTP response itself is produced by the route (axum `Sse`); this manager
//! only tracks who owns the stream and hands out the event subscription plus a
//! stop signal used by release / takeover.

use std::collections::HashMap;
use std::sync::Mutex;

use serde_json::Value;
use tokio::sync::{broadcast, oneshot};

use crate::events::EventSink;

/// Stream already owned by another client (mapped to HTTP 409).
#[derive(Debug, Clone)]
pub struct StreamConflict {
    pub owner_client_id: Option<String>,
}

impl StreamConflict {
    pub fn message(&self) -> &'static str {
        "Session stream is owned by another client"
    }
}

#[derive(Debug, Clone, Default)]
pub struct AttachOptions {
    /// Replay cursor (`Last-Event-ID`).
    pub last_event_id: Option<u64>,
    /// Page instance id; reconnects from the same page silently replace.
    pub client_id: Option<String>,
    /// Explicit takeover of another client's stream.
    pub takeover: bool,
}

/// Everything the route needs to render the stream.
pub struct SseAttach {
    pub connection_id: String,
    pub client_id: Option<String>,
    pub epoch: u64,
    pub resumed: bool,
    pub replay: Vec<Value>,
    pub gap: Option<u64>,
    pub events: broadcast::Receiver<Value>,
    pub stop: oneshot::Receiver<()>,
}

struct Connection {
    connection_id: String,
    client_id: Option<String>,
    epoch: u64,
    created_at: i64,
    last_heartbeat: i64,
    stop: Option<oneshot::Sender<()>>,
}

pub struct SessionStreamManager {
    connections: Mutex<HashMap<String, Connection>>,
    sink: std::sync::Arc<EventSink>,
}

impl SessionStreamManager {
    pub fn new(sink: std::sync::Arc<EventSink>) -> Self {
        Self {
            connections: Mutex::new(HashMap::new()),
            sink,
        }
    }

    /// Register a stream for `session_id`.
    pub fn attach(
        &self,
        session_id: &str,
        options: AttachOptions,
    ) -> Result<SseAttach, StreamConflict> {
        let mut connections = self.connections.lock().expect("sse manager poisoned");
        let previous = connections.get(session_id);

        let same_client = previous
            .zip(options.client_id.as_deref())
            .is_some_and(|(previous, client_id)| previous.client_id.as_deref() == Some(client_id));

        if previous.is_some() && !same_client && enforce_single_consumer() && !options.takeover {
            return Err(StreamConflict {
                owner_client_id: previous.and_then(|previous| previous.client_id.clone()),
            });
        }

        let (connection_id, epoch) = match previous {
            Some(previous) if same_client => (previous.connection_id.clone(), previous.epoch),
            Some(previous) => (
                uuid::Uuid::new_v4().to_string(),
                previous.epoch.saturating_add(1),
            ),
            None => (uuid::Uuid::new_v4().to_string(), 1),
        };

        // Stop the previous stream: silent replace for a reconnect, eviction
        // for an explicit takeover.
        if let Some(mut previous) = connections.remove(session_id)
            && let Some(stop) = previous.stop.take()
        {
            let _ = stop.send(());
        }

        let (replay, gap, events) = {
            let (replay, receiver) = self.sink.attach(session_id, options.last_event_id);
            (replay.events, replay.gap, receiver)
        };
        let (stop_tx, stop_rx) = oneshot::channel();

        connections.insert(
            session_id.to_string(),
            Connection {
                connection_id: connection_id.clone(),
                client_id: options.client_id.clone(),
                epoch,
                created_at: crate::events::sink::now_ms(),
                last_heartbeat: crate::events::sink::now_ms(),
                stop: Some(stop_tx),
            },
        );

        tracing::info!(
            "[SSE] client connected: {session_id} (client: {}, epoch: {epoch}, total: {})",
            options.client_id.as_deref().unwrap_or("anonymous"),
            connections.len()
        );

        Ok(SseAttach {
            connection_id,
            client_id: options.client_id,
            epoch,
            resumed: same_client,
            replay,
            gap,
            events,
            stop: stop_rx,
        })
    }

    /// Remove a stream when the response ends; ignores stale connections.
    pub fn detach(&self, session_id: &str, connection_id: &str) {
        let mut connections = self.connections.lock().expect("sse manager poisoned");
        let matches = connections
            .get(session_id)
            .is_some_and(|connection| connection.connection_id == connection_id);
        if matches {
            connections.remove(session_id);
            tracing::info!("[SSE] client disconnected: {session_id}");
        }
    }

    /// `DELETE /api/acp/stream/:sessionId` —idempotent ownership release.
    pub fn release(&self, session_id: &str, client_id: Option<&str>, epoch: Option<u64>) -> bool {
        let mut connections = self.connections.lock().expect("sse manager poisoned");
        let Some(owner) = connections.get(session_id) else {
            return true;
        };

        if owner.client_id.is_some() && (owner.client_id.as_deref() != client_id || Some(owner.epoch) != epoch)
        {
            return false;
        }

        if let Some(mut owner) = connections.remove(session_id)
            && let Some(stop) = owner.stop.take()
        {
            let _ = stop.send(());
        }
        tracing::info!("[SSE] released stream: {session_id}");
        true
    }

    /// Ownership check used by the epoch fence (disabled by default).
    pub fn is_owner(&self, session_id: &str, client_id: Option<&str>, epoch: Option<u64>) -> bool {
        let connections = self.connections.lock().expect("sse manager poisoned");
        let Some(owner) = connections.get(session_id) else {
            return true;
        };
        match (client_id, epoch) {
            (Some(client_id), Some(epoch)) => {
                owner.client_id.as_deref() == Some(client_id) && owner.epoch == epoch
            }
            // Scripts without credentials keep working (same as the TS version).
            _ => true,
        }
    }

    pub fn has_connection(&self, session_id: &str) -> bool {
        self.connections
            .lock()
            .map(|connections| connections.contains_key(session_id))
            .unwrap_or(false)
    }

    pub fn count(&self) -> usize {
        self.connections
            .lock()
            .map(|connections| connections.len())
            .unwrap_or(0)
    }

    pub fn touch(&self, session_id: &str) {
        if let Ok(mut connections) = self.connections.lock()
            && let Some(connection) = connections.get_mut(session_id)
        {
            connection.last_heartbeat = crate::events::sink::now_ms();
            let _ = connection.created_at;
        }
    }

    /// Close every stream (server shutdown).
    pub fn destroy(&self) {
        let drained: Vec<Connection> = match self.connections.lock() {
            Ok(mut connections) => connections.drain().map(|(_, value)| value).collect(),
            Err(_) => return,
        };
        for mut connection in drained {
            if let Some(stop) = connection.stop.take() {
                let _ = stop.send(());
            }
        }
    }
}

/// `CLOVER_ENFORCE_SINGLE_CONSUMER=1` turns the 409 arbitration back on
/// (disabled by default, exactly like the TS server).
fn enforce_single_consumer() -> bool {
    std::env::var("CLOVER_ENFORCE_SINGLE_CONSUMER").is_ok_and(|value| value == "1")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reconnects_from_the_same_client_keep_the_epoch() {
        let manager = SessionStreamManager::new(std::sync::Arc::new(EventSink::default()));
        let first = manager
            .attach(
                "s1",
                AttachOptions {
                    client_id: Some("page-1".to_string()),
                    ..Default::default()
                },
            )
            .expect("first attach");
        let second = manager
            .attach(
                "s1",
                AttachOptions {
                    client_id: Some("page-1".to_string()),
                    ..Default::default()
                },
            )
            .expect("second attach");

        assert!(second.resumed);
        assert_eq!(second.connection_id, first.connection_id);
        assert_eq!(second.epoch, first.epoch);
        assert_eq!(manager.count(), 1);
    }

    #[test]
    fn a_different_client_starts_broadcasting_without_arbitration() {
        let manager = SessionStreamManager::new(std::sync::Arc::new(EventSink::default()));
        let first = manager.attach("s1", AttachOptions::default()).expect("first");
        let second = manager.attach("s1", AttachOptions::default()).expect("second");

        assert!(!second.resumed);
        assert_ne!(second.connection_id, first.connection_id);
        assert_eq!(second.epoch, first.epoch + 1);
    }

    #[test]
    fn release_requires_matching_credentials_when_owned() {
        let manager = SessionStreamManager::new(std::sync::Arc::new(EventSink::default()));
        manager
            .attach(
                "s1",
                AttachOptions {
                    client_id: Some("page-1".to_string()),
                    ..Default::default()
                },
            )
            .expect("attach");

        assert!(!manager.release("s1", Some("page-2"), Some(1)));
        assert!(manager.release("s1", Some("page-1"), Some(1)));
        assert!(manager.release("s1", None, None));
    }

    #[test]
    fn detach_only_removes_the_matching_connection() {
        let manager = SessionStreamManager::new(std::sync::Arc::new(EventSink::default()));
        let attach = manager.attach("s1", AttachOptions::default()).expect("attach");
        manager.detach("s1", "someone-else");
        assert!(manager.has_connection("s1"));
        manager.detach("s1", &attach.connection_id);
        assert!(!manager.has_connection("s1"));
    }

    #[test]
    fn replay_cursor_is_forwarded() {
        let sink = EventSink::new(10);
        sink.append("s1", EventSink::event("a", Value::Null));
        sink.append("s1", EventSink::event("b", Value::Null));
        let manager = SessionStreamManager::new(std::sync::Arc::new(sink));

        let attach = manager
            .attach(
                "s1",
                AttachOptions {
                    last_event_id: Some(1),
                    ..Default::default()
                },
            )
            .expect("attach");
        assert_eq!(attach.replay.len(), 1);
        assert_eq!(attach.replay[0]["type"], "b");
        assert!(attach.gap.is_none());
    }
}