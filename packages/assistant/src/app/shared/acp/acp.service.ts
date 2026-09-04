import { Injectable, signal, computed, inject } from '@angular/core';
import {
  AcpSseService,
  ConnectionState as SseConnectionState,
} from './acp-sse.service';
import {
  SessionUpdate,
  PermissionRequest,
  SessionInfo,
  PromptCapabilities,
  ModelState,
  ContentBlock,
  TextContent,
  ToolCall,
  ToolCallUpdate,
  Plan,
  ToolCallStatus,
  ToolKind,
  ConfigOption,
} from './acp-websocket.service';
import { AVAILABLE_AGENTS } from './acp-agent.types';
import type { AgentConfig } from './acp-agent.types';

export interface AcpMessage {
  id: string;
  role: 'user' | 'assistant' | 'thought' | 'tool_call' | 'tool_call_update';
  content: string;
  timestamp: Date;
  // Non-text content blocks (images, audio, resources) attached to this message
  contentBlocks?: ContentBlock[];
  // For tool_call messages
  toolCallId?: string;
  toolTitle?: string;
  toolKind?: ToolKind;
  toolStatus?: ToolCallStatus;
  toolLocations?: Array<{ path: string; line?: number }>;
  toolRawInput?: unknown;
  toolRawOutput?: unknown;
}

export interface AcpPlan {
  planId: string;
  type: string;
  entries: Array<{
    content: string;
    priority: 'high' | 'medium' | 'low';
    status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  }>;
}

export interface ProjectSessionInfo {
  sessionId: string;
  agentId: string;
  title?: string;
  updatedAt?: string;
}

export interface ProjectInfo {
  name: string;
  path: string;
  type: 'project' | 'task';
  sessions: ProjectSessionInfo[];
  /** Task id — required when type='task' */
  id?: string;
  /** Task creation timestamp — required when type='task' */
  createdAt?: string;
}

export interface AcpSessionState {
  sessionId: string | null;
  isConnected: boolean;
  isConnecting: boolean;
  /** Whether the underlying agent process is connected (distinct from the SSE
   *  wrapper transport `isConnected`). False when the agent process crashed. */
  agentConnected: boolean;
  error: string | null;
  promptCapabilities?: PromptCapabilities;
  models?: ModelState;
  configOptions?: ConfigOption[];
  title?: string;
  cwd?: string;
}

@Injectable({
  providedIn: 'root'
})
export class AcpService {
  private sseService = inject(AcpSseService);

  readonly sessionState = signal<AcpSessionState>({
    sessionId: null,
    isConnected: false,
    isConnecting: false,
    agentConnected: false,
    error: null
  });

  readonly messages = signal<AcpMessage[]>([]);
  readonly plans = signal<Map<string, AcpPlan>>(new Map());
  readonly isProcessing = signal<boolean>(false);
  readonly isSwitchingSession = signal<boolean>(true);
  readonly loadingText = signal<string | null>(null);
  readonly processingStartTime = signal<number | null>(null);

  readonly activeTodosId = signal<string | null>(null);
  readonly activeTodosMessages = signal<AcpMessage[]>([]);
  readonly activeQuestionsMessages = signal<AcpMessage[]>([]);

  // Session history
  readonly sessions = signal<SessionInfo[]>([]);
  readonly sessionsLoading = signal<boolean>(false);

  // Projects
  readonly projects = signal<ProjectInfo[]>([]);
  readonly projectsLoading = signal<boolean>(false);

  // Tasks
  readonly tasks = signal<ProjectInfo[]>([]);

  // Working directory hint from file picker
  readonly workingDirHint = signal<string>('');

  // Currently selected project path (synced from agent project selection)
  readonly selectedProjectPath = signal<string | null>(null);

  // Session display state (persisted across panel show/hide)
  readonly showSessionHistory = signal<boolean>(true);

  /** True when no session has been opened/loaded yet (fresh start). */
  readonly isNewSession = signal<boolean>(true);

  /** Real ACP/OpenCode session id of the current wrapper's active session.
   *  Distinct from the wrapper session id (`sessionState.sessionId`), which is
   *  an internal transport id. Required to load sessions/tasks on the agent. */
  readonly acpSessionId = signal<string | null>(null);

  /** Persisted selected session id for the current project (restored on page load). */
  readonly selectedSessionId = signal<string | null>(null);

  // Model
  readonly currentModelId = signal<string | null>(null);

  // Usage
  readonly usage = signal<{ inputTokens?: number; outputTokens?: number; totalTokens?: number } | null>(null);

  // Slash commands
  readonly availableCommands = signal<Array<{ name: string; description: string; input?: unknown }>>([]);

  // Agent selection
  readonly selectedAgent = signal<AgentConfig | null>(AVAILABLE_AGENTS[0]);

  // Question answers tracking: toolCallId -> Set of submitted toolCallIds
  readonly submittedQuestions = signal<Set<string>>(new Set());

  // Whether we are replaying session history (session/load or session/resume).
  // During replay, user_message_chunk notifications are the only source of user
  // messages (unlike live prompts where the user message is added locally first).
  readonly isReplayingHistory = signal(false);

  /** Buffer for messages during history replay. Flushed to `messages` signal in one shot
   *  when replay completes, avoiding N re-renders (one per SSE event). */
  private replayBuffer: AcpMessage[] = [];

  /** Track last todos round during replay to determine final state */
  private lastTodosMessage: AcpMessage | null = null;
  private lastTodosAllCompleted: boolean = false;

  /** Agent id the current wrapper session was created with, used to detect
   *  agent changes so a stale wrapper is not reused. */
  private wrapperAgentId: string | null = null;

  readonly messageCount = computed(() => this.messages().length);
  readonly hasActiveSession = computed(() => this.sessionState().sessionId !== null);
  readonly isConnected = computed(() => this.sessionState().isConnected);
  readonly canDeleteSession = computed(() => {
    // SSE mode always allows session deletion
    return true;
  });

  readonly hasActiveQuestions = computed(() => this.activeQuestionsMessages().length > 0);

