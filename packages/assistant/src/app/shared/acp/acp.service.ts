import { Injectable, signal, computed, inject, effect, untracked } from '@angular/core';
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
  ToolCall,
  ToolCallUpdate,
  ToolCallContent,
  Plan,
  ToolCallStatus,
  ToolKind,
  ConfigOption,
} from './acp.model';
import { AVAILABLE_AGENTS } from './acp-agent.types';
import type { AgentConfig } from './acp-agent.types';
import { LocalAgentService } from '../local-agent/local-agent.service';
import { ACP_READ_ONLY } from './acp-readonly.token';

const AGENT_STORAGE_KEY = 'clover_selected_agent';

/**
 * Fallback wait for the server's "history replay complete" marker
 * (`session_loaded` / `session_resumed`, see `waitForReplayComplete`).
 * The marker is published right after `session/load` resolves, so it normally
 * arrives within milliseconds; this only bounds the case where an older backend
 * does not send it at all, so session switching can never hang.
 */
const REPLAY_COMPLETE_TIMEOUT_MS = 10_000;

function getInitialAgent(): AgentConfig {
  if (typeof localStorage !== 'undefined') {
    const id = localStorage.getItem(AGENT_STORAGE_KEY);
    const saved = AVAILABLE_AGENTS.find(a => a.id === id);
    if (saved) return saved;
  }
  return AVAILABLE_AGENTS[0];
}

export interface AcpMessage {
  id: string;
  role: 'user' | 'assistant' | 'thought' | 'tool_call' | 'tool_call_update' | 'error';
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
  /**
   * ACP tool-call result blocks (`ToolCallUpdate.content`).
   *
   * Many agents — `opencode acp` among them — put the tool's textual result here
   * while leaving `rawOutput` empty or metadata-only, so anything that needs the
   * result payload (e.g. the RAG result extractor) must read this field.
   */
  toolContent?: ToolCallContent[];
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
  /** MCP server names bound to this session, persisted so they survive page reloads. */
  mcpServers?: string[];
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
  /** MCP server names bound to this session (survives page reload via persisted record). */
  mcpServers?: string[];
}

@Injectable({
  providedIn: 'root'
})
export class AcpService {
  private sseService = inject(AcpSseService);
  private localAgentService = inject(LocalAgentService);

  /**
   * Read-only viewer instance (see `ACP_READ_ONLY`): used by the collaboration
   * session detail panel to `session/load` another session in isolation. Such an
   * instance renders history only and must never persist local preferences.
   */
  private readonly readOnly = inject(ACP_READ_ONLY, { optional: true }) ?? false;

  /** Placeholder session title used until the agent provides its own (LLM) title. */
  private static readonly PLACEHOLDER_TITLE = 'New Session';

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

  // Projects
  readonly projects = signal<ProjectInfo[]>([]);
  readonly projectsLoading = signal<boolean>(false);

  // Tasks
  readonly tasks = signal<ProjectInfo[]>([]);

  // Currently selected project path (synced from agent project selection)
  readonly selectedProjectPath = signal<string | null>(null);

  // Session display state (persisted across panel show/hide)
  readonly showSessionHistory = signal<boolean>(true);

  /** True when no session has been opened/loaded yet (fresh start). */
  readonly isNewSession = signal<boolean>(true);

  // NOTE: there is a single session identifier in this app: `sessionState().sessionId`
  // is the agent-generated ACP session id. Nothing needs to be set again; you can directly use it to
  // perform session/load, session/delete, and other operations.

  // Model
  readonly currentModelId = signal<string | null>(null);

  // Usage
  readonly usage = signal<{ inputTokens?: number; outputTokens?: number; totalTokens?: number } | null>(null);

  // Slash commands
  readonly availableCommands = signal<Array<{ name: string; description: string; input?: unknown }>>([]);

  /** Slash command waiting to be written into the chat input.
   *  Set by outside triggers (e.g. Settings → Appearance) and applied by every
   *  chat input instance until the user edits or sends the text. */
  readonly pendingSlashCommand = signal<string | null>(null);

  // Agent selection
  readonly selectedAgent = signal<AgentConfig | null>(getInitialAgent());

  // Question answers tracking: toolCallId -> Set of submitted toolCallIds
  readonly submittedQuestions = signal<Set<string>>(new Set());

  // Whether we are replaying session history (session/load or session/resume).
  // During replay, user_message_chunk notifications are the only source of user
  // messages (unlike live prompts where the user message is added locally first).
  readonly isReplayingHistory = signal(false);

  /** Currently selected MCP server names from the chat input toolbar */
  readonly selectedMcpServers = signal<string[]>([]);

  /** Buffer for messages during history replay. Flushed to `messages` signal in one shot
   *  when replay completes, avoiding N re-renders (one per SSE event). */
  private replayBuffer: AcpMessage[] = [];

  /** Track last todos round during replay to determine final state */
  private lastTodosMessage: AcpMessage | null = null;
  private lastTodosAllCompleted: boolean = false;

  /**
   * Pending resolver for the server's "history replay complete" marker
   * (`session_loaded` / `session_resumed`). Registered right after the SSE
   * stream opens and before `session/load` / `session/resume` is issued, so the
   * marker cannot arrive before the waiter exists.
   */
  private replayCompleteWaiter: { sessionId: string; resolve: () => void } | null = null;
  private replayCompleteTimer: ReturnType<typeof setTimeout> | null = null;

