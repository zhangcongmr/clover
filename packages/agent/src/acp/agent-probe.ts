import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Probe & launch resolution for ACP agents.
 *
 * Slim replacement for the removed `agent-executable.ts`: there is no
 * adapter/AGENT_RUNTIMES concept anymore — every agent is launched directly
 * from its configured `command` + `args` (a global CLI, an `npx`/`uvx`
 * invocation, or a binary installed under `~/.clover/agents/<id>/`).
 *
 * Node-only module: do NOT import it from `acp-agent.types.ts`, which is
 * bundled into the browser build.
 */

/** Result of looking a plain CLI agent up on PATH. */
export interface PathCommandProbe {
  found: boolean;
  path?: string;
}

/** Resolved spawn target for an agent command. */
export interface ResolvedSpawnTarget {
  command: string;
  args: string[];
  /** False when the command is a direct executable (no shell needed). */
  shell: boolean;
}

/**
 * Probe a CLI that is expected to be on PATH.
 * Returns the resolved entry point so the settings UI can show where it lives.
 */
export function probePathCommand(command: string): PathCommandProbe {
  if (command.includes('/') || command.includes('\\')) {
    return existsSync(command) ? { found: true, path: command } : { found: false };
  }

  if (process.platform !== 'win32') {
    const candidate = wherePaths(command).find(path => existsSync(path))
      ?? [join(dirname(process.execPath), command), join('/usr/local/bin', command)]
        .find(path => existsSync(path));
    return candidate ? { found: true, path: candidate } : { found: false };
  }

  const candidates = wherePaths(command);
  const resolved = resolveCliWindows(command, candidates, globalBinDirsWindows());
  return resolved ? { found: true, path: resolved } : { found: false };
}

/**
 * Resolve an agent command into the process that should be spawned.
 *
 * On Windows, npm/pnpm/uv shims (`.cmd`/`.bat`) cannot be spawned directly,
 * so the real binary behind the shim is preferred; when the shim only wraps
 * a script, the shim itself is returned and launched through `cmd.exe`.
 * On POSIX the command is passed through untouched (spawn resolves PATH).
 */
export function resolveForSpawn(command: string, args: string[] = []): ResolvedSpawnTarget {
  if (process.platform !== 'win32') {
    return { command, args, shell: false };
  }

  // Absolute/relative paths with a shell-shim extension must go through cmd.exe.
  if (/\.(cmd|bat)$/i.test(command)) {
    return { command: quoteCommand(command), args, shell: true };
  }
  if (command.includes('/') || command.includes('\\')) {
    return { command, args, shell: false };
  }

  // Bare command: prefer a native binary found on PATH / global bin dirs so
  // spawn can start it without a shell.
  const candidates = wherePaths(command);
  const resolved = resolveCliWindows(command, candidates, globalBinDirsWindows());
  if (!resolved) {
    // Nothing resolvable (e.g. only a shim cmd.exe must find): let the shell
    // resolve the bare command on PATH.
    return { command, args, shell: true };
  }
  if (/\.(exe|com)$/i.test(resolved)) {
    return { command: resolved, args, shell: false };
  }
  // .cmd/.bat shim: spawn through cmd.exe. shell:true makes Node join
  // command+args into one cmd line, so the path carries its own quotes —
  // otherwise a space in the path (C:\Program Files\...) truncates it.
  return { command: quoteCommand(resolved), args, shell: true };
}

/** Quote a command for a `shell: true` spawn on Windows. */
function quoteCommand(command: string): string {
  return command.includes(' ') ? `"${command}"` : command;
}

/** Extra global bin directories Windows npm/pnpm/uv install into. */
function globalBinDirsWindows(): string[] {
  return [
    dirname(process.execPath),
    join(process.env['APPDATA'] ?? '', 'npm'),
    join(process.env['LOCALAPPDATA'] ?? '', 'pnpm'),
    join(process.env['ProgramFiles'] ?? '', 'nodejs'),
    join(process.env['USERPROFILE'] ?? '', '.local', 'bin'),
  ].filter(dir => !!dir && dir.length > 0);
}

