import type * as acp from '@agentclientprotocol/sdk';

// Re-export ACP SDK types for convenience
export type {
  ContentBlock,
  SessionNotification,
  SessionUpdate,
  PromptResponse,
  StopReason,
  NewSessionResponse,
  LoadSessionResponse,
  SessionInfo,
  RequestPermissionRequest,
  RequestPermissionResponse,
  RequestPermissionOutcome,
  CancelNotification,
  InitializeResponse,
  AgentCapabilities,
  PromptCapabilities,
  SessionModeState,
  SessionConfigOption,
  McpServer,
} from '@agentclientprotocol/sdk';

// ============================================================================
// WebSocket Bridge Protocol Types
// ============================================================================

/**
 * Pending permission request tracked per connection.
 */
export interface PendingPermission {
  resolve: (outcome: acp.RequestPermissionOutcome) => void;
  timeout: ReturnType<typeof setTimeout>;
}

/**
 * Client → Agent messages over WebSocket.
 */
export type AcpWsMessage =
  | { type: 'connect'; payload: { command: string; args?: string[]; cwd?: string } }
  | { type: 'disconnect' }
  | { type: 'new_session'; payload: { cwd?: string } }
  | { type: 'prompt'; payload: { content: acp.ContentBlock[] } }
  | { type: 'cancel' }
  | { type: 'set_session_model'; payload: { modelId: string } }
  | { type: 'set_config_option'; payload: { sessionId: string; configId: string; type: 'id' | 'boolean'; value: string | boolean } }
  | { type: 'list_sessions'; payload?: { cwd?: string; cursor?: string } }
  | { type: 'load_session'; payload: { sessionId: string; cwd?: string } }
  | { type: 'resume_session'; payload: { sessionId: string; cwd?: string } }
  | { type: 'delete_session'; payload: { sessionId: string } }
  | { type: 'permission_response'; payload: { requestId: string; outcome: acp.RequestPermissionOutcome } }
  | { type: 'ping' };

/**
 * Agent → Client messages over WebSocket.
 */
export type AcpWsResponse =
  | { type: 'status'; payload: { connected: boolean; agentInfo?: acp.Implementation | null; capabilities?: acp.AgentCapabilities | null } }
  | { type: 'session_created'; payload: acp.NewSessionResponse }
  | { type: 'session_loaded'; payload: { sessionId: string } & Partial<acp.LoadSessionResponse> }
  | { type: 'session_resumed'; payload: { sessionId: string } & Partial<acp.LoadSessionResponse> }
  | { type: 'session_list'; payload: acp.ListSessionsResponse }
  | { type: 'session_deleted'; payload: { sessionId: string } }
  | { type: 'prompt_complete'; payload: acp.PromptResponse }
  | { type: 'session_update'; payload: acp.SessionNotification }
  | { type: 'permission_request'; payload: { requestId: string; sessionId: string; options: acp.RequestPermissionRequest['options']; toolCall: acp.RequestPermissionRequest['toolCall'] } }
  | { type: 'config_option_update'; payload: { configOptions: acp.SessionConfigOption[] } }
  | { type: 'model_changed'; payload: { modelId: string } }
  | { type: 'error'; payload: { message: string } }
  | { type: 'pong' };
