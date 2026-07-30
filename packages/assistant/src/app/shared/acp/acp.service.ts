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
  ToolKind
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
  entries: Array<{
    content: string;
    priority: 'high' | 'medium' | 'low';
    status: 'pending' | 'in_progress' | 'completed';
  }>;
}

export interface AcpSessionState {
  sessionId: string | null;
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
  promptCapabilities?: PromptCapabilities;
  models?: ModelState;
  currentMode?: string;
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
  readonly plan = signal<AcpPlan | null>(null);
  readonly isProcessing = signal<boolean>(false);

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
    });

    this.wsService.onSessionCreated((sessionId) => {
      console.log('[ACP] Session created:', sessionId);
      this.sessionState.update(s => ({
        ...s,
        sessionId
      }));
      // Load root directory
      this.wsService.listDir('');
    });

    this.wsService.onSessionList((sessions, nextCursor) => {
      console.log('[ACP] Sessions listed:', sessions.length);
      this.sessions.set(sessions);
      this.sessionsLoading.set(false);
    });

    this.wsService.onSessionLoaded((sessionId, promptCapabilities, models) => {
      console.log('[ACP] Session loaded:', sessionId);
      this.sessionState.update(s => ({
        ...s,
        sessionId,
        promptCapabilities,
        models
      }));
      this.currentModelId.set(models?.currentModelId ?? null);
      // Load root directory
      this.wsService.listDir('');
    });

    this.wsService.onSessionResumed((sessionId, promptCapabilities, models) => {
      console.log('[ACP] Session resumed:', sessionId);
      this.sessionState.update(s => ({
        ...s,
        sessionId,
        promptCapabilities,
        models
      }));
      this.currentModelId.set(models?.currentModelId ?? null);
      // Load root directory
      this.wsService.listDir('');
    });

    this.wsService.onModelChanged((modelId) => {
      console.log('[ACP] Model changed:', modelId);
      this.currentModelId.set(modelId);
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
    this.plan.set(null);
    this.sessions.set([]);
    this.dirItems.set([]);
    this.fileContent.set(null);
    this.currentFilePath.set(null);
    this.fileChanges.set([]);
    this.usage.set(null);
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
    this.plan.set(null);
    this.hasOpenedSession.set(true);
    this.showSessionHistory.set(false);
    this.wsService.loadSession(sessionId, cwd);
  }

  resumeSession(sessionId: string, cwd?: string): void {
    this.messages.set([]);
    this.plan.set(null);
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
        this.handleToolCall(update);
        break;

      case 'tool_call_update':
        this.handleToolCallUpdate(update);
        break;

      case 'plan':
        this.handlePlanUpdate(update);
        break;

      case 'current_mode_update':
        this.sessionState.update(s => ({
          ...s,
          currentMode: update.currentModeId
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
        break;

      case 'config_option_update':
        console.log('[ACP] Config options updated:', update.configOptions.length);
        break;
    }
  }

  private handleToolCall(update: any): void {
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

    this.messages.update(msgs => [...msgs, toolCallMsg]);
  }

  private handleToolCallUpdate(update: any): void {
    this.messages.update(msgs =>
      msgs.map(m => {
        if (m.role === 'tool_call' && m.toolCallId === update.toolCallId) {
          return {
            ...m,
            toolTitle: update.title ?? m.toolTitle,
            toolStatus: update.status ?? m.toolStatus,
            toolKind: update.kind ?? m.toolKind,
            toolLocations: update.locations ?? m.toolLocations,
            toolRawInput: update.rawInput ?? m.toolRawInput,
            toolRawOutput: update.rawOutput ?? m.toolRawOutput
          };
        }
        return m;
      })
    );
  }

  private handlePlanUpdate(update: any): void {
    this.plan.set({
      entries: update.entries || []
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
    this.plan.set(null);
    this.usage.set(null);
  }

  clearFileContent(): void {
    this.fileContent.set(null);
    this.currentFilePath.set(null);
  }
}