  /** Whether `sessionState().title` is a local placeholder (first user message)
   *  still awaiting the agent's own (LLM) title. Cleared once an agent title is
   *  adopted via `applySessionTitle`. */
  private provisionalTitle = false;

  /** 用户在无会话状态下（New Task 页面，configOptions 由持久化文件恢复）
   *  选择的配置项，待 ensureChatSession 建立 ACP 会话后下发给 agent。 */
  private pendingConfigSelection: { configId: string; type: 'id' | 'boolean'; value: string | boolean } | null = null;

  /** Timer for the delayed agent-title refresh after a prompt completes. */
  private titleRefreshTimer: ReturnType<typeof setTimeout> | null = null;

  readonly messageCount = computed(() => this.messages().length);
  readonly hasActiveSession = computed(() => this.sessionState().sessionId !== null);
  readonly isConnected = computed(() => this.sessionState().isConnected);
  readonly canDeleteSession = computed(() => {
    // SSE mode always allows session deletion
    return true;
  });

  readonly hasActiveQuestions = computed(() => this.activeQuestionsMessages().length > 0);

  constructor() {
    effect(() => {
      const agent = this.selectedAgent();
      if (typeof localStorage !== 'undefined' && !this.readOnly) {
        // 只读查看实例不得改写用户的 agent 偏好
        if (agent) localStorage.setItem(AGENT_STORAGE_KEY, agent.id);
        else localStorage.removeItem(AGENT_STORAGE_KEY);
      }
      // 启动（effect 首次运行）与切换 agent 时，从服务端读取该 agentId
      // 持久化的 configOptions，恢复 mode/model 选择器。
      // 必须 untracked：reloadConfigOptions 会同步读 sessionState，
      // 否则 sessionState 变化会反过来触发本 effect，形成请求死循环
      untracked(() => {
        if (this.readOnly) return;
        void this.reloadConfigOptions();
      });
    });
    this.setupSseCallbacks();
  }

  public getSelectedProjectInfo(selectedProjectPath: string | null): ProjectInfo | null {
    if (!selectedProjectPath) return null;
    const projects = this.projects();
    const tasks = this.tasks();
    return projects.find(p => p.path === selectedProjectPath)
      || tasks.find(t => t.path === selectedProjectPath)
      || null;
  }

  public findSessionInfo(sessionId: string, project: ProjectInfo | null): { cwd?: string; agentId?: string } {
    if (project) {
      const session = project.sessions?.find(s => s.sessionId === sessionId);
      if (session) {
        return { cwd: project.path, agentId: session.agentId };
      }
    }

    for (const project of this.projects()) {
      const session = project.sessions?.find(s => s.sessionId === sessionId);
      if (session) {
        return { cwd: project.path, agentId: session.agentId };
      }
    }

    return {};
  }

  /** 在 projects/tasks 持久化记录中查找指定 session 的信息。 */
  private findSessionRecord(sessionId: string): ProjectSessionInfo | null {
    for (const record of [...this.projects(), ...this.tasks()]) {
      const found = record.sessions?.find(s => s.sessionId === sessionId);
      if (found) return found;
    }
    return null;
  }

  /** 按当前 agentId 把最新 configOptions 持久化到服务端
   *  （~/.clover/agent-config.json），页面刷新后无需真实会话即可恢复选择器。
   *  写入失败静默，不影响会话流程。 */
  private persistConfigOptions(options?: ConfigOption[]): void {
    if (this.readOnly) return;
    const agentId = this.selectedAgent()?.id;
    if (!agentId || !options?.length) return;
    this.sseService.saveAgentConfig(agentId, options).catch(() => {});
  }

  /** 从服务端读取当前 agentId 持久化的 configOptions 并回填 sessionState。
   *  agent-config.json 仅对 New Task 生效（constructor effect 启动时、
   *  切换 agent 时、createNewTask 调用）；已加载/恢复的历史会话只认
   *  session/load、session/resume 返回的 configOptions。
   *  - 非 New Task 状态 → 不读取（含 await 期间进入历史会话的情况）
   *  - 拉取期间已有真实会话写入配置、或 agent 已再次切换 → 丢弃结果
   *  - 该 agent 无缓存 → 清空，避免残留上一个 agent 的配置 */
  async reloadConfigOptions(): Promise<void> {
    if (!this.isNewSession()) return;
    const agentId = this.selectedAgent()?.id;
    if (!agentId) return;
    const before = this.sessionState().configOptions;
    try {
      const options = await this.sseService.getAgentConfig(agentId);
      if (!this.isNewSession()) return;
      if (this.selectedAgent()?.id !== agentId) return;
      if (this.sessionState().configOptions !== before) return;
      const next = options?.length ? options : undefined;
      // 内容未变化时不写入，避免无意义的 signal 更新
      if (JSON.stringify(next ?? null) === JSON.stringify(before ?? null)) return;
      this.sessionState.update(s => ({
        ...s,
        configOptions: next,
      }));
    } catch {
      // 读取失败保持现状
    }
  }

