import { randomUUID } from 'node:crypto';
import { logger } from '../helpers/logger.js';
import type { Response } from 'express';
import { getSharedEventSink } from '../events/in-process-event-sink.js';
import type { EventSink, SessionEvent } from '../events/event-sink.js';

export interface SseConnection {
  response: Response;
  sessionId: string;
  createdAt: number;
  lastHeartbeat: number;
  /**
   * 页面实例标识（前端每次页面加载生成一个）。
   *
   * 用于区分「同一个标签页的重连」（复用 epoch，静默换流）与「另一个标签页」
   * （单消费者模型下需要冲突或显式接管）。
   */
  clientId?: string;
  /** 所有权代次：被接管时递增，用于隔离旧标签页的迟到请求。 */
  epoch: number;
  /** 稳定连接标识（同一 clientId 重连保持不变）。 */
  connectionId: string;
  /** @internal 主动驱逐时立即释放订阅，不必等待 'close' 事件。 */
  dispose?: () => void;
}

/** `addConnection` 的可选参数。 */
export interface SseConnectionOptions {
  /**
   * 断点续传游标：只补发 `seq > lastEventId` 的事件。
   *
   * 来自 SSE 的 `Last-Event-ID` 头（`fetch` 客户端重连时自己带上）。
   * 缺省表示「不补发历史」，与改造前行为一致。
   */
  lastEventId?: number;
  /** 页面实例标识；缺省表示脚本/内部调用方（按旧语义处理）。 */
  clientId?: string;
  /**
   * 是否允许接管他人持有的会话。
   *
   * 默认 `false`：并发接入一律返回冲突（HTTP 409），必须显式声明接管意图。
   * 匿名调用方也一样——不再有「后连接静默覆盖先连接」的特例。
   */
  takeover?: boolean;
}

/** 接管成功后的所有权信息，供路由与后续请求校验。 */
export interface SseAttachResult {
  connectionId: string;
  clientId?: string;
  epoch: number;
  /** 同一 clientId 的静默重连（换掉了旧流，所有权未变）。 */
  resumed: boolean;
}

/** 兼容旧命名：写入 SSE 的事件信封与事件总线共用同一个契约。 */
export type ServerEvent = SessionEvent;

/**
 * 流已被另一个客户端持有。
 *
 * 路由层把它映射成 HTTP 409（`fetch` 客户端可读状态码）。
 */
export class StreamConflictError extends Error {
  readonly code = 'SUPERSEDED';

  constructor(readonly ownerClientId?: string) {
    super('Session stream is owned by another client');
    this.name = 'StreamConflictError';
  }
}

/**
 * 临时开关：单消费者校验。
 *
 * 目前**默认关闭** —— 同一 session 允许多条 SSE 连接并行接收事件（回到
 * 广播语义），`connections` 仍只记录最后一条，用于心跳 / `sendToConnection`。
 *
 * 恢复方式（二选一）：
 * - 启动时设置 `CLOVER_ENFORCE_SINGLE_CONSUMER=1`；
 * - 或把下面的默认值改成 `true`。
 *
 * TODO(ownership): 恢复默认开启后删除这个开关。
 */
const ENFORCE_SINGLE_CONSUMER = process.env.CLOVER_ENFORCE_SINGLE_CONSUMER === '1';

