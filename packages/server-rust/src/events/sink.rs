//! Per-session event bus.
//!
//! Ports `packages/server/src/events/`. Every event gets a monotonic `seq`
//! inside its session stream; a bounded ring buffer keeps recent events so an
//! SSE reconnection can resume from `Last-Event-ID`. Consumers are async
//! `broadcast` receivers, which keeps the SSE handler in the async world while
//! `append` stays callable from sync contexts (connection callbacks).

use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};
use tokio::sync::broadcast;

/// Events retained per session for reconnects.
pub const DEFAULT_RING_SIZE: usize = 500;
/// Channel capacity for live subscribers.
const CHANNEL_CAPACITY: usize = 256;

#[derive(Debug)]
struct Stream {
    seq: AtomicU64,
    ring: Mutex<VecDeque<Value>>,
    tx: broadcast::Sender<Value>,
}

/// Append result / attach result tokens.
pub struct Replay {
    pub events: Vec<Value>,
    /// True when the requested cursor predates the retained ring.
    pub gap: Option<u64>,
}

#[derive(Debug)]
pub struct EventSink {
    ring_size: usize,
    streams: Mutex<HashMap<String, Arc<Stream>>>,
}

impl Default for EventSink {
    fn default() -> Self {
        Self::new(DEFAULT_RING_SIZE)
    }
}

impl EventSink {
    pub fn new(ring_size: usize) -> Self {
        Self {
            ring_size: ring_size.max(1),
            streams: Mutex::new(HashMap::new()),
        }
    }

    fn stream(&self, session_id: &str) -> Arc<Stream> {
        let mut streams = self.streams.lock().expect("event sink poisoned");
        if let Some(stream) = streams.get(session_id) {
            return Arc::clone(stream);
        }
        let (tx, _) = broadcast::channel(CHANNEL_CAPACITY);
        let stream = Arc::new(Stream {
            seq: AtomicU64::new(0),
            ring: Mutex::new(VecDeque::with_capacity(self.ring_size.min(64))),
            tx,
        });
        streams.insert(session_id.to_string(), Arc::clone(&stream));
        stream
    }

    /// Append one event to a session stream (`type` + optional payload).
    pub fn append(&self, session_id: &str, mut event: Value) {
        let stream = self.stream(session_id);
        let seq = stream.seq.fetch_add(1, Ordering::SeqCst) + 1;

        if let Value::Object(map) = &mut event {
            map.insert("seq".to_string(), Value::from(seq));
            map.entry("timestamp").or_insert_with(|| json!(now_ms()));
        }

        {
            let mut ring = stream.ring.lock().expect("ring poisoned");
            ring.push_back(event.clone());
            while ring.len() > self.ring_size {
                ring.pop_front();
            }
        }

        // Errors only mean "no subscribers right now".
        let _ = stream.tx.send(event);
    }

    /// Build an event object (`{ type, payload, timestamp }`).
    pub fn event(event_type: &str, payload: Value) -> Value {
        json!({ "type": event_type, "payload": payload, "timestamp": now_ms() })
    }

    /// Subscribe to live events; `after_seq` replays the retained backlog.
    pub fn attach(
        &self,
        session_id: &str,
        after_seq: Option<u64>,
    ) -> (Replay, broadcast::Receiver<Value>) {
        let stream = self.stream(session_id);
        let receiver = stream.tx.subscribe();

        let mut replay = Replay {
            events: Vec::new(),
            gap: None,
        };
        if let Some(after) = after_seq {
            let ring = stream.ring.lock().expect("ring poisoned");
            if let Some(oldest) = ring.front().and_then(event_seq)
                && after + 1 < oldest
            {
                replay.gap = Some(oldest);
            }
            for event in ring.iter() {
                match event_seq(event) {
                    Some(seq) if seq > after => replay.events.push(event.clone()),
                    _ => {}
                }
            }
        }

        (replay, receiver)
    }

    /// Drop a session stream (e.g. after `session/delete`).
    pub fn remove(&self, session_id: &str) {
        let mut streams = self.streams.lock().expect("event sink poisoned");
        streams.remove(session_id);
    }

    pub fn session_count(&self) -> usize {
        self.streams
            .lock()
            .map(|streams| streams.len())
            .unwrap_or(0)
    }

    /// Number of sessions with at least one live subscriber.
    pub fn active_session_count(&self) -> usize {
        self.streams
            .lock()
            .map(|streams| {
                streams
                    .values()
                    .filter(|stream| stream.tx.receiver_count() > 0)
                    .count()
            })
            .unwrap_or(0)
    }
}

fn event_seq(event: &Value) -> Option<u64> {
    event.get("seq").and_then(Value::as_u64)
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

/// Timeout used by permission requests (mirrors the TS 5-minute window).
pub const PERMISSION_TIMEOUT: Duration = Duration::from_secs(5 * 60);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn assigns_monotonic_sequence_numbers() {
        let sink = EventSink::new(10);
        sink.append("s1", EventSink::event("a", json!({})));
        sink.append("s1", EventSink::event("b", json!({})));
        sink.append("s2", EventSink::event("c", json!({})));

        let (replay, _rx) = sink.attach("s1", Some(0));
        assert_eq!(replay.events.len(), 2);
        assert_eq!(replay.events[0]["seq"], 1);
        assert_eq!(replay.events[1]["seq"], 2);
        assert!(replay.gap.is_none());
    }

    #[test]
    fn replay_resumes_after_a_cursor() {
        let sink = EventSink::new(10);
        for index in 0..5 {
            sink.append("s1", EventSink::event("tick", json!({ "index": index })));
        }
        let (replay, _rx) = sink.attach("s1", Some(3));
        assert_eq!(replay.events.len(), 2);
        assert_eq!(replay.events[0]["seq"], 4);
    }

    #[test]
    fn reports_a_gap_when_the_cursor_is_too_old() {
        let sink = EventSink::new(2);
        for index in 0..5 {
            sink.append("s1", EventSink::event("tick", json!({ "index": index })));
        }
        let (replay, _rx) = sink.attach("s1", Some(1));
        assert_eq!(replay.gap, Some(4));
        assert_eq!(replay.events.len(), 2);
    }

    #[tokio::test]
    async fn live_subscribers_receive_appended_events() {
        let sink = EventSink::new(10);
        let (_replay, mut rx) = sink.attach("s1", None);
        sink.append("s1", EventSink::event("hello", json!({ "n": 1 })));
        let event = rx.recv().await.expect("event");
        assert_eq!(event["type"], "hello");
        assert_eq!(event["payload"]["n"], 1);
        assert_eq!(event["seq"], 1);
    }
}