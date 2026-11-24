//! On-demand installer / uninstaller for ACP agents (Settings → Agents).
//!
//! Port of `packages/server/src/acp/agent-install.ts`. Install requests carry a
//! full [`AgentConfig`] plus the ACP registry `distribution` block, and follow
//! the registry FORMAT.md distribution types:
//!
//! - `npx`    — npm package; verified with `npx -y <package> --version`;
//! - `uvx`    — PyPI package via uv; verified with `uvx <package> --version`;
//! - `binary` — platform archive, sha256-checked, extracted under
//!   `<state_dir>/agents/<id>/` and launched directly.
//!
//! `~/.clover/acp.json` is only written once an install fully succeeded, so a
//! failed install leaves no configuration behind.
//!
//! Divergences from the TypeScript original (both intentional):
//!
//! - archives are extracted in-process (`zip` / `tar` + `gzip`) instead of
//!   shelling out to `tar` / `Expand-Archive`, so no external tool is required;
//! - raw-binary archives are written under their own file name (the TS version
//!   kept the temp-file prefix, which made the declared `cmd` unresolvable).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};
use tokio::process::Command;
use tokio::sync::mpsc;

use crate::acp::probe::{probe_path_command, resolve_for_spawn};
use crate::acp::registry::AgentRegistry;
use crate::acp::stores::{iso_now, read_acp_config, remove_acp_agent, upsert_acp_agent};
use crate::acp::types::AgentConfig;

const MAX_OUTPUT_LINES: usize = 200;
const MAX_JOBS: usize = 20;
/// Upper bound for a whole archive download (mirrors undici's body timeout,
/// but generous enough for large binaries on slow links).
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(600);

// ==========================================================================
// Registry distribution types (FORMAT.md)
// ==========================================================================

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NpxDistribution {
    pub package: String,
    #[serde(default)]
    pub args: Option<Vec<String>>,
    #[serde(default)]
    pub env: Option<IndexMap<String, String>>,
}

