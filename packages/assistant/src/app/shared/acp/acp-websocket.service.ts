import { Injectable, signal } from '@angular/core';

// ============================================================================
// ACP SDK Types (matching @agentclientprotocol/sdk)
// ============================================================================

export type ProtocolVersion = number;
export type SessionId = string;
export type RequestId = string | number;
export type ModelId = string;
export type SessionModeId = string;
export type SessionConfigId = string;
export type SessionConfigValueId = string;
export type ToolCallId = string;
export type PermissionOptionId = string;

// Config option type (matches ACP SessionConfigOption)
export interface ConfigOption {
  id: string;
  name: string;
  description?: string;
  category?: string;
  type: 'select' | 'boolean';
  currentValue?: string | boolean;
  options?: Array<{ value: string; name: string; description?: string }>;
}

// Optional annotations about how the content should be used or displayed
export interface Annotations {
  audience?: Array<'user' | 'assistant'>;
  priority?: number;
  lastModified?: string;
}

// Content types (matches ACP SDK ContentBlock / MCP)
export interface TextContent {
  type: 'text';
  text: string;
  annotations?: Annotations;
  _meta?: Record<string, unknown>;
}

export interface ImageContent {
  type: 'image';
  data: string;
  mimeType: string;
  uri?: string;
  annotations?: Annotations;
  _meta?: Record<string, unknown>;
}

export interface AudioContent {
  type: 'audio';
  data: string;
  mimeType: string;
  annotations?: Annotations;
  _meta?: Record<string, unknown>;
}

export interface ResourceLink {
  type: 'resource_link';
  uri: string;
  name: string;
  mimeType?: string;
  title?: string;
  description?: string;
  size?: number;
  annotations?: Annotations;
  _meta?: Record<string, unknown>;
}

export interface EmbeddedResource {
  type: 'resource';
  resource: { uri: string; text?: string; blob?: string; mimeType?: string };
  annotations?: Annotations;
  _meta?: Record<string, unknown>;
}

export type ContentBlock = TextContent | ImageContent | AudioContent | ResourceLink | EmbeddedResource;

export interface ContentChunk {
  content: ContentBlock;
  _meta?: Record<string, unknown>;
}

// Tool types
export type ToolCallStatus = 'pending' | 'in_progress' | 'completed' | 'failed';
export type ToolKind = 'read' | 'edit' | 'delete' | 'move' | 'search' | 'execute' | 'think' | 'fetch' | 'switch_mode' | 'other';
export type PermissionOptionKind = 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';

export interface ToolCallLocation {
  path: string;
  line?: number;
  _meta?: Record<string, unknown>;
}

export interface ToolCallContent {
  type: 'content' | 'diff' | 'terminal';
  content?: ContentBlock;
  path?: string;
  oldText?: string;
  newText?: string;
  terminalId?: string;
  _meta?: Record<string, unknown>;
}

export interface ToolCall {
  toolCallId: ToolCallId;
  title: string;
  content?: ToolCallContent[];
  kind?: ToolKind;
  locations?: ToolCallLocation[];
  rawInput?: unknown;
  rawOutput?: unknown;
  status?: ToolCallStatus;
  _meta?: Record<string, unknown>;
}

export interface ToolCallUpdate {
  toolCallId: ToolCallId;
  title?: string;
  content?: ToolCallContent[] | null;
  kind?: ToolKind | null;
  locations?: ToolCallLocation[] | null;
  rawInput?: unknown;
  rawOutput?: unknown;
  status?: ToolCallStatus | null;
  _meta?: Record<string, unknown>;
}

// Plan types
export type PlanEntryStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
export type PlanEntryPriority = 'high' | 'medium' | 'low';

export type PlanId = string;

export interface PlanEntry {
  content: string;
  priority: PlanEntryPriority;
  status: PlanEntryStatus;
  _meta?: Record<string, unknown>;
}

export interface Plan {
  type: string;
  planId: PlanId;
  entries: PlanEntry[];
  _meta?: Record<string, unknown>;
}

