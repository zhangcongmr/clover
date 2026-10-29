import { Injectable, signal } from '@angular/core';
import { LocalAgentService } from '../local-agent/local-agent.service';
import { openSseRequest, readSseFrames } from './sse-transport';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * Origin of an error surfaced through `onError`:
 * - 'connection': SSE transport failure — marks the session as disconnected.
 * - 'server': a `type: 'error'` event published by the backend (e.g. prompt
 *   failure) — the session stays connected, the error is only displayed.
 */
export type ErrorSource = 'connection' | 'server';

export interface ServerEvent {
  type: string;
  payload: any;
  timestamp: number;
}

/**
 * Runtime status of an ACP agent as reported by the backend AgentRegistry.
 * Display precedence: connected > unavailable > offline > available.
 */
export type AgentRuntimeStatus = 'unknown' | 'available' | 'unavailable' | 'offline' | 'connected';

export interface AgentStatusInfo {
  id: string;
  name: string;
  command: string;
  args?: string[];
  description?: string;
  installed: boolean | null;
  status: AgentRuntimeStatus;
  agentInfo?: unknown;
  capabilities?: unknown;
  error?: string;
  /** Installer command for the missing artifact, when the backend knows one. */
  install?: { command: string };
  /** Where the agent CLI lives on disk. */
  paths?: { cli?: string };
  /** Installed agent version, when the backend can resolve one. */
  version?: string;
  lastChecked: number;
}

/** Progress of an on-demand agent install started from the settings page. */
export interface AgentInstallJob {
  id: string;
  agentId: string;
  command: string;
  status: 'running' | 'succeeded' | 'failed';
  steps: Array<{
    label: string;
    command: string;
    status: 'pending' | 'running' | 'succeeded' | 'failed';
    output: string[];
  }>;
  startedAt: number;
  finishedAt?: number;
  error?: string;
}

/**
 * 页面实例标识。
 *
 * 每次页面加载生成一个，**不**放 sessionStorage：浏览器「复制标签页」会把
 * sessionStorage 一起复制，两个 tab 拿到同一个 id 就会互相把对方当成
 * 「同一页面的重连」，表现为一方静默失联。
 */
function createClientId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** 命令请求 id（服务端用它关联 `prompt_complete` 等事件）。 */
function newRequestId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

@Injectable({ providedIn: 'root' })
export class AcpSseService {
  /** 当前事件流的取消句柄。 */
  private abortController: AbortController | null = null;
  private baseUrl = '';
  private _currentSessionId = '';
  private _currentAgentId: string | undefined;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  /**
   * 最近一次收到的事件序号（来自 SSE `id:` 字段）。
   *
   * 主动重建连接时不会自动带上游标，所以要自己记住，重连时通过
   * `Last-Event-ID` header 传给服务端。
   */
  private lastEventId = '';
  /**
   * 单消费者所有权：页面实例 id + 本次连接的 epoch。
   *
   * `epoch` 来自服务端 `connected` 事件；被其它标签页接管后服务端会递增它，
   * 旧标签页带旧 epoch 的请求会被拒绝（409 / `session_superseded`）。
   */
  private readonly clientId = createClientId();
  private epoch: number | undefined;
  /** 已被其它标签页占用或被接管：置位后停止一切自动重连。 */
  readonly superseded = signal(false);
  private supersededReason: 'conflict' | 'evicted' | null = null;
  private onSupersededCallback: ((reason: 'conflict' | 'evicted') => void) | null = null;

  readonly connectionState = signal<ConnectionState>('disconnected');
  readonly error = signal<string | null>(null);
  readonly sessionId = signal<string | null>(null);

  // 事件回调
  private onConnectedCallback: (() => void) | null = null;
  private onSessionUpdateCallback: ((update: any) => void) | null = null;
  private onPermissionRequestCallback: ((request: any) => void) | null = null;
  private onPromptCompleteCallback: ((stopReason: string, acpSessionId?: string) => void) | null = null;
  private onErrorCallback: ((message: string, source: ErrorSource, acpSessionId?: string) => void) | null = null;
  private onDisconnectedCallback: (() => void) | null = null;
  private onStatusCallback: ((payload: any) => void) | null = null;
  /** Server-published "history replay complete" marker (`session_loaded` / `session_resumed`). */
  private onSessionLoadedCallback: ((payload: any) => void) | null = null;
  /** 续传窗口不足（服务端 ring 已覆盖 / 序号归零），需要重新 load 历史。 */
  private onReplayGapCallback: ((payload: any) => void) | null = null;

