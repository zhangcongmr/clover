import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { logger } from '../helpers/logger.js';
import type { AgentConfig } from './acp-agent.types.js';
import { probePathCommand } from './agent-probe.js';
import { removeAcpAgent, upsertAcpAgent } from './acp-config-store.js';

/**
 * On-demand installer/uninstaller for ACP agents (Settings → Agents).
 *
 * Install requests come from the frontend as a full `AgentInstallRequest`
 * (an `AgentConfig` plus the registry `distribution` block). Only
 * `source: 'registry'` agents are installed here, following the ACP registry
 * FORMAT.md distribution types:
 *
 * - `npx`   — npm package; verify via `npx -y <package> --version` (populates
 *             the npm cache), launched later as `npx <package> [args]`.
 * - `uvx`   — PyPI package via uv; verify via `uvx <package> --version`,
 *             launched later as `uvx <package> [args]`.
 * - `binary`— platform archive downloaded from the registry, sha256-checked,
 *             extracted under `~/.clover/agents/<id>/` and launched directly.
 *
 * An install only ever persists to `~/.clover/acp.json` after it fully
 * succeeded — a failed install leaves no configuration behind.
 *
 * Node-only module: do NOT import it from `acp-agent.types.ts`, which is
 * bundled into the browser build.
 */

// ============================================================================
// Registry distribution types (FORMAT.md)
// ============================================================================

