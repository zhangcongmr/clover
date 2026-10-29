import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Launch policy for ACP agents.
 *
 * - Agents with a native ACP mode (opencode, gemini, qwen, auggie) are started
 *   from the CLI the user already has on PATH. Nothing is installed.
 * - Agents that need an ACP adapter (claude -> `@agentclientprotocol/claude-agent-acp`)
 *   get the adapter installed inside this project's `node_modules`, while the
 *   agent CLI it drives stays the user's global install.
 * - Adapters that would otherwise ship their own copy of the agent CLI have
 *   that copy skipped at install time (`ignoredOptionalDependencies` in the
 *   root package.json). When a global CLI is found we point the adapter at it
 *   through the adapter's documented env override.
 *
 * Node-only module: do NOT import it from `acp-agent.types.ts`, which is
 * bundled into the browser build.
 */
interface AgentRuntimeSpec {
  /** npm package providing the ACP server binary (installed in this project). */
  adapterPackage: string;
  /** Agent CLI the adapter launches; resolved from the user's global install. */
  cli: {
    /** Executable name probed on PATH. */
    command: string;
    /** npm package that provides the CLI, used in error messages. */
    package: string;
    /** Env variable the adapter reads to locate an external CLI binary. */
    envKey: string;
  };
}

const AGENT_RUNTIMES: Readonly<Record<string, AgentRuntimeSpec>> = {
  'claude-agent-acp': {
    adapterPackage: '@agentclientprotocol/claude-agent-acp',
    cli: {
      command: 'claude',
      package: '@anthropic-ai/claude-code',
      envKey: 'CLAUDE_CODE_EXECUTABLE',
    },
  },
};

export interface ResolvedAgentCommand {
  command: string;
  args: string[];
  /** False when a local adapter entry is spawned directly (no shell). */
  shell: boolean;
  /** Extra env required to launch the resolved target. */
  env: Record<string, string>;
  /** True when the command resolved to a project-local adapter. */
  local: boolean;
}

export interface AgentCommandInspection {
  installed: boolean;
  error?: string;
  /** Which artifact is missing, so the UI can offer the right installer. */
  missing?: 'adapter' | 'cli';
  /** Path that will actually be spawned, for logs and diagnostics. */
  launchPath?: string;
  /** Resolved path of the agent CLI (global install), even when it is broken. */
  cliPath?: string;
}

/** Result of looking a plain CLI agent up on PATH. */
export interface PathCommandProbe {
  found: boolean;
  path?: string;
}

/**
 * Probe a CLI that is expected to be on PATH (agents with a native ACP mode).
 * Returns the resolved entry point so the settings UI can show where it lives.
 */
export function probePathCommand(command: string): PathCommandProbe {
  if (process.platform !== 'win32') {
    const candidate = wherePaths(command).find(path => existsSync(path))
      ?? [join(dirname(process.execPath), command), join('/usr/local/bin', command)]
        .find(path => existsSync(path));
    return candidate ? { found: true, path: candidate } : { found: false };
  }

  const candidates = wherePaths(command);
  const exe = candidates.find(path => path.toLowerCase().endsWith('.exe'));
  const shim = candidates.find(path => /\.(cmd|bat)$/i.test(path));

  return { found: candidates.length > 0, path: exe ?? shim ?? candidates[0] };
}

/** npm package that provides an agent CLI (installed globally by the user). */
const CLI_PACKAGES: Readonly<Record<string, string>> = {
  'claude-agent-acp': '@anthropic-ai/claude-code',
  opencode: '@opencode/cli',
  'acp-proxy': '@openai/codex',
  gemini: '@google/gemini-cli',
  qwen: '@qwen-code/qwen-code',
  auggie: '@augmentcode/auggie',
};

/** npm package backing an agent CLI, when one is known. */
export function agentCliPackage(command: string): string | undefined {
  return CLI_PACKAGES[command];
}

/** npm package backing a command, when the agent needs an ACP adapter. */
export function localAgentPackage(command: string): string | undefined {
  return AGENT_RUNTIMES[command]?.adapterPackage;
}

/** Cache: adapter bin entry per command (positive results only). */
const adapterEntryCache = new Map<string, string>();
/** Cache: located global CLI per command (`null` = not found). */
const cliPathCache = new Map<string, string | null>();
/** Cache: CLI `--version` check results. */
const cliCheckCache = new Map<string, { ok: boolean; error?: string }>();

/**
 * Resolve a configured command into the process that should be spawned.
 * Commands without an adapter spec are returned untouched (PATH lookup).
 */
