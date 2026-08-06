import { Injectable, signal, computed, inject } from '@angular/core';
import {
  AcpWebSocketService,
  SessionUpdate,
  PermissionRequest,
  SessionInfo,
  PromptCapabilities,
  ModelState,
  ContentBlock,
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
  role: 'user' | 'assistant' | 'thought' | 'tool_call';
  content: string;
  timestamp: Date;
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

export interface AcpSessionState {
  sessionId: string | null;
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
  promptCapabilities?: PromptCapabilities;
  models?: ModelState;
  configOptions?: ConfigOption[];
  title?: string;
}

@Injectable({
  providedIn: 'root'
})
export class AcpService {
  private wsService = inject(AcpWebSocketService);

  readonly sessionState = signal<AcpSessionState>({
    sessionId: null,
    isConnected: false,
    isConnecting: false,
    error: null
  });

  readonly messages = signal<AcpMessage[]>([]);
  readonly plans = signal<Map<string, AcpPlan>>(new Map());
  readonly isProcessing = signal<boolean>(false);
  readonly activeTodosId = signal<string | null>(null);

  // Session history
  readonly sessions = signal<SessionInfo[]>([]);
  readonly sessionsLoading = signal<boolean>(false);

  // Working directory hint from file picker
  readonly workingDirHint = signal<string>('');

  // Session display state (persisted across panel show/hide)
  readonly showSessionHistory = signal<boolean>(true);
  readonly hasOpenedSession = signal<boolean>(false);

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

  readonly messageCount = computed(() => this.messages().length);
  readonly hasActiveSession = computed(() => this.sessionState().sessionId !== null);
  readonly isConnected = computed(() => this.sessionState().isConnected);
  readonly canDeleteSession = computed(() => {
    const caps = this.wsService.agentCapabilities();
    if (!caps) return false;
    // SDK v1 normalizes capabilities to sessionCapabilities.delete; protocol
    // v2 uses session.delete. Support both shapes.
    return !!caps.sessionCapabilities?.delete || !!caps.session?.delete;
  });

  // Active question: the latest unanswered question tool call
  readonly activeQuestionMessage = computed(() => {
    const msgs = this.messages();
    const submitted = this.submittedQuestions();
    // Find the latest tool_call with questions that hasn't been answered
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.role === 'tool_call' && m.toolCallId) {
        const rawInput = m.toolRawInput as any;
        if (rawInput && Array.isArray(rawInput.questions) && rawInput.questions.length > 0) {
          if (!submitted.has(m.toolCallId)) {
            return m;
          }
        }
      }
    }
    return null;
  });

  readonly hasActiveQuestions = computed(() => this.activeQuestionMessage() !== null);

  constructor() {
    this.setupWebSocketCallbacks();
  }

  private setupWebSocketCallbacks(): void {
    this.wsService.onSessionUpdate((update) => {
      this.handleSessionUpdate(update);
    });

    this.wsService.onPermissionRequest((request) => {
      this.handlePermissionRequest(request);
    });

    this.wsService.onPromptComplete((stopReason) => {
      console.log('[ACP] Prompt completed:', stopReason);
      this.isProcessing.set(false);
      if (stopReason === 'end_turn') {
        this.activeTodosId.set(null);
      }
    });

    this.wsService.onSessionCreated((sessionId, configOptions) => {
      console.log('[ACP] Session created:', sessionId);
      this.sessionState.update(s => ({
        ...s,
        sessionId,
        configOptions,
      }));
    });

    this.wsService.onSessionList((sessions, nextCursor) => {
      console.log('[ACP] Sessions listed:', sessions.length);
      this.sessions.set(sessions);
      this.sessionsLoading.set(false);
    });

    this.wsService.onSessionDeleted((sessionId) => {
      console.log('[ACP] Session deleted:', sessionId);
      // If the deleted session was the active one, reset local state.
      if (this.sessionState().sessionId === sessionId) {
        this.messages.set([]);
        this.plans.set(new Map());
        this.usage.set(null);
        this.activeTodosId.set(null);
        this.sessionState.update(s => ({ ...s, sessionId: null, title: undefined }));
      }
      // Refresh the session history list.
      this.sessions.update(sessions => sessions.filter(s => s.sessionId !== sessionId));
      if (this.showSessionHistory()) {
        this.listSessions(this.workingDirHint());
      }
    });

    this.wsService.onSessionLoaded((sessionId, promptCapabilities, models, configOptions) => {
      console.log('[ACP] Session loaded:', sessionId);
      this.sessionState.update(s => ({
        ...s,
        sessionId,
        promptCapabilities,
        models,
        configOptions,
      }));
      this.currentModelId.set(models?.currentModelId ?? null);
    });

    this.wsService.onSessionResumed((sessionId, promptCapabilities, models, configOptions) => {
      console.log('[ACP] Session resumed:', sessionId);
      this.sessionState.update(s => ({
        ...s,
        sessionId,
        promptCapabilities,
        models,
        configOptions,
      }));
      this.currentModelId.set(models?.currentModelId ?? null);
    });

    this.wsService.onModelChanged((modelId) => {
      console.log('[ACP] Model changed:', modelId);
      this.currentModelId.set(modelId);
    });

    this.wsService.onConfigOptionUpdate((configOptions) => {
      console.log('[ACP] Config options updated:', configOptions.length);
      this.sessionState.update(s => ({
        ...s,
        configOptions,
      }));
    });

    // Sync connection state from WebSocket service
    const syncState = () => {
      const wsState = this.wsService.connectionState();
      this.sessionState.update(s => ({
        ...s,
        isConnected: wsState === 'connected',
        isConnecting: wsState === 'connecting',
        error: this.wsService.error()
      }));
    };

    // Watch for state changes
    const interval = setInterval(syncState, 100);
  }

  // ============================================================================
  // Connection management
  // ============================================================================

  /**
   * Sends ACP agent config (command + args) to the server.
   * This triggers the server to set up the ACP WebSocket endpoint.
   */
  async setAcpConfig(agent: { command: string; args?: string[] }): Promise<void> {
    try {
      const response = await fetch('/api/local/acp/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: agent.command, args: agent.args }),
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
      const agent = this.selectedAgent();
      await this.wsService.connect(url, agent ? { command: agent.command, args: agent.args } : undefined);
      this.sessionState.update(s => ({
        ...s,
        isConnected: true,
        isConnecting: false
      }));
    } catch (error: any) {
      this.sessionState.update(s => ({
        ...s,
        isConnecting: false,
        error: error.message || 'Failed to connect'
      }));
      throw error;
    }
  }

  async createSession(cwd?: string): Promise<string> {
    return this.wsService.createSessionAsync(cwd);
  }

  async sendPrompt(text: string): Promise<void> {
    if (!this.sessionState().isConnected) {
      throw new Error('Not connected');
    }

    this.isProcessing.set(true);

    // Add user message
    this.messages.update(msgs => [...msgs, {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: new Date()
    }]);

    this.wsService.sendPrompt(text);
  }

  async cancel(): Promise<void> {
    this.wsService.cancel();
    this.isProcessing.set(false);
  }

  async disconnect(): Promise<void> {
    this.wsService.disconnect();
    this.sessionState.set({
      sessionId: null,
      isConnected: false,
      isConnecting: false,
      error: null
    });
    this.messages.set([]);
    this.plans.set(new Map());
    this.sessions.set([]);
    this.usage.set(null);
    this.availableCommands.set([]);
    this.activeTodosId.set(null);
  }

  // ============================================================================
  // Session history
  // ============================================================================

  listSessions(cwd?: string, cursor?: string): void {
    this.sessionsLoading.set(true);
    this.wsService.listSessions(cwd, cursor);
  }

  loadSession(sessionId: string, cwd?: string): void {
    this.messages.set([]);
    this.plans.set(new Map());
    this.activeTodosId.set(null);
    this.hasOpenedSession.set(true);
    this.showSessionHistory.set(false);
    this.wsService.loadSession(sessionId, cwd);
  }

  resumeSession(sessionId: string, cwd?: string): void {
    this.messages.set([]);
    this.plans.set(new Map());
    this.activeTodosId.set(null);
    this.hasOpenedSession.set(true);
    this.showSessionHistory.set(false);
    this.wsService.resumeSession(sessionId, cwd);
  }

  deleteSession(sessionId: string): void {
    this.wsService.deleteSession(sessionId);
    // Optimistically remove from the list; the server confirmation in
    // onSessionDeleted performs the authoritative cleanup.
    this.sessions.update(sessions => sessions.filter(s => s.sessionId !== sessionId));
  }

  // ============================================================================
  // Model management
  // ============================================================================

  setModel(modelId: string): void {
    this.wsService.setModel(modelId);
  }

  setConfigOption(configId: string, type: 'id' | 'boolean', value: string | boolean): void {
    this.wsService.setConfigOption(configId, type, value);
  }

  // ============================================================================
  // Private handlers
  // ============================================================================

  private handleSessionUpdate(update: SessionUpdate): void {
    console.log('[ACP] Session update:', update.sessionUpdate);

    switch (update.sessionUpdate) {
      case 'agent_message_chunk':
        if (update.content?.type === 'text' && update.content.text) {
          this.appendAssistantMessage(update.content.text);
        }
        break;

      case 'agent_thought_chunk':
        if (update.content?.type === 'text' && update.content.text) {
          this.appendThoughtMessage(update.content.text);
        }
        break;

      case 'user_message_chunk':
        // User message chunks are echoed back, we already added the user message
        break;

      case 'tool_call':
      case 'tool_call_update':
        this.handleToolCall(update);
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
        console.log('[ACP] Available commands:', update.availableCommands.length);
        this.availableCommands.set(update.availableCommands);
        break;

      case 'config_option_update':
        console.log('[ACP] Config options updated:', update.configOptions.length);
        this.sessionState.update(s => ({
          ...s,
          configOptions: update.configOptions,
        }));
        break;
    }
  }

  private static hasTodosPayload(update: any): boolean {
    const rawInput = update.rawInput;
    if (rawInput && Array.isArray(rawInput.todos) && rawInput.todos.length > 0) return true;
    const rawOutput = update.rawOutput;
    if (rawOutput?.metadata && Array.isArray(rawOutput.metadata.todos) && rawOutput.metadata.todos.length > 0) return true;
    return false;
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

  private handleToolCall(update: any): void {
    const isTodo = AcpService.hasTodosPayload(update);

    if (isTodo) {
      const existingId = this.activeTodosId();
      if (existingId) {
        const existingMsg = this.messages().find(m => m.id === existingId);
        if (existingMsg) {
          const todos = AcpService.extractTodosFromMessage(existingMsg);
          // If all todos are completed, clear the activeTodosId
          if (todos && todos.every(t => t.status === 'completed')) {
            this.activeTodosId.set(null);
          }
        }
      }
    }

    if (isTodo) {
      const existingId = this.activeTodosId();
      if (existingId) {
        // Update the existing todo message with the new tool call update
        this.messages.update(msgs =>
          msgs.map(m => {
            if (m.id === existingId) {
              return {
                ...m,
                id: update.toolCallId || existingId,
                toolCallId: update.toolCallId,
                toolTitle: update.title ?? m.toolTitle,
                toolKind: update.kind ?? m.toolKind,
                toolStatus: update.status || 'pending',
                toolLocations: update.locations ?? m.toolLocations,
                toolRawInput: update.rawInput ?? m.toolRawInput,
                toolRawOutput: update.rawOutput ?? m.toolRawOutput
              };
            }
            return m;
          })
        );
        // 同步更新 activeTodosId，因为消息的 id 已被更新为新的 toolCallId
        this.activeTodosId.set(update.toolCallId || existingId);

        // 处理最后一轮 todos：如果所有任务都完成，清除 activeTodosId
        const updatedMsg = this.messages().find(m => m.id === update.toolCallId);
        if (updatedMsg) {
          const todos = AcpService.extractTodosFromMessage(updatedMsg);
          if (todos && todos.every(t => t.status === 'completed')) {
            this.activeTodosId.set(null);
          }
        }
        return;
      }
    }

    const toolCallId = update.toolCallId;

    // Upsert: if a message for this toolCallId already exists, update it in
    // place instead of appending a duplicate (ACP sends both a `tool_call` and
    // one or more `tool_call_update` events for the same tool call).
    const existingIndex = toolCallId
      ? this.messages().findIndex(m => m.toolCallId === toolCallId || m.id === toolCallId)
      : -1;

    if (existingIndex !== -1) {
      this.messages.update(msgs =>
        msgs.map((m, i) =>
          i === existingIndex
            ? {
                ...m,
                id: toolCallId || m.id,
                toolCallId,
                toolTitle: update.title ?? m.toolTitle,
                toolKind: update.kind ?? m.toolKind,
                toolStatus: update.status ?? m.toolStatus,
                toolLocations: update.locations ?? m.toolLocations,
                toolRawInput: update.rawInput ?? m.toolRawInput,
                toolRawOutput: update.rawOutput ?? m.toolRawOutput,
              }
            : m
        )
      );
      // Track already-answered questions when loading session history
      if (update.status === 'completed' && toolCallId) {
        const existingMsg = this.messages().find(m => m.toolCallId === toolCallId || m.id === toolCallId);
        const rawInput = existingMsg?.toolRawInput as any;
        if (rawInput && Array.isArray(rawInput.questions) && rawInput.questions.length > 0) {
          this.submittedQuestions.update(s => {
            const next = new Set(s);
            next.add(toolCallId);
            return next;
          });
        }
      }
      if (isTodo && toolCallId) {
        this.activeTodosId.set(toolCallId);
      }
      return;
    }

    const toolCallMsg: AcpMessage = {
      id: toolCallId || crypto.randomUUID(),
      role: 'tool_call',
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

    if (isTodo) {
      // 为新创建的 todo 消息设置 activeTodosId（与 line 499 互斥，不会重复执行）
      this.activeTodosId.set(toolCallMsg.id);
    }

    // Track already-answered questions when loading session history
    if (update.status === 'completed' && toolCallId) {
      const existingMsg = this.messages().find(m => m.toolCallId === toolCallId || m.id === toolCallId);
      const rawInput = existingMsg?.toolRawInput as any;
      if (rawInput && Array.isArray(rawInput.questions) && rawInput.questions.length > 0) {
        this.submittedQuestions.update(s => {
          const next = new Set(s);
          next.add(toolCallId);
          return next;
        });
      }
    }

    // Append the new tool call message to the messages list
    this.messages.update(msgs => [...msgs, toolCallMsg]);
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
    const event = new CustomEvent('acp-permission-request', {
      detail: {
        requestId: request.requestId,
        params: request,
        resolve: (outcome: any) => {
          this.wsService.sendPermissionResponse(request.requestId, outcome);
        }
      }
    });
    window.dispatchEvent(event);
  }

  private appendAssistantMessage(text: string): void {
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

  // ============================================================================
  // Question answers
  // ============================================================================

  isQuestionToolCall(message: AcpMessage): boolean {
    if (message.role !== 'tool_call') return false;
    const rawInput = message.toolRawInput as any;
    return rawInput && Array.isArray(rawInput.questions) && rawInput.questions.length > 0;
  }

  submitQuestionAnswers(toolCallId: string, answers: string[]): void {
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
    this.wsService.sendPrompt(answerText);
  }

  ignoreQuestions(toolCallId: string): void {
    if (this.submittedQuestions().has(toolCallId)) return;

    // Mark as submitted (ignored)
    this.submittedQuestions.update(s => {
      const next = new Set(s);
      next.add(toolCallId);
      return next;
    });

    // Send skip signal
    this.wsService.sendPrompt('[Questions ignored by user]');
  }

  // ============================================================================
  // Utility methods
  // ============================================================================

  clearError(): void {
    this.sessionState.update(s => ({ ...s, error: null }));
  }

  clearMessages(): void {
    this.messages.set([]);
    this.plans.set(new Map());
    this.usage.set(null);
    this.activeTodosId.set(null);
    this.submittedQuestions.set(new Set());
  }

  printRecordProxyRes() {
    console.log('Recorded Proxy Responses:\n', JSON.stringify(this.wsService.recordProxyRes));
  }
}