  constructor(private localAgentService: LocalAgentService) {}

  // ============================================================================
  // 事件注册方法
  // ============================================================================

  onConnected(callback: () => void): void {
    this.onConnectedCallback = callback;
  }

  onSessionUpdate(callback: (update: any) => void): void {
    this.onSessionUpdateCallback = callback;
  }

  onPermissionRequest(callback: (request: any) => void): void {
    this.onPermissionRequestCallback = callback;
  }

  onPromptComplete(callback: (stopReason: string, acpSessionId?: string) => void): void {
    this.onPromptCompleteCallback = callback;
  }

  onError(callback: (message: string, source: ErrorSource, acpSessionId?: string) => void): void {
    this.onErrorCallback = callback;
  }

  onDisconnected(callback: () => void): void {
    this.onDisconnectedCallback = callback;
  }

  onStatus(callback: (payload: any) => void): void {
    this.onStatusCallback = callback;
  }

  /**
   * Registers the handler for the server's "history replay complete" marker.
   * The backend publishes `session_loaded` / `session_resumed` on the session's
   * SSE channel AFTER all replay `session_update` events, so receiving it proves
   * every replayed update has already been delivered (SSE is ordered).
   */
  onSessionLoaded(callback: (payload: any) => void): void {
    this.onSessionLoadedCallback = callback;
  }

  /**
   * Registers the handler for a failed resume: the server could not replay the
   * requested gap (ring overwritten, or the stream was recreated so the cursor
   * is ahead of the current sequence). The only recovery is a full history
   * reload (`session/load`).
   */
  onReplayGap(callback: (payload: any) => void): void {
    this.onReplayGapCallback = callback;
  }

  /**
   * Registers the handler fired when this page loses ownership of the session:
   * `conflict` = another tab already owns it (we were refused), `evicted` =
   * another tab took it over (our stream was superseded).
   */
  onSuperseded(callback: (reason: 'conflict' | 'evicted') => void): void {
    this.onSupersededCallback = callback;
  }

  // ============================================================================
  // 连接管理
  // ============================================================================

  async connect(
    sessionId: string,
    agentId?: string,
    options: { resume?: boolean; takeover?: boolean } = {},
  ): Promise<void> {
    this.beginConnect(sessionId, agentId, options);
    await this.connectStream(sessionId, agentId, options.takeover ?? false);
  }

  /** 连接前的状态重置（不触发 disconnect 回调）。 */
  private beginConnect(
    sessionId: string,
    agentId: string | undefined,
    options: { resume?: boolean; takeover?: boolean },
  ): void {
    this.teardownStream();

    const resume = options.resume ?? true;
    const takeover = options.takeover ?? false;
    const sessionChanged = !!this._currentSessionId && this._currentSessionId !== sessionId;

    // 游标只在「同一会话的重连」中复用：切换会话，或显式 load/resume
    // （会从头回放历史）时必须清掉，否则补发的增量会和历史回放重复。
    if (!resume || sessionChanged) {
      this.lastEventId = '';
    }

    // 显式打开/接管 = 重新成为持有者：清掉上一轮被占用的状态。
    if (takeover || sessionChanged) {
      this.superseded.set(false);
      this.supersededReason = null;
      this.epoch = undefined;
    }

    this.baseUrl = this.localAgentService.getBaseUrl();
    this._currentSessionId = sessionId;
    this._currentAgentId = agentId;
    this.sessionId.set(sessionId);
    this.connectionState.set('connecting');
    this.error.set(null);
  }

