import { logger } from '../helpers/logger.js';
import type { AttachOptions, EventSink, SessionEvent } from './event-sink.js';

interface SessionStream {
  handlers: Set<(event: SessionEvent) => void>;
  /** 最近 `ringSize` 条事件（带 `seq`），用于断线续传。 */
  ring: SessionEvent[];
  /** 会话内单调序号，由本 sink 赋值。 */
  seq: number;
  /** 最后一个订阅者离开的时间；null 表示当前仍有订阅者。 */
  idleSince: number | null;
}

export interface InProcessEventSinkOptions {
  /** 每个会话保留的事件条数（续传窗口）。默认 500。 */
  ringSize?: number;
  /** 无订阅者后保留会话流多久（毫秒）。默认 5 分钟。 */
  idleTtlMs?: number;
  /** 扫描空闲会话的间隔（毫秒）。默认 60 秒。 */
  sweepIntervalMs?: number;
}

/**
 * 进程内事件汇聚实现（无外部依赖）。
 *
 * 设计要点：
 * - 零序列化、零 RTT：`append` 直接同步扇出给本地订阅者；
 * - 为每个会话维护 `seq` 与 ring buffer：支持 `Last-Event-ID` 式续传
 *   （`attach(sessionId, handler, { afterSeq })`）；
 * - **仅单进程有效**：多实例部署需要换成共享日志（Redis Streams）或
 *   Streamable HTTP。
 *
 * 语义与改造前的内存回退模式一致：`attach` 默认只接收后续事件，不重放历史；
 * 只有显式传入 `afterSeq` 才补发 ring 内的历史。
 */
export class InProcessEventSink implements EventSink {
  private readonly streams = new Map<string, SessionStream>();
  private readonly ringSize: number;
  private readonly idleTtlMs: number;
  private readonly sweeper: ReturnType<typeof setInterval> | null = null;

  constructor(options: InProcessEventSinkOptions = {}) {
    this.ringSize = Math.max(1, options.ringSize ?? 500);
    this.idleTtlMs = Math.max(0, options.idleTtlMs ?? 5 * 60_000);

    const sweepIntervalMs = Math.max(1000, options.sweepIntervalMs ?? 60_000);
    this.sweeper = setInterval(() => this.sweep(), sweepIntervalMs);
    // 不阻止进程退出（库代码不应持有事件循环）
    this.sweeper.unref?.();
  }

  async append(sessionId: string, event: SessionEvent): Promise<void> {
    const stream = this.getOrCreate(sessionId);
    const stamped: SessionEvent = { ...event, seq: ++stream.seq };

    stream.ring.push(stamped);
    if (stream.ring.length > this.ringSize) {
      stream.ring.shift();
    }

    // 无订阅者时以「最后一次活动」为起点计时，避免只由 append 创建的会话流
    // （例如 A2A 直连 prompt、没有 SSE 观看者）永远不被清理。
    if (stream.handlers.size === 0) {
      stream.idleSince = Date.now();
    }

    // 同步扇出：同一会话的事件严格按 append 顺序到达每个订阅者。
    for (const handler of stream.handlers) {
      try {
        handler(stamped);
      } catch (error) {
        // 单个订阅者异常不能影响其它订阅者，也不能让发布方失败。
        logger.error(`[EventSink] Subscriber error (session: ${sessionId}):`, error);
      }
    }
  }

  attach(
    sessionId: string,
    handler: (event: SessionEvent) => void,
    options?: AttachOptions,
  ): () => void {
    const stream = this.getOrCreate(sessionId);
    stream.handlers.add(handler);
    stream.idleSince = null;

    if (options?.afterSeq !== undefined) {
      this.replay(stream, sessionId, handler, options.afterSeq, options.onGap);
    }

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      stream.handlers.delete(handler);
      if (stream.handlers.size === 0) {
        stream.idleSince = Date.now();
      }
    };
  }

  /** 会话当前的最新序号（无记录时为 0）。 */
  lastSeq(sessionId: string): number {
    return this.streams.get(sessionId)?.seq ?? 0;
  }

  /** 当前订阅者数量（诊断用）。 */
  subscriberCount(sessionId: string): number {
    return this.streams.get(sessionId)?.handlers.size ?? 0;
  }

  /** 停止后台清理并丢弃全部状态（测试/优雅关闭用）。 */
  dispose(): void {
    if (this.sweeper) {
      clearInterval(this.sweeper);
    }
    this.streams.clear();
  }

  private getOrCreate(sessionId: string): SessionStream {
    let stream = this.streams.get(sessionId);
    if (!stream) {
      stream = { handlers: new Set(), ring: [], seq: 0, idleSince: null };
      this.streams.set(sessionId, stream);
    }
    return stream;
  }

  private replay(
    stream: SessionStream,
    sessionId: string,
    handler: (event: SessionEvent) => void,
    afterSeq: number,
    onGap?: (missedFrom: number) => void,
  ): void {
    const oldest = stream.ring[0]?.seq;
    const newest = stream.seq;

    // 两种空洞：游标超前（会话流被清理/进程重启后 seq 归零），或 ring 已被
    // 覆盖。都不可恢复，交由上层决定是否要求客户端重新 session/load。
    let gapFrom: number | null = null;
    if (afterSeq > newest) {
      gapFrom = newest;
    } else if (oldest !== undefined && oldest > afterSeq + 1) {
      gapFrom = oldest;
    }

    if (gapFrom !== null) {
      try {
        onGap?.(gapFrom);
      } catch (error) {
        logger.error(`[EventSink] onGap callback error (session: ${sessionId}):`, error);
      }
      logger.warn(
        `[EventSink] Replay gap (session: ${sessionId}): requested after ${afterSeq}, ` +
          `retained window is ${oldest ?? '-'}..${newest}`,
      );
    }

    for (const event of stream.ring) {
      if ((event.seq ?? 0) <= afterSeq) continue;
      try {
        handler(event);
      } catch (error) {
        logger.error(`[EventSink] Subscriber error during replay (session: ${sessionId}):`, error);
      }
    }
  }

  private sweep(): void {
    if (!this.idleTtlMs) return;
    const now = Date.now();
    for (const [sessionId, stream] of this.streams) {
      if (stream.handlers.size > 0) continue;
      if (stream.idleSince !== null && now - stream.idleSince >= this.idleTtlMs) {
        this.streams.delete(sessionId);
      }
    }
  }
}

export default InProcessEventSink;

/**
 * 进程级共享实例。
 *
 * 事件总线必须是**同一个对象**：发布方（`SseAcpClient`）与订阅方
 * （`SseManager` / `promptAndWait`）各自 `new` 一个就会互相收不到消息。
 * 所有可选注入点默认取这个单例，避免漏注入导致事件静默丢失。
 */
let sharedInstance: InProcessEventSink | null = null;

export function getSharedEventSink(): InProcessEventSink {
  if (!sharedInstance) {
    sharedInstance = new InProcessEventSink();
  }
  return sharedInstance;
}

