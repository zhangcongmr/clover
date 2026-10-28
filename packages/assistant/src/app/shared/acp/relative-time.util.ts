const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Date-ish value accepted by {@link formatRelativeTime}. */
export type TimeInput = string | number | Date | null | undefined;

/**
 * Formats a timestamp as a compact relative label (`just now`, `12m`, `3h`,
 * `5d`) and falls back to a short absolute date for anything older than a
 * month. Returns an empty string for missing/invalid input.
 */
export function formatRelativeTime(value: TimeInput): string {
  if (value === null || value === undefined || value === '') return '';

  const time = value instanceof Date
    ? value.getTime()
    : typeof value === 'number'
      ? value
      : Date.parse(value);
  if (!Number.isFinite(time)) return '';

  const diffMs = Date.now() - time;
  if (diffMs < MINUTE_MS) return 'just now';

  const diffMin = Math.floor(diffMs / MINUTE_MS);
  if (diffMin < 60) return `${diffMin}m`;

  const diffHr = Math.floor(diffMs / HOUR_MS);
  if (diffHr < 24) return `${diffHr}h`;

  const diffDay = Math.floor(diffMs / DAY_MS);
  if (diffDay < 30) return `${diffDay}d`;

  const date = new Date(time);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString('en-US', sameYear
    ? { month: 'short', day: 'numeric' }
    : { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Converts an ISO string / epoch millis / Date to epoch millis (`0` when unknown). */
export function toTimestamp(value: TimeInput): number {
  if (value === null || value === undefined || value === '') return 0;
  const time = value instanceof Date
    ? value.getTime()
    : typeof value === 'number'
      ? value
      : Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}