  /**
   * 事件流传输：`fetch` + SSE 解析。
   *
   * 状态码可读（409/404 不再需要从流里猜），header 携带身份与游标。
   * `fetch` resolve = 响应头到达 = 服务端已完成订阅，因此 `connect()` 在
   * 此时即可 resolve。
   */
  private async connectStream(
    sessionId: string,
    agentId: string | undefined,
    takeover: boolean,
  ): Promise<void> {
    const controller = new AbortController();
    this.abortController = controller;

    try {
      const token = await this.localAgentService.getToken();
      const headers: Record<string, string> = {
        Accept: 'text/event-stream',
        Authorization: `Bearer ${token}`,
        // 'X-Client-Id': this.clientId,
      };
      if (this.lastEventId) headers['Last-Event-ID'] = this.lastEventId;
      if (takeover) headers['X-Takeover'] = '1';

      const query = agentId ? `?agentId=${encodeURIComponent(agentId)}` : '';
      const url = `${this.baseUrl}/api/acp/stream/${encodeURIComponent(sessionId)}${query}`;

      const response = await openSseRequest(url, { headers, signal: controller.signal });

      if (response.status === 409) {
        // 另一个标签页持有该会话：不再重连
        this.markSuperseded('conflict');
        const conflict = new Error('Session is open in another tab');
        (conflict as { code?: string }).code = 'SUPERSEDED';
        throw conflict;
      }
      if (response.status === 404) {
        const message = 'Session not found on the server';
        this.connectionState.set('error');
        this.error.set(message);
        throw new Error(message);
      }
      if (!response.ok || !response.body) {
        throw new Error(`Stream failed: HTTP ${response.status}`);
      }

      this.reconnectAttempts = 0;
      // 后台消费：connect() 不能等整个流结束
      void this.pumpStream(response.body, controller.signal);
    } catch (error) {
      // 冲突：markSuperseded 会 abort 掉 controller，必须在这里显式重新抛出，
      // 否则调用方（load/resume）会误以为流已建立。
      if ((error as { code?: string })?.code === 'SUPERSEDED') {
        throw error;
      }
      if (controller.signal.aborted) {
        // 主动 disconnect：不算连接失败
        return;
      }
      console.error('[ACP SSE] Failed to connect (stream):', error);
      if (!this.superseded()) {
        this.connectionState.set('error');
        this.error.set((error as Error).message);
      }
      throw error;
    }
  }

