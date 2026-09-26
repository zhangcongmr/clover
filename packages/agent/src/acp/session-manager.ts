import { v4 as uuidv4 } from 'uuid';
import { SseAcpClient } from './sse-client.js';
import { RedisClient } from '../redis/client.js';
import type { AgentRegistry } from './agent-registry.js';
import type { SseAcpClientConfig } from './sse-client.js';
import type * as acp from '@agentclientprotocol/sdk';

export interface AcpSession {
  sessionId: string;
  client: SseAcpClient;
  config: SseAcpClientConfig;
  createdAt: number;
  lastActivity: number;
  status: 'active' | 'idle' | 'disconnected';
  /** Last underlying agent ACP session id. Persisted in memory so it can be
   *  resumed if the agent process crashes (survives agent re-spawn). */
  agentSessionId: string | null;
  /** Working directory of the current agent session. Captured from the
   *  connection's binding when the session changes (session/new·load·resume),
   *  so it survives agent re-spawn for crash recovery. */
  agentCwd: string | null;
  /** Whether connection-state/agent-session listeners are registered on `client`. */
  callbacksBound?: boolean;
  /** Teardown functions for the listeners registered on `client`. */
  detachFns?: Array<() => void>;
  /** Redis channel unsubscribers for this wrapper session. */
  redisUnsubs?: Array<() => void>;
}

export interface SessionCreateOptions {
  agentCommand?: string;
  agentArgs?: string[];
  agentEnv?: Record<string, string>;
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

  constructor(
    redis?: RedisClient,
    /** Optional registry providing pre-warmed shared agent connections. */
    private registry?: AgentRegistry,
  ) {
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

    const config: SseAcpClientConfig = {
      agentCommand: options.agentCommand,
      agentArgs: options.agentArgs,
      agentEnv: options.agentEnv,
    };

    // 占位客户端：实际连接在 ensureConnected 时绑定到预热共享连接
    // （或在无 registry 时于本地建立）。运行期的 wrapper 包装流程保持不变。
    const client = new SseAcpClient(sessionId, config, this.redis);

    // 订阅 Redis 频道接收客户端消息
    const redisUnsubs = this.setupRedisSubscriptions(sessionId);

    // 存储会话
    const session: AcpSession = {
      sessionId,
      client,
      config,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      status: 'active',
      agentSessionId: null,
      agentCwd: null,
      redisUnsubs,
    };
    this.sessions.set(sessionId, session);

    console.log(`[ACP Session] Created session: ${sessionId} (total: ${this.sessions.size})`);

    return sessionId;
  }