export function resolveAgentCommand(command: string, args: string[] = []): ResolvedAgentCommand {
  const spec = AGENT_RUNTIMES[command];
  if (!spec) {
    return { command, args, shell: true, env: {}, local: false };
  }

  const entry = adapterEntry(spec.adapterPackage, command);
  if (!entry) {
    // No project-local adapter: fall back to a globally installed one on PATH.
    return { command, args, shell: true, env: {}, local: false };
  }

  const env: Record<string, string> = {};
  const cliPath = locateCli(spec.cli.command);
  if (cliPath && !process.env[spec.cli.envKey]) {
    // Prefer the user's own CLI over the copy bundled with the adapter (which
    // `ignoredOptionalDependencies` keeps out of the install).
    env[spec.cli.envKey] = cliPath;
  }

  return { command: process.execPath, args: [entry, ...args], shell: false, env, local: true };
}

/**
 * Decide whether an agent can actually be launched, without spawning the ACP
 * process. Used by the registry probe so the settings UI can tell the user
 * which half is missing: the adapter or the agent CLI.
 */
export function inspectAgentCommand(command: string): AgentCommandInspection {
  const spec = AGENT_RUNTIMES[command];
  if (!spec) {
    // Plain CLI agents are probed on PATH by the caller.
    return { installed: true };
  }

  const entry = adapterEntry(spec.adapterPackage, command);
  if (!entry) {
    return {
      installed: false,
      missing: 'adapter',
      cliPath: locateCli(spec.cli.command) ?? undefined,
      error: `ACP adapter not installed: ${spec.adapterPackage} (run the installer or pnpm install)`,
    };
  }

  const cliPath = locateCli(spec.cli.command);
  if (!cliPath) {
    return {
      installed: false,
      missing: 'cli',
      launchPath: entry,
      error: `Agent CLI not found: install ${spec.cli.package}, add "${spec.cli.command}" to PATH, or set ${spec.cli.envKey}`,
    };
  }

  const check = checkCli(cliPath);
  if (!check.ok) {
    return {
      installed: false,
      missing: 'cli',
      launchPath: entry,
      cliPath,
      error: `Agent CLI at ${cliPath} is not runnable: ${check.error ?? 'unknown error'}${fileHint(cliPath)}`,
    };
  }

  return { installed: true, launchPath: entry, cliPath };
}

/**
 * Extra hint for the common broken case: npm/pnpm shims pointing at a stub that
 * never downloaded the real native binary (a few hundred bytes instead of MBs).
 */
function fileHint(filePath: string): string {
  try {
    const { size } = statSync(filePath);
    if (size > 0 && size < 4096) {
      return ` (file is only ${size} bytes — reinstall the agent CLI)`;
    }
  } catch {
    // Ignore stat failures; the probe error already explains the problem.
  }
  return '';
}

// ============================================================================
// Adapter resolution
// ============================================================================

/** Result of locating + executing an agent CLI. */
export interface AgentCliProbe {
  found: boolean;
  runnable: boolean;
  path?: string;
  error?: string;
}

/**
 * Locate and execute an agent CLI (`--version`), bypassing caches.
 *
 * Used by the installer to verify that a fresh `npm install -g` actually
 * produced a working binary — some packages ship a placeholder stub and rely on
 * a postinstall script to copy the real native binary into place.
 */
export function probeAgentCli(agentCommand: string): AgentCliProbe {
  invalidateAgentCommandCache();

  const spec = AGENT_RUNTIMES[agentCommand];
  const cliCommand = spec ? spec.cli.command : agentCommand;
  const cliPath = locateCli(cliCommand);
  if (!cliPath) {
    return {
      found: false,
      runnable: false,
      error: `"${cliCommand}" was not found on PATH after install`,
    };
  }

  const check = checkCli(cliPath);
  return {
    found: true,
    runnable: check.ok,
    path: cliPath,
    error: check.ok ? undefined : `${check.error ?? 'unknown error'}${fileHint(cliPath)}`,
  };
}

function adapterEntry(packageName: string, command: string): string | null {
  const cached = adapterEntryCache.get(command);
  if (cached) return cached;

  const entry = readBinEntry(findPackageJson(packageName), command);
  if (entry) adapterEntryCache.set(command, entry);
  return entry;
}

/**
 * Locate the `package.json` of an installed package.
 *
 * Uses Node resolution from several anchors first (regular installs), then
 * scans `node_modules` upwards. The scan matters for bundled builds (Angular
 * SSR / esbuild inline this package into the app server), where module
 * resolution starts from the bundle instead of from this package, and for
 * pnpm's hoisted virtual store (`node_modules/.pnpm/node_modules`).
 */