pub type UvxDistribution = NpxDistribution;

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BinaryTarget {
    pub archive: String,
    #[serde(default)]
    pub sha256: Option<String>,
    pub cmd: String,
    #[serde(default)]
    pub args: Option<Vec<String>>,
    #[serde(default)]
    pub env: Option<IndexMap<String, String>>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDistribution {
    #[serde(default)]
    pub npx: Option<NpxDistribution>,
    #[serde(default)]
    pub uvx: Option<UvxDistribution>,
    /// Keyed by FORMAT.md platform target (`windows-x86_64`, …).
    #[serde(default)]
    pub binary: Option<IndexMap<String, BinaryTarget>>,
}

// ==========================================================================
// Install jobs
// ==========================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum InstallStatus {
    Running,
    Succeeded,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum StepStatus {
    Pending,
    Running,
    Succeeded,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallStep {
    pub label: String,
    pub command: String,
    pub status: StepStatus,
    pub output: Vec<String>,
}

/// Progress of one install, polled by the settings page.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallJob {
    pub id: String,
    pub agent_id: String,
    /// Human-readable summary of what this install runs.
    pub command: String,
    pub status: InstallStatus,
    pub steps: Vec<InstallStep>,
    pub started_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Shared handle to a job record (polling reads while the task appends).
#[derive(Clone)]
struct JobHandle(Arc<Mutex<InstallJob>>);

impl JobHandle {
    fn new(job: InstallJob) -> Self {
        Self(Arc::new(Mutex::new(job)))
    }

    fn with<R>(&self, f: impl FnOnce(&mut InstallJob) -> R) -> R {
        let mut guard = self.0.lock().unwrap_or_else(|err| err.into_inner());
        f(&mut guard)
    }

    fn snapshot(&self) -> InstallJob {
        self.with(|job| job.clone())
    }

    fn job_id(&self) -> String {
        self.with(|job| job.id.clone())
    }

    fn agent_id(&self) -> String {
        self.with(|job| job.agent_id.clone())
    }

    fn started_at(&self) -> i64 {
        self.with(|job| job.started_at)
    }

    fn status(&self) -> InstallStatus {
        self.with(|job| job.status)
    }

    fn begin_step(&self, label: impl Into<String>, command: impl Into<String>) {
        let (agent_id, label, command) = {
            let label = label.into();
            let command = command.into();
            self.with(|job| {
                job.steps.push(InstallStep {
                    label: label.clone(),
                    command: command.clone(),
                    status: StepStatus::Running,
                    output: Vec::new(),
                });
                (job.agent_id.clone(), label, command)
            })
        };
        tracing::info!("[AgentInstall] [{agent_id}] {label}: {command}");
    }

    fn succeed_step(&self) {
        let (agent_id, label) = self.with(|job| {
            if let Some(step) = job.steps.last_mut() {
                step.status = StepStatus::Succeeded;
                (job.agent_id.clone(), Some(step.label.clone()))
            } else {
                (job.agent_id.clone(), None)
            }
        });
        if let Some(label) = label {
            tracing::info!("[AgentInstall] [{agent_id}] Step succeeded: {label}");
        }
    }

    fn fail_step(&self, message: &str) {
        let (agent_id, label) = self.with(|job| {
            if let Some(step) = job.steps.last_mut() {
                step.status = StepStatus::Failed;
                push_capped(&mut step.output, message);
                (job.agent_id.clone(), Some(step.label.clone()))
            } else {
                (job.agent_id.clone(), None)
            }
        });
        if let Some(label) = label {
            tracing::error!("[AgentInstall] [{agent_id}] Step failed: {label} — {message}");
        }
    }

    fn append_output(&self, line: &str) {
        self.with(|job| {
            if let Some(step) = job.steps.last_mut() {
                push_capped(&mut step.output, line);
            }
        });
    }

    /// Last line written to the current step (used for failure messages).
    fn last_output(&self) -> Option<String> {
        self.with(|job| job.steps.last().and_then(|step| step.output.last().cloned()))
    }

    fn finish_success(&self) {
        self.with(|job| {
            job.status = InstallStatus::Succeeded;
            job.finished_at = Some(crate::server::now_ms());
        });
    }

    fn finish_failure(&self, message: &str) {
        let agent_id = self.with(|job| {
            job.status = InstallStatus::Failed;
            job.error = Some(message.to_string());
            job.finished_at = Some(crate::server::now_ms());
            job.agent_id.clone()
        });
        tracing::error!("[AgentInstall] Install failed for agent \"{agent_id}\": {message}");
    }
}

fn push_capped(target: &mut Vec<String>, line: &str) {
    target.push(line.to_string());
    if target.len() > MAX_OUTPUT_LINES {
        target.remove(0);
    }
}

/// Install job registry plus the pieces an install needs.
///
/// One instance lives on [`crate::server::AppState`]; jobs are polled through
/// `GET /api/acp/agents/install/:jobId`.
pub struct AgentInstaller {
    state_dir: PathBuf,
    registry: Arc<AgentRegistry>,
    jobs: Mutex<IndexMap<String, JobHandle>>,
    /// agentId → in-flight jobId (one install per agent, like the TS server).
    running: Mutex<HashMap<String, String>>,
}

impl AgentInstaller {
    pub fn new(state_dir: PathBuf, registry: Arc<AgentRegistry>) -> Arc<Self> {
        Arc::new(Self {
            state_dir,
            registry,
            jobs: Mutex::new(IndexMap::new()),
            running: Mutex::new(HashMap::new()),
        })
    }

    pub fn get_job(&self, job_id: &str) -> Option<InstallJob> {
        let jobs = self.jobs.lock().unwrap_or_else(|err| err.into_inner());
        jobs.get(job_id).map(JobHandle::snapshot)
    }

    /// Latest job for an agent (running first), so a settings refresh can
    /// reattach to an in-flight install.
    pub fn latest_job(&self, agent_id: &str) -> Option<InstallJob> {
        if let Some(job) = self.running_job(agent_id) {
            return Some(job);
        }
        let jobs = self.jobs.lock().unwrap_or_else(|err| err.into_inner());
        jobs.values()
            .filter(|job| job.agent_id() == agent_id)
            .max_by_key(|job| job.started_at())
            .map(JobHandle::snapshot)
    }

    fn running_job(&self, agent_id: &str) -> Option<InstallJob> {
        let job_id = self
            .running
            .lock()
            .unwrap_or_else(|err| err.into_inner())
            .get(agent_id)
            .cloned()?;
        self.get_job(&job_id)
    }

    /// Start an install.
    ///
    /// Returns the in-flight job when one is already running for this agent,
    /// and `None` when the request is not installable (registry source without
    /// a distribution block). `source = disk` completes synchronously before
    /// returning, matching the TS implementation.
    pub async fn start(
        self: &Arc<Self>,
        config: AgentConfig,
        distribution: Option<AgentDistribution>,
    ) -> Option<InstallJob> {
        if let Some(job) = self.running_job(&config.id) {
            return Some(job);
        }

        let is_disk = config.source.as_deref() == Some("disk");
        if !is_disk && distribution.is_none() {
            tracing::error!(
                "[AgentInstall] No distribution block for agent: {}",
                config.id
            );
            return None;
        }

        let command = if is_disk {
            config.command.clone()
        } else {
            describe_install_command(distribution.as_ref())
        };
        let handle = self.create_job(&config, command);

        if is_disk {
            if let Err(message) = self.run_disk_install(&handle, &config).await {
                handle.finish_failure(&message);
            }
            self.settle(&handle);
            if handle.status() == InstallStatus::Succeeded {
                let installer = Arc::clone(self);
                let agent_id = config.id.clone();
                tokio::spawn(async move { installer.register_installed(&agent_id).await });
            }
            return Some(handle.snapshot());
        }

        let distribution = distribution?;
        let installer = Arc::clone(self);
        let agent_config = config.clone();
        let task_handle = handle.clone();
        tokio::spawn(async move {
            if let Err(message) = installer
                .run_registry_install(&task_handle, &agent_config, &distribution)
                .await
            {
                task_handle.finish_failure(&message);
            }
            installer.settle(&task_handle);
            if task_handle.status() == InstallStatus::Succeeded {
                installer.register_installed(&agent_config.id).await;
            }
        });

        Some(handle.snapshot())
    }

    /// Create + register a job (caller handled the dedupe check).
    fn create_job(&self, config: &AgentConfig, command: String) -> JobHandle {
        let job = InstallJob {
            id: random_id(),
            agent_id: config.id.clone(),
            command: command.clone(),
            status: InstallStatus::Running,
            steps: Vec::new(),
            started_at: crate::server::now_ms(),
            finished_at: None,
            error: None,
        };
        let handle = JobHandle::new(job);

        {
            let mut jobs = self.jobs.lock().unwrap_or_else(|err| err.into_inner());
            while jobs.len() >= MAX_JOBS {
                let oldest = jobs
                    .values()
                    .min_by_key(|job| job.started_at())
                    .map(JobHandle::job_id);
                match oldest {
                    Some(job_id) => {
                        jobs.shift_remove(&job_id);
                    }
                    None => break,
                }
            }
            jobs.insert(handle.job_id(), handle.clone());
        }
        self.running
            .lock()
            .unwrap_or_else(|err| err.into_inner())
            .insert(config.id.clone(), handle.job_id());

        tracing::info!(
            "[AgentInstall] Installing agent \"{}\" ({}): {} [job {}]",
            config.id,
            config.name,
            command,
            handle.job_id()
        );
        handle
    }

    /// Release the per-agent running slot.
    fn settle(&self, handle: &JobHandle) {
        self.running
            .lock()
            .unwrap_or_else(|err| err.into_inner())
            .remove(&handle.agent_id());
    }

    /// Read the freshly persisted config and register it with the registry so
    /// the agent is usable without a server restart.
    async fn register_installed(&self, agent_id: &str) {
        let entry = read_acp_config(&self.state_dir)
            .agents
            .into_iter()
            .find(|agent| agent.id == agent_id);
        let Some(entry) = entry else { return };
        if self.registry.add_config(entry).await
            && let Err(error) = self.registry.check_now(agent_id).await
        {
            tracing::warn!(
                "[ACP Routes] Failed to register installed agent (agent: {agent_id}): {error}"
            );
        }
    }

    // ------------------------------------------------------------------
    // Install flows
    // ------------------------------------------------------------------

    async fn run_registry_install(
        &self,
        job: &JobHandle,
        config: &AgentConfig,
        distribution: &AgentDistribution,
    ) -> Result<(), String> {
        let launch = if let Some(npx) = &distribution.npx {
            self.install_npx(job, npx).await?
        } else if let Some(uvx) = &distribution.uvx {
            self.install_uvx(job, uvx).await?
        } else if let Some(binary) = &distribution.binary {
            self.install_binary(job, &config.id, binary).await?
        } else {
            return Err("Distribution block has none of: npx, uvx, binary".to_string());
        };

        // Success only: persist the derived launch config.
        let mut env = launch.env.unwrap_or_default();
        if let Some(extra) = &config.env {
            for (key, value) in extra {
                env.insert(key.clone(), value.clone());
            }
        }
        let entry = AgentConfig {
            id: config.id.clone(),
            name: config.name.clone(),
            command: launch.command,
            args: Some(launch.args),
            description: config.description.clone(),
            env: Some(env),
            source: Some(
                config
                    .source
                    .clone()
                    .unwrap_or_else(|| "registry".to_string()),
            ),
            version: config.version.clone(),
            installed_at: Some(iso_now()),
            installed: Some(true),
        };
        upsert_acp_agent(&self.state_dir, entry.clone());
        tracing::info!(
            "[AgentInstall] Agent \"{}\" installed: {} {}",
            entry.id,
            entry.command,
            entry.args_vec().join(" ")
        );

        job.finish_success();
        Ok(())
    }

    /// Disk source: verify the executable resolves, persist, done.
    async fn run_disk_install(
        &self,
        job: &JobHandle,
        config: &AgentConfig,
    ) -> Result<(), String> {
        job.begin_step("Verify executable", config.command.clone());
        let probe = probe_path_command(&config.command).await;
        if !probe.found {
            let message = format!("Executable not found: {}", config.command);
            job.fail_step(&message);
            return Err(message);
        }
        job.append_output(&format!(
            "Found: {}",
            probe.path.as_deref().unwrap_or("on PATH")
        ));
        job.succeed_step();

        let entry = AgentConfig {
            id: config.id.clone(),
            name: config.name.clone(),
            command: config.command.clone(),
            args: config.args.clone(),
            env: config.env.clone(),
            description: Some(
                config
                    .description
                    .clone()
                    .unwrap_or_else(|| "Agent added from disk".to_string()),
            ),
            source: Some("disk".to_string()),
            version: config.version.clone(),
            installed_at: Some(iso_now()),
            installed: Some(true),
        };
        upsert_acp_agent(&self.state_dir, entry.clone());
        tracing::info!(
            "[AgentInstall] Disk agent \"{}\" registered: {} {}",
            entry.id,
            entry.command,
            entry.args_vec().join(" ")
        );

        job.finish_success();
        Ok(())
    }

    /// npx: verify the package runs; launch as `npx <package> [args]`.
    async fn install_npx(
        &self,
        job: &JobHandle,
        dist: &NpxDistribution,
    ) -> Result<Launch, String> {
        job.begin_step("Check Node.js / npx runtime", "node + npx on PATH");
        let node = probe_path_command("node").await;
        let npx = probe_path_command("npx").await;
        if !node.found || !npx.found {
            job.fail_step("Node.js or npx not found on PATH — install Node.js first");
            return Err("Node.js / npx is required to install npm-based agents".to_string());
        }
        job.append_output(&format!(
            "npx: {}",
            npx.path.as_deref().unwrap_or("on PATH")
        ));
        job.succeed_step();

        job.begin_step(
            format!("Verify npm package {}", dist.package),
            format!("npx -y {} --version", dist.package),
        );
        let verify = run_install_command(
            job,
            "npx",
            &["-y".to_string(), dist.package.clone(), "--version".to_string()],
        )
        .await?;
        if verify.code != 0 {
            let message = job
                .last_output()
                .unwrap_or_else(|| format!("npx exited with code {}", verify.code));
            job.fail_step(&message);
            return Err(format!(
                "Failed to run {} via npx (exit code {})",
                dist.package, verify.code
            ));
        }
        job.succeed_step();

        let mut args = vec![dist.package.clone()];
        args.extend(dist.args.clone().unwrap_or_default());
        Ok(Launch {
            command: "npx".to_string(),
            args,
            env: dist.env.clone(),
        })
    }

    /// uvx: verify the package runs; launch as `uvx <package> [args]`.
    async fn install_uvx(
        &self,
        job: &JobHandle,
        dist: &UvxDistribution,
    ) -> Result<Launch, String> {
        job.begin_step("Check uv runtime", "uv on PATH");
        let uv = probe_path_command("uv").await;
        if !uv.found {
            job.fail_step(
                "uv not found on PATH — install uv first (https://docs.astral.sh/uv/)",
            );
            return Err("uv is required to install uvx-based agents".to_string());
        }
        job.append_output(&format!(
            "uv: {}",
            uv.path.as_deref().unwrap_or("on PATH")
        ));
        job.succeed_step();

        job.begin_step(
            format!("Verify PyPI package {}", dist.package),
            format!("uvx {} --version", dist.package),
        );
        let verify = run_install_command(
            job,
            "uvx",
            &[dist.package.clone(), "--version".to_string()],
        )
        .await?;
        if verify.code != 0 {
            let message = job
                .last_output()
                .unwrap_or_else(|| format!("uvx exited with code {}", verify.code));
            job.fail_step(&message);
            return Err(format!(
                "Failed to run {} via uvx (exit code {})",
                dist.package, verify.code
            ));
        }
        job.succeed_step();

        let mut args = vec![dist.package.clone()];
        args.extend(dist.args.clone().unwrap_or_default());
        Ok(Launch {
            command: "uvx".to_string(),
            args,
            env: dist.env.clone(),
        })
    }

    /// binary: download → sha256 → extract → resolve the executable.
    async fn install_binary(
        &self,
        job: &JobHandle,
        agent_id: &str,
        targets: &IndexMap<String, BinaryTarget>,
    ) -> Result<Launch, String> {
        let platform_target = binary_platform_target();
        let Some(target) = targets.get(&platform_target) else {
            let available = if targets.is_empty() {
                "none".to_string()
            } else {
                targets.keys().cloned().collect::<Vec<_>>().join(", ")
            };
            job.begin_step(
                format!("Resolve binary distribution for {platform_target}"),
                "distribution.binary",
            );
            let message = format!(
                "No binary distribution for {platform_target} (available: {available})"
            );
            job.fail_step(&message);
            return Err(format!(
                "No binary distribution of this agent for {platform_target}"
            ));
        };

        // 1. Download (+ integrity check).
        job.begin_step(
            format!("Download archive for {platform_target}"),
            target.archive.clone(),
        );
        let archive = match download(&target.archive).await {
            Ok(bytes) => bytes,
            Err(error) => {
                job.fail_step(&error);
                return Err(format!("Archive download failed: {error}"));
            }
        };
        job.append_output(&format!(
            "Downloaded {:.1} MiB",
            archive.len() as f64 / 1024.0 / 1024.0
        ));

        if let Some(expected) = &target.sha256 {
            let digest = hex::encode(Sha256::digest(&archive));
            if !digest.eq_ignore_ascii_case(expected) {
                job.fail_step(&format!(
                    "sha256 mismatch: expected {expected}, got {digest}"
                ));
                return Err("Archive sha256 verification failed".to_string());
            }
            job.append_output(&format!("sha256 verified: {digest}"));
        }
        job.succeed_step();

        // 2. Extract into the managed install dir.
        let install_dir = install_dir(&self.state_dir, agent_id)
            .ok_or_else(|| format!("Invalid agent id: {agent_id}"))?;
        let archive_name = archive_file_name(&target.archive);
        job.begin_step(
            "Extract archive",
            format!("{archive_name} -> {}", install_dir.display()),
        );
        let extracted = (|| -> Result<(), String> {
            remove_dir_all_retry(&install_dir);
            std::fs::create_dir_all(&install_dir)
                .map_err(|error| format!("Failed to create {}: {error}", install_dir.display()))?;
            extract_archive(&archive, &archive_name, &install_dir)?;
            let empty = std::fs::read_dir(&install_dir)
                .map(|mut entries| entries.next().is_none())
                .unwrap_or(true);
            if empty {
                return Err("Archive produced no files".to_string());
            }
            Ok(())
        })();
        if let Err(message) = extracted {
            job.fail_step(&message);
            return Err(message);
        }
        job.append_output(&format!("Extracted: {}", list_dir(&install_dir)));
        job.succeed_step();

        // 3. Resolve + make executable.
        let relative = target.cmd.trim_start_matches("./").trim_start_matches(".\\");
        let executable = relative
            .split(['/', '\\'])
            .fold(install_dir.clone(), |path, part| path.join(part));
        if !executable.exists() {
            let message = format!(
                "Executable not found: {} (contains: {})",
                target.cmd,
                list_dir(&install_dir)
            );
            job.fail_step(&message);
            return Err(format!(
                "Archive did not contain the declared executable: {}",
                target.cmd
            ));
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o755));
        }
        job.append_output(&format!("Executable ready: {}", executable.display()));

        Ok(Launch {
            command: executable.to_string_lossy().to_string(),
            args: target.args.clone().unwrap_or_default(),
            env: target.env.clone(),
        })
    }
}

