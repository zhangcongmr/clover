import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { logger } from '../helpers/logger.js';
import { agentCliPackage, localAgentPackage, probeAgentCli } from './agent-executable.js';

/**
 * On-demand installers for ACP agents (Settings → Agents → Install).
 *
 * The project only ships the ACP adapter for agents that need one; the agent
 * CLI itself stays the user's own global install. This module turns that policy
 * into an explicit, user-triggered action: it runs the documented npm/pnpm
 * command, streams the output, verifies the result, and repairs the common
 * "installer skipped the postinstall step" failure.
 *
 * Nothing here runs automatically — an install only starts from the settings
 * button, and the exact command is always reported back to the UI.
 */

export type AgentInstallTarget = 'cli' | 'adapter';

export interface AgentInstallStep {
  label: string;
  command: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  output: string[];
}

export interface AgentInstallJob {
  id: string;
  agentId: string;
  /** Command line shown in the UI, e.g. `npm install -g @google/gemini-cli`. */
  command: string;
  status: 'running' | 'succeeded' | 'failed';
  steps: AgentInstallStep[];
  startedAt: number;
  finishedAt?: number;
  error?: string;
}

interface InstallStepSpec {
  label: string;
  command: string;
  args: string[];
  cwd?: string;
  /** Skip the `--version` verification that follows a successful CLI install. */
  skipVerify?: boolean;
}

const MAX_OUTPUT_LINES = 200;
const MAX_JOBS = 20;

const jobsById = new Map<string, AgentInstallJob>();
const runningByAgent = new Map<string, string>();

/**
 * Install command for a missing artifact, or null when there is no known
 * installer (command not listed in `CLI_PACKAGES`).
 */
export function installCommandFor(agentCommand: string, target: AgentInstallTarget): string | null {
  if (target === 'adapter') {
    // Adapters are regular dependencies of this workspace.
    return findWorkspaceRoot() ? 'pnpm install' : null;
  }
  const packageName = agentCliPackage(agentCommand);
  return packageName ? `npm install -g ${packageName}` : null;
}

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

/**
 * Start installing the missing artifact for `agentCommand`.
 *
 * Returns the in-flight job when one is already running for this agent, and
 * null when no installer is known.
 */
