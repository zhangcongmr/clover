
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
