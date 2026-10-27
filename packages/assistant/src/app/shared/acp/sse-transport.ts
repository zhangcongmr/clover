/**
 * Minimal SSE-over-`fetch` transport.
 *
 * 为什么不用 `EventSource`：
 * - 读不到 HTTP 状态码（无法区分 409 冲突 / 404 会话失效 / 网络故障）；
 * - 不能设置自定义 header（`X-Client-Id` / `X-Epoch` / `Last-Event-ID`）；
 * - 自动重连不可控，会和我们基于游标的续传状态机互相打架。
 *
 * 这里只做两件事：发请求、把 `text/event-stream` 解析成帧。
 * 重连策略、事件分发仍由各自的 service 负责。
 */

export interface SseFrame {
  /** 事件序号（服务端写入的 SSE `id:` 字段）。 */
  id?: string;
  /** 事件负载（多行 `data:` 已按规范用 `\n` 连接）。 */
  data: string;
}

/**
 * 发起 SSE 请求。
 *
 * 返回 `Response` 后由调用方先判断状态码，再决定是否消费 body——
 * 这正是 `EventSource` 做不到的事。
 */
export async function openSseRequest(
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
): Promise<Response> {
  return fetch(url, {
    method: 'GET',
    headers: init.headers,
    signal: init.signal,
    // SSE 必须拿到实时流，不能被浏览器缓存
    cache: 'no-store',
  });
}

/**
 * 逐帧解析 SSE 流。
 *
 * 兼容 `\r\n`、多行 `data:`、注释行（`: keep-alive`）与 `retry:` 字段。
 * 只产出带 `data`（或仅有 `id`）的帧；纯 `retry:`/注释不会产出。
 */
export async function* readSseFrames(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<SseFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const rawFrame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        const frame = parseFrame(rawFrame);
        if (frame) yield frame;
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // 流已结束/已取消，忽略
    }
  }
}

function parseFrame(raw: string): SseFrame | null {
  let id: string | undefined;
  const data: string[] = [];

  for (const line of raw.split('\n')) {
    if (!line || line.startsWith(':')) continue;

    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');

    if (field === 'id') {
      id = value;
    } else if (field === 'data') {
      data.push(value);
    }
    // `event:` / `retry:` 目前不需要：事件类型在 payload.type 里
  }

  if (id === undefined && data.length === 0) return null;
  return { id, data: data.join('\n') };
}
