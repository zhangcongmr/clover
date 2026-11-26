//! Newline-delimited JSON-RPC 2.0 over the agent's stdio.
//!
//! The ACP SDK speaks NDJSON (one JSON object per line) in both directions:
//!
//! ```text
//! → {"jsonrpc":"2.0","id":1,"method":"initialize","params":{…}}
//! ← {"jsonrpc":"2.0","id":1,"result":{…}}
//! ← {"jsonrpc":"2.0","method":"session/update","params":{…}}      (notification)
//! ← {"jsonrpc":"2.0","id":9,"method":"session/request_permission","params":{…}}
//! → {"jsonrpc":"2.0","id":9,"result":{"outcome":{…}}}
//! ```
//!
//! Inbound requests are dispatched on their own task: a permission request can
//! wait minutes for the user while `session/update` notifications must keep
//! flowing.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use async_trait::async_trait;
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::oneshot;

#[derive(Debug, Clone, thiserror::Error)]
pub enum RpcError {
    #[error("not connected to agent")]
    Closed,
    #[error("{0}")]
    Agent(String),
    #[error("io error: {0}")]
    Io(String),
    #[error("request timed out")]
    Timeout,
}

#[async_trait]
pub trait RpcHandler: Send + Sync + 'static {
    /// Agent → client notification (no response expected).
    async fn on_notification(&self, method: &str, params: Value);

    /// Agent → client request (response required).
    async fn on_request(&self, method: &str, params: Value) -> Result<Value, RpcError>;
}

/// Shared JSON-RPC connection.
pub struct JsonRpc {
    writer: tokio::sync::Mutex<Box<dyn tokio::io::AsyncWrite + Unpin + Send>>,
    next_id: AtomicI64,
    pending: Mutex<HashMap<i64, oneshot::Sender<Result<Value, RpcError>>>>,
    closed: AtomicBool,
}

impl JsonRpc {
    /// Start the reader task and return the connection handle.
    pub fn start<R, W>(reader: R, writer: W, handler: Arc<dyn RpcHandler>) -> Arc<Self>
    where
        R: tokio::io::AsyncRead + Unpin + Send + 'static,
        W: tokio::io::AsyncWrite + Unpin + Send + 'static,
    {
        let rpc = Arc::new(Self {
            writer: tokio::sync::Mutex::new(Box::new(writer)),
            next_id: AtomicI64::new(0),
            pending: Mutex::new(HashMap::new()),
            closed: AtomicBool::new(false),
        });

        let connection = Arc::clone(&rpc);
        tokio::spawn(async move {
            connection.read_loop(reader, handler).await;
        });

        rpc
    }

