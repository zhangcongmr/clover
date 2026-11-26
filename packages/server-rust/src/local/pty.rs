//! PTY manager.
//!
//! Port of `packages/server/src/local/pty-manager.ts` on top of
//! `portable-pty` (ConPTY on Windows, openpty elsewhere).
//!
//! Lifecycle: the WebSocket connection owns the reader; the manager owns the
//! master/writer/child so it can resize, kill and reap idle instances.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};

/// Maximum concurrent terminals (same limit as the TS manager).
const MAX_INSTANCES: usize = 10;
/// Kill terminals idle for this long.
const IDLE_TIMEOUT: Duration = Duration::from_secs(30 * 60);
/// How often idle instances are swept.
const SWEEP_INTERVAL: Duration = Duration::from_secs(60);

pub struct PtyHandle {
    pub id: String,
    created_at: Instant,
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    child: Mutex<Box<dyn Child + Send + Sync>>,
    cols: u16,
    rows: u16,
}

impl std::fmt::Debug for PtyHandle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PtyHandle")
            .field("id", &self.id)
            .field("cols", &self.cols)
            .field("rows", &self.rows)
            .finish_non_exhaustive()
    }
}

impl PtyHandle {
    /// Raw terminal input.
    pub fn write(&self, data: &[u8]) {
        if let Ok(mut writer) = self.writer.lock() {
            let _ = writer.write_all(data);
            let _ = writer.flush();
        }
    }

    pub fn resize(&self, cols: u16, rows: u16) {
        if let Ok(master) = self.master.lock() {
            let _ = master.resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            });
        }
    }

    /// True once the shell process has exited.
    pub fn has_exited(&self) -> bool {
        match self.child.lock() {
            Ok(mut child) => matches!(child.try_wait(), Ok(Some(_)) | Err(_)),
            Err(_) => true,
        }
    }

    /// Kill the shell. Ignored when it already exited.
    pub fn kill(&self) {
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
        }
    }
}

#[derive(Debug, Default)]
pub struct PtyManager {
    instances: Mutex<HashMap<String, Arc<PtyHandle>>>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// Spawn a shell. The returned reader is consumed by the WebSocket task.
    pub async fn create(
        &self,
        cols: u16,
        rows: u16,
        cwd: &str,
    ) -> Result<(Arc<PtyHandle>, Box<dyn Read + Send>)> {
        if self.count() >= MAX_INSTANCES {
            anyhow::bail!("Max PTY instances ({MAX_INSTANCES}) reached");
        }

        let working_dir = if PathLike::is_dir(cwd) {
            cwd.to_string()
        } else {
            std::env::current_dir()?.to_string_lossy().to_string()
        };

        let cols = cols.max(1);
        let rows = rows.max(1);
        let cwd_owned = working_dir.clone();

        let (handle, reader) = tokio::task::spawn_blocking(move || {
            spawn_shell(cols, rows, &cwd_owned)
        })
        .await
        .context("pty task panicked")??;

        {
            let mut instances = self.instances.lock().expect("pty registry poisoned");
            instances.insert(handle.id.clone(), handle.clone());
        }

        Ok((handle, reader))
    }

    pub fn get(&self, id: &str) -> Option<Arc<PtyHandle>> {
        self.instances
            .lock()
            .ok()
            .and_then(|instances| instances.get(id).cloned())
    }

    pub fn destroy(&self, id: &str) -> bool {
        let removed = self
            .instances
            .lock()
            .ok()
            .and_then(|mut instances| instances.remove(id));
        match removed {
            Some(handle) => {
                handle.kill();
                true
            }
            None => false,
        }
    }

    pub fn count(&self) -> usize {
        self.instances
            .lock()
            .map(|instances| instances.len())
            .unwrap_or(0)
    }

    /// Kill every terminal (server shutdown).
    pub fn destroy_all(&self) {
        let drained: Vec<Arc<PtyHandle>> = self
            .instances
            .lock()
            .map(|mut instances| instances.drain().map(|(_, handle)| handle).collect())
            .unwrap_or_default();
        for handle in drained {
            handle.kill();
        }
    }

    /// Background sweep for idle terminals.
    pub fn spawn_cleanup(self: &Arc<Self>) {
        let manager = Arc::clone(self);
        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(SWEEP_INTERVAL);
            ticker.tick().await; // first tick fires immediately
            loop {
                ticker.tick().await;
                manager.sweep_idle(IDLE_TIMEOUT);
            }
        });
    }

    fn sweep_idle(&self, idle: Duration) {
        let expired: Vec<String> = {
            let Ok(instances) = self.instances.lock() else {
                return;
            };
            instances
                .iter()
                .filter(|(_, handle)| handle.created_at.elapsed() > idle)
                .map(|(id, _)| id.clone())
                .collect()
        };
        for id in expired {
            tracing::info!("closing idle PTY {id}");
            self.destroy(&id);
        }
    }
}

fn spawn_shell(cols: u16, rows: u16, cwd: &str) -> Result<(Arc<PtyHandle>, Box<dyn Read + Send>)> {
    let pty_system = native_pty_system();
    let pair = pty_system.openpty(PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    })?;

    let mut command = CommandBuilder::new(default_shell());
    command.cwd(cwd);
    command.env("TERM", "xterm-256color");
    for (key, value) in std::env::vars() {
        command.env(key, value);
    }

    let child = pair.slave.spawn_command(command)?;
    // Required: the slave handle must be closed, otherwise the master never
    // reports EOF when the shell exits.
    drop(pair.slave);

    let reader = pair.master.try_clone_reader()?;
    let writer = pair.master.take_writer()?;

    let id = format!("pty_{}_{}", now_millis(), short_random());

    let handle = Arc::new(PtyHandle {
        id,
        created_at: Instant::now(),
        master: Mutex::new(pair.master),
        writer: Mutex::new(writer),
        child: Mutex::new(child),
        cols,
        rows,
    });

    Ok((handle, reader))
}

fn default_shell() -> String {
    if cfg!(windows) {
        "powershell.exe".to_string()
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
    }
}

fn now_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn short_random() -> String {
    uuid::Uuid::new_v4().simple().to_string()[..6].to_string()
}

/// Tiny helper so the cwd check reads like the TS version.
struct PathLike;

impl PathLike {
    fn is_dir(path: &str) -> bool {
        !path.is_empty() && std::path::Path::new(path).is_dir()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn creates_and_destroys_a_terminal() {
        let manager = PtyManager::new();
        let (handle, _reader) = manager
            .create(80, 24, "")
            .await
            .expect("spawn shell");
        assert_eq!(manager.count(), 1);
        assert!(manager.get(&handle.id).is_some());

        handle.write(b"echo hi\r\n");
        assert!(manager.destroy(&handle.id));
        assert_eq!(manager.count(), 0);
        assert!(manager.get(&handle.id).is_none());
    }

    #[tokio::test]
    async fn enforces_the_instance_limit() {
        let manager = PtyManager::new();
        let mut created = Vec::new();
        for _ in 0..MAX_INSTANCES {
            let (handle, reader) = manager.create(80, 24, "").await.expect("spawn shell");
            created.push((handle, reader));
        }
        let error = manager
            .create(80, 24, "")
            .await
            .err()
            .expect("limit reached");
        assert!(error.to_string().contains("Max PTY instances"));
        manager.destroy_all();
        assert_eq!(manager.count(), 0);
    }
}