  /** 消费事件流；正常 EOF 或网络错误时按游标重连。 */
  private async pumpStream(body: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<void> {
    try {
      for await (const frame of readSseFrames(body, signal)) {
        if (signal.aborted) return;

        if (frame.id) this.lastEventId = frame.id;
        if (!frame.data) continue;

        try {
          this.handleEvent(JSON.parse(frame.data) as ServerEvent);
        } catch (error) {
          console.error('[ACP SSE] Failed to parse event:', error);
        }
      }
    } catch (error) {
      if (signal.aborted) return;
      console.error('[ACP SSE] Stream error:', error);
    }

    if (signal.aborted || this.superseded()) return;

    this.handleError('SSE connection error');
    this.attemptReconnect();
  }

  private handleEvent(event: ServerEvent): void {
    switch (event.type) {
      case 'connected':
        console.log('[ACP SSE] Connected to session:', event.payload.sessionId);
        if (typeof event.payload?.epoch === 'number') {
          this.epoch = event.payload.epoch;
        }
        this.connectionState.set('connected');
        this.onConnectedCallback?.();
        break;

      case 'status':
        this.onStatusCallback?.(event.payload);
        break;

      case 'session_update':
        this.onSessionUpdateCallback?.(event.payload.update);
        break;

      case 'session_loaded':
      case 'session_resumed':
        // Ordered "history replay complete" marker: every `session_update`
        // published before it has already been dispatched above.
        this.onSessionLoadedCallback?.(event.payload);
        break;

      case 'replay_gap':
        // 服务端无法补齐游标之后的增量（ring 覆盖 / 序号归零）：需要一次
        // 完整的 session/load 才能恢复。
        console.warn('[ACP SSE] Replay gap:', event.payload);
        this.onReplayGapCallback?.(event.payload);
        break;

      case 'session_superseded':
        // 单消费者：本连接被另一个标签页接管，必须停止自动重连。
        this.markSuperseded('evicted', event.payload);
        break;

      case 'permission_request':
        this.onPermissionRequestCallback?.(event.payload);
        break;

      case 'prompt_complete':
        // payload.acpSessionId 标明这是哪个 ACP 会话结束：前端据此判断
        // 该事件是否属于当前会话（切换会话后旧会话的迟到事件必须忽略）。
        this.onPromptCompleteCallback?.(event.payload.stopReason, event.payload.acpSessionId);
        break;

      case 'error':
        console.error('[ACP SSE] Server error:', event.payload.message);
        // payload.acpSessionId 标明错误属于哪个 ACP 会话：前端据此忽略
        // 其它会话的迟到错误（同 prompt_complete）。
        this.handleError(event.payload.message, 'server', event.payload.acpSessionId);
        break;

      case 'heartbeat':
        // 心跳事件，无需处理
        break;

      default:
        console.log('[ACP SSE] Unknown event type:', event.type);
    }
  }

  private handleError(message: string, source: ErrorSource = 'connection', acpSessionId?: string): void {
    // 只有连接级错误写入 error signal：acp.service 的 syncState 会周期性把
    // error() 同步进 sessionState().error，server 错误若写入会在 10s 内间接
    // 改掉 sessionState（要求保持不变），因此 server 错误只走回调。
    if (source === 'connection') {
      this.error.set(message);
    }
    this.onErrorCallback?.(message, source, acpSessionId);
  }

  private attemptReconnect(): void {
    if (this.superseded()) {
      // 会话已归别的标签页所有：重连只会把对方踢掉，形成抢锁循环。
      console.warn('[ACP SSE] Not reconnecting: session is owned by another client');
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[ACP SSE] Max reconnection attempts reached');
      this.connectionState.set('error');
      this.error.set('Max reconnection attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);

    console.log(`[ACP SSE] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimeout = setTimeout(async () => {
      try {
        await this.connect(this._currentSessionId, this._currentAgentId);
      } catch (error) {
        console.error('[ACP SSE] Reconnection failed:', error);
      }
    }, delay);
  }

  /**
   * Stops this stream for good: the session belongs to another page (or a newer
   * one). Auto-reconnect is suppressed so two tabs cannot fight over it.
   */
  private markSuperseded(reason: 'conflict' | 'evicted', detail?: any): void {
    if (this.supersededReason === reason) return;
    this.supersededReason = reason;
    this.superseded.set(true);

    // 关流（AbortController）
    this.teardownStream();

    this.connectionState.set('disconnected');
    console.warn(`[ACP SSE] Stream superseded (${reason})`, detail ?? '');
    this.onSupersededCallback?.(reason);
  }

  /**
   * Drops the resume cursor so the next `connect()` starts a fresh stream with
   * no replay request. Used when the gap cannot be covered (the server would
   * otherwise report the same gap forever).
   */
  clearCursor(): void {
    this.lastEventId = '';
  }

  /** 释放底层传输（不改变对外状态、不触发回调）。 */
  private teardownStream(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  disconnect(): void {
    this.teardownStream();
    this.connectionState.set('disconnected');
    this.sessionId.set(null);
    this.onDisconnectedCallback?.();
  }

  // ============================================================================
  // HTTP 请求方法
  // ============================================================================

  private async post(endpoint: string, body: any): Promise<any> {
    const token = await this.localAgentService.getToken();
    const base = this.localAgentService.getBaseUrl();

    const response = await fetch(`${base}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        // 所有权凭据：新端点从 header 读取；旧端点会忽略这些头
        // 'X-Client-Id': this.clientId,
        // ...(this.epoch !== undefined ? { 'X-Epoch': String(this.epoch) } : {}),
      },
      body: JSON.stringify(body),
    });

    if (response.status === 409) {
      // epoch 栅栏：本页已不是会话持有者（被接管后仍在发请求）。
      this.markSuperseded('evicted');
    }

    if (!response.ok) {
      throw new Error(await this.describeResponseError(response));
    }

    return response.json();
  }

  private async get(endpoint: string): Promise<any> {
    const token = await this.localAgentService.getToken();
    const base = this.localAgentService.getBaseUrl();

    const response = await fetch(`${base}${endpoint}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error(await this.describeResponseError(response));
    }

    return response.json();
  }

  /**
   * Builds a friendly error message from a non-OK response. Servers may return
   * JSON, plain text, or an HTML error page (e.g. Express body-parser 413), so
   * the body is parsed defensively before falling back to the status code.
   */
  private async describeResponseError(response: Response): Promise<string> {
    if (response.status === 413) {
      return 'Payload too large (413): reduce the attachment size or attach fewer files (max 10MB per file)';
    }

    let text = '';
    try {
      text = await response.text();
    } catch {
      // ignore read errors
    }

    if (text.trim()) {
      try {
        const json = JSON.parse(text);
        if (typeof json?.error === 'string') return `${response.status}: ${json.error}`;
        if (typeof json?.message === 'string') return `${response.status}: ${json.message}`;
      } catch {
        // Not JSON, strip HTML tags to keep the message readable
        const clean = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        if (clean) return `${response.status}: ${clean.slice(0, 300)}`;
      }
    }

    return `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
  }

  // ============================================================================
  // 公开 API 方法
  // ============================================================================

  /**
   * 发送 prompt
   */
  async sendPrompt(sessionId: string, content: any[]): Promise<string> {
    const id = newRequestId();
    const result = await this.post(this.streamCommandPath(sessionId), {
      id,
      method: 'prompt',
      params: { content },
    });
    return result?.id ?? id;
  }

  /**
   * 取消操作
   */
  async cancel(sessionId: string): Promise<void> {
    await this.post(this.streamCommandPath(sessionId), { method: 'cancel', params: {} });
  }

  /**
   * 发送权限响应
   */
  async sendPermissionResponse(
    sessionId: string,
    requestId: string,
    outcome: any
  ): Promise<void> {
    await this.post(this.streamCommandPath(sessionId), {
      method: 'permission',
      params: { requestId, outcome },
    });
  }

  /** 事件流命令通道（输出仍走 GET 事件流）。 */
  private streamCommandPath(sessionId: string): string {
    return `/api/acp/stream/${encodeURIComponent(sessionId)}`;
  }

  /**
   * 创建 ACP 会话（按 agentId 解析 agent，一步返回真实 ACP session id）。
   * available_commands 等创建期通知由响应字段携带补偿（前端在
   * 会话创建之后才建立 SSE，创建期通知没有订阅者）。
   */
  async createAcpSession(agentId: string, cwd?: string, mcpServers?: string[]): Promise<any> {
    return this.post('/api/acp/session/create', { agentId, cwd, mcpServers });
  }

  /**
   * 列出一个 agent 的会话（连接级操作，同步返回结果）
   */
  async listSessions(agentId: string, cwd?: string, cursor?: string): Promise<any> {
    return this.post('/api/acp/session/list', { agentId, cwd, cursor });
  }

  /**
   * 聚合列出所有 agent 的会话（服务端逐个 agent getOrCreate/list）
   */
  async listAllSessions(cwd: string, agents: Array<{ id: string; command: string; args?: string[]; env?: Record<string, string> }>): Promise<any> {
    return this.post('/api/acp/list-all-sessions', { cwd, agents });
  }

  /**
   * 加载会话历史（sessionId 即目标 ACP session id；同步返回结果）。
   * 注意：SSE 必须先行建立（connect 带 agentId），否则 load 的历史回放通知
   * 没有订阅者、消息会丢失。
   */
  async loadSession(sessionId: string, agentId: string, cwd?: string, mcpServers?: string[]): Promise<any> {
    return this.post('/api/acp/session/load', { sessionId, agentId, cwd, mcpServers });
  }

  /**
   * 恢复会话（sessionId 即目标 ACP session id；同步返回结果）
   */
  async resumeSession(sessionId: string, agentId: string, cwd?: string, mcpServers?: string[]): Promise<any> {
    return this.post('/api/acp/session/resume', { sessionId, agentId, cwd, mcpServers });
  }

  /**
   * 删除 ACP 会话（agentId 仅在服务端记录丢失时用于解析 agent）
   */
  async deleteAcpSession(sessionId: string, agentId?: string): Promise<any> {
    return this.post('/api/acp/session/delete', { sessionId, agentId });
  }

  /**
   * 设置配置选项（同步返回结果）
   */
  async setConfigOption(
    sessionId: string,
    configId: string,
    type: 'id' | 'boolean',
    value: string | boolean
  ): Promise<any> {
    return this.post('/api/acp/config', { sessionId, configId, type, value });
  }

  /**
   * 读取指定 agent 持久化的 configOptions（~/.clover/agent-config.json）
   */
  async getAgentConfig(agentId: string): Promise<any[] | null> {
    const result = await this.get(`/api/acp/agent-config?agentId=${encodeURIComponent(agentId)}`);
    return Array.isArray(result?.configOptions) ? result.configOptions : null;
  }

  /**
   * 按 agentId 持久化 configOptions 到服务端
   */
  async saveAgentConfig(agentId: string, configOptions: any[]): Promise<void> {
    await this.post('/api/acp/agent-config', { agentId, configOptions });
  }

  /**
   * Ping 检测连接
   */
  async ping(sessionId: string): Promise<void> {
    await this.post('/api/acp/ping', { sessionId });
  }

  /**
   * 列出全部 Agent 及其运行状态（Settings → Agents）
   */
  async listAgents(): Promise<AgentStatusInfo[]> {
    const result = await this.get('/api/acp/agents');
    return (result?.agents ?? []) as AgentStatusInfo[];
  }

  /**
   * Check Now：重新检测某个 Agent 的安装状态并尝试拉起到“连接”状态
   */
  async checkAgent(agentId: string): Promise<AgentStatusInfo> {
    const result = await this.post(`/api/acp/agents/${encodeURIComponent(agentId)}/check`, {});
    return result.agent as AgentStatusInfo;
  }

  /**
   * 安装缺失的组件（Agent CLI 或 ACP 适配器），返回后台任务
   */
  async startAgentInstall(agentId: string): Promise<AgentInstallJob> {
    const result = await this.post(`/api/acp/agents/${encodeURIComponent(agentId)}/install`, {});
    return result.job as AgentInstallJob;
  }

  /**
   * 查询安装任务进度（设置页轮询）
   */
  async getAgentInstallJob(jobId: string): Promise<AgentInstallJob> {
    const result = await this.get(`/api/acp/agents/install/${encodeURIComponent(jobId)}`);
    return result.job as AgentInstallJob;
  }

  // ============================================================================
  // 项目管理方法（免认证）
  // ============================================================================

  private async postNoAuth(endpoint: string, body: any): Promise<any> {
    const base = this.localAgentService.getBaseUrl();

    const response = await fetch(`${base}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(await this.describeResponseError(response));
    }

    return response.json();
  }

  /**
   * 列出所有项目
   */
  async listProjects(): Promise<any> {
    return this.postNoAuth('/api/projects', {});
  }

  /**
   * 列出所有任务
   */
  async listTasks(): Promise<any> {
    return this.postNoAuth('/api/tasks', {});
  }

  /**
   * 新增项目或任务（通过 type 区分）
   */
  async addProject(project: { name: string; path: string; type: string; sessions?: any[]; id?: string; createdAt?: string }): Promise<any> {
    return this.postNoAuth('/api/projects/add', project);
  }

  /**
   * 删除项目或任务（task 支持按 id 精确删除）
   */
  async deleteProject(name: string, type: string, id?: string): Promise<any> {
    return this.postNoAuth('/api/projects/delete', { name, type, id });
  }

  /**
   * 保存会话到项目或任务
   */
  async saveSessionToProject(projectPath: string, session: {
    sessionId: string;
    agentId: string;
    title?: string;
    updatedAt?: string;
  }): Promise<any> {
    return this.postNoAuth('/api/projects/save-session', { projectPath, session });
  }

  /**
   * 从项目中删除会话
   */
  async deleteSessionFromProject(projectPath: string, sessionId: string): Promise<any> {
    return this.postNoAuth('/api/projects/delete-session', { projectPath, sessionId });
  }

  /**
   * 获取选中的项目和会话
   */
  async getSelectedProject(): Promise<{ selectedProject: string | null; selectedSessionId: string | null }> {
    try {
      const base = this.localAgentService.getBaseUrl();
      const response = await fetch(`${base}/api/projects/selected`, {
        method: 'GET',
      });
      if (!response.ok) return { selectedProject: null, selectedSessionId: null };
      const result = await response.json();
      return { selectedProject: result.selectedProject || null, selectedSessionId: result.selectedSessionId || null };
    } catch {
      return { selectedProject: null, selectedSessionId: null };
    }
  }

  /**
   * 保存选中的项目和会话
   */
  async saveSelectedProject(selectedProject: string | null, selectedSessionId?: string | null): Promise<void> {
    await this.postNoAuth('/api/projects/selected', { selectedProject, selectedSessionId });
  }
}