export interface NpxDistribution {
  package: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface UvxDistribution {
  package: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface BinaryDistributionTarget {
  archive: string;
  sha256?: string;
  cmd: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface AgentDistribution {
  npx?: NpxDistribution;
  uvx?: UvxDistribution;
  binary?: Record<string, BinaryDistributionTarget>;
}

/**
 * Install request body for `POST /api/acp/agents/install`: a full AgentConfig
 * plus the registry `distribution` block (required for source=registry).
 */
export type AgentInstallRequest = AgentConfig & { distribution?: AgentDistribution };

// ============================================================================
// Install jobs
// ============================================================================

export interface AgentInstallStep {
  label: string;
  command: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  output: string[];
}

export interface AgentInstallJob {
  id: string;
  agentId: string;
  /** Human-readable summary of what this install runs, shown in the UI. */
  command: string;
  status: 'running' | 'succeeded' | 'failed';
  steps: AgentInstallStep[];
  startedAt: number;
  finishedAt?: number;
  error?: string;
}

const MAX_OUTPUT_LINES = 200;
const MAX_JOBS = 20;

const jobsById = new Map<string, AgentInstallJob>();
const runningByAgent = new Map<string, string>();

export function getInstallJob(jobId: string): AgentInstallJob | undefined {
  return jobsById.get(jobId);
}

/** Latest job for an agent, so a settings refresh can reattach to a running install. */
export function getLatestInstallJob(agentId: string): AgentInstallJob | undefined {
  const runningId = runningByAgent.get(agentId);
  if (runningId) return jobsById.get(runningId);

  let latest: AgentInstallJob | undefined;
  for (const job of jobsById.values()) {
    if (job.agentId === agentId && (!latest || job.startedAt > latest.startedAt)) latest = job;
  }
  return latest;
}

/** Root directory for binary installs: `~/.clover/agents/`. */
function agentsRoot(): string {
  return join(homedir(), '.clover', 'agents');
}

/** Install directory for one binary agent: `~/.clover/agents/<agentId>/`. */
function agentInstallDir(agentId: string): string {
  return join(agentsRoot(), agentId);
}

/**
 * Start installing a registry agent.
 *
 * Returns the in-flight job when one is already running for this agent, and
 * null when the request is not installable (no distribution block).
 * `onFinished` fires once when the job reaches a terminal state; the caller
 * registers the agent with the AgentRegistry on success.
 */
export function startInstall(
  config: AgentInstallRequest,
  onFinished?: (job: AgentInstallJob) => void,
): AgentInstallJob | null {
  const runningId = runningByAgent.get(config.id);
  if (runningId) return jobsById.get(runningId) ?? null;

  const distribution = config.distribution;
  if (!distribution) {
    logger.error(`[AgentInstall] No distribution block for agent: ${config.id}`);
    return null;
  }

  // Trim history so the job map cannot grow unbounded.
  while (jobsById.size >= MAX_JOBS) {
    const oldest = [...jobsById.values()].sort((a, b) => a.startedAt - b.startedAt)[0];
    if (!oldest) break;
    jobsById.delete(oldest.id);
  }

  const job: AgentInstallJob = {
    id: randomId(),
    agentId: config.id,
    command: describeInstallCommand(distribution),
    status: 'running',
    steps: [],
    startedAt: Date.now(),
  };
  jobsById.set(job.id, job);
  runningByAgent.set(config.id, job.id);
  logger.log(`[AgentInstall] Installing agent "${config.id}" (${config.name}): ${job.command} [job ${job.id}]`);

  void runInstall(job, config, distribution)
    .catch((error) => {
      failJob(job, (error as Error).message);
    })
    .finally(() => {
      runningByAgent.delete(config.id);
      try {
        onFinished?.(job);
      } catch (error) {
        logger.error('[AgentInstall] onFinished callback failed:', error);
      }
    });

  return job;
}

/**
 * Remove on-disk artifacts of an install (Settings → Uninstall).
 *
 * Only directories inside the managed `~/.clover/agents/` root are ever
 * removed — and only when the agent's stored command actually points there
 * (binary installs). npx/uvx agents have no managed artifacts; their config
 * entry is dropped and the npm/uv caches are left alone.
 *
 * The caller must have stopped the agent's process first (registry
 * removeConfig disconnects and waits); removal still retries briefly since
 * Windows can release the executable's file lock a moment late.
 *
 * Returns true when on-disk artifacts were removed.
 */
export async function uninstallAgentArtifacts(config: AgentConfig): Promise<boolean> {
  // Path-traversal guard: never resolve an agent id outside the managed root.
  if (!config.id || /[/\\]|\.\./.test(config.id)) return false;

  const root = agentsRoot();
  const installDir = agentInstallDir(config.id);
  const command = config.command ?? '';

  if (!command.startsWith(root) || !command.startsWith(installDir)) return false;
  if (!existsSync(installDir)) return false;

  // Belt & suspenders: kill any orphaned processes whose executable still
  // lives under the install dir. Agents like agy_acp_server.exe re-exec
  // themselves, so the tree-kill on disconnect can still leave orphans that
  // keep the directory locked (Windows EPERM on rm).
  killProcessesUnderDir(installDir);

  const attempts = 5;
  for (let attempt = 1; ; attempt++) {
    try {
      rmSync(installDir, { recursive: true, force: true });
      logger.log(`[AgentInstall] Removed install dir: ${installDir}`);
      return true;
    } catch (error) {
      if (attempt >= attempts) {
        logger.error(`[AgentInstall] Failed to remove ${installDir} after ${attempts} attempts:`, error);
        throw error;
      }
      // EBUSY/EPERM: the exe's file lock is not released yet — wait and retry.
      await new Promise(resolve => setTimeout(resolve, 400));
    }
  }
}

/** Uninstall helper: remove on-disk artifacts AND drop the acp.json entry. */
export async function uninstallAgent(config: AgentConfig): Promise<boolean> {
  let artifactsRemoved = false;
  try {
    artifactsRemoved = await uninstallAgentArtifacts(config);
  } catch (error) {
    logger.error(`[AgentInstall] Uninstall artifact cleanup failed for "${config.id}":`, error);
    throw error;
  }
  removeAcpAgent(config.id);
  logger.log(`[AgentInstall] Agent "${config.id}" uninstalled (artifacts removed: ${artifactsRemoved})`);
  return artifactsRemoved;
}

// ============================================================================
// Install flows
// ============================================================================

async function runInstall(
  job: AgentInstallJob,
  config: AgentInstallRequest,
  distribution: AgentDistribution,
): Promise<void> {
  let launch: { command: string; args?: string[]; env?: Record<string, string> };

  if (distribution.npx) {
    launch = await installNpx(job, distribution.npx);
  } else if (distribution.uvx) {
    launch = await installUvx(job, distribution.uvx);
  } else if (distribution.binary) {
    launch = await installBinary(job, config.id, distribution.binary);
  } else {
    throw new Error('Distribution block has none of: npx, uvx, binary');
  }

  // Success only: persist the derived launch config to ~/.clover/acp.json.
  const entry: AgentConfig = {
    id: config.id,
    name: config.name,
    command: launch.command,
    args: launch.args,
    env: { ...launch.env, ...(config.env ?? {}) },
    description: config.description,
    source: config.source ?? 'registry',
    version: config.version,
    installed: true,
    installedAt: new Date().toISOString(),
  };
  upsertAcpAgent(entry);
  logger.log(`[AgentInstall] Agent "${config.id}" installed: ${entry.command} ${(entry.args ?? []).join(' ')}`);

  job.status = 'succeeded';
  job.finishedAt = Date.now();
}

/** npx distribution: verify the package runs; launch as `npx <package> [args]`. */
async function installNpx(job: AgentInstallJob, dist: NpxDistribution) {
  beginStep(job, 'Check Node.js / npx runtime', 'node + npx on PATH');
  const node = probePathCommand('node');
  const npx = probePathCommand('npx');
  if (!node.found || !npx.found) {
    failStep(job, 'Node.js or npx not found on PATH — install Node.js first');
    throw new Error('Node.js / npx is required to install npm-based agents');
  }
  appendStepOutput(job, `npx: ${npx.path ?? 'on PATH'}`);
  succeedStep(job);

  beginStep(job, `Verify npm package ${dist.package}`, `npx -y ${dist.package} --version`);
  const verify = await runInstallCommand(job, 'npx', ['-y', dist.package, '--version']);
  if (verify.code !== 0) {
    failStep(job, verify.output[verify.output.length - 1] ?? `npx exited with code ${verify.code}`);
    throw new Error(`Failed to run ${dist.package} via npx (exit code ${verify.code})`);
  }
  succeedStep(job);

  return {
    command: 'npx',
    args: [dist.package, ...(dist.args ?? [])],
    env: dist.env,
  };
}

/** uvx distribution: verify the package runs; launch as `uvx <package> [args]`. */
async function installUvx(job: AgentInstallJob, dist: UvxDistribution) {
  beginStep(job, 'Check uv runtime', 'uv on PATH');
  const uv = probePathCommand('uv');
  if (!uv.found) {
    failStep(job, 'uv not found on PATH — install uv first (https://docs.astral.sh/uv/)');
    throw new Error('uv is required to install uvx-based agents');
  }
  appendStepOutput(job, `uv: ${uv.path ?? 'on PATH'}`);
  succeedStep(job);

  beginStep(job, `Verify PyPI package ${dist.package}`, `uvx ${dist.package} --version`);
  const verify = await runInstallCommand(job, 'uvx', [dist.package, '--version']);
  if (verify.code !== 0) {
    failStep(job, verify.output[verify.output.length - 1] ?? `uvx exited with code ${verify.code}`);
    throw new Error(`Failed to run ${dist.package} via uvx (exit code ${verify.code})`);
  }
  succeedStep(job);

  return {
    command: 'uvx',
    args: [dist.package, ...(dist.args ?? [])],
    env: dist.env,
  };
}

/** binary distribution: download → sha256 → extract → resolve the executable. */
async function installBinary(
  job: AgentInstallJob,
  agentId: string,
  targets: Record<string, BinaryDistributionTarget>,
) {
  const platformTarget = binaryPlatformTarget();
  const target = targets[platformTarget];
  if (!target) {
    const available = Object.keys(targets).join(', ') || 'none';
    beginStep(job, `Resolve binary distribution for ${platformTarget}`, 'distribution.binary');
    failStep(job, `No binary distribution for ${platformTarget} (available: ${available})`);
    throw new Error(`No binary distribution of this agent for ${platformTarget}`);
  }

  // 1. Download (+ integrity check).
  beginStep(job, `Download archive for ${platformTarget}`, target.archive);
  let archive: Buffer;
  try {
    const response = await fetch(target.archive);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${target.archive}`);
    }
    archive = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    failStep(job, (error as Error).message);
    throw new Error(`Archive download failed: ${(error as Error).message}`);
  }
  appendStepOutput(job, `Downloaded ${(archive.length / 1024 / 1024).toFixed(1)} MiB`);

  if (target.sha256) {
    const digest = createHash('sha256').update(archive).digest('hex');
    if (digest.toLowerCase() !== target.sha256.toLowerCase()) {
      failStep(job, `sha256 mismatch: expected ${target.sha256}, got ${digest}`);
      throw new Error('Archive sha256 verification failed');
    }
    appendStepOutput(job, `sha256 verified: ${digest}`);
  }
  succeedStep(job);

  // 2. Extract into the managed install dir.
  const archivePath = join(tmpdir(), `clover-agent-${agentId}-${basename(new URL(target.archive).pathname)}`);
  const installDir = agentInstallDir(agentId);
  writeFileSync(archivePath, archive);
  rmSync(installDir, { recursive: true, force: true });
  mkdirSync(installDir, { recursive: true });
  beginStep(job, 'Extract archive', `${basename(archivePath)} -> ${installDir}`);
  try {
    extractArchive(archivePath, archive, installDir);
    if (!existsSync(installDir) || readdirSync(installDir).length === 0) {
      throw new Error('Archive produced no files');
    }
  } catch (error) {
    failStep(job, (error as Error).message);
    throw error;
  } finally {
    try {
      rmSync(archivePath, { force: true });
    } catch {
      // ignore temp cleanup failures
    }
  }
  appendStepOutput(job, `Extracted: ${listDir(installDir)}`);
  succeedStep(job);

  // 3. Resolve + make executable.
  const executable = join(installDir, ...target.cmd.replace(/^\.\//, '').split(/[\\/]/));
  if (!existsSync(executable)) {
    failStep(job, `Executable not found: ${target.cmd} (contains: ${listDir(installDir)})`);
    throw new Error(`Archive did not contain the declared executable: ${target.cmd}`);
  }
  if (process.platform !== 'win32') {
    chmodSync(executable, 0o755);
  }
  appendStepOutput(job, `Executable ready: ${executable}`);

  return {
    command: executable,
    args: target.args ?? [],
    env: target.env,
  };
}

// ============================================================================
// Helpers
// ============================================================================

/** Map the running platform/arch onto FORMAT.md platform targets. */
function binaryPlatformTarget(): string {
  const platform = process.platform === 'darwin'
    ? 'darwin'
    : process.platform === 'linux'
      ? 'linux'
      : process.platform === 'win32'
        ? 'windows'
        : process.platform;
  const arch = process.arch === 'x64'
    ? 'x86_64'
    : process.arch === 'arm64'
      ? 'aarch64'
      : process.arch;
  return `${platform}-${arch}`;
}

/** Extract a registry archive (zip / tar.gz / tgz / tar.bz2 / tbz2 / raw binary). */
function extractArchive(archivePath: string, archive: Buffer, destDir: string): void {
  const name = basename(archivePath).toLowerCase();

  if (/\.(tar\.gz|tgz|tar\.bz2|tbz2)$/.test(name)) {
    const result = spawnSyncChecked('tar', ['-xf', archivePath, '-C', destDir]);
    if (result) throw result;
    return;
  }
  if (name.endsWith('.zip')) {
    if (process.platform === 'win32') {
      const script = `Expand-Archive -LiteralPath "${archivePath}" -DestinationPath "${destDir}" -Force`;
      const result = spawnSyncChecked('powershell', ['-NoProfile', '-NonInteractive', '-Command', script]);
      if (result) throw result;
    } else {
      const result = spawnSyncChecked('unzip', ['-o', archivePath, '-d', destDir]);
      if (result) throw result;
    }
    return;
  }

  // Raw binary: write the downloaded bytes as-is, keeping the declared name.
  writeFileSync(join(destDir, basename(archivePath)), archive);
}

/**
 * Kill every process whose executable lives under `dir`.
 *
 * Uninstall safety net for agents that spawn their own children (or re-exec
 * themselves): after the registry tears down the warm connection, orphaned
 * subprocesses can still hold the install directory locked. On Windows the
 * scan runs through PowerShell's Win32_Process (path filter) and kills each
 * hit with `taskkill /T /F`; on POSIX `pkill -f` matches the cmdline path.
 */
function killProcessesUnderDir(dir: string): void {
  try {
    if (process.platform === 'win32') {
      const likePath = `${dir.replace(/'/g, "''")}\\*`;
      const script =
        `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and ` +
        `$_.ExecutablePath -like '${likePath}' } | ` +
        `ForEach-Object { taskkill /PID $_.ProcessId /T /F 2>$null }`;
      spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
        windowsHide: true,
        timeout: 15000,
      });
    } else {
      spawnSync('pkill', ['-f', dir], { windowsHide: true, timeout: 5000 });
    }
  } catch (error) {
    logger.warn(`[AgentInstall] Orphan process scan failed for ${dir}:`, error);
  }
}

/** Run an extraction tool synchronously; returns an Error on failure, null on success. */
function spawnSyncChecked(command: string, args: string[]): Error | null {
  const result = spawnSync(command, args, { windowsHide: true });
  if (result.error) return result.error;
  if (result.status !== 0) {
    const stderr = result.stderr?.toString().trim();
    return new Error(`${command} exited with code ${result.status}${stderr ? `: ${stderr}` : ''}`);
  }
  return null;
}

interface CommandResult {
  code: number;
  output: string[];
}

/**
 * Run an installer command, streaming its combined output lines into the
 * given job's current step.
 *
 * Windows resolution: bare commands like `npx` are npm `.cmd` shims that
 * cannot be spawned directly (Node ≥18.20 refuses `.cmd` without a shell,
 * and a plain `spawn('npx')` fails with ENOENT anyway). The command is
 * resolved on PATH first — a `.exe` is spawned directly (args keep their
 * quoting, so paths with spaces are safe), a `.cmd`/`.bat` shim goes through
 * cmd.exe with the command quoted.
 */
function runInstallCommand(
  job: AgentInstallJob,
  command: string,
  args: string[],
): Promise<CommandResult> {
  let spawnCommand = command;
  let useShell = false;

  if (process.platform === 'win32') {
    if (/\.(cmd|bat)$/i.test(command)) {
      useShell = true;
    } else {
      const probe = probePathCommand(command);
      if (probe.path) {
        spawnCommand = probe.path;
        useShell = /\.(cmd|bat)$/i.test(spawnCommand);
      } else {
        // No exe and no resolvable shim — let cmd.exe try PATH resolution.
        useShell = true;
      }
    }
    if (useShell) {
      // shell:true joins command+args into a single cmd.exe line, so the
      // command itself must carry its own quotes (PATH may contain spaces).
      spawnCommand = `"${spawnCommand}"`;
    }
  }
  const display = `${command} ${args.join(' ')}`;

  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(spawnCommand, args, {
      shell: useShell,
      windowsHide: true,
      env: process.env,
    });

    const output: string[] = [];
    const collect = (chunk: Buffer) => {
      for (const line of chunk.toString().split(/\r?\n/)) {
        if (!line.trim()) continue;
        output.push(line);
        if (output.length > MAX_OUTPUT_LINES) output.shift();
        appendStepOutput(job, line);
      }
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);

    child.on('error', (error) => {
      rejectPromise(new Error(`${display}: ${error.message}`));
    });
    child.on('close', (code) => {
      resolvePromise({ code: code ?? 1, output });
    });
  });
}