  constructor() {
    this.setupSseCallbacks();
    if (typeof window !== 'undefined') {
      this.listAll();
      // Hydrate the persisted selected project path and session id
      this.getSelectedProject().then(p => {
        if (p.selectedProject) this.selectedProjectPath.set(p.selectedProject);
        if (p.selectedSessionId) this.selectedSessionId.set(p.selectedSessionId);
      });
    }
  }

  private setupSseCallbacks(): void {
    this.sseService.onSessionUpdate((update) => {
      this.handleSessionUpdate(update);
    });

    this.sseService.onPermissionRequest((request) => {
      this.handlePermissionRequest(request);
    });

    this.sseService.onPromptComplete((stopReason) => {
      this.isProcessing.set(false);
      this.processingStartTime.set(null);
      if (stopReason === 'end_turn') {
        this.activeTodosId.set(null);
      }
    });

    this.sseService.onSessionCreated(async (sessionId, payload) => {
      // payload.sessionId 是 OpenCode 返回的真实 ACP 会话 id（wrapper session id 保持不变）
      this.acpSessionId.set(payload?.sessionId ?? sessionId ?? null);
      this.sessionState.update(s => ({
        ...s,
        // 保持 wrapper session id，不覆盖为 agent 返回的 ACP session id
        configOptions: payload?.configOptions,
      }));

      // Create task (task creation = isNewSession && no selected project)
      if (this.isNewSession() && !this.selectedProjectPath()) {
        const acpSessionId = this.acpSessionId();
        const title = this.sessionState().title || 'New Task';
        const agentId = this.selectedAgent()?.id || 'opencode';
        const cwd = this.sessionState().cwd || '';
        if (acpSessionId && cwd) {
          const taskId = cwd.replace(/\\/g, '/').split('/').pop() || '';
          if (taskId) {
            try {
              await this.sseService.addProject({
                name: title,
                path: cwd,
                type: 'task',
                sessions: [{ sessionId: acpSessionId, agentId, title }],
                id: taskId,
                createdAt: new Date().toISOString(),
              });
              await this.listTasks();
              await this.saveSelectedProject(cwd);
            } catch (err) {
              console.error('[ACP] Failed to create task:', err);
            }
          }
        }
      }

      // Create session record (moved from acp-chat-input sendMessage)
      if (this.isNewSession()) {
        const acpSessionId = this.acpSessionId();
        if (acpSessionId) {
          const cwd = this.sessionState().cwd || this.workingDirHint() || '';
          const agentId = this.selectedAgent()?.id || 'opencode';

          const newSession: SessionInfo = {
            cwd,
            sessionId: acpSessionId,
            title: this.sessionState().title,
            updatedAt: new Date().toISOString(),
          };
          this.sessions.update(list => [
            newSession,
            ...list.filter(s => s.sessionId !== acpSessionId),
          ]);

          const project = this.projects().find(p => p.path === cwd);
          if (project) {
            await this.saveSessionToProject(cwd, {
              sessionId: acpSessionId,
              agentId,
              title: this.sessionState().title || 'New session',
              updatedAt: new Date().toISOString(),
            });
          }
        }
      }

      // Reset isNewSession after task/session creation logic has read it
      this.isNewSession.set(false);
    });

    this.sseService.onConnected(() => {
      this.sessionState.update(s => ({
        ...s,
        isConnected: true,
        isConnecting: false,
      }));
    });

    this.sseService.onStatus((payload) => {
      // Surface agent prompt capabilities so UI can gate image/audio/embeddedContext
      const promptCapabilities = (payload?.capabilities as { promptCapabilities?: PromptCapabilities } | null)?.promptCapabilities;
      this.sessionState.update(s => ({
        ...s,
        agentConnected: payload?.connected === true,
        promptCapabilities: promptCapabilities ?? s.promptCapabilities,
      }));
    });

    this.sseService.onError((message) => {
      this.sessionState.update(s => ({
        ...s,
        isConnected: false,
        isConnecting: false,
        agentConnected: false,
        error: message,
      }));
    });

    this.sseService.onDisconnected(() => {
      this.sessionState.update(s => ({
        ...s,
        isConnected: false,
        isConnecting: false,
      }));
    });

    // Sync connection state from SSE service
    const syncState = () => {
      const sseState = this.sseService.connectionState();
      const isConnected = sseState === 'connected';
      const isConnecting = sseState === 'connecting';
      const error = this.sseService.error();
      const current = this.sessionState();
      // 仅在实际变化时更新，避免每 100ms 无条件触发变更检测
      if (
        current.isConnected !== isConnected ||
        current.isConnecting !== isConnecting ||
        current.error !== error
      ) {
        this.sessionState.update(s => ({
          ...s,
          isConnected,
          isConnecting,
          error,
        }));
      }
    };

    // Watch for state changes
    setInterval(syncState, 10000);
  }

  // ============================================================================
  // Connection management
  // ============================================================================