// Permission types
export interface PermissionOption {
  optionId: PermissionOptionId;
  name: string;
  kind: PermissionOptionKind;
  _meta?: Record<string, unknown>;
}

export interface RequestPermissionRequest {
  sessionId: SessionId;
  options: PermissionOption[];
  toolCall: ToolCall;
  _meta?: Record<string, unknown>;
}

export interface RequestPermissionResponse {
  outcome: { outcome: 'cancelled' } | { outcome: 'selected'; optionId: PermissionOptionId };
  _meta?: Record<string, unknown>;
}

// ============================================================================
// Session Update Types (matching ACP SDK SessionUpdate)
// ============================================================================

export interface UserMessageChunkUpdate {
  sessionUpdate: 'user_message_chunk';
  content: ContentBlock;
  messageId?: string;
  _meta?: Record<string, unknown>;
}

export interface AgentMessageChunkUpdate {
  sessionUpdate: 'agent_message_chunk';
  content: ContentBlock;
  _meta?: Record<string, unknown>;
}

export interface AgentThoughtChunkUpdate {
  sessionUpdate: 'agent_thought_chunk';
  content: ContentBlock;
  _meta?: Record<string, unknown>;
}

export interface ToolCallSessionUpdate {
  sessionUpdate: 'tool_call';
  toolCallId: ToolCallId;
  title: string;
  content?: ToolCallContent[];
  kind?: ToolKind;
  locations?: ToolCallLocation[];
  rawInput?: unknown;
  rawOutput?: unknown;
  status?: ToolCallStatus;
  _meta?: Record<string, unknown>;
}

export interface ToolCallUpdateSessionUpdate {
  sessionUpdate: 'tool_call_update';
  toolCallId: ToolCallId;
  title?: string;
  content?: ToolCallContent[] | null;
  kind?: ToolKind | null;
  locations?: ToolCallLocation[] | null;
  rawInput?: unknown;
  rawOutput?: unknown;
  status?: ToolCallStatus | null;
  _meta?: Record<string, unknown>;
}

export interface PlanSessionUpdate {
  sessionUpdate: 'plan_update';
  plan: Plan;
  _meta?: Record<string, unknown>;
}

export interface AvailableCommandsUpdate {
  sessionUpdate: 'available_commands_update';
  availableCommands: Array<{ name: string; description: string; input?: unknown }>;
  _meta?: Record<string, unknown>;
}

export interface CurrentModeUpdate {
  sessionUpdate: 'current_mode_update';
  currentModeId: SessionModeId;
  _meta?: Record<string, unknown>;
}

export interface ConfigOptionUpdate {
  sessionUpdate: 'config_option_update';
  configOptions: ConfigOption[];
  _meta?: Record<string, unknown>;
}

export interface SessionInfoUpdate {
  sessionUpdate: 'session_info_update';
  title?: string;
  _meta?: Record<string, unknown>;
}

export interface UsageUpdate {
  sessionUpdate: 'usage_update';
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  _meta?: Record<string, unknown>;
}

export type SessionUpdate =
  | UserMessageChunkUpdate
  | AgentMessageChunkUpdate
  | AgentThoughtChunkUpdate
  | ToolCallSessionUpdate
  | ToolCallUpdateSessionUpdate
  | PlanSessionUpdate
  | AvailableCommandsUpdate
  | CurrentModeUpdate
  | ConfigOptionUpdate
  | SessionInfoUpdate
  | UsageUpdate;

// ============================================================================
// Messages sent TO the proxy server
// ============================================================================

