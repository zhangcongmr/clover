import { Injectable, signal } from '@angular/core';

// Messages sent TO the proxy server
export type ProxyMessage =
  | { type: 'connect' }
  | { type: 'disconnect' }
  | { type: 'new_session'; payload?: { cwd?: string } }
  | { type: 'prompt'; payload: { content: ContentBlock[] } }
  | { type: 'cancel' }
  | { type: 'permission_response'; payload: { requestId: string; outcome: { outcome: 'cancelled' } | { outcome: 'selected'; optionId: string } } }
  | { type: 'ping' };

// Messages received FROM the proxy server
export interface ProxyStatusMessage {
  type: 'status';
  payload: {
    connected: boolean;
    agentInfo?: { name?: string; version?: string };
    capabilities?: unknown;
  };
}

export interface ProxyErrorMessage {
  type: 'error';
  payload: { message: string };
}

export interface ProxySessionCreatedMessage {
  type: 'session_created';
  payload: { sessionId: string };
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
    options: Array<{ optionId: string; label?: string; description?: string }>;
    toolCall: {
      toolCallId: string;
      title: string;
      kind?: string;
    };
  };
}

export type ProxyResponse =
  | ProxyStatusMessage
  | ProxyErrorMessage
  | ProxySessionCreatedMessage
  | ProxySessionUpdateMessage
  | ProxyPromptCompleteMessage
  | ProxyPermissionRequestMessage;

// Content block types
export interface TextContent {
  type: 'text';
  text: string;
}

export interface ImageContent {
  type: 'image';
  mimeType: string;
  data: string;
}

export type ContentBlock = TextContent | ImageContent | { type: string; text?: string };

// Session update types from ACP
export interface AgentMessageChunkUpdate {
  sessionUpdate: 'agent_message_chunk';
  content: ContentBlock;
}

export interface ToolCallUpdate {
  sessionUpdate: 'tool_call';
  toolCallId: string;
  title: string;
  status: string;
  content?: any[];
  rawInput?: Record<string, unknown>;
  rawOutput?: Record<string, unknown>;
}

export interface ToolCallStatusUpdate {
  sessionUpdate: 'tool_call_update';
  toolCallId: string;
  status?: string;
  title?: string;
  content?: any[];
  rawInput?: Record<string, unknown>;
  rawOutput?: Record<string, unknown>;
}

export interface AgentThoughtChunkUpdate {
  sessionUpdate: 'agent_thought_chunk';
  content: ContentBlock;
}

export interface PlanUpdate {
  sessionUpdate: 'plan';
}

export interface UserMessageChunkUpdate {
  sessionUpdate: 'user_message_chunk';
  content: ContentBlock;
}

export type SessionUpdate =
  | AgentMessageChunkUpdate
  | ToolCallUpdate
  | ToolCallStatusUpdate
  | AgentThoughtChunkUpdate
  | PlanUpdate
  | UserMessageChunkUpdate;

// Connection state
export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

export interface PermissionRequest {
  requestId: string;
  sessionId: string;
  options: Array<{ optionId: string; label?: string; description?: string }>;
  toolCall: {
    toolCallId: string;
    title: string;
    kind?: string;
  };
}

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

  // Event callbacks
  private onSessionUpdateCallback: ((update: SessionUpdate) => void) | null = null;
  private onPermissionRequestCallback: ((request: PermissionRequest) => void) | null = null;
  private onPromptCompleteCallback: ((stopReason: string) => void) | null = null;
  private onSessionCreatedCallback: ((sessionId: string) => void) | null = null;

  constructor() {}

  onSessionUpdate(callback: (update: SessionUpdate) => void): void {
    this.onSessionUpdateCallback = callback;
  }

  onPermissionRequest(callback: (request: PermissionRequest) => void): void {
    this.onPermissionRequestCallback = callback;
  }

  onPromptComplete(callback: (stopReason: string) => void): void {
    this.onPromptCompleteCallback = callback;
  }

  onSessionCreated(callback: (sessionId: string) => void): void {
    this.onSessionCreatedCallback = callback;
  }

  connect(url: string): Promise<void> {
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
          console.log('[ACP WebSocket] Connected, sending connect command');
          this.send({ type: 'connect' });
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
          console.log('[ACP WebSocket] Closed');
          this.connectionState.set('disconnected');
          this.ws = null;
          this.sessionId.set(null);
        };
      } catch (error) {
        this.connectionState.set('error');
        this.error.set((error as Error).message);
        reject(error);
      }
    });
  }

  private handleResponse(response: ProxyResponse): void {
    console.log('[ACP WebSocket] Received:', response.type);

    switch (response.type) {
      case 'status':
        if (response.payload.connected) {
          this.connectionState.set('connected');
          this.connectResolve?.();
        } else {
          this.connectionState.set('disconnected');
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
        this.onSessionCreatedCallback?.(response.payload.sessionId);
        break;

      case 'session_update':
        this.onSessionUpdateCallback?.(response.payload.update);
        break;

      case 'prompt_complete':
        this.onPromptCompleteCallback?.(response.payload.stopReason);
        break;

      case 'permission_request':
        console.log('[ACP WebSocket] Permission request:', response.payload);
        this.handlePermissionRequest(response.payload);
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
    this.cancelAllPendingPermissions();
  }

  createSession(cwd?: string): void {
    this.send({ type: 'new_session', payload: { cwd } });
  }

  sendPrompt(text: string): void {
    this.send({
      type: 'prompt',
      payload: {
        content: [{ type: 'text', text }]
      }
    });
  }

  cancel(): void {
    this.send({ type: 'cancel' });
  }

  sendPermissionResponse(requestId: string, outcome: { outcome: 'cancelled' } | { outcome: 'selected'; optionId: string }): void {
    this.send({ type: 'permission_response', payload: { requestId, outcome } });
    
    const pending = this.pendingPermissions.get(requestId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingPermissions.delete(requestId);
    }
  }

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