export class SseManager {
  private connections: Map<string, SseConnection> = new Map();
  private sink: EventSink;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(sink?: EventSink) {
    this.sink = sink || getSharedEventSink();
    this.startCleanupInterval();
  }

  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      // this.cleanup();
    }, 30000);
  }

  /**
   * 会话事件流接入。
   *
   * - 同一 `clientId` 重连 → 复用 connectionId/epoch，静默替换写流目标；
   * - 单消费者校验开启时：`takeover` 为 true 才驱逐旧连接接管，否则抛
   *   `StreamConflictError`（HTTP 409）；
   * - 单消费者校验关闭时（当前默认）：保留旧连接，多条流并行接收事件。
   */
  addConnection(
    sessionId: string,
    response: Response,
    options: SseConnectionOptions = {},
  ): SseAttachResult {
    const { lastEventId, clientId } = options;
    const takeover = options.takeover ?? false;

    const previous = this.connections.get(sessionId);
    const sameClient = !!previous && clientId !== undefined && previous.clientId === clientId;

    if (previous && sameClient) {
      // 同一页面重连：静默换掉写流目标（所有权与 epoch 均不变）。
      // 主动释放旧订阅，不等迟到的 'close'，避免出现一段双订阅窗口。
      previous.dispose?.();
      this.closeResponse(previous.response);
    } else if (previous && ENFORCE_SINGLE_CONSUMER) {
      if (!takeover) {
        throw new StreamConflictError(previous.clientId);
      }
      this.evict(sessionId, previous, 'superseded_by_another_client');
    }
    // 单消费者校验关闭时：不做任何仲裁，旧连接继续接收事件（广播语义）。

    const connection: SseConnection = {
      response,
      sessionId,
      createdAt: Date.now(),
      lastHeartbeat: Date.now(),
      clientId,
      connectionId: sameClient ? previous!.connectionId : randomUUID(),
      epoch: sameClient ? previous!.epoch : (previous?.epoch ?? 0) + 1,
    };

    this.applySseHeaders(response);

    // 初始事件：携带所有权信息，前端据此给后续请求加 epoch 栅栏。
    this.sendEvent(response, {
      type: 'connected',
      payload: {
        sessionId,
        clientId: connection.clientId,
        connectionId: connection.connectionId,
        epoch: connection.epoch,
        timestamp: Date.now(),
      },
      timestamp: Date.now(),
    }, sessionId);

    // 订阅会话事件流（编解码交由 EventSink 处理）。
    // 带游标时只补发缺口；ring 覆盖不到则发 `replay_gap`，由前端决定是否
    // 走一次完整的 session/load。
    const unsubscribe = this.sink.attach(
      sessionId,
      (event) => {
        this.sendEvent(response, event, sessionId);
      },
      lastEventId === undefined
        ? undefined
        : {
            afterSeq: lastEventId,
            onGap: (oldestRetainedSeq) => {
              logger.warn(
                `[SSE] Replay gap for ${sessionId}: requested after ${lastEventId}, oldest retained is ${oldestRetainedSeq}`,
              );
              this.sendEvent(response, {
                type: 'replay_gap',
                payload: { requestedAfter: lastEventId, oldestRetainedSeq },
                timestamp: Date.now(),
              }, sessionId);
            },
          },
    );

    this.connections.set(sessionId, connection);

    // 清理只作用于「自己」：重连时新连接可能已经覆盖了同 session 的记录，
    // 旧连接的迟到 close 不能把新连接一起删掉。
    let closed = false;
    const cleanup = (reason: 'close' | 'error', error?: unknown) => {
      if (closed) return;
      closed = true;
      if (reason === 'error') {
        logger.error(`[SSE] Response error for ${sessionId}:`, error);
      } else {
        logger.log(`[SSE] Client disconnected: ${sessionId}`);
      }
      unsubscribe();
      if (this.connections.get(sessionId) === connection) {
        this.connections.delete(sessionId);
      }
    };
    connection.dispose = () => cleanup('close');

    response.on('close', () => cleanup('close'));
    response.on('error', (error) => cleanup('error', error));

    logger.log(
      `[SSE] Client connected: ${sessionId} (client: ${clientId ?? 'anonymous'}, epoch: ${connection.epoch}, total: ${this.connections.size})`,
    );

    return {
      connectionId: connection.connectionId,
      clientId,
      epoch: connection.epoch,
      resumed: sameClient,
    };
  }

  private applySseHeaders(response: Response): void {
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    // 禁用 Express 的压缩，因为 SSE 需要流式传输
    response.setHeader('Content-Encoding', 'none');
    // CORS 由全局中间件统一处理（此处覆盖会与 allow-credentials 冲突）
  }

  /**
   * legacy `EventSource` 端点专用：用 SSE 事件表达冲突。
   *
   * 浏览器 `EventSource` 读不到 409，只能从流里拿到原因；新端点走
   * `StreamConflictError` → HTTP 409，不再需要这个分支。
   */
  /**
   * 显式释放流（`DELETE /api/acp/stream/:sessionId`）。
   *
   * 幂等：无人持有时返回 true。持有者是匿名的（脚本调用）时允许释放；
   * 有 `clientId` 时必须与 `epoch` 完全匹配，避免任何标签页都能踢人。
   */
  release(sessionId: string, clientId?: string, epoch?: number): boolean {
    const owner = this.connections.get(sessionId);
    if (!owner) return true;

    if (owner.clientId !== undefined && (owner.clientId !== clientId || owner.epoch !== epoch)) {
      return false;
    }

    if (this.connections.get(sessionId) === owner) {
      this.connections.delete(sessionId);
    }
    owner.dispose?.();
    this.closeResponse(owner.response);
    logger.log(`[SSE] Released stream: ${sessionId}`);
    return true;
  }

  /** 驱逐当前持有者：先告知原因，再释放订阅并关闭流。 */
  private evict(sessionId: string, connection: SseConnection, reason: string): void {
    this.sendEvent(connection.response, {
      type: 'session_superseded',
      payload: { reason },
      timestamp: Date.now(),
    }, sessionId);

    if (this.connections.get(sessionId) === connection) {
      this.connections.delete(sessionId);
    }
    // 立即退订，不等 'close'（旧连接的 close 可能迟到，期间不应再收事件）。
    connection.dispose?.();

    logger.log(`[SSE] Evicted connection: ${sessionId} (${reason})`);
    this.closeResponse(connection.response);
  }

  /**
   * 请求方的所有权校验（epoch 栅栏）。
   *
   * 宽容策略：
   * - 没有活跃持有者 → 放行（脚本、A2A 等无界面调用）；
   * - 调用方未携带 clientId/epoch → 放行（脚本调用保持可用）；
   * - 否则必须与当前持有者完全一致。
   */
  isOwner(sessionId: string, clientId?: string, epoch?: number): boolean {
    const owner = this.connections.get(sessionId);
    if (!owner) return true;
    if (!clientId || epoch === undefined) return true;
    return owner.clientId === clientId && owner.epoch === epoch;
  }

  getOwner(sessionId: string): SseConnection | undefined {
    return this.connections.get(sessionId);
  }


  private sendEvent(response: Response, event: ServerEvent, sessionId?: string): void {
    try {
      if (!response.writableEnded && !response.destroyed) {
        // 带 seq 时写入 SSE `id:`：浏览器重连会自动带上 `Last-Event-ID`，
        // 为断线续传（EventSink 的 ring）提供游标。
        const id = typeof event.seq === 'number' ? `id: ${event.seq}\n` : '';
        response.write(`${id}data: ${JSON.stringify(event)}\n\n`);
      }
    } catch (error) {
      logger.error(`[SSE] Failed to send event (session: ${sessionId ?? 'unknown'}):`, error);
    }
  }

  sendHeartbeat(sessionId: string): void {
    const connection = this.connections.get(sessionId);
    if (connection) {
      connection.lastHeartbeat = Date.now();
      this.sendEvent(connection.response, {
        type: 'heartbeat',
        payload: { timestamp: Date.now() },
        timestamp: Date.now(),
      }, sessionId);
    }
  }

  /**
   * Write an event directly to a session's SSE connection (bypasses the event sink).
   */
  sendToConnection(sessionId: string, event: ServerEvent): void {
    const connection = this.connections.get(sessionId);
    if (connection) {
      this.sendEvent(connection.response, event, sessionId);
    }
  }

  broadcastHeartbeat(): void {
    for (const [sessionId] of this.connections) {
      this.sendHeartbeat(sessionId);
    }
  }

  private closeConnection(connection: SseConnection): void {
    this.closeResponse(connection.response);
  }

  private closeResponse(response: Response): void {
    try {
      if (!response.writableEnded) {
        response.end();
      }
    } catch (error) {
      // 忽略关闭错误
    }
  }

  private cleanup(): void {
    const now = Date.now();
    const maxIdleTime = 5 * 60 * 1000; // 5 分钟

    for (const [sessionId, connection] of this.connections) {
      // 检查响应是否已关闭
      if (connection.response.writableEnded || connection.response.destroyed) {
        logger.log(`[SSE] Cleaning up closed connection: ${sessionId}`);
        this.connections.delete(sessionId);
        continue;
      }

      // 检查空闲时间
      if (now - connection.lastHeartbeat > maxIdleTime) {
        logger.log(`[SSE] Cleaning up idle connection: ${sessionId}`);
        this.closeConnection(connection);
        this.connections.delete(sessionId);
      }
    }
  }

  getConnection(sessionId: string): SseConnection | undefined {
    return this.connections.get(sessionId);
  }

  getConnectionCount(): number {
    return this.connections.size;
  }

  hasConnection(sessionId: string): boolean {
    const connection = this.connections.get(sessionId);
    return connection !== undefined && 
           !connection.response.writableEnded && 
           !connection.response.destroyed;
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    for (const [, connection] of this.connections) {
      this.closeConnection(connection);
    }
    this.connections.clear();
  }
}

export default SseManager;