  /**
   * Sends ACP agent config (command + args) to the server.
   * This triggers the server to set up the ACP WebSocket endpoint.
   */
  async setAcpConfig(agent: { command: string; args?: string[]; env?: Record<string, string> }): Promise<void> {
    try {
      const response = await fetch('/api/local/acp/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: agent.command, args: agent.args, env: agent.env }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to set ACP config');
      }
    } catch (error) {
      console.error('[ACP] Failed to set config:', error);
      throw error;
    }
  }

  async connect(url: string): Promise<void> {
    this.sessionState.update(s => ({ ...s, isConnecting: true, error: null }));

    try {
      // Create a new wrapper session and connect to SSE (no internal ACP session yet)
      await this.createWrapperSession(this.workingDirHint() || undefined);

      this.sessionState.update(s => ({
        ...s,
        isConnected: true,
        isConnecting: false
      }));

      // List sessions after connecting
      await this.listSessions(this.workingDirHint() || undefined);
    } catch (error: any) {
      this.sessionState.update(s => ({
        ...s,
        isConnecting: false,
        error: error.message || 'Failed to connect'
      }));
      throw error;
    }
  }

  /**
   * Creates a wrapper session only: spawns the agent wrapper on the server,
   * records it in sessionState, and opens the SSE connection. 
   *
   * Callers:
   * - createSession: creates wrapper + internal ACP session (full new session)
   * - connect: creates wrapper only (acp-session-manager connection)
   * - loadSession / resumeSession: creates wrapper only, then loads/resumes the target ACP session
   * - deleteSession: creates a throwaway wrapper and deletes the target ACP session through it
   */
  async createWrapperSession(cwd?: string): Promise<{ sessionId: string; cwd: string }> {
    const agent = this.selectedAgent();
    const result = await this.sseService.createSession({
      cwd,
      agentCommand: agent?.command,
      agentArgs: agent?.args,
      agentEnv: agent?.env,
    });

    this.sessionState.update(s => ({
      ...s,
      sessionId: result.sessionId,
      cwd: result.cwd,
    }));
    this.wrapperAgentId = agent?.id ?? null;

    // Connect to SSE with the new session ID
    await this.sseService.connect(result.sessionId);

    return result;
  }

  async createSession(cwd?: string): Promise<string> {
    const { sessionId, cwd: actualCwd } = await this.createWrapperSession(cwd);

    // Create the underlying ACP session so prompt requests have an active session
    const acpResult = await this.sseService.createAcpSession(sessionId, actualCwd);
    this.acpSessionId.set(acpResult?.sessionId ?? this.acpSessionId());

    return sessionId;
  }

  /**
   * Ensures there is an active wrapper with an underlying ACP session before
   * chatting. Reuses the existing wrapper (created by connect() or history
   * load/resume) when possible; only falls back to creating a new wrapper when
   * there is no usable wrapper, SSE is disconnected, or the selected agent
   * differs from the one the wrapper was created with.
   */
  async ensureChatSession(cwd?: string): Promise<void> {
    const existing = this.sessionState().sessionId;
    const agentChanged = this.wrapperAgentId !== (this.selectedAgent()?.id ?? null);
    if (existing && this.sessionState().isConnected && !agentChanged) {
      const acpResult = await this.sseService.createAcpSession(existing, cwd);
      this.acpSessionId.set(acpResult?.sessionId ?? this.acpSessionId());
      if (cwd) {
        this.sessionState.update(s => ({ ...s, cwd }));
      }
      return;
    }
    await this.createSession(cwd);
  }

  async sendPrompt(content: ContentBlock[]): Promise<void> {
    const sessionId = this.sessionState().sessionId;
    if (!sessionId) {
      throw new Error('No active session');
    }

    this.processingStartTime.set(Date.now());
    this.isProcessing.set(true);

    // Split text blocks for session title generation
    const textBlocks = content.filter(
      (b): b is TextContent => b.type === 'text' && !!b.text
    );

    // 会话标题：用首条用户消息文本生成（ACP agent 不会主动下发 session_info_update 标题）
    if (!this.sessionState().title && textBlocks.length > 0) {
      const firstText = textBlocks[0].text!.trim().replace(/\s+/g, ' ');
      this.sessionState.update(s => ({
        ...s,
        title: firstText.length > 50 ? firstText.slice(0, 50) + '…' : firstText,
      }));
    }

    await this.sseService.sendPrompt(sessionId, content);
  }

  /**
   * Adds a user message to the messages list immediately for instant visual feedback.
   * Called by the chat input component before the async session creation / prompt send.
   */
  addUserMessage(content: string, contentBlocks?: ContentBlock[]): void {
    this.messages.update(msgs => [...msgs, {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      contentBlocks,
      timestamp: new Date()
    }]);
  }

  async cancel(): Promise<void> {
    const sessionId = this.sessionState().sessionId;
    if (sessionId) {
      await this.sseService.cancel(sessionId);
    }
    this.isProcessing.set(false);
  }

  async disconnect(): Promise<void> {
    this.sseService.disconnect();
    this.wrapperAgentId = null;
    this.acpSessionId.set(null);
    this.sessionState.set({
      sessionId: null,
      isConnected: false,
      isConnecting: false,
      agentConnected: false,
      error: null
    });
    this.messages.set([]);
    this.replayBuffer = [];
    this.plans.set(new Map());
    this.sessions.set([]);
    this.usage.set(null);
    this.availableCommands.set([]);
    this.activeTodosId.set(null);
  }

  // ============================================================================
  // Session history
  // ============================================================================

  async listSessions(cwd?: string, cursor?: string): Promise<void> {
    this.sessionsLoading.set(true);
    try {
      const sessionId = this.sessionState().sessionId;
      if (!sessionId) {
        this.sessions.set([]);
        this.sessionsLoading.set(false);
        return;
      }

      // 同步等待 agent 返回会话列表
      const result = await this.sseService.listSessions(sessionId, cwd, cursor);
      const sessions = result?.sessions ?? [];
      this.sessions.set(sessions);
      this.sessionsLoading.set(false);
    } catch (error) {
      console.error('[ACP] Failed to list sessions:', error);
      this.sessionsLoading.set(false);
    }
  }

  async listSessionsFromAllAgents(cwd?: string): Promise<void> {
    this.sessionsLoading.set(true);

    try {
      const targetCwd = cwd || this.workingDirHint() || undefined;
      if (!targetCwd) {
        this.sessions.set([]);
        return;
      }

      // 聚合一次调用：服务端逐个 agent create/connect/list/清理
      const result = await this.sseService.listAllSessions(targetCwd, AVAILABLE_AGENTS);
      const allSessions: SessionInfo[] = result?.sessions ?? [];

      this.sessions.set(allSessions);

      if (cwd) {
        const existingProject = this.projects().find(p => p.path === cwd);
        const existingSessionIds = new Set(
          (existingProject?.sessions || []).map(s => `${s.sessionId}:${s.agentId}`)
        );
        
        for (const session of allSessions) {
          const key = `${session.sessionId}:${(session as any).agentId}`;
          if (existingSessionIds.has(key)) {
            continue;
          }
          
          try {
            await this.sseService.saveSessionToProject(cwd, {
              sessionId: session.sessionId,
              agentId: (session as any).agentId,
              title: session.title || `Session ${session.sessionId.substring(0, 8)}`,
              updatedAt: session.updatedAt || new Date().toISOString(),
            });
            existingSessionIds.add(key);
          } catch (error) {
            console.error('[ACP] Failed to persist session:', session.sessionId, error);
          }
        }
      }
    } catch (error) {
      console.warn('[ACP] Failed to list sessions from all agents:', (error as Error).message || error);
    } finally {
      this.sessionsLoading.set(false);
    }
  }

  // ============================================================================
  // 项目管理
  // ============================================================================

  async listProjects(): Promise<void> {
    this.projectsLoading.set(true);
    try {
      const result = await this.sseService.listProjects();
      this.projects.set(result?.projects ?? []);
    } catch (error) {
      console.error('[ACP] Failed to list projects:', error);
    } finally {
      this.projectsLoading.set(false);
    }
  }

  async listTasks(): Promise<void> {
    try {
      const result = await this.sseService.listTasks();
      this.tasks.set(result?.tasks ?? []);
    } catch (error) {
      console.error('[ACP] Failed to list tasks:', error);
    }
  }

  async listAll(): Promise<void> {
    await Promise.all([this.listProjects(), this.listTasks()]);
  }

  async addProject(name: string, path: string): Promise<void> {
    try {
      await this.sseService.addProject({ name, path, type: 'project' });
    } catch (error) {
      console.error('[ACP] Failed to add project:', error);
      throw error;
    }
    await this.listProjects();
  }

  async deleteProject(name: string): Promise<void> {
    const project = this.projects().find(p => p.name === name);
    try {
      await this.sseService.deleteProject(name, project?.type || 'project');
    } catch (error) {
      console.error('[ACP] Failed to delete project:', error);
      throw error;
    }
    await this.listProjects();
    // 关联清除该项目下的 session 列表
    if (project?.path) {
      this.sessions.update(list => list.filter(s => s.cwd !== project.path));
    }
  }

  async saveSessionToProject(projectPath: string, session: ProjectSessionInfo): Promise<void> {
    try {
      await this.sseService.saveSessionToProject(projectPath, session);
    } catch (error) {
      console.error('[ACP] Failed to save session to project:', error);
    }
  }

  async deleteSessionFromProject(projectPath: string, sessionId: string): Promise<void> {
    try {
      await this.sseService.deleteSessionFromProject(projectPath, sessionId);
      await this.listProjects();
    } catch (error) {
      console.error('[ACP] Failed to delete session from project:', error);
    }
  }

  async getSelectedProject(): Promise<{ selectedProject: string | null; selectedSessionId: string | null }> {
    return this.sseService.getSelectedProject();
  }

  async saveSelectedProject(selectedProject: string | null): Promise<void> {
    this.selectedProjectPath.set(selectedProject);
    await this.sseService.saveSelectedProject(selectedProject);
  }

  async saveSelectedSession(sessionId: string | null): Promise<void> {
    this.selectedSessionId.set(sessionId);
    await this.sseService.saveSelectedProject(this.selectedProjectPath(), sessionId);
  }

  // ============================================================================
  // 任务管理
  // ============================================================================

  async deleteTask(id: string): Promise<void> {
    try {
      const task = this.tasks().find(t => t.id === id);
      await this.sseService.deleteProject(task?.name || '', 'task');
      await this.listProjects();
    } catch (error) {
      console.error('[ACP] Failed to delete task:', error);
      throw error;
    }
  }

  async switchAgent(agentId: string, cwd?: string): Promise<void> {
    const agent = AVAILABLE_AGENTS.find(a => a.id === agentId);
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }

    if (this.wrapperAgentId === agentId && this.sessionState().isConnected) {
      return;
    }

    if (this.sessionState().sessionId) {
      this.disconnect();
    }

    this.selectedAgent.set(agent);
  }

  async loadSession(sessionId: string, cwd?: string, agentId?: string): Promise<void> {
    this.isSwitchingSession.set(true);

    // Phase 1: Switch agent if needed
    if (agentId && agentId !== this.wrapperAgentId) {
      this.loadingText.set('Switching agent...');
      await this.switchAgent(agentId, cwd);
    }

    // Phase 2: Reset state
    this.loadingText.set('Preparing session...');
    this.messages.set([]);
    this.replayBuffer = [];
    this.plans.set(new Map());
    this.activeTodosId.set(null);
    this.activeTodosMessages.set([]);
    this.activeQuestionsMessages.set([]);
    this.isNewSession.set(false);
    // 会话标题：从已加载的会话列表取回
    const loaded = this.sessions().find(s => s.sessionId === sessionId);
    if (loaded?.title) {
      this.sessionState.update(s => ({ ...s, title: loaded.title }));
    }

    let currentSessionId = this.sessionState().sessionId;

    // Phase 3: Create wrapper session if needed
    if (!currentSessionId) {
      this.loadingText.set('Connecting to server...');
      const wrapper = await this.createWrapperSession(cwd || this.workingDirHint() || undefined);
      currentSessionId = wrapper.sessionId;
      this.sessionState.update(s => ({ ...s, isConnecting: true, isConnected: false }));
    }

    // Phase 4: Load session history
    this.loadingText.set('Loading session history...');
    this.isReplayingHistory.set(true);
    try {
      const result = await this.sseService.loadSession(currentSessionId, sessionId, cwd);

      this.acpSessionId.set(sessionId);
      this.sessionState.update(s => ({
        ...s,
        isConnected: true,
        isConnecting: false,
        configOptions: result?.configOptions ?? s.configOptions,
      }));
    } finally {
      this.isReplayingHistory.set(false);
      
      // 回放结束后，根据最后一轮todos的状态决定是否清空activeTodosMessages
      if (this.lastTodosMessage && !this.lastTodosAllCompleted) {
        this.activeTodosMessages.set([this.lastTodosMessage]);
        this.activeTodosId.set(this.lastTodosMessage.toolCallId ?? null);
      }
      
      // 清理临时变量
      this.lastTodosMessage = null;
      this.lastTodosAllCompleted = false;
      
      this.flushReplayBuffer();
      this.isSwitchingSession.set(false);
      this.loadingText.set(null);
    }
  }

  async resumeSession(sessionId: string, cwd?: string, agentId?: string, replayFrom?: { type: string }): Promise<void> {
    this.isSwitchingSession.set(true);

    // Phase 1: Switch agent if needed
    if (agentId && agentId !== this.wrapperAgentId) {
      this.loadingText.set('Switching agent...');
      await this.switchAgent(agentId, cwd);
    }

    // Phase 2: Reset state
    this.loadingText.set('Preparing session...');
    this.messages.set([]);
    this.plans.set(new Map());
    this.activeTodosId.set(null);
    this.activeTodosMessages.set([]);
    this.activeQuestionsMessages.set([]);
    this.isNewSession.set(false);
    // 会话标题：从已加载的会话列表取回
    const resumed = this.sessions().find(s => s.sessionId === sessionId);
    if (resumed?.title) {
      this.sessionState.update(s => ({ ...s, title: resumed.title }));
    }

    let currentSessionId = this.sessionState().sessionId;

    // Phase 3: Create wrapper session if needed
    if (!currentSessionId) {
      this.loadingText.set('Connecting to server...');
      const wrapper = await this.createWrapperSession(cwd || this.workingDirHint() || undefined);
      currentSessionId = wrapper.sessionId;
      this.sessionState.update(s => ({ ...s, isConnecting: true, isConnected: false }));
    }

    // Phase 4: Resume session
    this.loadingText.set('Loading session history...');
    this.isReplayingHistory.set(true);
    try {
      await this.sseService.resumeSession(currentSessionId, sessionId, cwd);

      this.acpSessionId.set(sessionId);
      this.sessionState.update(s => ({
        ...s,
        isConnected: true,
        isConnecting: false,
      }));
    } finally {
      this.isReplayingHistory.set(false);
      
      // 回放结束后，根据最后一轮todos的状态决定是否清空activeTodosMessages
      if (this.lastTodosMessage && !this.lastTodosAllCompleted) {
        this.activeTodosMessages.set([this.lastTodosMessage]);
        this.activeTodosId.set(this.lastTodosMessage.toolCallId ?? null);
      }
      
      // 清理临时变量
      this.lastTodosMessage = null;
      this.lastTodosAllCompleted = false;
      
      this.flushReplayBuffer();
      this.isSwitchingSession.set(false);
      this.loadingText.set(null);
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    const currentSessionId = this.sessionState().sessionId;

    if (currentSessionId) {
      // 通过当前活跃的连接同步删除目标 ACP 会话
      await this.sseService.deleteAcpSession(currentSessionId, sessionId);
    } else {
      // 无活跃 wrapper：先创建并连接一次性 wrapper，再通过它删除目标 ACP 会话
      const wrapper = await this.createWrapperSession(this.workingDirHint() || undefined);
      await this.sseService.deleteAcpSession(wrapper.sessionId, sessionId);
      // 重置一次性 wrapper 的连接状态（不清空 sessions 列表）
      this.sseService.disconnect();
      this.wrapperAgentId = null;
      this.acpSessionId.set(null);
      this.sessionState.set({
        sessionId: null,
        isConnected: false,
        isConnecting: false,
        agentConnected: false,
        error: null
      });
    }

    // 从列表中移除
    this.sessions.update(sessions => sessions.filter(s => s.sessionId !== sessionId));
  }

  // ============================================================================
  // Model management
  // ============================================================================

  async setModel(modelId: string): Promise<void> {
    const sessionId = this.sessionState().sessionId;
    if (!sessionId) {
      throw new Error('No active session');
    }
    // TODO: Implement setModel via SSE/HTTP when backend supports it
    console.warn('[ACP] setModel not yet implemented for SSE mode');
  }

  async setConfigOption(configId: string, type: 'id' | 'boolean', value: string | boolean): Promise<void> {
    const sessionId = this.sessionState().sessionId;
    if (!sessionId) {
      throw new Error('No active session');
    }
    const result = await this.sseService.setConfigOption(sessionId, configId, type, value);
    if (result?.configOptions) {
      this.sessionState.update(s => ({
        ...s,
        configOptions: result.configOptions,
      }));
    }
  }

  // ============================================================================
  // Ping/Pong
  // ============================================================================

  async ping(): Promise<void> {
    const sessionId = this.sessionState().sessionId;
    if (!sessionId) {
      throw new Error('No active session');
    }
    await this.sseService.ping(sessionId);
  }

  // ============================================================================
  // Private handlers
  // ============================================================================

  private handleSessionUpdate(update: SessionUpdate): void {
    switch (update.sessionUpdate) {
      case 'agent_message_chunk':
        this.appendAssistantChunk(update.content);
        break;

      case 'agent_thought_chunk':
        this.appendThoughtChunk(update.content);
        break;

      case 'user_message_chunk':
        if (this.isReplayingHistory()) {
          this.appendReplayedUserChunk(update.content, update.messageId);
        }
        // Live prompt: user message chunks are echoed back, we already added the user message
        break;

      case 'tool_call':
      case 'tool_call_update':
        this.handleToolCallNew(update);
        break;

      case 'plan_update':
        this.handlePlanUpdate(update);
        break;

      case 'current_mode_update':
        // Deprecated: convert to configOptions update for backward compatibility
        this.sessionState.update(s => ({
          ...s,
          configOptions: s.configOptions?.map(o =>
            o.category === 'mode' ? { ...o, currentValue: update.currentModeId } : o
          ),
        }));
        break;

      case 'session_info_update':
        if (update.title) {
          this.sessionState.update(s => ({
            ...s,
            title: update.title
          }));
        }
        break;

      case 'usage_update':
        this.usage.set(update.usage ?? null);
        break;

      case 'available_commands_update':
        this.availableCommands.set(update.availableCommands);
        break;

      case 'config_option_update':
        this.sessionState.update(s => ({
          ...s,
          configOptions: update.configOptions,
        }));
        break;
    }
  }

  private static extractTodosFromMessage(msg: AcpMessage): Array<{ content: string; status: string; priority: string }> | null {
    const rawOutput = msg.toolRawOutput as any;
    const fromOutput = rawOutput?.metadata?.todos;
    if (Array.isArray(fromOutput) && fromOutput.length > 0) return fromOutput;
    const rawInput = msg.toolRawInput as any;
    const fromInput = rawInput?.todos;
    if (Array.isArray(fromInput) && fromInput.length > 0) return fromInput;
    return null;
  }

  private handleToolCallNew(update: any): void {
    const isTodo = this.isTodosPayload(update);
    const isQuestion = this.isQuestionsPayload(update);
    
    if (isTodo) {
      this.handleTodosMessage(update);
      return;
    }
    
    if (this.isQuestionAnswer(update)) {
      this.handleQuestionAnswer(update);
      return;
    }
    
    if (isQuestion) {
      this.handleQuestionsMessage(update);
      return;
    }
    
    if (this.isReplayingHistory()) {
      this.handleReplayMode(update);
      return;
    }
    
    const toolCallId = update.toolCallId;
    
    if (update.sessionUpdate === 'tool_call_update' && toolCallId) {
      if (this.mergeToolCallUpdate(update, toolCallId)) return;
    }
    
    const toolCallMsg = this.createToolCallMessage(update);
    this.messages.update(msgs => [...msgs, toolCallMsg]);
  }

  /** 合并 update 字段到现有消息（保留原始 toolKind、toolRawOutput 等） */
  private mergeUpdateToExisting(existing: AcpMessage, update: any, toolCallId?: string): AcpMessage {
    return {
      ...existing,
      ...(toolCallId ? { id: toolCallId, toolCallId } : {}),
      toolTitle: update.title ?? existing.toolTitle,
      toolKind: update.kind ?? existing.toolKind,
      toolStatus: update.status ?? existing.toolStatus,
      toolLocations: update.locations ?? existing.toolLocations,
      toolRawInput: update.rawInput ?? existing.toolRawInput,
      toolRawOutput: update.rawOutput ?? existing.toolRawOutput,
    };
  }

  /** 合并 tool_call_update 到现有 tool_call 消息 */
  private mergeToolCallUpdate(update: any, toolCallId: string): boolean {
    const existingIdx = this.messages().findIndex(m => m.toolCallId === toolCallId);
    if (existingIdx === -1) return false;
    
    const updated = this.mergeUpdateToExisting(this.messages()[existingIdx], update);
    this.messages.update(msgs => {
      const newMsgs = [...msgs];
      newMsgs[existingIdx] = updated;
      return newMsgs;
    });
    return true;
  }

  private handleReplayMode(update: any): void {
    const toolCallId = update.toolCallId;
    if (toolCallId) {
      const existingIdx = this.replayBuffer.findIndex(
        m => m.toolCallId === toolCallId || m.id === toolCallId
      );
      if (existingIdx !== -1) {
        this.replayBuffer[existingIdx] = this.mergeUpdateToExisting(
          this.replayBuffer[existingIdx], update, toolCallId
        );
        return;
      }
    }
    
    const toolCallMsg = this.createToolCallMessage(update);
    this.replayBuffer.push(toolCallMsg);
  }

  private isTodosPayload(update: any): boolean {
    const rawInput = update.rawInput;
    if (rawInput && Array.isArray(rawInput.todos) && rawInput.todos.length > 0) return true;
    const rawOutput = update.rawOutput;
    if (rawOutput?.metadata && Array.isArray(rawOutput.metadata.todos) && rawOutput.metadata.todos.length > 0) return true;
    return false;
  }

  private isQuestionsPayload(update: any): boolean {
    const rawInput = update.rawInput;
    return rawInput && Array.isArray(rawInput.questions) && rawInput.questions.length > 0;
  }

  private createToolCallMessage(update: any): AcpMessage {
    const toolCallId = update.toolCallId;
    const isUpdate = update.sessionUpdate === 'tool_call_update';
    return {
      id: isUpdate ? `${toolCallId}-update-${crypto.randomUUID().slice(0, 8)}` : (toolCallId || crypto.randomUUID()),
      role: update.sessionUpdate,
      content: '',
      timestamp: new Date(),
      toolCallId,
      toolTitle: update.title,
      toolKind: update.kind,
      toolStatus: update.status || 'pending',
      toolLocations: update.locations,
      toolRawInput: update.rawInput,
      toolRawOutput: update.rawOutput
    };
  }

  private handleTodosMessage(update: any): void {
    const message = this.createToolCallMessage(update);
    
    // 回放模式下：不加入replayBuffer，不立即更新activeTodosMessages
    if (this.isReplayingHistory()) {
      // 只在tool_call类型时记录信息
      if (update.sessionUpdate === 'tool_call') {
        this.lastTodosMessage = message;
        this.lastTodosAllCompleted = false;
      }
      // 在tool_call_update时检查是否全部完成
      if (update.sessionUpdate === 'tool_call_update') {
        const todos = AcpService.extractTodosFromMessage(message);
        this.lastTodosAllCompleted = todos ? todos.every(t => t.status === 'completed') : false;
      }
      return;
    }
    
    // 非回放模式：原有逻辑
    if (update.sessionUpdate === 'tool_call') {
      this.activeTodosMessages.set([message]);
      this.activeTodosId.set(message.toolCallId ?? null);
    } else {
      // tool_call_update：更新现有消息
      this.activeTodosMessages.update(messages => {
        const existingIndex = messages.findIndex(m => m.toolCallId === message.toolCallId);
        if (existingIndex !== -1) {
          return messages.map((m, i) => 
            i === existingIndex ? { ...m, ...message } : m
          );
        } else {
          return [...messages, message];
        }
      });
    }
    
    // 检查是否所有todos都已完成
    const todos = AcpService.extractTodosFromMessage(message);
    if (todos && todos.every(t => t.status === 'completed')) {
      this.activeTodosMessages.set([]);
      this.activeTodosId.set(null);
    }
  }

  private handleQuestionsMessage(update: any): void {
    const message = this.createToolCallMessage(update);
    
    // 回放模式下：不加入replayBuffer
    if (this.isReplayingHistory()) {
      const toolCallId = message.toolCallId;
      
      // 检查是否已有答案（通过submittedQuestions判断）
      if (toolCallId && this.submittedQuestions().has(toolCallId)) {
        // 已有答案，不保存到activeQuestionsMessages
        return;
      }
      
      // 未有答案，保存到activeQuestionsMessages
      this.activeQuestionsMessages.update(messages => {
        const existingIndex = messages.findIndex(m => m.toolCallId === message.toolCallId);
        if (existingIndex !== -1) {
          return messages.map((m, i) => 
            i === existingIndex ? { ...m, ...message } : m
          );
        } else {
          return [...messages, message];
        }
      });
      return;
    }
    
    // 非回放模式：原有逻辑
    this.activeQuestionsMessages.update(messages => {
      const existingIndex = messages.findIndex(m => m.toolCallId === message.toolCallId);
      if (existingIndex !== -1) {
        return messages.map((m, i) => 
          i === existingIndex ? { ...m, ...message } : m
        );
      } else {
        return [...messages, message];
      }
    });
  }

  private isQuestionAnswer(update: any): boolean {
    if (update.sessionUpdate !== 'tool_call_update') return false;
    if (update.status !== 'completed' && update.status !== 'failed') return false;
    
    const toolCallId = update.toolCallId;
    if (!toolCallId) return false;
    
    return this.activeQuestionsMessages().some(m => m.toolCallId === toolCallId);
  }

  private handleQuestionAnswer(update: any): void {
    const toolCallId = update.toolCallId;
    const answerMsg = this.createToolCallMessage(update);
    
    // 无论回放还是非回放模式，答案消息都加入replayBuffer
    // 这样答案会出现在messages中
    this.replayBuffer.push(answerMsg);
    
    // 从activeQuestionsMessages中移除对应的question
    this.activeQuestionsMessages.update(messages => 
      messages.filter(m => m.toolCallId !== toolCallId)
    );
    
    // 标记为已提交
    this.submittedQuestions.update(s => {
      const next = new Set(s);
      next.add(toolCallId);
      return next;
    });
  }

  private handlePlanUpdate(update: any): void {
    const planData = update.plan;
    if (!planData?.planId) return;

    this.plans.update(current => {
      const next = new Map(current);
      const existing = next.get(planData.planId);
      next.set(planData.planId, {
        planId: planData.planId,
        type: planData.type || existing?.type || 'items',
        entries: planData.entries || []
      });
      return next;
    });
  }

  private handlePermissionRequest(request: PermissionRequest): void {
    const sessionId = this.sessionState().sessionId;
    const event = new CustomEvent('acp-permission-request', {
      detail: {
        requestId: request.requestId,
        params: request,
        resolve: async (outcome: any) => {
          if (sessionId) {
            await this.sseService.sendPermissionResponse(sessionId, request.requestId, outcome);
          }
        }
      }
    });
    window.dispatchEvent(event);
  }

  private maybeClearSwitchingSession(): void {
    if (this.isSwitchingSession() && !this.isReplayingHistory()) {
      this.isSwitchingSession.set(false);
    }
  }

  /** Flush all buffered replay messages into the `messages` signal in one shot. */
  private flushReplayBuffer(): void {
    if (this.replayBuffer.length > 0) {
      this.messages.set(this.replayBuffer);
      this.replayBuffer = [];
    }
  }

  private appendAssistantChunk(content: ContentBlock): void {
    this.maybeClearSwitchingSession();
    if (content?.type === 'text') {
      if (content.text) {
        this.appendAssistantMessage(content.text);
      }
    } else {
      this.appendAssistantBlock(content);
    }
  }

  private appendThoughtChunk(content: ContentBlock): void {
    this.maybeClearSwitchingSession();
    if (content?.type === 'text') {
      if (content.text) {
        this.appendThoughtMessage(content.text);
      }
    } else {
      this.appendThoughtBlock(content);
    }
  }

  private appendReplayedUserChunk(content: ContentBlock, messageId?: string): void {
    this.maybeClearSwitchingSession();
    if (content?.type === 'text') {
      if (content.text) {
        this.appendReplayedUserMessage(content.text, messageId);
      }
    } else {
      this.appendReplayedUserBlock(content, messageId);
    }
  }

  private appendAssistantBlock(content: ContentBlock): void {
    if (this.isReplayingHistory()) {
      const last = this.replayBuffer[this.replayBuffer.length - 1];
      if (last && last.role === 'assistant') {
        last.contentBlocks = [...(last.contentBlocks ?? []), content];
      } else {
        this.replayBuffer.push({
          id: crypto.randomUUID(),
          role: 'assistant',
          content: '',
          contentBlocks: [content],
          timestamp: new Date()
        });
      }
      return;
    }
    this.messages.update(msgs => {
      const lastMsg = msgs[msgs.length - 1];
      if (lastMsg && lastMsg.role === 'assistant') {
        lastMsg.contentBlocks = [...(lastMsg.contentBlocks ?? []), content];
        return [...msgs];
      }
      return [...msgs, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: '',
        contentBlocks: [content],
        timestamp: new Date()
      }];
    });
  }

  private appendThoughtBlock(content: ContentBlock): void {
    if (this.isReplayingHistory()) {
      const last = this.replayBuffer[this.replayBuffer.length - 1];
      if (last && last.role === 'thought') {
        last.contentBlocks = [...(last.contentBlocks ?? []), content];
      } else {
        this.replayBuffer.push({
          id: crypto.randomUUID(),
          role: 'thought',
          content: '',
          contentBlocks: [content],
          timestamp: new Date()
        });
      }
      return;
    }
    this.messages.update(msgs => {
      const lastMsg = msgs[msgs.length - 1];
      if (lastMsg && lastMsg.role === 'thought') {
        lastMsg.contentBlocks = [...(lastMsg.contentBlocks ?? []), content];
        return [...msgs];
      }
      return [...msgs, {
        id: crypto.randomUUID(),
        role: 'thought',
        content: '',
        contentBlocks: [content],
        timestamp: new Date()
      }];
    });
  }

  private appendReplayedUserBlock(content: ContentBlock, messageId?: string): void {
    if (this.isReplayingHistory()) {
      const last = this.replayBuffer[this.replayBuffer.length - 1];
      if (last && last.role === 'user' && messageId && last.id === messageId) {
        last.contentBlocks = [...(last.contentBlocks ?? []), content];
      } else {
        this.replayBuffer.push({
          id: messageId || crypto.randomUUID(),
          role: 'user',
          content: '',
          contentBlocks: [content],
          timestamp: new Date()
        });
      }
      return;
    }
    this.messages.update(msgs => {
      const lastMsg = msgs[msgs.length - 1];
      if (lastMsg && lastMsg.role === 'user' && messageId && lastMsg.id === messageId) {
        lastMsg.contentBlocks = [...(lastMsg.contentBlocks ?? []), content];
        return [...msgs];
      }
      return [...msgs, {
        id: messageId || crypto.randomUUID(),
        role: 'user',
        content: '',
        contentBlocks: [content],
        timestamp: new Date()
      }];
    });
  }

  private appendAssistantMessage(text: string): void {
    if (this.isReplayingHistory()) {
      const last = this.replayBuffer[this.replayBuffer.length - 1];
      if (last && last.role === 'assistant') {
        last.content += text;
      } else {
        this.replayBuffer.push({
          id: crypto.randomUUID(),
          role: 'assistant',
          content: text,
          timestamp: new Date()
        });
      }
      return;
    }
    this.messages.update(msgs => {
      const lastMsg = msgs[msgs.length - 1];
      if (lastMsg && lastMsg.role === 'assistant') {
        lastMsg.content += text;
        return [...msgs];
      }
      return [...msgs, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: text,
        timestamp: new Date()
      }];
    });
  }

  private appendThoughtMessage(text: string): void {
    if (this.isReplayingHistory()) {
      const last = this.replayBuffer[this.replayBuffer.length - 1];
      if (last && last.role === 'thought') {
        last.content += text;
      } else {
        this.replayBuffer.push({
          id: crypto.randomUUID(),
          role: 'thought',
          content: text,
          timestamp: new Date()
        });
      }
      return;
    }
    this.messages.update(msgs => {
      const lastMsg = msgs[msgs.length - 1];
      if (lastMsg && lastMsg.role === 'thought') {
        lastMsg.content += text;
        return [...msgs];
      }
      return [...msgs, {
        id: crypto.randomUUID(),
        role: 'thought',
        content: text,
        timestamp: new Date()
      }];
    });
  }

  private appendReplayedUserMessage(text: string, messageId?: string): void {
    if (this.isReplayingHistory()) {
      const last = this.replayBuffer[this.replayBuffer.length - 1];
      if (last && last.role === 'user' && messageId && last.id === messageId) {
        last.content += text;
      } else {
        this.replayBuffer.push({
          id: messageId || crypto.randomUUID(),
          role: 'user',
          content: text,
          timestamp: new Date()
        });
      }
      return;
    }
    this.messages.update(msgs => {
      const lastMsg = msgs[msgs.length - 1];
      if (lastMsg && lastMsg.role === 'user' && messageId && lastMsg.id === messageId) {
        lastMsg.content += text;
        return [...msgs];
      }
      return [...msgs, {
        id: messageId || crypto.randomUUID(),
        role: 'user',
        content: text,
        timestamp: new Date()
      }];
    });
  }

  // ============================================================================
  // Question answers
  // ============================================================================

  isQuestionToolCall(message: AcpMessage): boolean {
    if (message.role !== 'tool_call') return false;
    const rawInput = message.toolRawInput as any;
    return rawInput && Array.isArray(rawInput.questions) && rawInput.questions.length > 0;
  }

  async submitQuestionAnswers(toolCallId: string, answers: string[]): Promise<void> {
    if (this.submittedQuestions().has(toolCallId)) return;

    // Format answers as simple text (one per line)
    const answerText = answers.map((a, i) => `Question ${i + 1}: ${a}`).join('\n');

    // Mark as submitted
    this.submittedQuestions.update(s => {
      const next = new Set(s);
      next.add(toolCallId);
      return next;
    });

    // Send answers via session/prompt
    const sessionId = this.sessionState().sessionId;
    if (sessionId) {
      const content = [{ type: 'text', text: answerText }];
      await this.sseService.sendPrompt(sessionId, content);
    }
  }

  async ignoreQuestions(toolCallId: string): Promise<void> {
    if (this.submittedQuestions().has(toolCallId)) return;

    // Mark as submitted (ignored)
    this.submittedQuestions.update(s => {
      const next = new Set(s);
      next.add(toolCallId);
      return next;
    });

    // Send skip signal
    const sessionId = this.sessionState().sessionId;
    if (sessionId) {
      const content = [{ type: 'text', text: '[Questions ignored by user]' }];
      await this.sseService.sendPrompt(sessionId, content);
    }
  }

  // ============================================================================
  // Utility methods
  // ============================================================================

  clearError(): void {
    this.sessionState.update(s => ({ ...s, error: null }));
  }

  setError(message: string): void {
    this.sessionState.update(s => ({ ...s, error: message }));
  }

  clearMessages(): void {
    this.messages.set([]);
    this.replayBuffer = [];
    this.plans.set(new Map());
    this.usage.set(null);
    this.activeTodosId.set(null);
    this.submittedQuestions.set(new Set());
  }
}