/**
 * Resolve Windows PATH hits for an agent CLI into the most native path.
 *
 * Preference order: a bare `.exe` on PATH, an executable referenced by a
 * `.cmd`/`.bat` shim, and finally the shim itself — spawnable through cmd.exe.
 */
function resolveCliWindows(
  command: string,
  candidates: string[],
  fallbackDirs: string[],
): string | null {
  const shims = candidates
    .filter(path => /\.(cmd|bat)$/i.test(path))
    .concat(fallbackDirs.map(dir => join(dir, `${command}.cmd`)))
    .filter(shim => existsSync(shim));

  // Spawnable without a shell: bare exes, then whatever a shim executes.
  const nativeCandidates = [
    ...candidates.filter(path => path.toLowerCase().endsWith('.exe')),
    ...fallbackDirs.map(dir => join(dir, `${command}.exe`)),
    ...shims.flatMap(shim => shimTargets(shim)),
  ];

  for (const candidate of nativeCandidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }

  return shims[0] ?? null;
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
 * Resolve executables referenced by an npm/pnpm `.cmd` shim, e.g.
 * `"%_prog%"  "%dp0%\node_modules\@scope\pkg\bin\cli.exe" %*`.
 *
 * Only the line that forwards `%*` is inspected: npm shims also probe helpers
 * on earlier lines (`IF EXIST "%dp0%\node.exe"`), and picking those up would
 * resolve the CLI to the Node binary. Shims whose target is a script (`.js`)
 * yield nothing here — the shim itself is then used as the launch path.
 */
function shimTargets(shimPath: string): string[] {
  if (!/\.(cmd|bat)$/i.test(shimPath)) return [];

  try {
    const shimDir = dirname(shimPath);
    const targets: string[] = [];

    for (const line of readFileSync(shimPath, 'utf8').split(/\r?\n/)) {
      if (!line.includes('%*')) continue;

      // `%dp0%` (npm) and `%~dp0%` (pnpm) both expand to the shim directory.
      for (const match of line.matchAll(/"%~?dp0%\\([^"]+?\.(?:exe|com))"/gi)) {
        targets.push(join(shimDir, match[1]));
      }
      for (const match of line.matchAll(/"([A-Za-z]:\\[^"]+?\.(?:exe|com))"/gi)) {
        targets.push(match[1]);
      }
    }

    return [...new Set(targets)];
  } catch {
    return [];
  }
}

// ============================================================================
// Version probe
// ============================================================================

/** Cache: CLI `--version` check results. */
const cliCheckCache = new Map<string, { ok: boolean; error?: string; version?: string }>();

/**
 * Installed agent CLI version, parsed from a `--version` run.
 * Returns null when the version cannot be resolved. Results are cached, so
 * the runnability probe and this lookup cost a single subprocess execution.
 */
export function probeAgentVersion(cliPath: string): string | null {
  return checkCli(cliPath).version ?? null;
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
      const output = runVersionCheck(cliPath);
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
 * Run `<cli> --version` and return its stdout.
 *
 * Windows shell shims (`.cmd`/`.bat`) cannot be executed directly, so they go
 * through `cmd.exe` as a single command line — passing args together with
 * `shell: true` is deprecated and would not quote the path.
 */
function runVersionCheck(cliPath: string): string {
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(cliPath)) {
    return execSync(`"${cliPath}" --version`, {
      encoding: 'utf8',
      timeout: 10000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }

  return execFileSync(cliPath, ['--version'], {
    encoding: 'utf8',
    timeout: 10000,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * Extract the first semver-like token — optionally `v`-prefixed, e.g. `1.2.3`
 * or `v0.18.0-beta.1` — from command output. Returns null when none is found.
 */
function parseVersion(text: string): string | null {
  const match = text.match(/v?(\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?)/);
  return match ? match[1] : null;
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

/** Extra hint for a common broken case: a shim pointing at a stub binary. */
export function fileHint(filePath: string): string {
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

/** Drop cached probes so a freshly installed CLI is picked up. */
export function invalidateAgentCommandCache(): void {
  cliCheckCache.clear();
}
