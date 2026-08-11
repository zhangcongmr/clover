import type { Response } from 'express';
import { RedisClient } from '../redis/client.js';

export interface SseConnection {
  response: Response;
  sessionId: string;
  userId?: string;
  createdAt: number;
  lastHeartbeat: number;
}

export interface ServerEvent {
  type: string;
  payload: any;
  timestamp: number;
}

export class SseManager {
  private connections: Map<string, SseConnection> = new Map();
  private redis: RedisClient;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(redis?: RedisClient) {
    this.redis = redis || RedisClient.getInstance();
    this.startCleanupInterval();
  }

  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 30000);
  }

  addConnection(sessionId: string, response: Response, userId?: string): void {
    // 如果已存在连接，先关闭旧连接
    const existingConnection = this.connections.get(sessionId);
    if (existingConnection) {
      this.closeConnection(existingConnection);
    }

    // 设置 SSE 响应头
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', 'Cache-Control');
    response.setHeader('Access-Control-Allow-Credentials', 'true');

    // 禁用 Express 的压缩，因为 SSE 需要流式传输
    response.setHeader('Content-Encoding', 'none');

    // 发送初始连接成功事件
    this.sendEvent(response, {
      type: 'connected',
      payload: { sessionId, timestamp: Date.now() },
      timestamp: Date.now(),
    });

    // 订阅 Redis 频道
    const channel = `acp:events:${sessionId}`;
    const unsubscribe = this.redis.subscribe(channel, (message) => {
      try {
        const event: ServerEvent = JSON.parse(message);
        this.sendEvent(response, event);
      } catch (error) {
        console.error(`[SSE] Failed to parse Redis message:`, error);
      }
    });

    // 存储连接
    const connection: SseConnection = {
      response,
      sessionId,
      userId,
      createdAt: Date.now(),
      lastHeartbeat: Date.now(),
    };
    this.connections.set(sessionId, connection);

    // 处理连接关闭
    response.on('close', () => {
      console.log(`[SSE] Client disconnected: ${sessionId}`);
      unsubscribe();
      this.connections.delete(sessionId);
    });

    // 处理错误
    response.on('error', (error) => {
      console.error(`[SSE] Response error for ${sessionId}:`, error);
      unsubscribe();
      this.connections.delete(sessionId);
    });

    console.log(`[SSE] Client connected: ${sessionId} (total: ${this.connections.size})`);
  }

  private sendEvent(response: Response, event: ServerEvent): void {
    try {
      if (!response.writableEnded && !response.destroyed) {
        response.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } catch (error) {
      console.error('[SSE] Failed to send event:', error);
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
      });
    }
  }

  broadcastHeartbeat(): void {
    for (const [sessionId] of this.connections) {
      this.sendHeartbeat(sessionId);
    }
  }

  private closeConnection(connection: SseConnection): void {
    try {
      if (!connection.response.writableEnded) {
        connection.response.end();
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
        console.log(`[SSE] Cleaning up closed connection: ${sessionId}`);
        this.connections.delete(sessionId);
        continue;
      }

      // 检查空闲时间
      if (now - connection.lastHeartbeat > maxIdleTime) {
        console.log(`[SSE] Cleaning up idle connection: ${sessionId}`);
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
