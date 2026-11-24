//! WebSocket endpoints: `/ws/terminal` and `/ws/file-watch`.
//!
//! Protocol is unchanged from the TS server:
//!
//! - terminal: first client frame is `{"type":"pty","cols":N,"rows":N,"cwd":"…"}`,
//!   then raw text frames are keystrokes and `{"type":"resize",…}` resizes.
//!   Output is sent as binary frames (xterm decodes UTF-8 itself, which avoids
//!   splitting multi-byte sequences across frames).
//! - file-watch: `{"type":"file-watch-start","path":"…","requestId":"…"}` /
//!   `{"type":"file-watch-stop","path":"…"}`, replies with
//!   `{"type":"file-watch-event","path":"…","eventType":"change|rename"}`.

use std::collections::HashMap;
use std::io::Read;
use std::path::Path;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};

use axum::extract::ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::Response;
use futures_util::{SinkExt, StreamExt};
use notify::{RecursiveMode, Watcher};
use serde::Deserialize;
use serde_json::json;

use crate::local::pty::PtyHandle;
use crate::server::AppState;

/// Debounce window for `change` events (matches the TS watcher).
const CHANGE_DEBOUNCE: Duration = Duration::from_millis(50);
/// How often the terminal checks whether the shell exited.
const EXIT_POLL: Duration = Duration::from_millis(250);

pub async fn terminal(ws: WebSocketUpgrade, State(state): State<AppState>) -> Response {
    ws.on_upgrade(move |socket| handle_terminal(socket, state))
}

pub async fn file_watch(ws: WebSocketUpgrade) -> Response {
    ws.on_upgrade(handle_file_watch)
}

// ==========================================================================
// Terminal
// ==========================================================================

#[derive(Debug, Deserialize)]
struct PtyInit {
    #[serde(rename = "type")]
    kind: String,
    cols: u16,
    rows: u16,
    #[serde(default)]
    cwd: String,
}

#[derive(Debug, Deserialize)]
struct Resize {
    #[serde(rename = "type")]
    kind: String,
    cols: u16,
    rows: u16,
}

async fn handle_terminal(socket: WebSocket, state: AppState) {
    let (mut sink, mut stream) = socket.split();

    let Some(Ok(Message::Text(first))) = stream.next().await else {
        let _ = close(&mut sink, 4002, "Invalid init message").await;
        return;
    };
    let Ok(init) = serde_json::from_str::<PtyInit>(first.as_str()) else {
        let _ = close(&mut sink, 4002, "Invalid init message").await;
        return;
    };
    if init.kind != "pty" {
        let _ = close(&mut sink, 4002, "Invalid init message").await;
        return;
    }

    let (handle, reader) = match state.pty.create(init.cols, init.rows, &init.cwd).await {
        Ok(created) => created,
        Err(error) => {
            tracing::warn!("failed to create PTY: {error}");
            let _ = close(&mut sink, 4002, "Invalid init message").await;
            return;
        }
    };

    // Blocking reads are bridged into the async task through a channel.
    let (output_tx, mut output_rx) = tokio::sync::mpsc::channel::<Vec<u8>>(64);
    spawn_reader(reader, output_tx);

    let mut exit_ticker = tokio::time::interval(EXIT_POLL);

    loop {
        tokio::select! {
            chunk = output_rx.recv() => {
                // `None` means the reader hit EOF: the shell is gone.
                let Some(bytes) = chunk else { break };
                if sink.send(Message::Binary(bytes.into())).await.is_err() {
                    break;
                }
            }
            message = stream.next() => {
                match message {
                    Some(Ok(Message::Text(text))) => {
                        if !apply_input(&handle, text.as_str()) {
                            break;
                        }
                    }
                    Some(Ok(Message::Binary(bytes))) => handle.write(&bytes),
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Err(error)) => {
                        tracing::debug!("terminal socket error: {error}");
                        break;
                    }
                    _ => {}
                }
            }
            _ = exit_ticker.tick() => {
                if handle.has_exited() {
                    break;
                }
            }
        }
    }

    let _ = close(&mut sink, 1000, "PTY exited").await;
    state.pty.destroy(&handle.id);
}

/// Returns `false` when the socket should close.
fn apply_input(handle: &Arc<PtyHandle>, text: &str) -> bool {
    if let Ok(resize) = serde_json::from_str::<Resize>(text)
        && resize.kind == "resize"
    {
        handle.resize(resize.cols, resize.rows);
        return true;
    }
    // Either not JSON or a JSON object that is not a resize: raw keystrokes.
    handle.write(text.as_bytes());
    true
}

fn spawn_reader(mut reader: Box<dyn Read + Send>, tx: tokio::sync::mpsc::Sender<Vec<u8>>) {
    std::thread::spawn(move || {
        let mut buffer = [0u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => return,
                Ok(read) => {
                    if tx.blocking_send(buffer[..read].to_vec()).is_err() {
                        return;
                    }
                }
            }
        }
    });
}

async fn close<S>(sink: &mut S, code: u16, reason: &str) -> Result<(), axum::Error>
where
    S: SinkExt<Message, Error = axum::Error> + Unpin,
{
    sink.send(Message::Close(Some(CloseFrame {
        code,
        reason: reason.to_string().into(),
    })))
    .await
}