struct Launch {
    command: String,
    args: Vec<String>,
    env: Option<IndexMap<String, String>>,
}

struct CommandResult {
    code: i32,
}

// ==========================================================================
// Uninstall
// ==========================================================================

/// Root directory for binary installs: `<state_dir>/agents/`.
pub fn agents_root(state_dir: &Path) -> PathBuf {
    state_dir.join("agents")
}

/// Install directory for one binary agent, or `None` when the id would escape
/// the managed root (`../`, separators).
pub fn install_dir(state_dir: &Path, agent_id: &str) -> Option<PathBuf> {
    if agent_id.is_empty() || agent_id.contains('/') || agent_id.contains('\\') || agent_id.contains("..")
    {
        return None;
    }
    Some(agents_root(state_dir).join(agent_id))
}

/// Remove on-disk artifacts of an install.
///
/// Only directories under the managed `<state_dir>/agents/` root are removed,
/// and only when the stored command actually points there (binary installs).
/// npx/uvx agents have no managed artifacts; their config entry is dropped and
/// the npm/uv caches are left alone.
///
/// The caller must stop the agent's process first; removal still retries
/// briefly because Windows can release the executable's file lock a moment
/// late. Returns whether artifacts were removed.
pub async fn uninstall_agent_artifacts(
    state_dir: &Path,
    config: &AgentConfig,
) -> Result<bool, String> {
    let Some(install_root) = install_dir(state_dir, &config.id) else {
        return Ok(false);
    };
    let command = config.command.as_str();
    let root = agents_root(state_dir);
    let command_path = Path::new(command);

    if !command_path.starts_with(&root) || !command_path.starts_with(&install_root) {
        return Ok(false);
    }
    if !install_root.exists() {
        return Ok(false);
    }

    // Belt & suspenders: kill orphaned processes whose executable still lives
    // under the install dir; agents like agy_acp_server.exe re-exec themselves.
    kill_processes_under_dir(&install_root).await;

    let mut last_error = None;
    for attempt in 1..=5 {
        match std::fs::remove_dir_all(&install_root) {
            Ok(()) => {
                tracing::info!(
                    "[AgentInstall] Removed install dir: {}",
                    install_root.display()
                );
                return Ok(true);
            }
            Err(error) => {
                last_error = Some(error);
                if attempt < 5 {
                    tokio::time::sleep(Duration::from_millis(400)).await;
                }
            }
        }
    }
    let error = last_error.map(|error| error.to_string()).unwrap_or_default();
    tracing::error!(
        "[AgentInstall] Failed to remove {} after 5 attempts: {error}",
        install_root.display()
    );
    Err(error)
}

