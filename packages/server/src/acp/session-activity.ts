import { logger } from '../helpers/logger.js';

/**
 * 会话「处理中」状态的 client 级广播。
 *
 * 为什么需要单独一条通道：会话事件流是**按 session 建流**的
 * （`SseManager` 的 key 就是 sessionId，`EventSink.append(sessionId, …)`），
 * 而前端同一时刻只订阅一个会话（`beginConnect` 会 abort 上一条流）。用户从 A
 * 切到 B 之后，A 的 `prompt_complete` 再也没有通道能到达页面 —— 侧边栏里 A
 * 那一行就会一直转下去，直到重新打开 A。
 *
 * 这一层把 prompt 生命周期从「按会话」提升到「按客户端」：所有会话的开始/
 * 结束都扇出到一条全局流（`GET /api/acp/sessions/events`），前端订阅一次就
 * 能掌握全部会话的状态，无需为每个后台会话保持一条 SSE 连接。
 *
 * 只广播**状态迁移**（开始/结束），不携带会话内容，因此不存在多标签页之间
 * 的事件重复消费问题：收到事件的一方只是校正本地标记，不会触发任何执行。
 */
export interface SessionActivityEvent {
  type: 'session_processing_changed';
  payload: {
    /** ACP session id。 */
    sessionId: string;
    /** true = 本轮 prompt 正在跑；false = 已结束（完成 / 失败 / 取消）。 */
    processing: boolean;
  };
  timestamp: number;
}

export type SessionActivityListener = (event: SessionActivityEvent) => void;

export class SessionActivityHub {
  private readonly listeners = new Set<SessionActivityListener>();

  /**
   * 广播一次状态迁移。
   *
   * 单个订阅者抛错不能影响其它订阅者，也不能让发布方（prompt 链路）失败。
   */
  publish(sessionId: string, processing: boolean): void {
    if (!sessionId) return;

    const event: SessionActivityEvent = {
      type: 'session_processing_changed',
      payload: { sessionId, processing },
      timestamp: Date.now(),
    };

    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        logger.error(`[SessionActivity] Subscriber error (session: ${sessionId}):`, error);
      }
    }
  }

  /** @returns 取消订阅函数 */
  subscribe(listener: SessionActivityListener): () => void {
    this.listeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.listeners.delete(listener);
    };
  }

  /** 当前订阅者数量（诊断用）。 */
  get listenerCount(): number {
    return this.listeners.size;
  }
}

/**
 * 进程级共享实例。
 *
 * 发布方（`AcpSessionManager.publishEvent`）与订阅方（`/api/acp/sessions/events`
 * 路由）必须拿到同一个对象，否则事件会静默丢失。
 */
let sharedInstance: SessionActivityHub | null = null;

export function getSharedSessionActivity(): SessionActivityHub {
  if (!sharedInstance) {
    sharedInstance = new SessionActivityHub();
  }
  return sharedInstance;
}
