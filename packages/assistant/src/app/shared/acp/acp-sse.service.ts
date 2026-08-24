import { Injectable, signal } from '@angular/core';
import { LocalAgentService } from '../local-agent/local-agent.service';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface ServerEvent {
  type: string;
  payload: any;
  timestamp: number;
}

@Injectable({ providedIn: 'root' })
export class AcpSseService {
  private eventSource: EventSource | null = null;
  private baseUrl = '';
  private _currentSessionId = '';
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

  readonly connectionState = signal<ConnectionState>('disconnected');
  readonly error = signal<string | null>(null);
  readonly sessionId = signal<string | null>(null);

  // 事件回调
  private onConnectedCallback: (() => void) | null = null;
  private onSessionUpdateCallback: ((update: any) => void) | null = null;
  private onPermissionRequestCallback: ((request: any) => void) | null = null;
  private onPromptCompleteCallback: ((stopReason: string) => void) | null = null;
  private onSessionCreatedCallback: ((sessionId: string, payload?: any) => void) | null = null;
  private onErrorCallback: ((message: string) => void) | null = null;
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

  onPromptComplete(callback: (stopReason: string) => void): void {
    this.onPromptCompleteCallback = callback;
  }

  onSessionCreated(callback: (sessionId: string, payload?: any) => void): void {
    this.onSessionCreatedCallback = callback;
  }

  onError(callback: (message: string) => void): void {
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

  async connect(sessionId: string): Promise<void> {
    if (this.eventSource) {
      this.disconnect();
    }

    this.baseUrl = this.localAgentService.getBaseUrl();
    this._currentSessionId = sessionId;
    this.sessionId.set(sessionId);
    this.connectionState.set('connecting');
    this.error.set(null);

    try {
      // 获取认证 token
      const token = await this.localAgentService.getToken();
      const url = `${this.baseUrl}/api/acp/events/${sessionId}`;

      // 创建 EventSource
      this.eventSource = new EventSource(`${url}?token=${token}`);

      this.setupEventSourceHandlers();
    } catch (error) {
      console.error('[ACP SSE] Failed to connect:', error);
      this.connectionState.set('error');
      this.error.set((error as Error).message);
      throw error;
    }
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
        this.onPromptCompleteCallback?.(event.payload.stopReason);
        break;

      case 'session_created':
        this.onSessionCreatedCallback?.(event.payload.sessionId, event.payload);
        break;

      case 'error':
        console.error('[ACP SSE] Server error:', event.payload.message);
        this.handleError(event.payload.message);
        break;

      case 'heartbeat':
        // 心跳事件，无需处理
        break;

      default:
        console.log('[ACP SSE] Unknown event type:', event.type);
    }
  }

  private handleError(message: string): void {
    this.error.set(message);
    this.onErrorCallback?.(message);
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
        await this.connect(this._currentSessionId);
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
   * 创建新会话
   */
  async createSession(options?: { cwd?: string; agentCommand?: string; agentArgs?: string[]; agentEnv?: Record<string, string> }): Promise<{ sessionId: string; cwd: string }> {
    const result = await this.post('/api/acp/session', options || {});
    return { sessionId: result.sessionId, cwd: result.cwd || options?.cwd || '' };
  }

  /**
   * 获取会话状态
   */
  async getSessionStatus(sessionId: string): Promise<any> {
    return this.get(`/api/acp/session/${sessionId}`);
  }

  /**
   * 删除会话
   */
  async deleteSession(sessionId: string): Promise<void> {
    const token = await this.localAgentService.getToken();
    const base = this.localAgentService.getBaseUrl();

    await fetch(`${base}/api/acp/session/${sessionId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });
  }

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
   * 获取系统状态
   */
  async getStatus(): Promise<any> {
    return this.get('/api/acp/status');
  }

  /**
   * 创建 ACP 会话（在已连接的客户端中）
   */
  async createAcpSession(sessionId: string, cwd?: string): Promise<any> {
    return this.post('/api/acp/session/create', { sessionId, cwd });
  }

  /**
   * 列出会话（同步返回结果）
   */
  async listSessions(sessionId: string, cwd?: string, cursor?: string): Promise<any> {
    return this.post('/api/acp/session/list', { sessionId, cwd, cursor });
  }

  /**
   * 聚合列出所有 agent 的会话（服务端逐个 agent create/connect/list/清理）
   */
  async listAllSessions(cwd: string, agents: Array<{ id: string; command: string; args?: string[]; env?: Record<string, string> }>): Promise<any> {
    return this.post('/api/acp/list-all-sessions', { cwd, agents });
  }

  /**
   * 加载会话（同步返回结果）
   */
  async loadSession(sessionId: string, loadSessionId: string, cwd?: string): Promise<any> {
    return this.post('/api/acp/session/load', { sessionId, loadSessionId, cwd });
  }

  /**
   * 恢复会话（同步返回结果）
   */
  async resumeSession(sessionId: string, resumeSessionId: string, cwd?: string): Promise<any> {
    return this.post('/api/acp/session/resume', { sessionId, resumeSessionId, cwd });
  }

  /**
   * 删除 ACP 会话（通过 wrapper session 同步删除）
   */
  async deleteAcpSession(sessionId: string, deleteSessionId: string): Promise<any> {
    return this.post('/api/acp/session/delete', { sessionId, deleteSessionId });
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
   * Ping 检测连接
   */
  async ping(sessionId: string): Promise<void> {
    await this.post('/api/acp/ping', { sessionId });
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
   * 新增项目
   */
  async addProject(name: string, path: string): Promise<any> {
    return this.postNoAuth('/api/projects/add', { name, path });
  }

  /**
   * 删除项目
   */
  async deleteProject(name: string): Promise<any> {
    return this.postNoAuth('/api/projects/delete', { name });
  }

  /**
   * 保存会话到项目
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
   * 获取选中的项目
   */
  async getSelectedProject(): Promise<string | null> {
    try {
      const base = this.localAgentService.getBaseUrl();
      const response = await fetch(`${base}/api/projects/selected`, {
        method: 'GET',
      });
      if (!response.ok) return null;
      const result = await response.json();
      return result.selectedProject || null;
    } catch {
      return null;
    }
  }

  /**
   * 保存选中的项目
   */
  async saveSelectedProject(selectedProject: string | null): Promise<void> {
    await this.postNoAuth('/api/projects/selected', { selectedProject });
  }

  // ============================================================================
  // 任务管理方法（免认证）
  // ============================================================================

  /**
   * 列出所有任务
   */
  async listTasks(): Promise<any> {
    return this.postNoAuth('/api/tasks', {});
  }

  /**
   * 新增任务
   */
  async addTask(task: { id: string; title: string; sessionId: string; agentId: string; cwd?: string }): Promise<any> {
    return this.postNoAuth('/api/tasks/add', task);
  }

  /**
   * 删除任务
   */
  async deleteTask(id: string): Promise<any> {
    return this.postNoAuth('/api/tasks/delete', { id });
  }

  /**
   * 获取选中的任务
   */
  async getSelectedTask(): Promise<string | null> {
    try {
      const base = this.localAgentService.getBaseUrl();
      const response = await fetch(`${base}/api/tasks/selected`, {
        method: 'GET',
      });
      if (!response.ok) return null;
      const result = await response.json();
      return result.selectedTask || null;
    } catch {
      return null;
    }
  }

  /**
   * 保存选中的任务
   */
  async saveSelectedTask(selectedTask: string | null): Promise<void> {
    await this.postNoAuth('/api/tasks/selected', { selectedTask });
  }
}