function findPackageJson(packageName: string): string | null {
  const specifier = `${packageName}/package.json`;

  for (const anchor of resolutionAnchors()) {
    try {
      const resolved = createRequire(anchor).resolve(specifier);
      if (existsSync(resolved)) return resolved;
    } catch {
      // Not resolvable from this anchor — try the next one.
    }
  }

  const parts = packageName.split('/');
  for (const nodeModules of candidateNodeModulesDirs()) {
    for (const candidate of [
      join(nodeModules, ...parts),
      join(nodeModules, '.pnpm', 'node_modules', ...parts),
    ]) {
      const packageJson = join(candidate, 'package.json');
      if (existsSync(packageJson)) return packageJson;
    }
  }

  return null;
}

/** Absolute file paths `createRequire` can resolve from. */
function resolutionAnchors(): string[] {
  const anchors = new Set<string>();
  const modulePath = ownModulePath();
  if (modulePath) anchors.add(modulePath);
  const argvPath = process.argv[1] ? resolve(process.argv[1]) : null;
  if (argvPath) anchors.add(argvPath);
  anchors.add(join(process.cwd(), 'index.js'));
  return [...anchors];
}

/** This module's own file path (undefined when bundled to CommonJS). */
function ownModulePath(): string | null {
  const url: unknown = (import.meta as { url?: unknown }).url;
  if (typeof url === 'string') {
    try {
      return fileURLToPath(url);
    } catch {
      // Malformed URL — fall through to __dirname.
    }
  }
  const dir = (globalThis as Record<string, unknown>)['__dirname'];
  return typeof dir === 'string' ? join(dir, 'index.js') : null;
}

