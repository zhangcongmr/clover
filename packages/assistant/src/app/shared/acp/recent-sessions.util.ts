/**
 * Shared definitions for the welcome screen's "Recent" list.
 *
 * The list is derived from the persisted project/task records (`projects.json`
 * / `tasks.json`) plus a local "last opened" map, because opening a session
 * does not refresh its persisted `updatedAt`. Set is written by the components
 * that actually open a session, and read by the welcome screen.
 */

/** localStorage key: `{ [sessionId]: epochMillis }`. */
export const RECENT_OPENED_STORAGE_KEY = 'clover_recent_opened_sessions';

/** How many entries the welcome screen shows. */
export const RECENT_SESSION_LIMIT = 6;

/** Cap of the persisted map so it cannot grow without bound. */
const RECENT_OPENED_MAX_ENTRIES = 50;

export type RecentSessionKind = 'task' | 'project';

/** One row of the welcome screen's recent list. */
export interface RecentSessionEntry {
  sessionId: string;
  title: string;
  kind: RecentSessionKind;
  /** Owning task/project display name, rendered as the row's meta text. */
  containerName: string;
  /** Working directory the session belongs to (resolved into `cwd` on open). */
  cwd: string;
  agentId?: string;
  /** Task id — required when `kind === 'task'`. */
  taskId?: string;
  /** Last locally recorded open (epoch millis, `0` when never opened locally). */
  openedAt: number;
  /** Persisted record timestamp (epoch millis, `0` when unknown). */
  updatedAt: number;
}

/** Reads the local session-id → last-opened map, tolerating SSR and corrupt data. */
export function readRecentOpenedSessions(): Record<string, number> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(RECENT_OPENED_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    const result: Record<string, number> = {};
    for (const [sessionId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (sessionId && typeof value === 'number' && Number.isFinite(value)) {
        result[sessionId] = value;
      }
    }
    return result;
  } catch {
    return {};
  }
}

/** Marks a session as just opened, pruning the oldest entries. */
export function recordRecentOpenedSession(sessionId: string): void {
  if (!sessionId || typeof localStorage === 'undefined') return;
  try {
    const map = readRecentOpenedSessions();
    map[sessionId] = Date.now();
    const trimmed = Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, RECENT_OPENED_MAX_ENTRIES);
    localStorage.setItem(RECENT_OPENED_STORAGE_KEY, JSON.stringify(Object.fromEntries(trimmed)));
  } catch {
    // ignore quota/serialization failures — the list just stays stale
  }
}
