import { Injectable, signal, computed, inject } from '@angular/core';
import {
  AcpWebSocketService,
  SessionUpdate,
  PermissionRequest,
  SessionInfo,
  PromptCapabilities,
  ModelState,
  DirItem,
  FileChange,
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

  // File explorer
  readonly currentDirPath = signal<string>('');
  readonly dirItems = signal<DirItem[]>([]);
  readonly fileContent = signal<string | null>(null);
  readonly currentFilePath = signal<string | null>(null);
  readonly fileChanges = signal<FileChange[]>([]);

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

  readonly messageCount = computed(() => this.messages().length);
  readonly hasActiveSession = computed(() => this.sessionState().sessionId !== null);
  readonly isConnected = computed(() => this.sessionState().isConnected);

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
      // Load root directory
      this.wsService.listDir('');
    });

    this.wsService.onSessionList((sessions, nextCursor) => {
      console.log('[ACP] Sessions listed:', sessions.length);
      this.sessions.set(sessions);
      this.sessionsLoading.set(false);
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
      // Load root directory
      this.wsService.listDir('');
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
      // Load root directory
      this.wsService.listDir('');
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

    this.wsService.onDirListing((path, items) => {
      console.log('[ACP] Dir listing:', path, items.length);
      this.currentDirPath.set(path);
      this.dirItems.set(items);
    });

    this.wsService.onFileContent((content) => {
      console.log('[ACP] File content received');
      this.fileContent.set(content);
    });

    this.wsService.onFileChanges((changes) => {
      console.log('[ACP] File changes:', changes.length);
      this.fileChanges.set(changes);
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
    this.dirItems.set([]);
    this.fileContent.set(null);
    this.currentFilePath.set(null);
    this.fileChanges.set([]);
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
  // File explorer
  // ============================================================================

  listDir(path: string): void {
    this.wsService.listDir(path);
  }

  readFile(path: string): void {
    this.currentFilePath.set(path);
    this.wsService.readFile(path);
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

    const toolCallMsg: AcpMessage = {
      id: update.toolCallId || crypto.randomUUID(),
      role: 'tool_call',
      content: '',
      timestamp: new Date(),
      toolCallId: update.toolCallId,
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
  }

  clearFileContent(): void {
    this.fileContent.set(null);
    this.currentFilePath.set(null);
  }

  printRecordProxyRes() {
    console.log('Recorded Proxy Responses:\n', JSON.stringify(this.wsService.recordProxyRes));
  }
}