/// Uninstall helper: remove on-disk artifacts AND drop the acp.json entry.
pub async fn uninstall_agent(state_dir: &Path, config: &AgentConfig) -> Result<bool, String> {
    let artifacts_removed = uninstall_agent_artifacts(state_dir, config).await?;
    remove_acp_agent(state_dir, &config.id);
    tracing::info!(
        "[AgentInstall] Agent \"{}\" uninstalled (artifacts removed: {artifacts_removed})",
        config.id
    );
    Ok(artifacts_removed)
}

// ==========================================================================
// Helpers
// ==========================================================================

/// Map the running platform/arch onto FORMAT.md platform targets.
pub fn binary_platform_target() -> String {
    // `process.platform` / `process.arch` (Node) use the same names as
    // `std::env::consts`, except macOS.
    let platform = match std::env::consts::OS {
        "macos" => "darwin",
        other => other,
    };
    format!("{platform}-{}", std::env::consts::ARCH)
}

fn describe_install_command(distribution: Option<&AgentDistribution>) -> String {
    let Some(distribution) = distribution else {
        return "unknown distribution".to_string();
    };
    if let Some(npx) = &distribution.npx {
        return format!(
            "npx {} {}",
            npx.package,
            npx.args.clone().unwrap_or_default().join(" ")
        )
        .trim()
        .to_string();
    }
    if let Some(uvx) = &distribution.uvx {
        return format!(
            "uvx {} {}",
            uvx.package,
            uvx.args.clone().unwrap_or_default().join(" ")
        )
        .trim()
        .to_string();
    }
    if let Some(binary) = &distribution.binary {
        return match binary.get(&binary_platform_target()) {
            Some(target) => format!("download {}", target.archive),
            None => "download (no matching platform target)".to_string(),
        };
    }
    "unknown distribution".to_string()
}