export type ProxyMessage =
  // Connection management
  | { type: 'connect'; payload?: { command?: string; args?: string[] } }
  | { type: 'disconnect' }
  | { type: 'ping' }
  // Session management
  | { type: 'new_session'; payload?: { cwd?: string } }
  | { type: 'prompt'; payload: { content: ContentBlock[] } }
  | { type: 'cancel' }
  | { type: 'set_session_model'; payload: { modelId: string } }
  | { type: 'set_config_option'; payload: { sessionId: string; configId: string; type: 'id' | 'boolean'; value: string | boolean } }
  // Session history
  | { type: 'list_sessions'; payload?: { cwd?: string; cursor?: string } }
  | { type: 'load_session'; payload: { sessionId: string; cwd?: string } }
  | { type: 'resume_session'; payload: { sessionId: string; cwd?: string; replayFrom?: { type: string } } }
  | { type: 'delete_session'; payload: { sessionId: string } }
  // Permission response
  | { type: 'permission_response'; payload: { requestId: string; outcome: { outcome: 'cancelled' } | { outcome: 'selected'; optionId: string } } }
  // Browser tool response (from extension)
  | { type: 'browser_tool_result'; callId: string; result: unknown };

// ============================================================================
// Messages received FROM the proxy server
// ============================================================================

export interface ProxyStatusMessage {
  type: 'status';
  payload: {
    connected: boolean;
    agentInfo?: { name?: string; version?: string };
    capabilities?: AgentCapabilitiesLike | null;
  };
}

export interface ProxyErrorMessage {
  type: 'error';
  payload: { message: string };
}

export interface ProxySessionCreatedMessage {
  type: 'session_created';
  payload: {
    sessionId: string;
    configOptions?: Array<{
      id: string;
      name: string;
      description?: string;
      category?: string;
      type: 'select' | 'boolean';
      currentValue?: string | boolean;
      options?: Array<{ value: string; name: string; description?: string }>;
    }>;
  };
}

export interface ProxySessionUpdateMessage {
  type: 'session_update';
  payload: {
    sessionId: string;
    update: SessionUpdate;
  };
}

export interface ProxyPromptCompleteMessage {
  type: 'prompt_complete';
  payload: { stopReason: string };
}

export interface ProxyPermissionRequestMessage {
  type: 'permission_request';
  payload: {
    requestId: string;
    sessionId: string;
    options: PermissionOption[];
    toolCall: ToolCall;
  };
}

// Session history responses
export interface ProxySessionListMessage {
  type: 'session_list';
  payload: {
    sessions: SessionInfo[];
    nextCursor?: string;
    _meta?: unknown;
  };
}

export interface ProxySessionLoadedMessage {
  type: 'session_loaded';
  payload: {
    sessionId: string;
    promptCapabilities?: PromptCapabilities;
    models?: ModelState;
    configOptions?: Array<{
      id: string;
      name: string;
      description?: string;
      category?: string;
      type: 'select' | 'boolean';
      currentValue?: string | boolean;
      options?: Array<{ value: string; name: string; description?: string }>;
    }>;
  };
}

export interface ProxySessionResumedMessage {
  type: 'session_resumed';
  payload: {
    sessionId: string;
    promptCapabilities?: PromptCapabilities;
    models?: ModelState;
    configOptions?: Array<{
      id: string;
      name: string;
      description?: string;
      category?: string;
      type: 'select' | 'boolean';
      currentValue?: string | boolean;
      options?: Array<{ value: string; name: string; description?: string }>;
    }>;
  };
}

export interface ProxySessionDeletedMessage {
  type: 'session_deleted';
  payload: {
    sessionId: string;
  };
}

// Model responses
export interface ProxyModelChangedMessage {
  type: 'model_changed';
  payload: { modelId: string };
}

export interface ProxyPongMessage {
  type: 'pong';
}

export interface ProxyConfigOptionUpdateMessage {
  type: 'config_option_update';
  payload: { configOptions: ConfigOption[] };
}

export type ProxyResponse =
  | ProxyStatusMessage
  | ProxyErrorMessage
  | ProxySessionCreatedMessage
  | ProxySessionUpdateMessage
  | ProxyPromptCompleteMessage
  | ProxyPermissionRequestMessage
  | ProxySessionListMessage
  | ProxySessionLoadedMessage
  | ProxySessionResumedMessage
  | ProxySessionDeletedMessage
  | ProxyModelChangedMessage
  | ProxyConfigOptionUpdateMessage
  | ProxyPongMessage;

// ============================================================================
// Additional types
// ============================================================================

export interface SessionDeleteCapabilities {
  _meta?: unknown;
}

