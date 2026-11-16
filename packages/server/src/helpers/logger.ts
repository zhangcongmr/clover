import { format } from 'node:util';
import { RollingFileLogger, type FileLoggingOptions } from './log-file.js';

export { RollingFileLogger };
export type { FileLoggingOptions };

/**
 * Lightweight timestamped logger.
 *
 * Every line routed through this logger is prefixed with a local-time
 * timestamp and an uppercased level keyword, e.g.
 *
 *   [2026-10-16 14:03:27.482] INFO  [AgentRegistry] Warming up 6 agents in parallel...
 *
 * Output goes to the console and, by default, is also persisted to rotating
 * files under `~/.clover/logs` (see {@link RollingFileLogger}). It keeps the
 * same variadic signature as `console.*` so it stays a drop-in replacement
 * (`logger.error('msg', err)`), preserving structured argument inspection.
 */

export type LogArgs = unknown[];

/** Uppercased level keyword printed in each log line. */
export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

/**
 * Console 输出通道。
 *
 * 'stdout'（默认）保持既有行为：log/info 走 stdout，warn/error 走 stderr。
 * 'stderr' 把所有级别都挪到 stderr —— CLI 用 stdout 承载 agent 的输出
 * （`clover run --json` 还要输出 NDJSON），库日志混进去会破坏可解析性。
 */
export type LoggerConsoleTarget = 'stdout' | 'stderr';

let consoleTarget: LoggerConsoleTarget = 'stdout';

/**
 * 切换库日志的 console 通道。
 *
 * 服务端保持默认的 stdout；CLI 切成 stderr，让 stdout 只剩命令自己的输出。
 */
export function setLoggerConsoleTarget(target: LoggerConsoleTarget): void {
  consoleTarget = target;
}

/** 当前库日志的 console 通道。 */
export function getLoggerConsoleTarget(): LoggerConsoleTarget {
  return consoleTarget;
}

export interface Logger {
  /** Informational message (maps to `console.log`). */
  log: (...args: LogArgs) => void;
  /** Informational message (maps to `console.info`). */
  info: (...args: LogArgs) => void;
  /** Warning message (maps to `console.warn`). */
  warn: (...args: LogArgs) => void;
  /** Error message (maps to `console.error`). */
  error: (...args: LogArgs) => void;
  /** Debug message (maps to `console.debug`). */
  debug: (...args: LogArgs) => void;
}

/** Shared on-disk sink (lazily opens its first file on the first write). */
const fileLogger = new RollingFileLogger();

/** Reconfigure on-disk logging at runtime (dir, size limit, retention, …). */
export function configureFileLogging(options: FileLoggingOptions): void {
  fileLogger.configure(options);
}

/** Resolve once all queued log lines have been written to disk. */
export function flushLogs(): Promise<void> {
  return fileLogger.flush();
}

/** Flush and close the active log file (call on graceful shutdown). */
export function closeLogs(): Promise<void> {
  return fileLogger.close();
}

/** Directory currently receiving log files. */
export function logDirectory(): string {
  return fileLogger.directory;
}

/** Path of the file currently being appended to (null before the first write). */
export function currentLogFile(): string | null {
  return fileLogger.currentFile;
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0');
}

/**
 * Format a date as `YYYY-MM-DD HH:mm:ss.SSS` in local time.
 */
export function formatLogTimestamp(date: Date = new Date()): string {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.` +
    `${pad(date.getMilliseconds(), 3)}`
  );
}

function withPrefix(level: LogLevel, args: LogArgs): LogArgs {
  return [`[${formatLogTimestamp()}] ${level.padEnd(5)}`, ...args];
}

function emit(sink: (...args: unknown[]) => void, level: LogLevel, args: LogArgs): void {
  const prefixed = withPrefix(level, args);
  sink(...prefixed);
  fileLogger.write(`${format(...prefixed)}\n`);
}

export const logger: Logger = {
  log: (...args) => emit(consoleTarget === 'stderr' ? console.warn : console.log, 'INFO', args),
  info: (...args) => emit(consoleTarget === 'stderr' ? console.warn : console.info, 'INFO', args),
  warn: (...args) => emit(console.warn, 'WARN', args),
  error: (...args) => emit(console.error, 'ERROR', args),
  debug: (...args) => emit(consoleTarget === 'stderr' ? console.warn : console.debug, 'DEBUG', args),
};

export default logger;