fn random_id() -> String {
    let now = crate::server::now_ms();
    let suffix: String = uuid::Uuid::new_v4()
        .simple()
        .to_string()
        .chars()
        .take(6)
        .collect();
    format!("install-{}-{suffix}", base36(now as u64))
}

fn base36(mut value: u64) -> String {
    const DIGITS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    if value == 0 {
        return "0".to_string();
    }
    let mut out = Vec::new();
    while value > 0 {
        out.push(DIGITS[(value % 36) as usize]);
        value /= 36;
    }
    out.reverse();
    String::from_utf8(out).unwrap_or_default()
}

fn list_dir(dir: &Path) -> String {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return "(unreadable)".to_string();
    };
    let names: Vec<String> = entries
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| entry.file_name().into_string().ok())
        .take(12)
        .collect();
    names.join(", ")
}

/// File name of the archive URL (query string / fragment stripped).
fn archive_file_name(url: &str) -> String {
    let without_fragment = url.split('#').next().unwrap_or(url);
    let without_query = without_fragment.split('?').next().unwrap_or(without_fragment);
    let trimmed = without_query.trim_end_matches(['/', '\\']);
    trimmed
        .rsplit(['/', '\\'])
        .next()
        .filter(|name| !name.is_empty())
        .unwrap_or("agent-archive")
        .to_string()
}

