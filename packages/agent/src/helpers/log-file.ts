import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
  type WriteStream,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Rolling, size-bounded file logging backed by a non-blocking `WriteStream`.
 *
 * Writes to `~/.clover/logs` by default, one file at a time whose name carries
 * the creation timestamp, e.g. `agent-20261016-112030-123-0000.log`. When the
 * current file would exceed `maxSizeBytes` a new timestamped file is opened,
 * and the oldest files are deleted so at most `maxFiles` remain (rolling
 * deletion).
 *
 * Writes go through a `WriteStream` so logging never blocks the event loop.
 * The trade-off is that the last few buffered lines may not reach disk if the
 * process is killed abruptly — call {@link RollingFileLogger.flush} or
 * {@link RollingFileLogger.close} on graceful shutdown to drain them.
 *
 * Configuration (all optional, env vars are read once at construction):
 *   CLOVER_LOG_DIR        target directory            (default ~/.clover/logs)
 *   CLOVER_LOG_MAX_SIZE   per-file size limit, bytes  (default 10 MiB)
 *   CLOVER_LOG_MAX_FILES  files to keep, oldest first (default 10, <=0 = keep all)
 *   CLOVER_LOG_PREFIX     filename prefix             (default "agent")
 *   CLOVER_LOG_TO_FILE    set to "false" to disable   (default enabled)
 */
export interface FileLoggingOptions {
  enabled?: boolean;
  /** Target directory. `~` is expanded. */
  dir?: string;
  /** Rotate once the current file would grow past this many bytes. */
  maxSizeBytes?: number;
  /** Number of files to retain, oldest deleted first. `<= 0` keeps everything. */
  maxFiles?: number;
  /** Filename prefix, e.g. `agent` -> `agent-<timestamp>-<seq>.log`. */
  prefix?: string;
}

const DEFAULT_MAX_SIZE_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_FILES = 10;
const DEFAULT_PREFIX = 'agent';

function expandHome(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2));
  return path;
}

function envNumber(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0');
}

