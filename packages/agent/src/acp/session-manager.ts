import { logger } from '../helpers/logger.js';
import { SseAcpClient } from './sse-client.js';
import { RedisClient } from '../redis/client.js';
import type { AgentRegistry } from './agent-registry.js';
import type { SseAcpClientConfig } from './sse-client.js';
import type * as acp from '@agentclientprotocol/sdk';

export interface AcpSession {
  /** ACP session id (agent-generated) — the only session identifier in use. */
  sessionId: string;
  client: SseAcpClient;
  /** Agent command/args/env this session belongs to (resolved via registry by agentId). */
  config: SseAcpClientConfig;
  /** Working directory of the current agent session. */
  cwd: string | null;
  createdAt: number;
  lastActivity: number;
  status: 'active' | 'idle' | 'disconnected';
  /** Whether the connection-state listener is registered on `client`. */
  callbacksBound?: boolean;
  /** Teardown function for the listener registered on `client`. */
  detachFns?: Array<() => void>;
  /** Redis channel unsubscribers for this session. */
  redisUnsubs?: Array<() => void>;
}

export interface SessionMessage {
  type: string;
  sessionId: string;
  payload?: any;
  requestId?: string;
  timestamp: number;
}

/** Event published to `acp:events:{acpSessionId}` (may omit `sessionId`). */
export interface AcpSessionEvent {
  type: string;
  sessionId?: string;
  payload?: any;
  requestId?: string;
  timestamp?: number;
}

export interface SessionOperationOptions {
  /** Public agent id used to resolve the agent command/args/env via registry. */
  agentId?: string;
  cwd?: string;
  mcpServers?: acp.McpServer[];
}

export class AcpSessionManager {
  /** ACP session id -> session record. */
  private sessions: Map<string, AcpSession> = new Map();
  private redis: RedisClient;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private publishCallbacks: Map<string, (event: any) => void> = new Map();