export interface SessionCapabilities {
  list?: unknown;
  delete?: SessionDeleteCapabilities | null;
  additionalDirectories?: unknown;
  fork?: unknown;
  resume?: unknown;
  close?: unknown;
  _meta?: unknown;
}

export interface AgentCapabilitiesLike {
  loadSession?: boolean;
  promptCapabilities?: PromptCapabilities;
  sessionCapabilities?: SessionCapabilities;
  session?: SessionCapabilities | null;
  _meta?: unknown;
}

export interface SessionInfo {
  _meta?: unknown;
  cwd: string;
  sessionId: string;
  title?: string;
  updatedAt?: string;
}

export interface PromptCapabilities {
  text?: boolean;
  image?: boolean;
  audio?: boolean;
  embeddedContext?: boolean;
}

export interface ModelState {
  currentModelId?: string;
  models?: Array<{ modelId: string; name: string; description?: string }>;
}

// Connection state
export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

export interface PermissionRequest {
  requestId: string;
  sessionId: string;
  options: PermissionOption[];
  toolCall: ToolCall;
}

// ============================================================================
// Service
// ============================================================================

@Injectable({
  providedIn: 'root'
})
export class AcpWebSocketService {
  private ws: WebSocket | null = null;
  private pendingPermissions = new Map<string, {
    resolve: (outcome: any) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>();

  private connectResolve: (() => void) | null = null;
  private connectReject: ((error: Error) => void) | null = null;

  readonly connectionState = signal<ConnectionState>('disconnected');
  readonly error = signal<string | null>(null);
  readonly sessionId = signal<string | null>(null);
  readonly agentCapabilities = signal<AgentCapabilitiesLike | null>(null);

  // Event callbacks
  private onSessionUpdateCallback: ((update: SessionUpdate) => void) | null = null;
  private onPermissionRequestCallback: ((request: PermissionRequest) => void) | null = null;
  private onPromptCompleteCallback: ((stopReason: string) => void) | null = null;
  private onSessionCreatedCallback: ((sessionId: string, configOptions?: ConfigOption[]) => void) | null = null;
  private onSessionListCallback: ((sessions: SessionInfo[], nextCursor?: string) => void) | null = null;
  private onSessionLoadedCallback: ((sessionId: string, promptCapabilities?: PromptCapabilities, models?: ModelState, configOptions?: ConfigOption[]) => void) | null = null;
  private onSessionResumedCallback: ((sessionId: string, promptCapabilities?: PromptCapabilities, models?: ModelState, configOptions?: ConfigOption[]) => void) | null = null;
  private onSessionDeletedCallback: ((sessionId: string) => void) | null = null;
  private onModelChangedCallback: ((modelId: string) => void) | null = null;
  private onConfigOptionUpdateCallback: ((configOptions: ConfigOption[]) => void) | null = null;

  constructor() {}

  // ============================================================================
  // Event handlers
  // ============================================================================

  onSessionUpdate(callback: (update: SessionUpdate) => void): void {
    this.onSessionUpdateCallback = callback;
  }

  onPermissionRequest(callback: (request: PermissionRequest) => void): void {
    this.onPermissionRequestCallback = callback;
  }

  onPromptComplete(callback: (stopReason: string) => void): void {
    this.onPromptCompleteCallback = callback;
  }

  onSessionCreated(callback: (sessionId: string, configOptions?: ConfigOption[]) => void): void {
    this.onSessionCreatedCallback = callback;
  }

  onSessionList(callback: (sessions: SessionInfo[], nextCursor?: string) => void): void {
    this.onSessionListCallback = callback;
  }

  onSessionLoaded(callback: (sessionId: string, promptCapabilities?: PromptCapabilities, models?: ModelState, configOptions?: ConfigOption[]) => void): void {
    this.onSessionLoadedCallback = callback;
  }

  onSessionResumed(callback: (sessionId: string, promptCapabilities?: PromptCapabilities, models?: ModelState, configOptions?: ConfigOption[]) => void): void {
    this.onSessionResumedCallback = callback;
  }

  onSessionDeleted(callback: (sessionId: string) => void): void {
    this.onSessionDeletedCallback = callback;
  }

  onModelChanged(callback: (modelId: string) => void): void {
    this.onModelChangedCallback = callback;
  }

  onConfigOptionUpdate(callback: (configOptions: ConfigOption[]) => void): void {
    this.onConfigOptionUpdateCallback = callback;
  }

  // ============================================================================
  // Connection management
  // ============================================================================

  connect(url: string, agent?: { command: string; args?: string[] }): Promise<void> {
    if (this.ws) {
      this.disconnect();
    }

    this.connectionState.set('connecting');
    this.error.set(null);

    return new Promise((resolve, reject) => {
      this.connectResolve = resolve;
      this.connectReject = reject;

      try {
        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
          this.send({
            type: 'connect',
            payload: agent ? { command: agent.command, args: agent.args } : undefined,
          });
        };

        this.ws.onmessage = (event) => {
          try {
            const response: ProxyResponse = JSON.parse(event.data);
            this.handleResponse(response);
          } catch (error) {
            console.error('[ACP WebSocket] Failed to parse message:', error);
          }
        };

        this.ws.onerror = () => {
          console.error('[ACP WebSocket] Error');
          this.connectionState.set('error');
          this.error.set('WebSocket connection error');
          this.connectReject?.(new Error('WebSocket connection error'));
          this.connectResolve = null;
          this.connectReject = null;
        };

        this.ws.onclose = () => {
          this.connectionState.set('disconnected');
          this.ws = null;
          this.sessionId.set(null);
          this.agentCapabilities.set(null);
        };
      } catch (error) {
        this.connectionState.set('error');
        this.error.set((error as Error).message);
        reject(error);
      }
    });
  }