function beginStep(job: AgentInstallJob, label: string, command: string): void {
  job.steps.push({ label, command, status: 'running', output: [] });
  logger.log(`[AgentInstall] [${job.agentId}] ${label}: ${command}`);
}

function succeedStep(job: AgentInstallJob): void {
  const step = job.steps[job.steps.length - 1];
  if (step) {
    step.status = 'succeeded';
    logger.log(`[AgentInstall] [${job.agentId}] Step succeeded: ${step.label}`);
  }
}

function failStep(job: AgentInstallJob, message: string): void {
  const step = job.steps[job.steps.length - 1];
  if (step) {
    step.status = 'failed';
    step.output.push(message);
    if (step.output.length > MAX_OUTPUT_LINES) step.output.shift();
    logger.error(`[AgentInstall] [${job.agentId}] Step failed: ${step.label} — ${message}`);
  }
}

function appendStepOutput(job: AgentInstallJob, line: string): void {
  const step = job.steps[job.steps.length - 1];
  if (!step) return;
  step.output.push(line);
  if (step.output.length > MAX_OUTPUT_LINES) step.output.shift();
}

function failJob(job: AgentInstallJob, message: string): void {
  logger.error(`[AgentInstall] Install failed for agent "${job.agentId}": ${message}`);
  job.status = 'failed';
  job.error = message;
  job.finishedAt = Date.now();
}

function describeInstallCommand(distribution: AgentDistribution): string {
  if (distribution.npx) return `npx ${distribution.npx.package} ${(distribution.npx.args ?? []).join(' ')}`.trim();
  if (distribution.uvx) return `uvx ${distribution.uvx.package} ${(distribution.uvx.args ?? []).join(' ')}`.trim();
  if (distribution.binary) {
    const target = distribution.binary[binaryPlatformTarget()];
    return target ? `download ${target.archive}` : 'download (no matching platform target)';
  }
  return 'unknown distribution';
}

function listDir(dir: string): string {
  try {
    return readdirSync(dir).slice(0, 12).join(', ');
  } catch {
    return '(unreadable)';
  }
}

function randomId(): string {
  return `install-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