// ==========================================================================
// File watch
// ==========================================================================

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WatchMessage {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    path: String,
    #[serde(default)]
    request_id: Option<String>,
}

/// One event produced by a `notify` watcher.
struct WatchSignal {
    path: String,
    event_type: &'static str,
    request_id: Option<String>,
}

type WatcherMap = Arc<StdMutex<HashMap<String, notify::RecommendedWatcher>>>;

async fn handle_file_watch(socket: WebSocket) {
    let (mut sink, mut stream) = socket.split();
    let (signal_tx, mut signal_rx) = tokio::sync::mpsc::unbounded_channel::<WatchSignal>();

    // Keyed by the client-supplied path, like the TS `watchers` map.
    let watchers: WatcherMap = Arc::new(StdMutex::new(HashMap::new()));

    // Debounced `change` events: path -> (deadline, requestId).
    let mut pending: HashMap<String, (Instant, Option<String>)> = HashMap::new();

    loop {
        let deadline = pending.values().map(|(at, _)| *at).min();
        let timer = async {
            match deadline {
                Some(at) => tokio::time::sleep_until(at.into()).await,
                None => std::future::pending::<()>().await,
            }
        };

        tokio::select! {
            message = stream.next() => {
                match message {
                    Some(Ok(Message::Text(text))) => {
                        match serde_json::from_str::<WatchMessage>(text.as_str()) {
                            Ok(msg) if msg.kind == "file-watch-start" => {
                                if !msg.path.is_empty() {
                                    watch_start(&watchers, &signal_tx, &msg.path, msg.request_id);
                                }
                            }
                            Ok(msg) if msg.kind == "file-watch-stop" => {
                                watch_stop(&watchers, &msg.path);
                                pending.remove(&msg.path);
                            }
                            Ok(_) => {}
                            Err(error) => {
                                tracing::warn!("ignoring malformed file-watch message: {error}");
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Err(error)) => {
                        tracing::debug!("file-watch socket error: {error}");
                        break;
                    }
                    _ => {}
                }
            }
            signal = signal_rx.recv() => {
                let Some(signal) = signal else { break };
                if signal.event_type == "rename" {
                    // A rename usually means an editor replaced the file, so the
                    // existing watch may be stale: re-create it immediately.
                    watch_stop(&watchers, &signal.path);
                    watch_start(
                        &watchers,
                        &signal_tx,
                        &signal.path,
                        signal.request_id.clone(),
                    );
                    pending.remove(&signal.path);
                    send_watch_event(&mut sink, &signal.path, "rename", signal.request_id.as_deref()).await;
                } else {
                    pending.insert(
                        signal.path,
                        (Instant::now() + CHANGE_DEBOUNCE, signal.request_id),
                    );
                }
            }
            _ = timer, if deadline.is_some() => {
                let now = Instant::now();
                let due: Vec<String> = pending
                    .iter()
                    .filter(|(_, (at, _))| *at <= now)
                    .map(|(path, _)| path.clone())
                    .collect();
                for path in due {
                    let request_id = pending.remove(&path).and_then(|(_, id)| id);
                    send_watch_event(&mut sink, &path, "change", request_id.as_deref()).await;
                }
            }
        }
    }

    if let Ok(mut map) = watchers.lock() {
        map.clear();
    }
}

fn watch_start(
    watchers: &WatcherMap,
    tx: &tokio::sync::mpsc::UnboundedSender<WatchSignal>,
    client_path: &str,
    request_id: Option<String>,
) {
    {
        let Ok(map) = watchers.lock() else { return };
        if map.contains_key(client_path) {
            return;
        }
    }

    let resolved = crate::local::resolve::resolve_path(client_path);
    let signal_path = client_path.to_string();
    let sender = tx.clone();

    let mut watcher = match notify::recommended_watcher(
        move |result: notify::Result<notify::Event>| {
            let Ok(event) = result else { return };
            let event_type = match event.kind {
                notify::EventKind::Modify(_) => "change",
                _ => "rename",
            };
            let _ = sender.send(WatchSignal {
                path: signal_path.clone(),
                event_type,
                request_id: request_id.clone(),
            });
        },
    ) {
        Ok(watcher) => watcher,
        Err(error) => {
            tracing::error!("failed to create watcher: {error}");
            return;
        }
    };

    if let Err(error) = watcher.watch(Path::new(&resolved), RecursiveMode::NonRecursive) {
        tracing::error!("failed to watch {}: {error}", resolved.to_string_lossy());
        return;
    }

    if let Ok(mut map) = watchers.lock() {
        map.insert(client_path.to_string(), watcher);
    }
}

fn watch_stop(watchers: &WatcherMap, client_path: &str) {
    if let Ok(mut map) = watchers.lock() {
        map.remove(client_path);
    }
}

async fn send_watch_event<S>(
    sink: &mut S,
    path: &str,
    event_type: &str,
    request_id: Option<&str>,
) where
    S: SinkExt<Message, Error = axum::Error> + Unpin,
{
    let payload = json!({
        "type": "file-watch-event",
        "path": path,
        "eventType": event_type,
        "requestId": request_id,
    });
    let _ = sink.send(Message::Text(payload.to_string().into())).await;
}