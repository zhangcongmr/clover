import { Injectable, signal } from '@angular/core';
import { LocalAgentService } from '../local-agent/local-agent.service';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * Origin of an error surfaced through `onError`:
 * - 'connection': EventSource transport failure (line 144) — marks the session
 *   as disconnected.
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
  lastChecked: number;
}

@Injectable({ providedIn: 'root' })
export class AcpSseService {
  private eventSource: EventSource | null = null;
  private baseUrl = '';
  private _currentSessionId = '';
  private _currentAgentId: string | undefined;
  private reconnectAttempts = 0;
  /** Rejects the pending `waitForEventSourceReady`, so a disconnect during a
   *  cold-start connect fails fast instead of stalling until timeout. */
  private readyWaiterReject: (() => void) | null = null;
  private maxReconnectAttempts = 5;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

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

  // ============================================================================
  // 连接管理
  // ============================================================================

  async connect(sessionId: string, agentId?: string): Promise<void> {
    if (this.eventSource) {
      this.disconnect();
    }

    this.baseUrl = this.localAgentService.getBaseUrl();
    this._currentSessionId = sessionId;
    this._currentAgentId = agentId;
    this.sessionId.set(sessionId);
    this.connectionState.set('connecting');
    this.error.set(null);

    try {
      // 获取认证 token
      const token = await this.localAgentService.getToken();
      // `?agentId=` 供服务端在会话记录缺失时（后端重启）解析 agent：
      // load/resume 流程要求 SSE 先于 session/load 建立，否则历史回放丢失。
      const url = `${this.baseUrl}/api/acp/events/${encodeURIComponent(sessionId)}${agentId ? `?agentId=${encodeURIComponent(agentId)}` : ''}`;

      // 创建 EventSource
      this.eventSource = new EventSource(`${url}${agentId ? '&' : '?'}token=${token}`);

      this.setupEventSourceHandlers();

      // 等待连接真正建立后才 resolve：保证「后端订阅已就绪」先于后续的
      // session/load 请求，load 期间 agent 回放的历史通知才不会丢失。
      // （onopen = 服务端已写入并 flush SSE 头 = addConnection 已完成订阅）
      await this.waitForEventSourceReady();
    } catch (error) {
      console.error('[ACP SSE] Failed to connect:', error);
      this.connectionState.set('error');
      this.error.set((error as Error).message);
      throw error;
    }
  }

  /**
   * Resolves once the SSE stream is open (server headers flushed, Redis
   * subscription in place), rejects on failure or timeout so callers do not
   * race a doomed connection.
   *
   * 冷启动场景（后端记录缺失 → ensureRecord → getOrCreate 可能要 spawn +
   * initialize agent）耗时可达数秒，与 initialize 超时对齐取 30s。
   */
  private waitForEventSourceReady(timeoutMs = 30_000): Promise<void> {
    const es = this.eventSource;
    if (!es) {
      return Promise.resolve();
    }
    if (es.readyState === 1) {
      // EventSource.OPEN
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        this.readyWaiterReject = null;
        es.removeEventListener('open', onOpen);
        es.removeEventListener('error', onError);
      };
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error('SSE connection failed'));
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('SSE connection timed out'));
      }, timeoutMs);

      // disconnect() 时快速失败，避免等待句柄悬挂到超时
      this.readyWaiterReject = () => {
        cleanup();
        reject(new Error('SSE connection cancelled'));
      };

      // 与 setupEventSourceHandlers 的 onopen/onerror 互不干扰（独立 listener）
      es.addEventListener('open', onOpen);
      es.addEventListener('error', onError);
    });
  }

  private setupEventSourceHandlers(): void {
    if (!this.eventSource) return;

    this.eventSource.onopen = () => {
      console.log('[ACP SSE] EventSource opened');
      this.reconnectAttempts = 0;
    };

    this.eventSource.onmessage = (event) => {
      try {
        const data: ServerEvent = JSON.parse(event.data);
        this.handleEvent(data);
      } catch (error) {
        console.error('[ACP SSE] Failed to parse event:', error);
      }
    };

    this.eventSource.onerror = (event) => {
      console.error('[ACP SSE] EventSource error:', event);
      this.handleError('SSE connection error');
      this.attemptReconnect();
    };
  }

  private handleEvent(event: ServerEvent): void {
    switch (event.type) {
      case 'connected':
        console.log('[ACP SSE] Connected to session:', event.payload.sessionId);
        this.connectionState.set('connected');
        this.onConnectedCallback?.();
        break;

      case 'status':
        this.onStatusCallback?.(event.payload);
        break;

      case 'session_update':
        this.onSessionUpdateCallback?.(event.payload.update);
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

  disconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.readyWaiterReject?.();
    this.readyWaiterReject = null;

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

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
      },
      body: JSON.stringify(body),
    });

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
    const result = await this.post('/api/acp/prompt', {
      sessionId,
      content,
    });
    return result.requestId;
  }

  /**
   * 取消操作
   */
  async cancel(sessionId: string): Promise<void> {
    await this.post('/api/acp/cancel', { sessionId });
  }

  /**
   * 发送权限响应
   */
  async sendPermissionResponse(
    sessionId: string,
    requestId: string,
    outcome: any
  ): Promise<void> {
    await this.post('/api/acp/permission', {
      sessionId,
      requestId,
      outcome,
    });
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
