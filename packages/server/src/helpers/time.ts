/**
 * 统一时间戳工具。
 *
 * 项目内所有对外暴露（持久化到 JSON、写入目录名、返回给前端）的时间戳都遵循同一套约定：
 * - 时区统一为 UTC，避免同一时刻在不同机器/容器上产生不同字符串；
 * - 精度统一到毫秒，避免同一秒内的多次写入互相覆盖或无法排序；
 * - 落盘格式统一为 ISO 8601（`2026-11-05T04:46:15.123Z`），前端 `Date.parse()` 可直接解析。
 */

/** 统一使用的时区。 */
export const TIME_ZONE = 'UTC';

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

/**
 * ISO 8601 时间戳（UTC，毫秒精度），例如 `2026-11-05T04:46:15.123Z`。
 *
 * 与前端 `new Date().toISOString()` 的输出完全一致，服务端与前端写出的时间戳可以直接比较。
 */
export function toIsoTimestamp(date: Date = new Date()): string {
  return date.toISOString();
}

/**
 * 目录名用的紧凑时间戳（UTC，毫秒精度），例如 `2026-11-05-04-46-15-123`。
 *
 * 不使用 `:` 等 Windows 非法字符；保持字典序与时间序一致，便于按名称排序。
 */
export function toPathTimestamp(date: Date = new Date()): string {
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}-` +
    `${pad(date.getUTCHours())}-${pad(date.getUTCMinutes())}-${pad(date.getUTCSeconds())}-` +
    `${pad(date.getUTCMilliseconds(), 3)}`
  );
}