  private setupSseCallbacks(): void {
    this.sseService.onSessionUpdate((update) => {
      this.handleSessionUpdate(update);
    });
    // Server-published "history replay complete" marker. Because the SSE channel
    // is ordered, this resolves only after every replay `session_update` has been
    // handled — the load/resume HTTP response cannot provide that guarantee.
    this.sseService.onSessionLoaded((payload) => {
      this.handleReplayComplete(payload);
    });
    this.sseService.onPermissionRequest((request) => {
      this.handlePermissionRequest(request);
    });

    this.sseService.onPromptComplete((stopReason, acpSessionId) => {
      // 只处理「当前会话」的完成事件：切换会话后，旧会话的 prompt_complete
      // 仍可能迟到（它按 ACP session 路由，与当前视图无关），若不忽略就会
      // 把当前会话的 isProcessing 误置为 false。
      if (acpSessionId && acpSessionId !== this.sessionState().sessionId) {
        return;
      }
      this.isProcessing.set(false);
      this.processingStartTime.set(null);
      if (stopReason === 'end_turn') {
        this.activeTodosId.set(null);
      }
      // Agents (e.g. OpenCode) generate the session title asynchronously after
      // the turn finishes — re-check once the local title is still a placeholder.
      if (this.provisionalTitle) {
        this.scheduleTitleRefresh();
      }
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

    this.sseService.onError((message, source, acpSessionId) => {
      if (source === 'server') {
        // 只处理「当前会话」的错误：旧会话的迟到 error 与 prompt_complete
        // 同理，必须忽略，否则会误清当前会话的处理中状态。
        if (acpSessionId && acpSessionId !== this.sessionState().sessionId) {
          return;
        }
        // 后端发布的服务端错误（如 prompt 失败）：sessionState 保持不变，
        // 只结束处理状态并把错误作为消息插入对话流展示。
        this.isProcessing.set(false);
        this.processingStartTime.set(null);
        this.appendErrorMessage(message);
        return;
      }
      // 连接级错误（EventSource 断开）：维持既有行为，标记会话断开。
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
   * Creates a fresh ACP session via a single HTTP call (agent resolved by
   * `agentId`, server returns the real ACP session id), records it in
   * sessionState, and only then opens the SSE stream (`sessionId` is known by
   * then). Notifications the agent pushes in the creation window — notably
   * `available_commands_update` — have no SSE subscriber yet, so the HTTP
   * response carries them and they are applied here.
   *
   * Also persists the new task/session records (previously handled by the SSE
   * `session_created` event, which no longer exists) before opening the stream.
   */
  async createSession(cwd?: string, mcpServers?: any[]): Promise<string> {
    const agent = this.selectedAgent();
    if (!agent?.id) {
      throw new Error('No agent selected');
    }

    // Pre-bind the MCP server selection so the persisted task/session record
    // below carries the servers that are actually being used.
    if (mcpServers?.length) {
      this.sessionState.update(s => ({ ...s, mcpServers: mcpServers as string[] }));
    }

    // Create the ACP session first (cwd is resolved and defaulted server-side)
    const acpResult = await this.sseService.createAcpSession(agent.id, cwd, mcpServers);
    const acpSessionId = acpResult?.sessionId;
    if (!acpSessionId) {
      throw new Error('Agent returned no session id');
    }

    this.sessionState.update(s => ({
      ...s,
      sessionId: acpSessionId,
      cwd: acpResult?.cwd ?? s.cwd,
      // 仅使用 session/create 返回的 configOptions
      configOptions: acpResult?.configOptions ?? s.configOptions,
    }));
    // Slash commands pushed before any SSE subscriber exists
    if (Array.isArray(acpResult?.availableCommands) && acpResult.availableCommands.length > 0) {
      this.availableCommands.set(acpResult.availableCommands);
    }
    this.persistConfigOptions(acpResult?.configOptions);

    // Create task/session records while the isNewSession flag is still intact
    await this.persistNewSessionRecords(acpSessionId);
    // Reset isNewSession after task/session creation logic has read it
    this.isNewSession.set(false);

    // Open the event stream after the ACP session exists
    await this.sseService.connect(acpSessionId, agent.id);

    return acpSessionId;
  }

  /**
   * Persists a brand-new session's task (no project selected) or project
   * session record, and marks it as the selected session.
   *
   * Previously ran inside the SSE `session_created` callback; the event no
   * longer exists (creation results now arrive in the HTTP response), so this
   * runs directly after `session/create` returns.
   */
  private async persistNewSessionRecords(acpSessionId: string): Promise<void> {
    // Create task (task creation = isNewSession && no selected project)
    if (this.isNewSession() && !this.selectedProjectPath()) {
      const title = this.sessionState().title || 'New Task';
      const agentId = this.selectedAgent()?.id || 'opencode';
      const cwd = this.sessionState().cwd || '';
      const mcpServers = this.sessionState().mcpServers;
      if (cwd) {
        const taskId = cwd.replace(/\\/g, '/').split('/').pop() || '';
        const newTask: ProjectInfo = {
          name: title,
          path: cwd,
          type: 'task',
          sessions: [{ sessionId: acpSessionId, agentId, title, ...(mcpServers?.length ? { mcpServers } : {}) }],
          id: taskId,
          createdAt: new Date().toISOString(),
        }
        this.tasks.update(list => [
          newTask,
          ...list.filter(t => t.id !== taskId),
        ]);

        if (taskId) {
          try {
            await this.sseService.addProject(newTask);
            await this.saveSelectedProject(cwd);
            await this.saveSelectedSession(acpSessionId);
          } catch (err) {
            console.error('[ACP] Failed to create task:', err);
          }
        }
      }
    }

    // Create session record (moved from acp-chat-input sendMessage)
    if (this.isNewSession()) {
      const cwd = this.sessionState().cwd || '';
      const agentId = this.selectedAgent()?.id || 'opencode';
      const mcpServers = this.sessionState().mcpServers;

      const project = this.projects().find(p => p.path === cwd);
      if (project) {
        const record: ProjectSessionInfo = {
          sessionId: acpSessionId,
          agentId,
          title: this.sessionState().title || 'New session',
          updatedAt: new Date().toISOString(),
          ...(mcpServers?.length ? { mcpServers } : {}),
        };
        await this.saveSessionToProject(cwd, record);
        // 本地同步 upsert，新会话立即出现在侧边栏，无需等待 listProjects 刷新
        this.projects.update(list => list.map(p =>
          p.path === cwd
            ? { ...p, sessions: [...(p.sessions || []).filter(s => s.sessionId !== acpSessionId), record] }
            : p
        ));
        await this.saveSelectedSession(acpSessionId);
      }
    }
  }

  /**
   * Ensures an active ACP session id exists before chatting.
   *
   * When `sessionState().sessionId` is already set, the ACP session exists
   * (freshly created, or loaded/resumed from history) — it must NOT be
   * re-created: `session/new` would throw away the loaded context. The backend
   * lazily recovers a crashed agent via resume, keyed by the same session id.
   *
   * Only when no session id is known (fresh New Task) is a session created.
   */
  async ensureChatSession(cwd?: string, mcpServers?: any[]): Promise<void> {
    if (this.sessionState().sessionId) {
      // 已有会话：mcpServers 无法事后重绑，仅记录进 state 供保存记录时使用
      if (mcpServers?.length) {
        this.sessionState.update(s => ({ ...s, mcpServers: mcpServers as string[] }));
      }
      await this.applyPendingConfigSelection();
      return;
    }
    await this.createSession(cwd, mcpServers);
    await this.applyPendingConfigSelection();
  }

  /**
   * Submits a full turn (text + content blocks) from outside the chat input box.
   *
   * Used by panels that drive the agent on the user's behalf — currently the RAG
   * knowledge base, which asks the agent to invoke `index_document` / `search` /
   * `list_documents` / `delete_document` on the configured RAG MCP server. The
   * frontend deliberately has no MCP client of its own; the agent is the executor.
   *
   * Unlike `AcpChatInputComponent.sendMessage`, the blocks are built by the caller
   * rather than read from the chat input's local `attachments` signal, so this can
   * be called while the chat input is unmounted (e.g. from a manager modal).
   */
  async submitPrompt(text: string, blocks: ContentBlock[] = []): Promise<void> {
    const content: ContentBlock[] = [];
    if (text) {
      content.push({ type: 'text', text });
    }
    content.push(...blocks);

    this.pendingSlashCommand.set(null);
    this.addUserMessage(text, blocks.length > 0 ? blocks : undefined);

    await this.ensureChatSession(
      this.selectedProjectPath() || undefined,
      this.effectiveMcpServers(),
    );
    await this.sendPrompt(content);
  }

  /**
   * MCP server names to hand to the next `session/new`.
   *
   * Empty array means "no MCP servers" — the caller omits the payload entirely so
   * the agent keeps its own defaults rather than being handed an explicit empty list.
   */
  private effectiveMcpServers(): string[] | undefined {
    const names = Array.from(new Set(this.selectedMcpServers()));
    return names.length > 0 ? names : undefined;
  }

  /** Adds MCP server names to the session-level selection (idempotent). */
  attachMcpServers(names: string[]): void {
    this.selectedMcpServers.update(current => {
      const next = new Set(current);
      for (const name of names) {
        if (name) next.add(name);
      }
      return Array.from(next);
    });
  }

  async sendPrompt(content: ContentBlock[]): Promise<void> {
    const sessionId = this.sessionState().sessionId;
    if (!sessionId) {
      throw new Error('No active session');
    }

    this.processingStartTime.set(Date.now());
    this.isProcessing.set(true);

    // 会话标题占位：使用固定文案；agent 下发正式标题
    // （session_info_update 或 session/list）后由 applySessionTitle 覆盖
    if (!this.sessionState().title) {
      this.provisionalTitle = true;
      this.sessionState.update(s => ({ ...s, title: AcpService.PLACEHOLDER_TITLE }));
    }

    await this.sseService.sendPrompt(sessionId, content);
  }

  // ============================================================================
  // Session title synchronization
  // ============================================================================

  /**
   * Sets a fixed placeholder title for a brand-new session. The placeholder is
   * provisional: it is replaced once the agent provides its own (LLM-generated)
   * title via `session_info_update` or `session/list`.
   */
  setProvisionalTitle(): void {
    this.provisionalTitle = true;
    this.sessionState.update(s => ({ ...s, title: AcpService.PLACEHOLDER_TITLE }));
  }

  /**
   * Adopts an agent/LLM-provided title for a session. Agent titles always win
   * over local placeholders. Updates: the header (when the session is active),
   * every local project/task record containing the session, and the persisted
   * `projects.json`/`tasks.json` (backend save-session upserts).
   */
  async applySessionTitle(sessionId: string, title: string): Promise<void> {
    const next = title.trim();
    if (!sessionId || !next) return;

    if (this.sessionState().sessionId === sessionId) {
      this.provisionalTitle = false;
      if (this.sessionState().title !== next) {
        this.sessionState.update(s => ({ ...s, title: next }));
      }
    }

    const updatedAt = new Date().toISOString();

    // 补偿性更新：在 owner 查找之前无条件立即同步本地 project/task 记录中
    // 该 session 的标题，UI 无需等待后端刷新即可反映新标题
    //（替代原 sessions 列表的即时更新）
    const updateTitle = (list: ProjectInfo[]): ProjectInfo[] =>
      list.map(item => {
        if (!item.sessions?.some(s => s.sessionId === sessionId)) return item;
        return {
          ...item,
          name: item.type === 'task' ? next : item.name,
          sessions: item.sessions.map(s =>
            s.sessionId === sessionId ? { ...s, title: next, updatedAt } : s
          ),
        };
      });
    this.projects.update(updateTitle);
    this.tasks.update(updateTitle);

    // Locate the owning project/task record: match by session id first,
    // fall back to the current cwd.
    const hasSession = (r: ProjectInfo) => r.sessions?.some(s => s.sessionId === sessionId);
    const cwd = this.sessionState().cwd || this.selectedProjectPath() || '';
    const owner =
      this.projects().find(hasSession) ??
      this.tasks().find(hasSession) ??
      this.projects().find(p => p.path === cwd) ??
      this.tasks().find(t => t.path === cwd) ??
      null;
    if (!owner) return;

    const agentId =
      owner.sessions?.find(s => s.sessionId === sessionId)?.agentId ||
      this.selectedAgent()?.id || 'opencode';
    const existingMcpServers =
      owner.sessions?.find(s => s.sessionId === sessionId)?.mcpServers;

    await this.saveSessionToProject(owner.path, {
      sessionId,
      agentId,
      title: next,
      updatedAt,
      ...(existingMcpServers?.length ? { mcpServers: existingMcpServers } : {}),
    });
  }

  /** Delays the agent-title fetch — agents generate titles asynchronously
   *  after the turn completes, so a short delay avoids racing the write. */
  private scheduleTitleRefresh(delayMs = 1500): void {
    if (this.titleRefreshTimer) clearTimeout(this.titleRefreshTimer);
    this.titleRefreshTimer = setTimeout(() => {
      this.titleRefreshTimer = null;
      void this.refreshAgentTitle();
    }, delayMs);
  }

  /** Pulls the agent's session list and adopts its title for the current
   *  session when it differs from the local placeholder. Keeps the placeholder
   *  (and retries on the next prompt_complete) if the agent has none yet. */
  private async refreshAgentTitle(): Promise<void> {
    if (!this.provisionalTitle) return;
    const acpSessionId = this.sessionState().sessionId;
    if (!acpSessionId) return;

    const cwd = this.sessionState().cwd || this.selectedProjectPath() || undefined;
    try {
      const agentId = this.selectedAgent()?.id || 'opencode';
      const result = await this.sseService.listSessions(agentId, cwd);
      const list: SessionInfo[] = result?.sessions ?? [];
      const found = list.find(s => s.sessionId === acpSessionId);
      if (found?.title?.trim()) {
        await this.applySessionTitle(acpSessionId, found.title);
      }
    } catch (error) {
      console.warn('[ACP] Failed to refresh agent session title:', error);
    }
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
    if (this.titleRefreshTimer) {
      clearTimeout(this.titleRefreshTimer);
      this.titleRefreshTimer = null;
    }
    // Drop any in-flight replay-complete waiter: the session is going away, so a
    // late marker must not resolve a stale wait.
    this.clearReplayCompleteWaiter();
    this.provisionalTitle = false;
    this.sseService.disconnect();
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
    this.usage.set(null);
    this.availableCommands.set([]);
    this.activeTodosId.set(null);
    // Unanswered questions belong to the session that just went away; keeping
    // them would leave hasActiveQuestions() true and the chat textarea disabled.
    this.activeQuestionsMessages.set([]);
    this.activeTodosMessages.set([]);
    // 处理中状态同属刚断开的会话：必须一并清掉，否则 isProcessing 残留为 true，
    // sendMessage 会被直接 return（输入框表现为「发不出去」）。
    this.isProcessing.set(false);
    this.processingStartTime.set(null);
  }

  // ============================================================================
  // Session history
  // ============================================================================

  async listSessionsFromAllAgents(cwd?: string): Promise<void> {
    try {
      const targetCwd = cwd || undefined;
      if (!targetCwd) {
        return;
      }

      // 聚合一次调用：服务端逐个 agent create/connect/list/清理
      const result = await this.sseService.listAllSessions(targetCwd, AVAILABLE_AGENTS);
      const allSessions: SessionInfo[] = result?.sessions ?? [];

      if (cwd) {
        const existingProject = this.projects().find(p => p.path === cwd);
        const existingRecords = new Map(
          (existingProject?.sessions || []).map(s => [`${s.sessionId}:${s.agentId}`, s])
        );

        for (const session of allSessions) {
          const agentId = (session as any).agentId;
          const key = `${session.sessionId}:${agentId}`;
          const record = existingRecords.get(key);

          if (record) {
            // 已有记录：agent 返回的标题发生变化（如首轮后 LLM 生成）时回写
            const agentTitle = session.title?.trim();
            if (agentTitle && agentTitle !== record.title) {
              try {
                await this.applySessionTitle(session.sessionId, agentTitle);
                record.title = agentTitle;
              } catch (error) {
                console.warn('[ACP] Failed to refresh session title:', session.sessionId, error);
              }
            }
            continue;
          }

          try {
            await this.sseService.saveSessionToProject(cwd, {
              sessionId: session.sessionId,
              agentId,
              title: session.title || `Session ${session.sessionId.substring(0, 8)}`,
              updatedAt: session.updatedAt || new Date().toISOString(),
            });
            existingRecords.set(key, { sessionId: session.sessionId, agentId, title: session.title });
          } catch (error) {
            console.error('[ACP] Failed to persist session:', session.sessionId, error);
          }
        }

        // 持久化完成后刷新，使新记录的会话进入 projects() 列表
        await this.listProjects();
      }
    } catch (error) {
      console.warn('[ACP] Failed to list sessions from all agents:', (error as Error).message || error);
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
  }

  async saveSessionToProject(projectPath: string, session: ProjectSessionInfo): Promise<void> {
    // 只读查看实例不得写入项目/任务记录
    if (this.readOnly) return;
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
    await this.sseService.saveSelectedProject(this.selectedProjectPath(), sessionId);
  }

  // ============================================================================
  // 任务管理
  // ============================================================================

  async deleteTask(id: string): Promise<void> {
    const task = this.tasks().find(t => t.id === id);
    if (!task) return;
    try {
      // 先删除任务下的所有会话（连同 agent 侧的 ACP 会话），再删除任务记录。
      // 单个会话删除失败不阻断任务删除，保证任务始终能从列表移除。
      for (const session of task.sessions ?? []) {
        if (!session.sessionId) continue;
        try {
          await this.deleteSession(session.sessionId, session.agentId);
        } catch (error) {
          console.error('[ACP] Failed to delete task session:', session.sessionId, error);
        }
      }
      await this.sseService.deleteProject(task.name, 'task', id);
      await this.listTasks();
      // 任务记录删除后，连同其工作目录文件夹一并删除（默认工作目录位于 ~/.clover/<时间戳>）
      await this.deleteTaskWorkspace(task.path);
    } catch (error) {
      console.error('[ACP] Failed to delete task:', error);
      throw error;
    }
  }

  /**
   * 递归删除任务对应的工作目录文件夹。
   * 删除失败只记录日志，不影响任务删除结果。
   */
  private async deleteTaskWorkspace(workspacePath?: string): Promise<void> {
    const target = workspacePath?.trim();
    if (!target || this.isUnsafeWorkspacePath(target)) return;
    try {
      await this.localAgentService.deleteFile(target);
    } catch (error) {
      console.error('[ACP] Failed to delete task workspace:', target, error);
    }
  }

  /**
   * 判断路径是否属于不可删除的危险目录（空路径或文件系统根目录），
   * 避免误删整盘。
   */
  private isUnsafeWorkspacePath(target: string): boolean {
    // 去掉尾部斜杠后：'/' 会归一化为空串，'C:' / 'C:/' 作为盘符根
    const normalized = target.replace(/\\/g, '/').replace(/\/+$/, '');
    return !normalized || /^[a-zA-Z]:$/.test(normalized);
  }

  async switchAgent(agentId: string, cwd?: string): Promise<void> {
    const agent = AVAILABLE_AGENTS.find(a => a.id === agentId);
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }

    // 已是当前 agent（且会话存在）→ 无需切换；selectedAgent 只在
    // switchAgent 内变化，因此它与「当前会话所属 agent」始终一致。
    if (this.selectedAgent()?.id === agentId) {
      return;
    }

    if (this.sessionState().sessionId) {
      this.disconnect();
    }

    this.selectedAgent.set(agent);
  }

  async loadSession(sessionId: string, cwd?: string, agentId?: string, mcpServers?: string[]): Promise<void> {
    this.isSwitchingSession.set(true);

    // Phase 1: Switch agent if needed
    if (agentId && agentId !== this.selectedAgent()?.id) {
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
    this.provisionalTitle = false;
    // 切换会话 = 换了一轮「处理中」上下文。旧会话的 isProcessing 必须清掉，
    // 否则它会一直卡住输入框（sendMessage 会因 isProcessing 直接 return）。
    // 目标会话若在服务端仍在跑，由 Phase 4 的 result.prompting 恢复。
    this.isProcessing.set(false);
    this.processingStartTime.set(null);
    // 会话标题：从项目/任务记录取回；记录存在但无标题时清空，避免残留上一个会话的标题
    const loaded = this.findSessionRecord(sessionId);
    if (loaded) {
      this.sessionState.update(s => ({ ...s, title: loaded.title }));
    }
    // MCP servers bound to this session: prefer the persisted value (survives page reloads),
    // fall back to the caller-supplied argument.
    const persistedMcpServers = loaded?.mcpServers;
    const resolvedAgentId = this.selectedAgent()?.id || 'opencode';

    // Phase 3+4: 绑定目标会话并加载历史。sessionState().sessionId 即 ACP session id。
    // isReplayingHistory 必须在 connect 之前置位：SSE 建立期间服务端可能已
    // 触发恢复分支（ensureAgentSession → resume）并开始回放，这些事件同样
    // 要进 replayBuffer，而不是被当作实时消息处理（回放外的 user chunk 会被忽略）。
    this.loadingText.set('Connecting to server...');
    this.sessionState.update(s => ({ ...s, sessionId, isConnecting: true, isConnected: false }));
    this.isReplayingHistory.set(true);
    try {
      // connect 现在等到 SSE onopen 才 resolve（后端订阅已就绪），随后才发
      // session/load —— load 期间 agent 回放的历史通知不会丢失。
      // `agentId` 供服务端在记录缺失时（后端重启）兜底建立会话记录。
      await this.sseService.connect(sessionId, resolvedAgentId);

      // 注册「回放结束」等待器：必须在发起 load 之前完成注册（同一微任务内），
      // 否则服务端标记可能先于等待器到达而被丢弃。
      const replayComplete = this.waitForReplayComplete(sessionId);

      // Phase 4: Load session history
      this.loadingText.set('Loading session history...');
      const result = await this.sseService.loadSession(
        sessionId, resolvedAgentId, cwd || undefined, persistedMcpServers ?? mcpServers,
      );

      // 该会话在服务端可能仍有一轮 prompt 在跑（例如切走又切回）：
      // 恢复处理中状态，等待它真正的 prompt_complete。
      if (result?.prompting) {
        this.isProcessing.set(true);
        this.processingStartTime.set(Date.now());
      }
      this.sessionState.update(s => ({
        ...s,
        isConnected: true,
        isConnecting: false,
        cwd: cwd ?? s.cwd,
        // 仅使用 session/load 返回的 configOptions：不沿用上一个会话的值，
        // 也不写入 agent-config.json（持久化文件只服务 New Task）
        configOptions: result?.configOptions,
        // 将本次加载所用的 mcpServers 写入 sessionState，供后续保存记录时使用
        mcpServers: persistedMcpServers ?? mcpServers,
      }));

      // 等 SSE 的「回放结束」标记，而不是等上面的 HTTP 响应：两者是不同的连接，
      // 响应到达不代表历史通知已全部送达。SSE 单通道有序，标记到达即代表此前
      // 所有 session_update 都已处理完，此时结束回放态才不会丢消息。
      await replayComplete;
    } finally {
      this.finishHistoryReplay();
      this.isSwitchingSession.set(false);
      this.loadingText.set(null);
    }
  }

  async resumeSession(sessionId: string, cwd?: string, agentId?: string, replayFrom?: { type: string }, mcpServers?: string[]): Promise<void> {
    this.isSwitchingSession.set(true);

    // Phase 1: Switch agent if needed
    if (agentId && agentId !== this.selectedAgent()?.id) {
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
    this.provisionalTitle = false;
    // 切换会话 = 换了一轮「处理中」上下文（同 loadSession）。
    this.isProcessing.set(false);
    this.processingStartTime.set(null);
    // 会话标题：从项目/任务记录取回；记录存在但无标题时清空，避免残留上一个会话的标题
    const resumed = this.findSessionRecord(sessionId);
    if (resumed) {
      this.sessionState.update(s => ({ ...s, title: resumed.title }));
    }
    // MCP servers bound to this session: prefer the persisted value (survives page reloads),
    // fall back to the caller-supplied argument.
    const persistedMcpServers = resumed?.mcpServers;
    const resolvedAgentId = this.selectedAgent()?.id || 'opencode';

    // Phase 3+4: 绑定目标会话并恢复（同 loadSession：replay 标志先于 connect，
    // connect 等到 onopen 后才发请求，回放通知才不丢失）。
    this.loadingText.set('Connecting to server...');
    this.sessionState.update(s => ({ ...s, sessionId, isConnecting: true, isConnected: false }));
    this.isReplayingHistory.set(true);
    try {
      await this.sseService.connect(sessionId, resolvedAgentId);

      // 注册「回放结束」等待器（必须在发起 resume 之前，理由同 loadSession）。
      const replayComplete = this.waitForReplayComplete(sessionId);

      // Phase 4: Resume session
      this.loadingText.set('Loading session history...');
      const result = await this.sseService.resumeSession(
        sessionId, resolvedAgentId, cwd || undefined, persistedMcpServers ?? mcpServers,
      );

      // 该会话在服务端可能仍有一轮 prompt 在跑：恢复处理中状态。
      if (result?.prompting) {
        this.isProcessing.set(true);
        this.processingStartTime.set(Date.now());
      }
      this.sessionState.update(s => ({
        ...s,
        isConnected: true,
        isConnecting: false,
        cwd: cwd ?? s.cwd,
        // 仅使用 session/resume 返回的 configOptions（不沿用上一个会话的值）
        configOptions: result?.configOptions,
        // 将本次恢复所用的 mcpServers 写入 sessionState，供后续保存记录时使用
        mcpServers: persistedMcpServers ?? mcpServers,
      }));

      // 同 loadSession：以 SSE 的「回放结束」标记为准，而非 HTTP 响应。
      await replayComplete;
    } finally {
      this.finishHistoryReplay();
      this.isSwitchingSession.set(false);
      this.loadingText.set(null);
    }
  }

  /**
   * 删除 ACP 会话。
   *
   * agentId 用于服务端没有该会话的内存记录时（后端重启、或会话只从 agent
   * 列表里拉到过）解析 agent。调用方若已经/即将删除持久化记录，必须在调用
   * 前把 agentId 取出来显式传入，否则这里查不到记录。
   */
  async deleteSession(sessionId: string, agentId?: string): Promise<void> {
    const resolvedAgentId = agentId || this.findSessionRecord(sessionId)?.agentId;
    await this.sseService.deleteAcpSession(sessionId, resolvedAgentId);
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
      // 无会话（New Task 页面，configOptions 由持久化文件恢复）：
      // 本地乐观更新 + 持久化，并记为待下发，ensureChatSession 建立会话后再发给 agent
      this.pendingConfigSelection = { configId, type, value };
      this.sessionState.update(s => ({
        ...s,
        configOptions: s.configOptions?.map(o =>
          o.id === configId ? { ...o, currentValue: value } : o
        ),
      }));
      this.persistConfigOptions(this.sessionState().configOptions);
      return;
    }
    const result = await this.sseService.setConfigOption(sessionId, configId, type, value);
    if (result?.configOptions) {
      this.sessionState.update(s => ({
        ...s,
        configOptions: result.configOptions,
      }));
    }
  }

  /** 把无会话期间记录的配置选择下发给刚建立的 ACP 会话
   *  （New Task 页面先选 mode/model、后发消息的场景）。无待下发项时为 no-op。 */
  private async applyPendingConfigSelection(): Promise<void> {
    const pending = this.pendingConfigSelection;
    const sessionId = this.sessionState().sessionId;
    if (!pending || !sessionId) return;
    this.pendingConfigSelection = null;
    try {
      const result = await this.sseService.setConfigOption(sessionId, pending.configId, pending.type, pending.value);
      if (result?.configOptions) {
        this.sessionState.update(s => ({ ...s, configOptions: result.configOptions }));
        this.persistConfigOptions(result.configOptions);
      }
    } catch {
      // 下发失败静默：选择仍保留在本地 state 与持久化文件中
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

  /** 服务端错误（SSE `error` 事件）以消息气泡形式插入对话流。
   *  回放期间写入 replayBuffer，避免 flushReplayBuffer 的
   *  `messages.set(replayBuffer)` 把错误冲掉。 */
  private appendErrorMessage(message: string): void {
    const errorMsg: AcpMessage = {
      id: crypto.randomUUID(),
      role: 'error',
      content: message,
      timestamp: new Date()
    };
    if (this.isReplayingHistory()) {
      this.replayBuffer.push(errorMsg);
      return;
    }
    this.messages.update(msgs => [...msgs, errorMsg]);
  }

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

      case 'current_mode_update': {
        // Deprecated: convert to configOptions update for backward compatibility
        const nextModeOptions = this.sessionState().configOptions?.map(o =>
          o.category === 'mode' ? { ...o, currentValue: update.currentModeId } : o
        );
        this.sessionState.update(s => ({
          ...s,
          configOptions: nextModeOptions,
        }));
        break;
      }

      case 'session_info_update':
        if (update.title) {
          const targetSessionId = (update as { sessionId?: string }).sessionId ?? this.sessionState().sessionId;
          if (targetSessionId) {
            void this.applySessionTitle(targetSessionId, update.title);
          }
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
      toolContent: update.content ?? existing.toolContent,
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
      toolRawOutput: update.rawOutput,
      toolContent: update.content ?? undefined
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
    // 只读查看实例不参与权限应答：协作空间自身的 SSE 订阅（CollabService）
    // 已负责派发同一会话的权限请求，这里再派发会导致同一请求重复进入对话框。
    if (this.readOnly) return;
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

  /**
   * Waits for the server's "history replay complete" marker for `sessionId`.
   *
   * <p>Must be called right after the SSE stream is open and BEFORE issuing
   * `session/load` / `session/resume`: the marker is published on the same SSE
   * channel after every replay `session_update`, so it can only be trusted if the
   * waiter already exists when it arrives.
   *
   * <p>Falls back to a timeout so a backend that does not publish the marker
   * (older version) cannot hang session switching.
   */
  private waitForReplayComplete(sessionId: string, timeoutMs = REPLAY_COMPLETE_TIMEOUT_MS): Promise<void> {
    return new Promise<void>((resolve) => {
      const settle = () => {
        this.clearReplayCompleteWaiter();
        resolve();
      };
      this.clearReplayCompleteWaiter();
      this.replayCompleteWaiter = { sessionId, resolve: settle };
      this.replayCompleteTimer = setTimeout(() => {
        console.warn(`[ACP] replay-complete marker timed out for session ${sessionId}; ending replay by fallback`);
        settle();
      }, timeoutMs);
    });
  }

  /** Resolves the pending replay-complete waiter when its session's marker arrives. */
  private handleReplayComplete(payload: any): void {
    const waiter = this.replayCompleteWaiter;
    if (!waiter) return;
    const markerSessionId = payload?.sessionId as string | undefined;
    // Ignore markers for other sessions (a stale/late marker must not end the
    // current session's replay).
    if (markerSessionId && markerSessionId !== waiter.sessionId) return;
    waiter.resolve();
  }

  private clearReplayCompleteWaiter(): void {
    if (this.replayCompleteTimer) {
      clearTimeout(this.replayCompleteTimer);
      this.replayCompleteTimer = null;
    }
    this.replayCompleteWaiter = null;
  }

  /**
   * Ends history-replay mode: restores the todos state and flushes the replay
   * buffer in one shot. Idempotent — safe to call from a `finally` even when the
   * marker already resolved the wait.
   */
  private finishHistoryReplay(): void {
    this.clearReplayCompleteWaiter();
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
