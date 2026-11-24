//! ACP agent subprocess lifecycle.
//!
//! Port of `packages/server/src/acp/agent-process.ts`: spawn the agent with
//! piped stdio, log its stderr, and kill the whole process tree on Windows
//! (`taskkill /T /F`) so orphaned children cannot keep files locked.

use std::io;
use std::time::Duration;

use indexmap::IndexMap;
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;

use crate::acp::probe::resolve_for_spawn;

pub struct SpawnedAgent {
    pub process: AgentProcess,
    pub stdin: ChildStdin,
    pub stdout: ChildStdout,
}

pub struct AgentProcess {
    label: String,
    pid: u32,
    child: Mutex<Option<Child>>,
}

impl std::fmt::Debug for AgentProcess {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AgentProcess")
            .field("label", &self.label)
            .field("pid", &self.pid)
            .finish_non_exhaustive()
    }
}

/// Spawn the configured agent command with piped stdio.
pub async fn spawn_agent(
    label: &str,
    command: &str,
    args: &[String],
    env: Option<&IndexMap<String, String>>,
) -> io::Result<SpawnedAgent> {
    let target = resolve_for_spawn(command, args).await;

    tracing::info!(
        "[ACP AgentProcess] [{label}] spawning: {} {}",
        target.program,
        target.args.join(" ")
    );

    let mut process = Command::new(&target.program);
    process
        .args(&target.args)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);

    if let Some(env) = env {
        for (key, value) in env {
            process.env(key, value);
        }
    }

    let mut child = process.spawn()?;
    let pid = child.id().unwrap_or(0);
    let stdin = child.stdin.take().ok_or_else(|| {
        io::Error::new(io::ErrorKind::BrokenPipe, "agent stdin unavailable")
    })?;
    let stdout = child.stdout.take().ok_or_else(|| {
        io::Error::new(io::ErrorKind::BrokenPipe, "agent stdout unavailable")
    })?;

    if let Some(stderr) = child.stderr.take() {
        spawn_stderr_logger(label.to_string(), stderr);
    }

    Ok(SpawnedAgent {
        process: AgentProcess {
            label: label.to_string(),
            pid,
            child: Mutex::new(Some(child)),
        },
        stdin,
        stdout,
    })
}

fn spawn_stderr_logger(label: String, stderr: tokio::process::ChildStderr) {
    use tokio::io::{AsyncBufReadExt, BufReader};

    tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if !line.trim().is_empty() {
                tracing::info!("[ACP Agent stderr] [{label}] {line}");
            }
        }
    });
}

impl AgentProcess {
    pub fn pid(&self) -> u32 {
        self.pid
    }

    /// Whether the child is still running.
    pub async fn is_running(&self) -> bool {
        let mut guard = self.child.lock().await;
        match guard.as_mut() {
            Some(child) => matches!(child.try_wait(), Ok(None)),
            None => false,
        }
    }

    /// Kill the agent (whole tree on Windows).
    pub async fn kill(&self) {
        tracing::info!("[ACP AgentProcess] [{}] killing process", self.label);
        let mut guard = self.child.lock().await;
        let Some(child) = guard.as_mut() else {
            return;
        };

        #[cfg(windows)]
        {
            // `Child::kill` maps to TerminateProcess and only kills the direct
            // child; agents spawn their own children which would survive and
            // keep the install directory locked.
            let _ = Command::new("taskkill")
                .args(["/pid", &self.pid.to_string(), "/T", "/F"])
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status()
                .await;
        }

        let _ = child.start_kill();
        let _ = child.try_wait();
    }

    /// Wait until the child exits; returns false on timeout.
    ///
    /// Polls `try_wait` instead of awaiting `wait()`: holding the child lock
    /// across an await would deadlock `kill`, which needs the same lock.
    pub async fn wait_for_exit(&self, timeout: Option<Duration>) -> bool {
        let started = std::time::Instant::now();
        loop {
            {
                let mut guard = self.child.lock().await;
                match guard.as_mut() {
                    None => return true,
                    Some(child) => match child.try_wait() {
                        Ok(Some(_)) | Err(_) => return true,
                        Ok(None) => {}
                    },
                }
            }

            if let Some(limit) = timeout
                && started.elapsed() >= limit
            {
                tracing::warn!(
                    "[ACP AgentProcess] [{}] did not exit within {limit:?}; force killing",
                    self.label
                );
                self.kill().await;
                return false;
            }

            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }

    /// Take ownership of the child (used when a caller wants raw access).
    pub async fn take_child(&self) -> Option<Child> {
        self.child.lock().await.take()
    }

    /// Put a child back (used when the exit watcher is cancelled).
    pub async fn restore_child(&self, child: Child) {
        *self.child.lock().await = Some(child);
    }
}