/// Download an archive over HTTP(S).
async fn download(url: &str) -> Result<Vec<u8>, String> {
    let request = reqwest::get(url);
    let response = match tokio::time::timeout(DOWNLOAD_TIMEOUT, request).await {
        Ok(Ok(response)) => response,
        Ok(Err(error)) => return Err(format!("{url}: {error}")),
        Err(_) => return Err(format!("{url}: download timed out")),
    };
    let status = response.status();
    if !status.is_success() {
        return Err(format!("HTTP {} for {url}", status.as_u16()));
    }
    match tokio::time::timeout(DOWNLOAD_TIMEOUT, response.bytes()).await {
        Ok(Ok(bytes)) => Ok(bytes.to_vec()),
        Ok(Err(error)) => Err(format!("{url}: {error}")),
        Err(_) => Err(format!("{url}: download timed out")),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ArchiveKind {
    TarGz,
    TarBz2,
    Zip,
    Raw,
}

fn archive_kind(name: &str) -> ArchiveKind {
    let lower = name.to_ascii_lowercase();
    if lower.ends_with(".tar.gz") || lower.ends_with(".tgz") {
        ArchiveKind::TarGz
    } else if lower.ends_with(".tar.bz2") || lower.ends_with(".tbz2") {
        ArchiveKind::TarBz2
    } else if lower.ends_with(".zip") {
        ArchiveKind::Zip
    } else {
        ArchiveKind::Raw
    }
}

/// Extract a registry archive (`zip` / `tar.gz` / `tgz` / `tar.bz2` / raw).
fn extract_archive(archive: &[u8], name: &str, dest_dir: &Path) -> Result<(), String> {
    match archive_kind(name) {
        ArchiveKind::TarGz => {
            let decoder = flate2::read::GzDecoder::new(archive);
            let mut tar = tar::Archive::new(decoder);
            tar.unpack(dest_dir)
                .map_err(|error| format!("Failed to extract {name}: {error}"))
        }
        ArchiveKind::TarBz2 => extract_with_system_tar(archive, name, dest_dir),
        ArchiveKind::Zip => extract_zip(archive, dest_dir),
        ArchiveKind::Raw => {
            let path = dest_dir.join(name);
            std::fs::write(&path, archive)
                .map_err(|error| format!("Failed to write {}: {error}", path.display()))
        }
    }
}

/// `tar.bz2` needs a bzip2 decoder; the system `tar` (bsdtar on Windows 10+,
/// GNU/bsd tar on macOS and Linux) covers it without a native dependency.
fn extract_with_system_tar(archive: &[u8], name: &str, dest_dir: &Path) -> Result<(), String> {
    let temp = dest_dir.join(format!(".download-{name}"));
    std::fs::write(&temp, archive)
        .map_err(|error| format!("Failed to write {}: {error}", temp.display()))?;

    let status = std::process::Command::new("tar")
        .arg("-xf")
        .arg(&temp)
        .arg("-C")
        .arg(dest_dir)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .status();
    let _ = std::fs::remove_file(&temp);

    match status {
        Ok(status) if status.success() => Ok(()),
        Ok(status) => Err(format!("tar exited with code {}", status.code().unwrap_or(1))),
        Err(error) => Err(format!("tar: {error}")),
    }
}

fn extract_zip(archive: &[u8], dest_dir: &Path) -> Result<(), String> {
    let reader = std::io::Cursor::new(archive);
    let mut zip = zip::ZipArchive::new(reader).map_err(|error| format!("Invalid zip: {error}"))?;
    for index in 0..zip.len() {
        let mut entry = zip
            .by_index(index)
            .map_err(|error| format!("Invalid zip entry: {error}"))?;
        // `enclosed_name` rejects absolute paths and `..` segments.
        let Some(relative) = entry.enclosed_name() else {
            return Err(format!("Unsafe zip entry: {}", entry.name()));
        };
        let target = dest_dir.join(relative);
        if entry.is_dir() {
            std::fs::create_dir_all(&target)
                .map_err(|error| format!("Failed to create {}: {error}", target.display()))?;
            continue;
        }
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("Failed to create {}: {error}", parent.display()))?;
        }
        let mut file = std::fs::File::create(&target)
            .map_err(|error| format!("Failed to create {}: {error}", target.display()))?;
        std::io::copy(&mut entry, &mut file)
            .map_err(|error| format!("Failed to extract {}: {error}", target.display()))?;
        // Preserve the executable bit from the archive on POSIX.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Some(mode) = entry.unix_mode() {
                let _ = std::fs::set_permissions(&target, std::fs::Permissions::from_mode(mode));
            }
        }
    }
    Ok(())
}