  recordProxyRes: ProxyResponse[] = [];
  private handleResponse(response: ProxyResponse): void {
    this.recordProxyRes.push(response);

    switch (response.type) {
      case 'status':
        if (response.payload.connected) {
          this.connectionState.set('connected');
          this.agentCapabilities.set(response.payload.capabilities ?? null);
          this.connectResolve?.();
        } else {
          this.connectionState.set('disconnected');
          this.agentCapabilities.set(null);
        }
        this.connectResolve = null;
        this.connectReject = null;
        break;

      case 'error':
        console.error('[ACP WebSocket] Error:', response.payload.message);
        this.error.set(response.payload.message);
        this.connectReject?.(new Error(response.payload.message));
        this.connectResolve = null;
        this.connectReject = null;
        break;

      case 'session_created':
        this.sessionId.set(response.payload.sessionId);
        this.onSessionCreatedCallback?.(response.payload.sessionId, response.payload.configOptions);
        break;

      case 'session_update':
        this.onSessionUpdateCallback?.(response.payload.update);
        break;

      case 'prompt_complete':
        this.onPromptCompleteCallback?.(response.payload.stopReason);
        break;

      case 'permission_request':
        this.handlePermissionRequest(response.payload);
        break;

      case 'session_list':
        this.onSessionListCallback?.(response.payload.sessions, response.payload.nextCursor);
        break;

      case 'session_loaded':
        this.sessionId.set(response.payload.sessionId);
        this.onSessionLoadedCallback?.(
          response.payload.sessionId,
          response.payload.promptCapabilities,
          response.payload.models,
          response.payload.configOptions
        );
        break;

      case 'session_resumed':
        this.sessionId.set(response.payload.sessionId);
        this.onSessionResumedCallback?.(
          response.payload.sessionId,
          response.payload.promptCapabilities,
          response.payload.models,
          response.payload.configOptions
        );
        break;

      case 'session_deleted':
        this.onSessionDeletedCallback?.(response.payload.sessionId);
        break;

      case 'model_changed':
        this.onModelChangedCallback?.(response.payload.modelId);
        break;

      case 'config_option_update':
        this.onConfigOptionUpdateCallback?.(response.payload.configOptions);
        break;

      case 'pong':
        break;
    }
  }

