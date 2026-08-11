import { v4 as uuidv4 } from 'uuid';
import { SseAcpClient } from './sse-client.js';
import { RedisClient } from '../redis/client.js';
import type { SseAcpClientConfig } from './sse-client.js';

export interface AcpSession {
  sessionId: string;
  client: SseAcpClient;
  config: SseAcpClientConfig;
  createdAt: number;
  lastActivity: number;
  status: 'active' | 'idle' | 'disconnected';
}

export interface SessionCreateOptions {
  cwd?: string;
  agentCommand?: string;
  agentArgs?: string[];
  userId?: string;
}

export interface SessionMessage {
  type: string;
  sessionId: string;
  payload?: any;
  requestId?: string;
  timestamp: number;
}

export class AcpSessionManager {
  private sessions: Map<string, AcpSession> = new Map();
  private redis: RedisClient;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private publishCallbacks: Map<string, (event: any) => void> = new Map();

  constructor(redis?: RedisClient) {
    this.redis = redis || RedisClient.getInstance();
    this.startCleanupInterval();
  }

  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredSessions();
    }, 60000);
  }

  async createSession(options: SessionCreateOptions = {}): Promise<string> {
    const sessionId = uuidv4();
    const defaultCwd = options.cwd || process.cwd();

    const config: SseAcpClientConfig = {
      defaultCwd,
      agentCommand: options.agentCommand,
      agentArgs: options.agentArgs,
    };

    // 创建 ACP 客户端
    const client = new SseAcpClient(sessionId, config, this.redis);

    // 订阅 Redis 频道接收客户端消息
    this.setupRedisSubscriptions(sessionId, client);

    // 存储会话
    const session: AcpSession = {
      sessionId,
      client,
      config,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      status: 'active',
    };
    this.sessions.set(sessionId, session);

    console.log(`[ACP Session] Created session: ${sessionId} (total: ${this.sessions.size})`);

    return sessionId;
  }

  private setupRedisSubscriptions(sessionId: string, client: SseAcpClient): void {
    // 订阅 prompt 请求
    this.redis.subscribe(`acp:prompt:${sessionId}`, async (message) => {
      try {
        const msg: SessionMessage = JSON.parse(message);
        await this.handleClientMessage(sessionId, msg, client);
      } catch (error) {
        console.error(`[ACP Session] Error handling prompt message:`, error);
        await this.publishEvent(sessionId, {
          type: 'error',
          payload: { message: (error as Error).message },
          timestamp: Date.now(),
        });
      }
    });

    // 订阅权限响应
    this.redis.subscribe(`acp:permission:${sessionId}`, async (message) => {
      try {
        const msg: SessionMessage = JSON.parse(message);
        await this.handlePermissionResponse(sessionId, msg, client);
      } catch (error) {
        console.error(`[ACP Session] Error handling permission message:`, error);
      }
    });
  }

  private async handleClientMessage(
    sessionId: string,
    msg: SessionMessage,
    client: SseAcpClient
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.lastActivity = Date.now();

    switch (msg.type) {
      case 'prompt':
        await this.handlePrompt(sessionId, msg, client);
        break;
      case 'cancel':
        await this.handleCancel(sessionId, client);
        break;
    }
  }

  private async handlePrompt(
    sessionId: string,
    msg: SessionMessage,
    client: SseAcpClient
  ): Promise<void> {
    try {
      // 发布处理中状态
      await this.publishEvent(sessionId, {
        type: 'prompt_processing',
        payload: { requestId: msg.requestId },
        timestamp: Date.now(),
      });

      // 调用客户端处理 prompt
      const result = await client.handlePrompt(msg.payload.content);

      // 发布完成事件
      await this.publishEvent(sessionId, {
        type: 'prompt_complete',
        payload: result,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error(`[ACP Session] Prompt error:`, error);
      await this.publishEvent(sessionId, {
        type: 'error',
        payload: { message: (error as Error).message, requestId: msg.requestId },
        timestamp: Date.now(),
      });
    }
  }

  private async handleCancel(
    sessionId: string,
    client: SseAcpClient
  ): Promise<void> {
    try {
      await client.handleCancel();
      await this.publishEvent(sessionId, {
        type: 'cancel_complete',
        payload: {},
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error(`[ACP Session] Cancel error:`, error);
    }
  }

  private async handlePermissionResponse(
    sessionId: string,
    msg: SessionMessage,
    client: SseAcpClient
  ): Promise<void> {
    try {
      await client.handlePermissionResponse(msg.requestId!, msg.payload.outcome);
    } catch (error) {
      console.error(`[ACP Session] Permission response error:`, error);
    }
  }

  async publishEvent(sessionId: string, event: any): Promise<void> {
    const channel = `acp:events:${sessionId}`;
    await this.redis.publish(channel, JSON.stringify(event));
  }

  async connectSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    try {
      // 连接到 agent
      await session.client.connect({
        command: session.config.agentCommand || 'opencode',
        args: session.config.agentArgs || ['acp'],
        cwd: session.config.defaultCwd,
      });

      session.status = 'active';
      session.lastActivity = Date.now();

      // 发布连接成功事件
      await this.publishEvent(sessionId, {
        type: 'connected',
        payload: { sessionId },
        timestamp: Date.now(),
      });

      console.log(`[ACP Session] Session connected: ${sessionId}`);
    } catch (error) {
      console.error(`[ACP Session] Connect error:`, error);
      await this.publishEvent(sessionId, {
        type: 'error',
        payload: { message: (error as Error).message },
        timestamp: Date.now(),
      });
      throw error;
    }
  }

  async createAcpSession(sessionId: string, cwd?: string): Promise<any> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    try {
      const result = await session.client.handleNewSession({ cwd });
      session.lastActivity = Date.now();

      await this.publishEvent(sessionId, {
        type: 'session_created',
        payload: result,
        timestamp: Date.now(),
      });

      return result;
    } catch (error) {
      console.error(`[ACP Session] Create session error:`, error);
      throw error;
    }
  }

  async listAcpSessions(sessionId: string, cwd?: string, cursor?: string): Promise<any> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    try {
      const result = await session.client.handleListSessions({ cwd, cursor });
      session.lastActivity = Date.now();
      return result;
    } catch (error) {
      console.error(`[ACP Session] List sessions error:`, error);
      throw error;
    }
  }

  async loadAcpSession(sessionId: string, loadSessionId: string, cwd?: string): Promise<any> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    try {
      const result = await session.client.handleLoadSession({ sessionId: loadSessionId, cwd });
      session.lastActivity = Date.now();
      return result;
    } catch (error) {
      console.error(`[ACP Session] Load session error:`, error);
      throw error;
    }
  }

  async resumeAcpSession(sessionId: string, resumeSessionId: string, cwd?: string): Promise<any> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    try {
      const result = await session.client.handleResumeSession({ sessionId: resumeSessionId, cwd });
      session.lastActivity = Date.now();
      return result;
    } catch (error) {
      console.error(`[ACP Session] Resume session error:`, error);
      throw error;
    }
  }

  async deleteAcpSession(sessionId: string, deleteSessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    try {
      await session.client.handleDeleteSession({ sessionId: deleteSessionId });
      session.lastActivity = Date.now();
    } catch (error) {
      console.error(`[ACP Session] Delete session error:`, error);
      throw error;
    }
  }

  async setAcpConfigOption(
    sessionId: string,
    configId: string,
    type: 'id' | 'boolean',
    value: string | boolean
  ): Promise<any> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    try {
      const result = await session.client.handleSetConfigOption({ sessionId, configId, type, value });
      session.lastActivity = Date.now();
      return result;
    } catch (error) {
      console.error(`[ACP Session] Set config option error:`, error);
      throw error;
    }
  }

  getSession(sessionId: string): AcpSession | undefined {
    return this.sessions.get(sessionId);
  }

  getSessionCount(): number {
    return this.sessions.size;
  }

  getActiveSessionCount(): number {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.status === 'active') count++;
    }
    return count;
  }

  async removeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      try {
        session.client.disconnect();
      } catch (error) {
        // 忽略断开连接错误
      }
      this.sessions.delete(sessionId);
      console.log(`[ACP Session] Removed session: ${sessionId}`);
    }
  }

  private cleanupExpiredSessions(): void {
    const now = Date.now();
    const maxIdleTime = 30 * 60 * 1000; // 30 分钟
    const maxAge = 60 * 60 * 1000; // 1 小时

    for (const [sessionId, session] of this.sessions) {
      const idleTime = now - session.lastActivity;
      const age = now - session.createdAt;

      if (idleTime > maxIdleTime || age > maxAge) {
        console.log(`[ACP Session] Cleaning up expired session: ${sessionId} (idle: ${idleTime}ms, age: ${age}ms)`);
        this.removeSession(sessionId);
      }
    }
  }

  async disconnectAll(): Promise<void> {
    for (const [sessionId] of this.sessions) {
      await this.removeSession(sessionId);
    }
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    for (const [, session] of this.sessions) {
      try {
        session.client.disconnect();
      } catch (error) {
        // 忽略错误
      }
    }
    this.sessions.clear();
  }
}

export default AcpSessionManager;