export function startAgentInstall(
  agentId: string,
  agentCommand: string,
  target: AgentInstallTarget,
  onFinished?: (job: AgentInstallJob) => void,
): AgentInstallJob | null {
  const runningId = runningByAgent.get(agentId);
  if (runningId) {
    return jobsById.get(runningId) ?? null;
  }

  const specs = buildSteps(agentCommand, target);
  if (!specs.length) return null;

  const job: AgentInstallJob = {
    id: `install_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    agentId,
    command: specs.map(prettyCommand).join(' && '),
    status: 'running',
    steps: [],
    startedAt: Date.now(),
  };

  jobsById.set(job.id, job);
  runningByAgent.set(agentId, job.id);
  pruneJobs();

  logger.log(`[AgentInstall] ${agentId}: ${job.command}`);

  void executeJob(job, agentCommand, specs)
    .then(
      () => {
        job.status = 'succeeded';
        job.finishedAt = Date.now();
        logger.log(`[AgentInstall] ${agentId}: succeeded`);
      },
      (error: Error) => {
        job.status = 'failed';
        job.error = error.message;
        job.finishedAt = Date.now();
        logger.error(`[AgentInstall] ${agentId}: failed — ${error.message}`);
      },
    )
    .finally(() => {
      runningByAgent.delete(agentId);
      onFinished?.(job);
    });

  return job;
}

/**
 * Run the install steps, then verify the CLI actually starts.
 *
 * Many agent packages ship a placeholder binary and copy the real one in a
 * `postinstall` script. When npm/pnpm skip that script (`--ignore-scripts`,
 * pnpm's build-script allow list, ...) the install "succeeds" but leaves a
 * non-runnable stub. In that case re-run the package's own postinstall once.
 */
async function executeJob(
  job: AgentInstallJob,
  agentCommand: string,
  specs: InstallStepSpec[],
): Promise<void> {
  for (const spec of specs) {
    await runStep(job, spec);
  }

  if (specs.every(spec => spec.skipVerify)) return;

  const verify = (): { ok: boolean; output: string[] } => {
    const probe = probeAgentCli(agentCommand);
    const output = probe.runnable
      ? [`${probe.path} --version: ok`]
      : [probe.error ?? 'verification failed'];
    return { ok: probe.runnable, output };
  };

  const first = verify();
  if (first.ok) {
    appendStep(job, 'Verify agent CLI', 'verify', 'succeeded', first.output);
    return;
  }

  // Installer left a broken CLI behind: run the package's documented repair.
  const repair = buildRepairStep(agentCommand);
  if (!repair) {
    appendStep(job, 'Verify agent CLI', 'verify', 'failed', first.output);
    throw new Error(
      `${first.output[0]}. Automatic repair is not available — run the package postinstall manually.`,
    );
  }

  appendStep(job, 'Verify agent CLI', 'verify', 'failed', first.output);
  await runStep(job, repair);

  const second = verify();
  if (!second.ok) {
    appendStep(job, 'Verify agent CLI (after repair)', 'verify', 'failed', second.output);
    throw new Error(`${second.output[0]}`);
  }
  appendStep(job, 'Verify agent CLI (after repair)', 'verify', 'succeeded', second.output);
}

/**
 * Repair step: re-run the installed package's `postinstall` script.
 *
 * Prefers running the script directly with the current Node binary, which
 * bypasses npm/pnpm script policies entirely; falls back to `npm rebuild`.
 */
function buildRepairStep(agentCommand: string): InstallStepSpec | null {
  const packageName = agentCliPackage(agentCommand);
  if (!packageName) return null;

  const packageDir = findGlobalPackageDir(packageName);
  if (!packageDir) {
    return {
      label: `Repair ${packageName} (postinstall)`,
      command: packageManagerBin('npm'),
      args: ['rebuild', '-g', packageName, '--foreground-scripts', '--ignore-scripts=false'],
      skipVerify: true,
    };
  }

  const postinstall = readPostinstallScript(packageDir);
  if (!postinstall) return null;

  return {
    label: `Repair ${packageName} (re-run postinstall)`,
    command: process.execPath,
    args: [postinstall],
    cwd: packageDir,
    skipVerify: true,
  };
}

/** Absolute path of a globally installed package directory, if it can be found. */
function findGlobalPackageDir(packageName: string): string | null {
  const roots: string[] = [];

  for (const manager of ['npm', 'pnpm'] as const) {
    try {
      const root = execFileSync(packageManagerBin(manager), ['root', '-g'], {
        encoding: 'utf8',
        timeout: 10000,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
        // npm/pnpm are `.cmd` shims on Windows and need a shell.
        shell: process.platform === 'win32',
      }).trim();
      if (root) roots.push(root);
    } catch {
      // Manager missing or not a global install; try the next one.
    }
  }

  for (const root of roots) {
    const candidate = join(root, ...packageName.split('/'));
    if (existsSync(join(candidate, 'package.json'))) return candidate;
  }
  return null;
}

/** `scripts.postinstall` as an absolute script path, when it is a `node <file>` call. */
function readPostinstallScript(packageDir: string): string | null {
  try {
    const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const script = manifest.scripts?.['postinstall'];
    if (!script) return null;

    const match = /^node\s+(\S+)/.exec(script.trim());
    if (!match) return null;

    const scriptPath = resolve(packageDir, match[1]);
    return existsSync(scriptPath) ? scriptPath : null;
  } catch {
    return null;
  }
}

/** Steps needed for the given target; adapter installs run in the workspace root. */
function buildSteps(agentCommand: string, target: AgentInstallTarget): InstallStepSpec[] {
  if (target === 'adapter') {
    const workspaceRoot = findWorkspaceRoot();
    const adapterPackage = localAgentPackage(agentCommand);
    if (!workspaceRoot || !adapterPackage) return [];
    return [{
      label: `Install ACP adapter (${adapterPackage})`,
      command: packageManagerBin('pnpm'),
      args: ['install'],
      cwd: workspaceRoot,
      skipVerify: true,
    }];
  }

  const packageName = agentCliPackage(agentCommand);
  if (!packageName) return [];
  return [{
    label: `Install agent CLI (${packageName})`,
    command: packageManagerBin('npm'),
    args: ['install', '-g', packageName],
  }];
}

/** Windows requires the `.cmd` shim when spawning npm/pnpm through a shell. */
function packageManagerBin(name: 'npm' | 'pnpm'): string {
  return process.platform === 'win32' ? `${name}.cmd` : name;
}

function prettyCommand(spec: InstallStepSpec): string {
  return [spec.command.replace(/\.cmd$/i, ''), ...spec.args].join(' ');
}

function appendStep(
  job: AgentInstallJob,
  label: string,
  command: string,
  status: AgentInstallStep['status'],
  output: string[],
): void {
  job.steps.push({ label, command, status, output: output.slice(-MAX_OUTPUT_LINES) });
}

/** Run one command and record it as a job step. Rejects when the step fails. */
async function runStep(job: AgentInstallJob, spec: InstallStepSpec): Promise<void> {
  const step: AgentInstallStep = {
    label: spec.label,
    command: prettyCommand(spec),
    status: 'running',
    output: [],
  };
  job.steps.push(step);

  const exitCode = await new Promise<number | null>((resolveExit, reject) => {
    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      shell: process.platform === 'win32',
      windowsHide: true,
      env: process.env,
    });

    const collect = (chunk: Buffer): void => {
      for (const line of chunk.toString().split(/\r?\n/)) {
        const text = line.trim();
        if (!text) continue;
        step.output.push(text);
        if (step.output.length > MAX_OUTPUT_LINES) step.output.shift();
      }
    };

    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    child.on('error', reject);
    child.on('close', code => resolveExit(code));
  });

  if (exitCode !== 0) {
    step.status = 'failed';
    const detail = step.output[step.output.length - 1];
    throw new Error(`${step.command} exited with code ${exitCode}${detail ? `: ${detail}` : ''}`);
  }
  step.status = 'succeeded';
}

function pruneJobs(): void {
  if (jobsById.size <= MAX_JOBS) return;
  const finished = [...jobsById.values()]
    .filter(job => job.status !== 'running')
    .sort((a, b) => a.startedAt - b.startedAt);

  for (const job of finished.slice(0, jobsById.size - MAX_JOBS)) {
    jobsById.delete(job.id);
  }
}

/** Locate the workspace root (the directory holding `pnpm-workspace.yaml`). */
function findWorkspaceRoot(): string | null {
  const starts = new Set<string>();
  starts.add(process.cwd());
  if (process.argv[1]) starts.add(dirname(process.argv[1]));

  for (const start of starts) {
    let current = start;
    for (;;) {
      if (existsSync(join(current, 'pnpm-workspace.yaml'))) return current;
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return null;
}