    async fn read_loop<R>(self: Arc<Self>, reader: R, handler: Arc<dyn RpcHandler>)
    where
        R: tokio::io::AsyncRead + Unpin + Send + 'static,
    {
        let mut lines = BufReader::new(reader).lines();

        loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    let trimmed = line.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    match serde_json::from_str::<Value>(trimmed) {
                        Ok(message) => self.dispatch(message, Arc::clone(&handler)),
                        Err(error) => {
                            tracing::warn!("[ACP RPC] ignoring malformed message: {error}");
                        }
                    }
                }
                Ok(None) => break,
                Err(error) => {
                    tracing::debug!("[ACP RPC] read error: {error}");
                    break;
                }
            }
        }

        self.closed.store(true, Ordering::SeqCst);
        self.fail_pending(RpcError::Closed);
    }

    fn dispatch(self: &Arc<Self>, message: Value, handler: Arc<dyn RpcHandler>) {
        let id = message.get("id").cloned();
        let method = message.get("method").and_then(Value::as_str);

        match (method, id) {
            // Response to one of our requests.
            (None, Some(id)) => {
                let Some(id) = id.as_i64() else { return };
                let sender = self
                    .pending
                    .lock()
                    .ok()
                    .and_then(|mut pending| pending.remove(&id));
                let Some(sender) = sender else {
                    tracing::debug!("[ACP RPC] response for unknown id {id}");
                    return;
                };
                let result = if let Some(error) = message.get("error") {
                    let text = error
                        .get("message")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                        .unwrap_or_else(|| error.to_string());
                    Err(RpcError::Agent(text))
                } else {
                    Ok(message.get("result").cloned().unwrap_or(Value::Null))
                };
                let _ = sender.send(result);
            }
            // Agent → client request: answer on its own task.
            (Some(method), Some(id)) => {
                let method = method.to_string();
                let params = message.get("params").cloned().unwrap_or(Value::Null);
                let connection = Arc::clone(self);
                tokio::spawn(async move {
                    let response = match handler.on_request(&method, params).await {
                        Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
                        Err(error) => json!({
                            "jsonrpc": "2.0",
                            "id": id,
                            "error": { "code": -32603, "message": error.to_string() }
                        }),
                    };
                    connection.write(&response).await;
                });
            }
            // Notification: keep ordering by awaiting inline.
            (Some(method), None) => {
                let method = method.to_string();
                let params = message.get("params").cloned().unwrap_or(Value::Null);
                tokio::spawn(async move {
                    handler.on_notification(&method, params).await;
                });
            }
            (None, None) => {}
        }
    }

    /// Send a request and await its response.
    pub async fn request(&self, method: &str, params: Value) -> Result<Value, RpcError> {
        self.request_with_timeout(method, params, None).await
    }

    pub async fn request_with_timeout(
        &self,
        method: &str,
        params: Value,
        timeout: Option<Duration>,
    ) -> Result<Value, RpcError> {
        if self.closed.load(Ordering::SeqCst) {
            return Err(RpcError::Closed);
        }

        let id = self.next_id.fetch_add(1, Ordering::SeqCst) + 1;
        let (tx, rx) = oneshot::channel();
        {
            let Ok(mut pending) = self.pending.lock() else {
                return Err(RpcError::Io("rpc state poisoned".to_string()));
            };
            pending.insert(id, tx);
        }

        let message = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
        if !self.write(&message).await {
            if let Ok(mut pending) = self.pending.lock() {
                pending.remove(&id);
            }
            return Err(RpcError::Closed);
        }

        match timeout {
            None => rx.await.unwrap_or(Err(RpcError::Closed)),
            Some(limit) => match tokio::time::timeout(limit, rx).await {
                Ok(result) => result.unwrap_or(Err(RpcError::Closed)),
                Err(_) => {
                    if let Ok(mut pending) = self.pending.lock() {
                        pending.remove(&id);
                    }
                    Err(RpcError::Timeout)
                }
            },
        }
    }

    /// Fire-and-forget notification.
    pub async fn notify(&self, method: &str, params: Value) -> Result<(), RpcError> {
        if self.closed.load(Ordering::SeqCst) {
            return Err(RpcError::Closed);
        }
        let message = json!({ "jsonrpc": "2.0", "method": method, "params": params });
        if self.write(&message).await {
            Ok(())
        } else {
            Err(RpcError::Closed)
        }
    }

    /// Serialise and flush one message; returns false when the pipe is gone.
    async fn write(&self, message: &Value) -> bool {
        let mut payload = match serde_json::to_vec(message) {
            Ok(payload) => payload,
            Err(error) => {
                tracing::error!("[ACP RPC] failed to serialise message: {error}");
                return false;
            }
        };
        payload.push(b'\n');

        let mut writer = self.writer.lock().await;
        if let Err(error) = writer.write_all(&payload).await {
            tracing::debug!("[ACP RPC] write failed: {error}");
            return false;
        }
        if let Err(error) = writer.flush().await {
            tracing::debug!("[ACP RPC] flush failed: {error}");
            return false;
        }
        true
    }

    pub fn is_closed(&self) -> bool {
        self.closed.load(Ordering::SeqCst)
    }

    /// Mark the connection closed and fail every in-flight request.
    pub fn close(&self) {
        self.closed.store(true, Ordering::SeqCst);
        self.fail_pending(RpcError::Closed);
    }

    fn fail_pending(&self, error: RpcError) {
        let drained: Vec<oneshot::Sender<Result<Value, RpcError>>> = {
            let Ok(mut pending) = self.pending.lock() else {
                return;
            };
            pending.drain().map(|(_, sender)| sender).collect()
        };
        for sender in drained {
            let _ = sender.send(Err(error.clone()));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    struct CountingHandler {
        notifications: AtomicUsize,
        requests: AtomicUsize,
    }

    #[async_trait]
    impl RpcHandler for CountingHandler {
        async fn on_notification(&self, method: &str, params: Value) {
            assert_eq!(method, "session/update");
            assert_eq!(params["sessionId"], "s1");
            self.notifications.fetch_add(1, Ordering::SeqCst);
        }

        async fn on_request(&self, method: &str, _params: Value) -> Result<Value, RpcError> {
            assert_eq!(method, "session/request_permission");
            self.requests.fetch_add(1, Ordering::SeqCst);
            Ok(json!({ "outcome": { "outcome": "cancelled" } }))
        }
    }

    #[tokio::test]
    async fn matches_responses_and_dispatches_inbound_messages() {
        let (client_side, server_side) = tokio::io::duplex(4096);
        let (server_read, server_write) = tokio::io::split(server_side);
        let (client_read, client_write) = tokio::io::split(client_side);

        let handler = Arc::new(CountingHandler {
            notifications: AtomicUsize::new(0),
            requests: AtomicUsize::new(0),
        });
        let rpc = JsonRpc::start(client_read, client_write, handler.clone());

        // Fake agent: answer one request, then push a notification and a request.
        tokio::spawn(async move {
            let mut lines = BufReader::new(server_read).lines();
            let line = lines.next_line().await.unwrap().unwrap();
            let message: Value = serde_json::from_str(&line).unwrap();
            let id = message["id"].clone();
            let mut writer = server_write;
            writer
                .write_all(
                    format!("{}\n", json!({ "jsonrpc": "2.0", "id": id, "result": { "ok": true } }))
                        .as_bytes(),
                )
                .await
                .unwrap();
            writer
                .write_all(
                    format!(
                        "{}\n",
                        json!({ "jsonrpc": "2.0", "method": "session/update",
                                "params": { "sessionId": "s1" } })
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();
            writer
                .write_all(
                    format!(
                        "{}\n",
                        json!({ "jsonrpc": "2.0", "id": 99, "method": "session/request_permission",
                                "params": { "sessionId": "s1" } })
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();

            // Read our response to the inbound request.
            let line = lines.next_line().await.unwrap().unwrap();
            let response: Value = serde_json::from_str(&line).unwrap();
            assert_eq!(response["id"], 99);
            assert_eq!(response["result"]["outcome"]["outcome"], "cancelled");
        });

        let result = rpc.request("initialize", json!({})).await.expect("response");
        assert_eq!(result["ok"], true);

        tokio::time::sleep(Duration::from_millis(100)).await;
        assert_eq!(handler.notifications.load(Ordering::SeqCst), 1);
        assert_eq!(handler.requests.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn surfaces_agent_errors() {
        let (client_side, server_side) = tokio::io::duplex(4096);
        let (server_read, server_write) = tokio::io::split(server_side);
        let (client_read, client_write) = tokio::io::split(client_side);

        let handler = Arc::new(CountingHandler {
            notifications: AtomicUsize::new(0),
            requests: AtomicUsize::new(0),
        });
        let rpc = JsonRpc::start(client_read, client_write, handler);

        tokio::spawn(async move {
            let mut lines = BufReader::new(server_read).lines();
            let line = lines.next_line().await.unwrap().unwrap();
            let message: Value = serde_json::from_str(&line).unwrap();
            let id = message["id"].clone();
            let mut writer = server_write;
            writer
                .write_all(
                    format!(
                        "{}\n",
                        json!({ "jsonrpc": "2.0", "id": id,
                                "error": { "code": -32000, "message": "boom" } })
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();
        });

        let error = rpc.request("session/new", json!({})).await.expect_err("error");
        assert!(matches!(error, RpcError::Agent(ref message) if message == "boom"));
    }

    #[tokio::test]
    async fn times_out_and_fails_after_close() {
        let (client_side, server_side) = tokio::io::duplex(4096);
        let (server_read, server_write) = tokio::io::split(server_side);
        let (client_read, client_write) = tokio::io::split(client_side);
        let handler = Arc::new(CountingHandler {
            notifications: AtomicUsize::new(0),
            requests: AtomicUsize::new(0),
        });
        let rpc = JsonRpc::start(client_read, client_write, handler);

        // Nobody answers.
        let error = rpc
            .request_with_timeout("initialize", json!({}), Some(Duration::from_millis(50)))
            .await
            .expect_err("timeout");
        assert!(matches!(error, RpcError::Timeout));

        rpc.close();
        let error = rpc.request("initialize", json!({})).await.expect_err("closed");
        assert!(matches!(error, RpcError::Closed));

        drop((server_read, server_write));
    }
}