  private setupRedisSubscriptions(sessionId: string): Array<() => void> {
    // 订阅 prompt 请求（handler 运行时解析会话与连接，允许连接被换绑/复用）
    const unsubPrompt = this.redis.subscribe(`acp:prompt:${sessionId}`, async (message) => {
      const session = this.sessions.get(sessionId);
      if (!session) return;
      try {
        const msg: SessionMessage = JSON.parse(message);
        await this.handleClientMessage(sessionId, msg, session.client);
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
    const unsubPermission = this.redis.subscribe(`acp:permission:${sessionId}`, async (message) => {
      const session = this.sessions.get(sessionId);
      if (!session) return;
      try {
        const msg: SessionMessage = JSON.parse(message);
        await this.handlePermissionResponse(sessionId, msg, session.client);
      } catch (error) {
        console.error(`[ACP Session] Error handling permission message:`, error);
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

      // 调用客户端处理 prompt（按 wrapper session 定向到其 ACP session）
      const result = await client.handlePrompt(sessionId, msg.payload.content);

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
      await client.handleCancel(sessionId);
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

  // ==========================================================================
  // Connection management (预热复用 + 检查逻辑 + 兜底)
  // ==========================================================================

  /**
   * Make sure the wrapper session is attached to a live agent connection.
   *
   * 检查逻辑：
   *  1. 已连接（且由 registry 拥有）→ 直接复用，跳过 spawn+initialize；
   *  2. 否则从 AgentRegistry 预热池取共享连接（预热未就绪时由
   *     getOrCreate 内部兜底 spawn+initialize）；
   *  3. 无 registry（兼容旧用法）→ 走原有的本地 spawn+initialize 路径。
   */
  private async ensureConnected(session: AcpSession): Promise<void> {
    const registry = this.registry;

    if (
      session.client?.isConnected() &&
      session.callbacksBound &&
      (!registry || registry.owns(session.client))
    ) {
      session.client.attach(session.sessionId);
      return;
    }

    let newlyBound = false;

    if (registry) {
      // 预热已就绪 → 直接复用；未就绪/已死 → 内部兜底 spawn+initialize
      const conn = await registry.getOrCreate(session.config);
      newlyBound = this.bindConnection(session, conn);
    } else {
      const conn = session.client;
      if (!conn.isConnected()) {
        await conn.connect({
          command: session.config.agentCommand || 'opencode',
          args: session.config.agentArgs || ['acp'],
          env: session.config.agentEnv,
        });
      }
      newlyBound = this.bindConnection(session, conn);
    }

    session.status = 'active';
    session.lastActivity = Date.now();

    if (newlyBound) {
      await this.publishEvent(session.sessionId, {
        type: 'connected',
        payload: { sessionId: session.sessionId },
        timestamp: Date.now(),
      });
    }

    console.log(`[ACP Session] Session connected: ${session.sessionId}`);
  }

  /**
   * Bind the session to a (shared) connection and register its listeners.
   * Returns true when listeners were (re-)registered, i.e. the wrapper just
   * attached to a connection.
   */
  private bindConnection(session: AcpSession, conn: SseAcpClient): boolean {
    const alreadyBound = session.client === conn && session.callbacksBound === true;

    if (!alreadyBound) {
      // Detach listeners from the previous connection (e.g. placeholder).
      session.detachFns?.forEach(fn => {
        try { fn(); } catch { /* ignore */ }
      });
      session.detachFns = [];

      const wrapperId = session.sessionId;

      const offState = conn.onConnectionState((connected) => {
        const s = this.sessions.get(wrapperId);
        if (s) {
          s.status = connected ? 'active' : 'disconnected';
        }
      });

      const offAgentSession = conn.onAgentSessionChange((changedWrapperId, acpSessionId) => {
        if (changedWrapperId !== wrapperId) return;
        const s = this.sessions.get(wrapperId);
        if (s) {
          s.agentSessionId = acpSessionId;
          // 记录会话真实 cwd（可能与创建时传入的项目目录不同，如时间戳目录）
          s.agentCwd = conn.getAcpSessionCwd(wrapperId) ?? s.agentCwd;
        }
      });

      session.detachFns = [offState, offAgentSession];
      session.client = conn;
      session.callbacksBound = true;
    }

    conn.attach(session.sessionId);
    return !alreadyBound;
  }

  async connectSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    try {
      await this.ensureConnected(session);
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

  // ==========================================================================
  // ACP session operations (all guarded by ensureConnected)
  // ==========================================================================

  async createAcpSession(sessionId: string, cwd?: string, mcpServers?: acp.McpServer[]): Promise<any> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    try {
      // 复用已有 wrapper 时其 agent 可能已断开：先确保连接再建会话
      await this.ensureConnected(session);

      const result = await session.client.handleNewSession(sessionId, { cwd, mcpServers });
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

  /**
   * 列出指定 agent 的会话（无需创建 wrapper session）。
   *
   * `session/list` 是连接级请求：有 registry 时直接复用预热共享连接，
   * 省去 wrapper 的 uuid / 占位客户端 / Redis 订阅 / 监听器绑定开销；
   * 无 registry 时兜底走原有的 create → connect → list → remove 流程。
   */
  async listAgentSessions(
    agent: { command: string; args?: string[]; env?: Record<string, string> },
    cwd: string,
    cursor?: string,
  ): Promise<any> {
    if (this.registry) {
      const conn = await this.registry.getOrCreate({
        agentCommand: agent.command,
        agentArgs: agent.args,
        agentEnv: agent.env,
      });
      return conn.handleListSessions({ cwd, cursor });
    }

    // 兜底（无 registry）：保持原 wrapper 流程
    const sessionId = await this.createSession({
      agentCommand: agent.command,
      agentArgs: agent.args,
      agentEnv: agent.env,
    });
    try {
      await this.connectSession(sessionId);
      return await this.listAcpSessions(sessionId, cwd, cursor);
    } finally {
      try {
        await this.removeSession(sessionId);
      } catch (cleanupError) {
        console.warn(`[ACP Session] Failed to clean up wrapper session ${sessionId}:`, cleanupError);
      }
    }
  }

  async loadAcpSession(sessionId: string, loadSessionId: string, cwd?: string, mcpServers?: acp.McpServer[]): Promise<any> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    try {
      // 断线恢复：预热连接复用 / 兜底 spawn
      await this.ensureConnected(session);

      const result = await session.client.handleLoadSession(sessionId, {
        sessionId: loadSessionId,
        cwd: this.resolveCwd(session, cwd),
        mcpServers,
      });
      session.lastActivity = Date.now();
      return result;
    } catch (error) {
      console.error(`[ACP Session] Load session error:`, error);
      throw error;
    }
  }

  async resumeAcpSession(sessionId: string, resumeSessionId: string, cwd?: string, mcpServers?: acp.McpServer[]): Promise<any> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    try {
      // 断线恢复：预热连接复用 / 兜底 spawn
      await this.ensureConnected(session);

      const result = await session.client.handleResumeSession(sessionId, {
        sessionId: resumeSessionId,
        cwd: this.resolveCwd(session, cwd),
        mcpServers,
      });
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
      await session.client.handleDeleteSession(sessionId, { sessionId: deleteSessionId });
      session.lastActivity = Date.now();
      if (session.agentSessionId === deleteSessionId) {
        session.agentSessionId = null;
      }
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
      const result = await session.client.handleSetConfigOption(sessionId, { configId, type, value });
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

  /**
   * Whether the agent process behind the wrapper is actually connected right now.
   */
  isAgentConnected(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    return session ? session.client.isConnected() : false;
  }

  /**
   * 请求未带 cwd 时的回退链：本次会话 cwd → 已绑定 agent 会话的真实 cwd → 进程目录。
   * 兜底逻辑在 wrapper 层完成——共享连接不持有 cwd。
   */
  private resolveCwd(session: AcpSession, cwd?: string | null): string {
    return cwd || session.agentCwd || process.cwd();
  }

  /**
   * Ensure the agent is connected and has an active ACP session.
   * If a previous agent session id was persisted (and the agent supports
   * resume), it resumes that session to preserve context; otherwise it throws
   * so the caller can surface the failure instead of silently losing context.
   */
  async ensureAgentSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // 检查逻辑：已连接则跳过 spawn+initialize；预热连接直接复用
    await this.ensureConnected(session);

    const cwd = this.resolveCwd(session, session.agentCwd);
    await session.client.ensureSession(sessionId, session.agentSessionId, cwd);

    session.lastActivity = Date.now();
    session.status = session.client.isConnected() ? 'active' : 'disconnected';
    session.agentSessionId = session.client.getAcpSessionId(sessionId);
    session.agentCwd = cwd;
  }

  async removeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      try {
        if (this.registry?.owns(session.client)) {
          // 归还共享预热连接：只解绑，不杀进程
          session.client.detach(sessionId);
        } else {
          session.client.disconnect();
        }
      } catch (error) {
        // 忽略断开连接错误
      }

      session.detachFns?.forEach(fn => {
        try { fn(); } catch { /* ignore */ }
      });
      session.redisUnsubs?.forEach(unsub => {
        try { unsub(); } catch { /* ignore */ }
      });

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
        session.detachFns?.forEach(fn => fn());
        session.redisUnsubs?.forEach(unsub => unsub());
        if (!this.registry?.owns(session.client)) {
          session.client.disconnect();
        }
      } catch (error) {
        // 忽略错误
      }
    }
    this.sessions.clear();
  }
}

export default AcpSessionManager;