/** Every `<dir>/node_modules` on the way up from the running code and cwd. */
function candidateNodeModulesDirs(): string[] {
  const starts: string[] = [];
  const modulePath = ownModulePath();
  if (modulePath) starts.push(dirname(modulePath));
  if (process.argv[1]) starts.push(dirname(resolve(process.argv[1])));
  starts.push(process.cwd());

  const dirs = new Set<string>();
  for (const start of starts) {
    let current = start;
    for (;;) {
      dirs.add(join(current, 'node_modules'));
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return [...dirs];
}

/** Read the `bin` entry named after `command` from a package manifest. */
function readBinEntry(packageJsonPath: string | null, command: string): string | null {
  if (!packageJsonPath) return null;

  try {
    const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      bin?: string | Record<string, string>;
    };
    const { bin } = manifest;
    const relative = typeof bin === 'string'
      ? bin
      : bin?.[command] ?? Object.values(bin ?? {})[0];

    if (!relative) return null;

    const entry = resolve(dirname(packageJsonPath), relative);
    return existsSync(entry) ? entry : null;
  } catch {
    return null;
  }
}

// ============================================================================
// Global agent CLI resolution
// ============================================================================

/**
 * Find the user's global agent CLI executable.
 *
 * Shell shims (`.cmd`/`.ps1` produced by npm/pnpm on Windows) cannot be spawned
 * without a shell, so the real binary behind the shim is preferred.
 */
function locateCli(command: string): string | null {
  if (cliPathCache.has(command)) {
    return cliPathCache.get(command) ?? null;
  }

  const found = process.platform === 'win32'
    ? locateCliWindows(command)
    : locateCliPosix(command);

  cliPathCache.set(command, found);
  return found;
}

function locateCliWindows(command: string): string | null {
  const candidates = wherePaths(command);
  const exeName = `${command}.exe`;

  // PATH is not the only place npm/pnpm put global bins: a server started by a
  // service, PM2 or an IDE can inherit a PATH that lacks the user's install
  // directory, so also look next to the running Node binary and in the usual
  // global prefixes.
  const fallbackDirs = [
    dirname(process.execPath),
    join(process.env['APPDATA'] ?? '', 'npm'),
    join(process.env['LOCALAPPDATA'] ?? '', 'pnpm'),
    join(process.env['ProgramFiles'] ?? '', 'nodejs'),
    join(process.env['USERPROFILE'] ?? '', '.local', 'bin'),
  ].filter(dir => !!dir);

  const nativeCandidates = [
    ...candidates.filter(path => path.toLowerCase().endsWith('.exe')),
    ...candidates.flatMap(shimTargets),
    ...fallbackDirs.flatMap(dir => [join(dir, exeName), ...shimTargets(join(dir, `${command}.cmd`))]),
  ];

  for (const candidate of nativeCandidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
}

function locateCliPosix(command: string): string | null {
  const fallbackPaths = [
    join(dirname(process.execPath), command),
    join(process.env['HOME'] ?? '', '.local', 'bin', command),
    join('/usr/local/bin', command),
    join('/opt/homebrew/bin', command),
  ];
  for (const candidate of [...wherePaths(command), ...fallbackPaths]) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
}

/** Paths reported by `where` (Windows) / `command -v` (POSIX). */
function wherePaths(command: string): string[] {
  try {
    // stderr must be swallowed: `where` prints a localized
    // "INFO: Could not find files for the given pattern(s)." in the console
    // code page (e.g. GBK) whenever nothing matches, which shows up as mojibake
    // on UTF-8 terminals.
    const options = {
      encoding: 'utf8' as const,
      timeout: 5000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'] as ['ignore', 'pipe', 'ignore'],
    };
    const output = process.platform === 'win32'
      ? execFileSync('where', [command], options)
      : execFileSync('sh', ['-c', `command -v "${command}"`], options);
    return output.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Resolve the real executable referenced by an npm/pnpm `.cmd` shim, e.g.
 * `"%_prog%"  "%dp0%\node_modules\@anthropic-ai\claude-code\bin\claude.exe" %*`.
 */
function shimTargets(shimPath: string): string[] {
  if (!/\.(cmd|bat|ps1)$/i.test(shimPath)) return [];

  try {
    const text = readFileSync(shimPath, 'utf8');
    const shimDir = dirname(shimPath);
    const targets: string[] = [];
    for (const match of text.matchAll(/"%dp0%\\([^"]+?\.(?:exe|cmd))"/gi)) {
      targets.push(join(shimDir, match[1]));
    }
    for (const match of text.matchAll(/"([A-Za-z]:\\[^"]+?\.exe)"/gi)) {
      targets.push(match[1]);
    }
    return targets;
  } catch {
    return [];
  }
}

/**
 * Verify the CLI actually runs (`--version`) so a broken install is reported as
 * such, and surface its parsed version string when one is found.
 */
function checkCli(cliPath: string): { ok: boolean; error?: string; version?: string } {
  const cached = cliCheckCache.get(cliPath);
  if (cached) return cached;

  const result = ((): { ok: boolean; error?: string; version?: string } => {
    try {
      const output = execFileSync(cliPath, ['--version'], {
        encoding: 'utf8',
        timeout: 10000,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { ok: true, version: parseVersion(output) ?? undefined };
    } catch (error) {
      const failure = error as { stderr?: string; status?: number | null; code?: string; message?: string };
      const stderrLine = (failure.stderr ?? '')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)[0];
      const detail = stderrLine
        ?? (typeof failure.status === 'number' ? `exit code ${failure.status}` : undefined)
        ?? describeSpawnError(failure.code)
        ?? failure.message
        ?? 'unknown error';
      return { ok: false, error: detail, version: parseVersion(failure.stderr ?? '') ?? undefined };
    }
  })();

  cliCheckCache.set(cliPath, result);
  return result;
}

/**
 * Extract the first semver-like token — optionally `v`-prefixed, e.g. `1.2.3`
 * or `v0.18.0-beta.1` — from command output. Returns null when none is found.
 */
function parseVersion(text: string): string | null {
  const match = text.match(/v?(\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?)/);
  return match ? match[1] : null;
}

/**
 * Installed agent CLI version, parsed from a `--version` run. Returns null when
 * the version cannot be resolved. Shares `checkCli`'s cache, so the runnability
 * probe and this lookup cost a single subprocess execution.
 */
export function probeAgentVersion(cliPath: string): string | null {
  return checkCli(cliPath).version ?? null;
}

/** Turn low-level spawn codes into something a user can act on. */
function describeSpawnError(code: string | undefined): string | undefined {
  switch (code) {
    case 'EFTYPE':
    case 'UNKNOWN':
      return 'not a valid executable';
    case 'EINVAL':
      return 'cannot be executed directly (shell shim instead of a binary)';
    case 'ENOENT':
      return 'executable not found';
    case 'EACCES':
    case 'EPERM':
      return 'permission denied';
    default:
      return code;
  }
}

/** Drop cached probes so a freshly installed CLI/adapter is picked up. */
export function invalidateAgentCommandCache(): void {
  adapterEntryCache.clear();
  cliPathCache.clear();
  cliCheckCache.clear();
}