fn remove_dir_all_retry(dir: &Path) {
    for _ in 0..3 {
        if !dir.exists() || std::fs::remove_dir_all(dir).is_ok() {
            return;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
}

/// Kill every process whose executable lives under `dir` (uninstall safety
/// net for agents that spawn children or re-exec themselves).
async fn kill_processes_under_dir(dir: &Path) {
    let dir_text = dir.to_string_lossy().to_string();
    let mut command;

    #[cfg(windows)]
    {
        let script = format!(
            "Get-CimInstance Win32_Process | Where-Object {{ $_.ExecutablePath -and $_.ExecutablePath -like '{}*' }} | ForEach-Object {{ taskkill /PID $_.ProcessId /T /F 2>$null }}",
            format!("{dir_text}\\").replace('\'', "''")
        );
        command = Command::new("powershell");
        command.args(["-NoProfile", "-NonInteractive", "-Command", &script]);
    }

    #[cfg(not(windows))]
    {
        command = Command::new("pkill");
        command.arg("-f").arg(&dir_text);
    }

    command
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);

    match tokio::time::timeout(Duration::from_secs(15), command.status()).await {
        Ok(Ok(_)) => {}
        Ok(Err(error)) => {
            tracing::warn!("[AgentInstall] Orphan process scan failed for {dir_text}: {error}")
        }
        Err(_) => tracing::warn!("[AgentInstall] Orphan process scan timed out for {dir_text}"),
    }
}

/// Run an installer command, streaming its combined output lines into the
/// job's current step.
async fn run_install_command(
    job: &JobHandle,
    command: &str,
    args: &[String],
) -> Result<CommandResult, String> {
    let target = resolve_for_spawn(command, args).await;
    let display = format!("{command} {}", args.join(" "));

    let mut child = Command::new(&target.program)
        .args(&target.args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| format!("{}: {error}", display.trim()))?;

    let (done_tx, mut done_rx) = mpsc::channel::<()>(2);
    if let Some(stdout) = child.stdout.take() {
        spawn_line_reader(stdout, job.clone(), done_tx.clone());
    }
    if let Some(stderr) = child.stderr.take() {
        spawn_line_reader(stderr, job.clone(), done_tx.clone());
    }
    drop(done_tx);

    let status = child
        .wait()
        .await
        .map_err(|error| format!("{}: {error}", display.trim()))?;

    // Let the readers drain the pipes (EOF arrives right after process exit).
    for _ in 0..2 {
        if tokio::time::timeout(Duration::from_secs(2), done_rx.recv())
            .await
            .is_err()
        {
            break;
        }
    }

    Ok(CommandResult {
        code: status.code().unwrap_or(1),
    })
}

fn spawn_line_reader<R>(reader: R, job: JobHandle, done: mpsc::Sender<()>)
where
    R: AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    if line.trim().is_empty() {
                        continue;
                    }
                    job.append_output(&line);
                }
                Ok(None) => break,
                Err(_) => break,
            }
        }
        let _ = done.send(()).await;
    });
}