/** Filename-safe local timestamp: `YYYYMMDD-HHmmss-SSS`. */
function timestampForName(date: Date): string {
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}-` +
    `${pad(date.getMilliseconds(), 3)}`
  );
}

/** Default log directory (`~/.clover/logs`), honoring `CLOVER_LOG_DIR`. */
export function defaultLogDir(): string {
  return expandHome(process.env['CLOVER_LOG_DIR'] || join(homedir(), '.clover', 'logs'));
}

export class RollingFileLogger {
  private enabled: boolean;
  private dir: string;
  private maxSizeBytes: number;
  private maxFiles: number;
  private prefix: string;

  /** Currently open stream, or null when nothing has been written yet. */
  private stream: WriteStream | null = null;
  private currentPath: string | null = null;
  /** Logical bytes committed to the current file (buffer-independent). */
  private currentSize = 0;
  /** Writes handed to the stream but not yet confirmed on disk. */
  private inflight = 0;
  /** Resolvers waiting for {@link flush}. */
  private drainWaiters: Array<() => void> = [];
  /** Files this instance has opened (may not be flushed to disk yet). */
  private opened: string[] = [];
  /** Timestamp portion of the last filename handed out, for sequence reset. */
  private lastStamp = '';
  /** Zero-padded sequence within the current timestamp (avoids ms collisions). */
  private seqInStamp = 0;
  /** Set once so a broken filesystem never spams the console. */
  private warned = false;

  constructor(options: FileLoggingOptions = {}) {
    this.enabled = options.enabled ?? process.env['CLOVER_LOG_TO_FILE'] !== 'false';
    this.dir = expandHome(options.dir ?? defaultLogDir());
    this.maxSizeBytes = options.maxSizeBytes ?? envNumber('CLOVER_LOG_MAX_SIZE', DEFAULT_MAX_SIZE_BYTES);
    this.maxFiles = options.maxFiles ?? envNumber('CLOVER_LOG_MAX_FILES', DEFAULT_MAX_FILES);
    this.prefix = options.prefix ?? (process.env['CLOVER_LOG_PREFIX'] || DEFAULT_PREFIX);
  }

  /** Directory currently targeted for log files. */
  get directory(): string {
    return this.dir;
  }

  /** Path of the file currently being appended to (may not exist yet). */
  get currentFile(): string | null {
    return this.currentPath;
  }

  /**
   * Reconfigure at runtime. The current stream is closed and the next write
   * opens a fresh file with the new settings.
   */
  configure(options: FileLoggingOptions): void {
    if (options.enabled !== undefined) this.enabled = options.enabled;
    if (options.dir !== undefined) this.dir = expandHome(options.dir);
    if (options.maxSizeBytes !== undefined) this.maxSizeBytes = options.maxSizeBytes;
    if (options.maxFiles !== undefined) this.maxFiles = options.maxFiles;
    if (options.prefix !== undefined) this.prefix = options.prefix;

    this.endStream();
    this.currentPath = null;
    this.currentSize = 0;
    this.warned = false;
  }

  /** Queue one already-formatted line (include the trailing newline). */
  write(line: string): void {
    if (!this.enabled || !line) return;
    try {
      const bytes = Buffer.byteLength(line, 'utf8');
      if (this.stream === null) {
        this.openNewFile();
      } else if (this.currentSize > 0 && this.currentSize + bytes > this.maxSizeBytes) {
        this.rotate();
      }
      // Never block: hand the chunk to the stream and return immediately.
      this.inflight += 1;
      this.stream!.write(line, () => this.onWriteSettled());
      this.currentSize += bytes;
    } catch (error) {
      // Never let logging break the app; disable after the first failure.
      this.disableFileLogging(error);
    }
  }

  /** Resolve once everything queued so far has been written to disk. */
  flush(): Promise<void> {
    if (this.inflight <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      this.drainWaiters.push(resolve);
    });
  }

  /** Flush and close the current stream. Safe to call multiple times. */
  close(): Promise<void> {
    const stream = this.stream;
    this.stream = null;
    if (!stream) return Promise.resolve();
    return new Promise((resolve) => {
      stream.once('error', () => resolve());
      stream.end(() => resolve());
    });
  }

  /** List retained log files, oldest first. */
  listFiles(): string[] {
    try {
      return readdirSync(this.dir)
        .filter((name) => name.startsWith(`${this.prefix}-`) && name.endsWith('.log'))
        .sort() // fixed-width timestamp => lexicographic order == chronological order
        .map((name) => join(this.dir, name));
    } catch {
      return [];
    }
  }

  private openNewFile(): void {
    mkdirSync(this.dir, { recursive: true });

    // Keep room for the file we are about to create.
    this.enforceRetention();

    const stamp = timestampForName(new Date());
    // The stream creates its file asynchronously, so `existsSync` alone cannot
    // see rotations that happen within the same millisecond. A zero-padded
    // sequence keeps every name unique *and* lexicographically ordered, which
    // the oldest-first pruning below relies on.
    if (stamp !== this.lastStamp) {
      this.lastStamp = stamp;
      this.seqInStamp = 0;
    }
    let seq = this.seqInStamp;
    let path = join(this.dir, `${this.prefix}-${stamp}-${pad(seq, 4)}.log`);
    while (this.opened.includes(path) || existsSync(path)) {
      seq += 1;
      path = join(this.dir, `${this.prefix}-${stamp}-${pad(seq, 4)}.log`);
    }
    this.seqInStamp = seq;
    this.opened.push(path);

    const stream = createWriteStream(path, { flags: 'a' });
    // A WriteStream with no 'error' listener would crash the process.
    stream.on('error', (error) => this.disableFileLogging(error));
    // Rotation defers deletion until the handle is actually released: on
    // Windows an open file cannot be unlinked, and `end()` closes asynchronously.
    stream.on('close', () => this.enforceRetention());

    this.stream = stream;
    this.currentPath = path;
    this.currentSize = 0;
  }

  private rotate(): void {
    this.endStream();
    this.currentPath = null;
    this.currentSize = 0;
    this.openNewFile();
  }

  /** Best-effort close of the active stream (ignores late async errors). */
  private endStream(): void {
    const stream = this.stream;
    this.stream = null;
    if (!stream) return;
    stream.once('error', () => undefined);
    stream.end();
  }

  private disableFileLogging(error: unknown): void {
    if (!this.warned) {
      this.warned = true;
      console.error(`[logger] File logging disabled after error: ${(error as Error)?.message ?? error}`);
    }
    this.enabled = false;
    const stream = this.stream;
    this.stream = null;
    try {
      stream?.destroy();
    } catch {
      // Ignore teardown errors.
    }
    // Nothing more will be written; release any pending flush waiters.
    this.inflight = 0;
    this.resolveDrainWaiters();
  }

  private onWriteSettled(): void {
    this.inflight -= 1;
    if (this.inflight <= 0) {
      this.inflight = 0;
      this.resolveDrainWaiters();
    }
  }

  private resolveDrainWaiters(): void {
    if (this.drainWaiters.length === 0) return;
    const waiters = this.drainWaiters;
    this.drainWaiters = [];
    for (const resolve of waiters) resolve();
  }

  /**
   * Delete oldest files so at most `maxFiles` remain (`maxFiles <= 0` keeps
   * everything). The file currently being written is never removed. Deletions
   * that fail because a handle is still open are retried on the next call,
   * which the stream `close` handler triggers.
   */
  private enforceRetention(): void {
    if (this.maxFiles <= 0) return;
    const active = this.currentPath;
    const candidates = [...new Set([...this.listFiles(), ...this.opened])]
      .filter((path) => path !== active)
      .sort();
    // Reserve one slot for the file about to be created / the active file.
    const keep = Math.max(this.maxFiles - 1, 0);
    const excess = candidates.length - keep;
    for (let i = 0; i < excess; i += 1) {
      this.tryRemove(candidates[i]);
    }
  }

  private tryRemove(path: string): void {
    try {
      unlinkSync(path);
      this.opened = this.opened.filter((kept) => kept !== path);
    } catch {
      // Still referenced (Windows keeps the handle briefly after `end()`).
      // Leave it in `opened` so the next retention pass retries it.
    }
  }
}

export default RollingFileLogger;