  constructor(
    /** Required registry providing pre-warmed shared agent connections. */
    private registry: AgentRegistry,
    redis?: RedisClient,
  ) {
    this.redis = redis || RedisClient.getInstance();
    this.startCleanupInterval();
  }

  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      // this.cleanupExpiredSessions();
    }, 60000);
  }

  /** Resolve an agent's command/args/env by its public id. */
  private resolveAgentConfig(agentId?: string): SseAcpClientConfig {
    if (!agentId || typeof agentId !== 'string') {
      throw new Error('agentId is required');
    }
    const config = this.registry.getConfigById(agentId);
    if (!config) {
      throw new Error(`Unknown agent: ${agentId}`);
    }
    return config;
  }

  /**
   * Subscribe the Redis prompt/permission channels of an ACP session.
   * Called AFTER the ACP session exists (created/loaded/resumed).
   */
  private setupRedisSubscriptions(sessionId: string): Array<() => void> {
    // 订阅 prompt 请求（handler 运行时解析会话与连接，允许连接被换绑/复用）
    const unsubPrompt = this.redis.subscribe(`acp:prompt:${sessionId}`, async (message) => {
      const session = this.sessions.get(sessionId);
      if (!session) return;
      try {
        const msg: SessionMessage = JSON.parse(message);
        await this.handleClientMessage(sessionId, msg, session.client);
      } catch (error) {
        logger.error(`[ACP Session] Error handling prompt message (session: ${sessionId}):`, error);
        await this.publishEvent(sessionId, {
          type: 'error',
          payload: { message: (error as Error).message },
          timestamp: Date.now(),
        });
      }
    });

    // 订阅权限响应
    const unsubPermission = this.redis.subscribe(`acp:permission:${sessionId}`, async (message) => {
      const session = this.sessions.get(sessionId);
      if (!session) return;
      try {
        const msg: SessionMessage = JSON.parse(message);
        await this.handlePermissionResponse(sessionId, msg, session.client);
      } catch (error) {
        logger.error(`[ACP Session] Error handling permission message (session: ${sessionId}):`, error);
      }
    });

    return [unsubPrompt, unsubPermission];
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

      const result = await client.handlePrompt(sessionId, msg.payload.content);

      // 发布完成事件。会话标识即投递目标：prompt 运行期间该标识不变。
      await this.publishEvent(sessionId, {
        type: 'prompt_complete',
        // 带 acpSessionId：前端据此判断这是不是它当前会话的结束事件
        // （切换会话后，旧会话的迟到事件必须被忽略）。
        payload: result,
        timestamp: Date.now(),
      });
    } catch (error) {
      logger.error(`[ACP Session] Prompt error (session: ${sessionId}):`, error);
      // 失败同样要发布到该会话的频道：前端靠 prompt_complete / error 结束处理中状态。
      const failedSessionId = (error as { acpSessionId?: string })?.acpSessionId;
      const target = failedSessionId ?? sessionId;
      await this.publishEvent(target, {
        type: 'error',
        payload: {
          message: (error as Error).message,
          requestId: msg.requestId,
          // 带 acpSessionId：前端据此判断是否属于当前会话（与 prompt_complete 同理）
          acpSessionId: failedSessionId,
        },
        timestamp: Date.now(),
      });
    }
  }

  private async handleCancel(
    sessionId: string,
    client: SseAcpClient
  ): Promise<void> {
    try {
      await client.handleCancel(sessionId);
      await this.publishEvent(sessionId, {
        type: 'cancel_complete',
        payload: {},
        timestamp: Date.now(),
      });
    } catch (error) {
      logger.error(`[ACP Session] Cancel error (session: ${sessionId}):`, error);
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
      logger.error(`[ACP Session] Permission response error (session: ${sessionId}):`, error);
    }
  }

  async publishEvent(sessionId: string, event: any): Promise<void> {
    const channel = `acp:events:${sessionId}`;
    await this.redis.publish(channel, JSON.stringify(event));
  }

  // ==========================================================================
  // Direct in-process prompt (A2A bridge)
  // ==========================================================================

  /**
   * Send a prompt directly (bypassing the Redis prompt channel) and wait until
   * the agent finishes. Session events (`session_update` chunks, permission
   * requests, …) are forwarded to `onEvent` for the duration of the prompt, so
   * callers can stream ACP message chunks without opening an SSE connection.
   *
   * Callers are responsible for serializing prompts per ACP session —
   * ACP allows only one in-flight prompt per session.
   */
  async promptAndWait(
    sessionId: string,
    content: acp.ContentBlock[],
    onEvent?: (event: AcpSessionEvent) => void,
  ): Promise<{ stopReason: string }> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Ensure connection + bound ACP session (lazy recovery after crash)
    await this.ensureAgentSession(sessionId);

    let unsub: (() => void) | undefined;
    if (onEvent) {
      const listener = (raw: string) => {
        try {
          onEvent(JSON.parse(raw) as AcpSessionEvent);
        } catch {
          /* malformed event — ignore */
        }
      };
      unsub = this.redis.subscribe(`acp:events:${sessionId}`, listener);
    }

    try {
      session.lastActivity = Date.now();
      await this.publishEvent(sessionId, {
        type: 'prompt_processing',
        payload: {},
        timestamp: Date.now(),
      });

      const result = await session.client.handlePrompt(sessionId, content);

      await this.publishEvent(sessionId, {
        type: 'prompt_complete',
        payload: result,
        timestamp: Date.now(),
      });
      return result;
    } catch (error) {
      logger.error(`[ACP Session] promptAndWait error (session: ${sessionId}):`, error);
      await this.publishEvent(sessionId, {
        type: 'error',
        payload: { message: (error as Error).message },
        timestamp: Date.now(),
      });
      throw error;
    } finally {
      session.lastActivity = Date.now();
      unsub?.();
    }
  }

  /**
   * Cancel the in-flight prompt of an ACP session (fire-and-forget).
   */
  async cancelPrompt(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    try {
      await session.client.handleCancel(sessionId);
    } catch (error) {
      logger.error(`[ACP Session] cancelPrompt error (session: ${sessionId}):`, error);
    }
  }

  // ==========================================================================
  // Connection management (预热复用 + 检查逻辑)
  // ==========================================================================

  /**
   * Make sure the session is hosted on a live agent connection.
   *
   * 检查逻辑：
   *  1. 已连接（且由 registry 拥有）→ 直接复用，跳过 spawn+initialize；
   *  2. 否则从 AgentRegistry 预热池取共享连接（预热未就绪时由
   *     getOrCreate 内部兜底 spawn+initialize）。
   */
  private async ensureConnected(session: AcpSession): Promise<void> {
    if (
      session.client?.isConnected() &&
      session.callbacksBound &&
      this.registry.owns(session.client)
    ) {
      return;
    }

    const conn = await this.registry.getOrCreate(session.config);
    this.bindConnection(session, conn);
  }

  /**
   * Bind the session record to a (shared) connection and register its listeners.
   */
  private bindConnection(session: AcpSession, conn: SseAcpClient): void {
    if (!(session.client === conn && session.callbacksBound === true)) {
      // Detach listeners from the previous connection.
      session.detachFns?.forEach(fn => {
        try { fn(); } catch { /* ignore */ }
      });

      const offState = conn.onConnectionState((connected) => {
        const s = this.sessions.get(session.sessionId);
        if (s) {
          s.status = connected ? 'active' : 'disconnected';
        }
      });

      session.detachFns = [offState];
      session.client = conn;
      session.callbacksBound = true;
    }

    session.status = 'active';
    session.lastActivity = Date.now();
  }

  // ==========================================================================
  // Record creation (Redis subscriptions are attached after the ACP session
  // exists, since every channel is keyed by the ACP session id)
  // ==========================================================================

  /** 存储「已存在 ACP session」的服务端记录（含 Redis 订阅与监听器）。 */
  private registerRecord(
    sessionId: string,
    client: SseAcpClient,
    config: SseAcpClientConfig,
    cwd: string | null,
  ): AcpSession {
    // Same id already tracked (collision or stale record) — clean it first.
    const stale = this.sessions.get(sessionId);
    if (stale) {
      void this.removeSession(sessionId);
    }

    const session: AcpSession = {
      sessionId,
      client,
      config,
      cwd,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      status: client.isConnected() ? 'active' : 'disconnected',
      redisUnsubs: this.setupRedisSubscriptions(sessionId),
    };
    this.sessions.set(sessionId, session);

    logger.log(`[ACP Session] Registered session: ${sessionId} (total: ${this.sessions.size})`);
    return session;
  }

  /**
   * Create a new ACP session for an agent (resolved by agentId) and register
   * the server-side record with its Redis subscriptions afterwards.
   */
  async createAcpSession(agentId: string, cwd?: string, mcpServers?: acp.McpServer[]): Promise<any> {
    const config = this.resolveAgentConfig(agentId);

    try {
      // 预热连接复用 / 兜底 spawn+initialize
      const conn = await this.registry.getOrCreate(config);

      const result = await conn.handleNewSession({ cwd, mcpServers });
      this.registerRecord(result.sessionId, conn, config, result.cwd ?? cwd ?? null);

      return result;
    } catch (error) {
      logger.error(`[ACP Session] Create session error (agent: ${agentId}):`, error);
      throw error;
    }
  }

  /**
   * Create (or refresh) the server-side record of an already-known ACP session
   * without issuing any ACP request to the agent.
   *
   * Used by the SSE endpoint so the frontend can connect the event stream
   * BEFORE `session/load` runs — the history replay notifications emitted
   * during load need an active subscriber or they are lost.
   */
  async ensureRecord(sessionId: string, agentId?: string): Promise<AcpSession> {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;

    const config = this.resolveAgentConfig(agentId);
    const conn = await this.registry.getOrCreate(config);
    return this.registerRecord(sessionId, conn, config, null);
  }

  // ==========================================================================
  // ACP session operations
  // ==========================================================================

  async loadAcpSession(sessionId: string, options: SessionOperationOptions = {}): Promise<any> {
    const { cwd, mcpServers, agentId } = options;

    try {
      let session = this.sessions.get(sessionId);
      if (!session) {
        // Record missing (e.g. backend restart): create it so routing and
        // subscriptions exist. Requires agentId to resolve the agent.
        session = await this.ensureRecord(sessionId, agentId);
      }

      // 断线恢复：预热连接复用 / 兜底 spawn
      await this.ensureConnected(session);

      const resolvedCwd = cwd || session.cwd || process.cwd();
      const result = await session.client.handleLoadSession(sessionId, {
        cwd: resolvedCwd,
        mcpServers,
      });
      session.cwd = resolvedCwd;
      session.lastActivity = Date.now();
      // 该 ACP session 可能仍有一轮 prompt 在跑（例如 UI 切走又切回）：
      // 告诉前端，免得它把「仍在处理中」的状态弄丢。
      return { ...result, prompting: session.client.isPrompting(sessionId) };
    } catch (error) {
      logger.error(`[ACP Session] Load session error (session: ${sessionId}):`, error);
      throw error;
    }
  }

  async resumeAcpSession(sessionId: string, options: SessionOperationOptions = {}): Promise<any> {
    const { cwd, mcpServers, agentId } = options;

    try {
      let session = this.sessions.get(sessionId);
      if (!session) {
        session = await this.ensureRecord(sessionId, agentId);
      }

      // 断线恢复：预热连接复用 / 兜底 spawn
      await this.ensureConnected(session);

      const resolvedCwd = cwd || session.cwd || process.cwd();
      const result = await session.client.handleResumeSession(sessionId, {
        cwd: resolvedCwd,
        mcpServers,
      });
      session.cwd = resolvedCwd;
      session.lastActivity = Date.now();
      return { ...result, prompting: session.client.isPrompting(sessionId) };
    } catch (error) {
      logger.error(`[ACP Session] Resume session error (session: ${sessionId}):`, error);
      throw error;
    }
  }

  /**
   * Delete an ACP session on the agent and drop the server-side record.
   */
  async deleteAcpSession(sessionId: string, agentId?: string): Promise<void> {
    const session = this.sessions.get(sessionId);

    try {
      if (session) {
        await session.client.handleDeleteSession(sessionId);
        await this.removeSession(sessionId);
      } else {
        // Record gone (backend restart): resolve the agent by id and delete
        // the session through a warm connection directly.
        const config = this.resolveAgentConfig(agentId);
        const conn = await this.registry.getOrCreate(config);
        await conn.handleDeleteSession(sessionId);
      }
    } catch (error) {
      logger.error(`[ACP Session] Delete session error (session: ${sessionId}):`, error);
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
      const result = await session.client.handleSetConfigOption(sessionId, { configId, type, value });
      session.lastActivity = Date.now();
      return result;
    } catch (error) {
      logger.error(`[ACP Session] Set config option error (session: ${sessionId}, config: ${configId}):`, error);
      throw error;
    }
  }

  /**
   * 列出指定 agent 的会话（按 agentId 解析，无需任何 session）。
   *
   * `session/list` 是连接级请求：直接复用 registry 预热共享连接。
   */
  async listAcpSessions(agentId: string, cwd?: string, cursor?: string): Promise<any> {
    const config = this.resolveAgentConfig(agentId);
    const conn = await this.registry.getOrCreate(config);
    return conn.handleListSessions({ cwd, cursor });
  }

  /**
   * 列出指定 agent 配置的会话（list-all-sessions 用：前端直接传 command/args/env）。
   */
  async listAgentSessions(
    agent: { command: string; args?: string[]; env?: Record<string, string> },
    cwd: string,
    cursor?: string,
  ): Promise<any> {
    const conn = await this.registry.getOrCreate({
      agentCommand: agent.command,
      agentArgs: agent.args,
      agentEnv: agent.env,
    });
    return conn.handleListSessions({ cwd, cursor });
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

  /**
   * Whether the agent process behind the session is actually connected right now.
   */
  isAgentConnected(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    return session ? session.client.isConnected() : false;
  }

  /**
   * Ensure the agent is connected and the ACP session is bound to the
   * connection. After an agent crash the binding is lost, so the session is
   * resumed from the persisted cwd to preserve context; if resume is not
   * supported it throws so the caller can surface the failure.
   */
  async ensureAgentSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // 检查逻辑：已连接则跳过 spawn+initialize；预热连接直接复用
    await this.ensureConnected(session);

    await session.client.ensureSession(sessionId, session.cwd ?? undefined);

    session.lastActivity = Date.now();
    session.status = session.client.isConnected() ? 'active' : 'disconnected';
  }

  async removeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.detachFns?.forEach(fn => {
        try { fn(); } catch { /* ignore */ }
      });
      session.redisUnsubs?.forEach(unsub => {
        try { unsub(); } catch { /* ignore */ }
      });

      // 归还共享预热连接：只解绑本会话，不杀进程
      try {
        session.client.releaseSession(sessionId);
      } catch (error) {
        // 忽略解绑错误
      }

      this.sessions.delete(sessionId);
      logger.log(`[ACP Session] Removed session: ${sessionId}`);
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
        logger.log(`[ACP Session] Cleaning up expired session: ${sessionId} (idle: ${idleTime}ms, age: ${age}ms)`);
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
        session.detachFns?.forEach(fn => fn());
        session.redisUnsubs?.forEach(unsub => unsub());
      } catch (error) {
        // 忽略错误
      }
    }
    // Warm connections live in the registry and outlive individual sessions.
    this.sessions.clear();
  }
}

export default AcpSessionManager;