/// Parse an install request body into a config + distribution pair.
pub fn parse_install_request(body: &Value) -> Result<(AgentConfig, Option<AgentDistribution>), String> {
    let config: AgentConfig = serde_json::from_value(body.clone())
        .map_err(|error| format!("body must be a full AgentConfig: {error}"))?;
    let distribution = match body.get("distribution") {
        Some(value) if !value.is_null() => Some(
            serde_json::from_value::<AgentDistribution>(value.clone())
                .map_err(|error| format!("invalid distribution block: {error}"))?,
        ),
        _ => None,
    };
    Ok((config, distribution))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("target")
            .join("test-tmp")
            .join(format!(
                "clover-agent-install-{tag}-{}",
                uuid::Uuid::new_v4().simple()
            ));
        std::fs::create_dir_all(&path).expect("create temp dir");
        path
    }

    #[test]
    fn platform_target_uses_registry_names() {
        let target = binary_platform_target();
        assert!(
            target.starts_with("windows-")
                || target.starts_with("darwin-")
                || target.starts_with("linux-"),
            "{target}"
        );
        assert!(target.ends_with("x86_64") || target.ends_with("aarch64"), "{target}");
    }

    #[test]
    fn archive_names_are_detected() {
        assert_eq!(archive_kind("tool.tar.gz"), ArchiveKind::TarGz);
        assert_eq!(archive_kind("TOOL.TGZ"), ArchiveKind::TarGz);
        assert_eq!(archive_kind("tool.tar.bz2"), ArchiveKind::TarBz2);
        assert_eq!(archive_kind("tool.tbz2"), ArchiveKind::TarBz2);
        assert_eq!(archive_kind("tool.zip"), ArchiveKind::Zip);
        assert_eq!(archive_kind("tool.exe"), ArchiveKind::Raw);
    }

    #[test]
    fn archive_file_name_strips_url_parts() {
        assert_eq!(
            archive_file_name("https://example.com/a/b/tool.zip?token=1#x"),
            "tool.zip"
        );
        assert_eq!(archive_file_name("https://example.com/dir/"), "dir");
        assert_eq!(archive_file_name("https://example.com"), "example.com");
    }

    #[test]
    fn install_dir_rejects_traversal() {
        let root = temp_dir("traversal");
        assert!(install_dir(&root, "ok").is_some());
        assert!(install_dir(&root, "../evil").is_none());
        assert!(install_dir(&root, "a/b").is_none());
        assert!(install_dir(&root, "a\\b").is_none());
        assert!(install_dir(&root, "").is_none());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn describe_matches_registry_shapes() {
        let npx: AgentDistribution = serde_json::from_value(serde_json::json!({
            "npx": { "package": "@scope/agent", "args": ["--acp"] }
        }))
        .expect("npx dist");
        assert_eq!(
            describe_install_command(Some(&npx)),
            "npx @scope/agent --acp"
        );

        let uvx: AgentDistribution = serde_json::from_value(serde_json::json!({
            "uvx": { "package": "agent-pkg" }
        }))
        .expect("uvx dist");
        assert_eq!(describe_install_command(Some(&uvx)), "uvx agent-pkg");

        let binary: AgentDistribution = serde_json::from_value(serde_json::json!({
            "binary": {
                "windows-x86_64": { "archive": "https://x/tool.zip", "cmd": "tool.exe" },
                "linux-x86_64": { "archive": "https://x/tool.tgz", "cmd": "./tool" }
            }
        }))
        .expect("binary dist");
        let described = describe_install_command(Some(&binary));
        assert!(described.starts_with("download "), "{described}");
        assert_eq!(describe_install_command(None), "unknown distribution");
    }

    #[test]
    fn jobs_are_capped_and_output_is_trimmed() {
        let root = temp_dir("jobs");
        let registry = AgentRegistry::new(Vec::new(), Arc::new(crate::events::EventSink::default()));
        let installer = AgentInstaller::new(root.clone(), registry);

        for index in 0..(MAX_JOBS + 3) {
            let config = AgentConfig {
                id: format!("agent-{index}"),
                name: "Agent".to_string(),
                command: "cmd".to_string(),
                ..Default::default()
            };
            installer.create_job(&config, "cmd".to_string());
        }

        let jobs = installer.jobs.lock().expect("jobs");
        assert_eq!(jobs.len(), MAX_JOBS);
        assert!(!jobs.values().any(|job| job.agent_id() == "agent-0"));
        drop(jobs);

        let config = AgentConfig {
            id: "output".to_string(),
            name: "Output".to_string(),
            command: "cmd".to_string(),
            ..Default::default()
        };
        let handle = installer.create_job(&config, "cmd".to_string());
        handle.begin_step("step", "cmd");
        for index in 0..(MAX_OUTPUT_LINES + 10) {
            handle.append_output(&format!("line {index}"));
        }
        let snapshot = handle.snapshot();
        assert_eq!(snapshot.steps[0].output.len(), MAX_OUTPUT_LINES);
        assert_eq!(
            snapshot.steps[0].output.last().map(String::as_str),
            Some(format!("line {}", MAX_OUTPUT_LINES + 9).as_str())
        );

        installer.settle(&handle);
        assert!(installer.running_job("output").is_none());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn parse_request_reads_distribution() {
        let body = serde_json::json!({
            "id": "agent",
            "name": "Agent",
            "source": "registry",
            "distribution": { "npx": { "package": "pkg" } }
        });
        let (config, distribution) = parse_install_request(&body).expect("parse");
        assert_eq!(config.id, "agent");
        assert_eq!(
            distribution.expect("distribution").npx.expect("npx").package,
            "pkg"
        );

        let (config, distribution) =
            parse_install_request(&serde_json::json!({ "id": "d", "name": "D" })).expect("parse");
        assert_eq!(config.id, "d");
        assert!(distribution.is_none());
    }
}