  private handlePermissionRequest(payload: ProxyPermissionRequestMessage['payload']): void {
    const timeout = setTimeout(() => {
      this.pendingPermissions.delete(payload.requestId);
      this.sendPermissionResponse(payload.requestId, { outcome: 'cancelled' });
    }, 5 * 60 * 1000);

    this.pendingPermissions.set(payload.requestId, {
      resolve: () => {},
      timeout
    });

    this.onPermissionRequestCallback?.(payload);
  }

  disconnect(): void {
    if (this.ws) {
      try {
        this.send({ type: 'disconnect' });
      } catch {
        // Ignore send errors during disconnect
      }
      this.ws.close();
      this.ws = null;
    }
    this.connectionState.set('disconnected');
    this.sessionId.set(null);
    this.agentCapabilities.set(null);
    this.cancelAllPendingPermissions();
  }

  // ============================================================================
  // Session management
  // ============================================================================

  createSession(cwd?: string): void {
    this.send({ type: 'new_session', payload: { cwd } });
  }

  createSessionAsync(cwd?: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.onSessionCreatedCallback = originalCallback;
        reject(new Error('createSession timed out'));
      }, 10000);

      const originalCallback = this.onSessionCreatedCallback;
      this.onSessionCreatedCallback = (sessionId, configOptions) => {
        clearTimeout(timeout);
        if (originalCallback) {
          originalCallback(sessionId, configOptions);
        }
        resolve(sessionId);
      };

      this.send({ type: 'new_session', payload: { cwd } });
    });
  }

  sendPrompt(content: ContentBlock[]): void {
    this.send({
      type: 'prompt',
      payload: {
        content
      }
    });
  }

  cancel(): void {
    this.send({ type: 'cancel' });
  }

  setModel(modelId: string): void {
    this.send({ type: 'set_session_model', payload: { modelId } });
  }

  setConfigOption(configId: string, type: 'id' | 'boolean', value: string | boolean): void {
    const sessionId = this.sessionId();
    if (!sessionId) {
      console.error('[AcpWebSocketService] No session ID, cannot set config option');
      return;
    }
    this.send({ type: 'set_config_option', payload: { sessionId, configId, type, value } });
  }

  // ============================================================================
  // Session history
  // ============================================================================

  listSessions(cwd?: string, cursor?: string): void {
    this.send({ type: 'list_sessions', payload: { cwd, cursor } });
  }

  loadSession(sessionId: string, cwd?: string): void {
    this.send({ type: 'load_session', payload: { sessionId, cwd } });
  }

  resumeSession(sessionId: string, cwd?: string, replayFrom?: { type: string }): void {
    this.send({ type: 'resume_session', payload: { sessionId, cwd, replayFrom } });
  }

  deleteSession(sessionId: string): void {
    this.send({ type: 'delete_session', payload: { sessionId } });
  }

  // ============================================================================
  // Permission response
  // ============================================================================

  sendPermissionResponse(requestId: string, outcome: { outcome: 'cancelled' } | { outcome: 'selected'; optionId: string }): void {
    this.send({ type: 'permission_response', payload: { requestId, outcome } });
    
    const pending = this.pendingPermissions.get(requestId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingPermissions.delete(requestId);
    }
  }

  // ============================================================================
  // Browser tool response (from extension)
  // ============================================================================

  sendBrowserToolResult(callId: string, result: unknown): void {
    this.send({ type: 'browser_tool_result', callId, result });
  }

  // ============================================================================
  // Ping
  // ============================================================================

  ping(): void {
    this.send({ type: 'ping' });
  }

  // ============================================================================
  // Internal
  // ============================================================================

  private send(message: ProxyMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('[ACP WebSocket] Not connected');
      return;
    }
    this.ws.send(JSON.stringify(message));
  }

  private cancelAllPendingPermissions(): void {
    for (const [requestId, pending] of this.pendingPermissions) {
      clearTimeout(pending.timeout);
      this.sendPermissionResponse(requestId, { outcome: 'cancelled' });
    }
    this.pendingPermissions.clear();
  }
}
