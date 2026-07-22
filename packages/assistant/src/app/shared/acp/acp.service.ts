import { Injectable, signal, computed, inject } from '@angular/core';
import { AcpWebSocketService, SessionUpdate, PermissionRequest } from './acp-websocket.service';

export interface AcpMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface AcpToolCall {
  id: string;
  title: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  kind?: string;
  content?: any[];
}

export interface AcpSessionState {
  sessionId: string | null;
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
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
  readonly toolCalls = signal<AcpToolCall[]>([]);
  readonly isProcessing = signal<boolean>(false);

  readonly messageCount = computed(() => this.messages().length);
  readonly hasActiveSession = computed(() => this.sessionState().sessionId !== null);

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

  async connect(url: string): Promise<void> {
    this.sessionState.update(s => ({ ...s, isConnecting: true, error: null }));

    try {
      await this.wsService.connect(url);
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

  async createSession(cwd?: string): Promise<void> {
    this.wsService.createSession(cwd);
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
    this.toolCalls.set([]);
  }

  private handleSessionUpdate(update: SessionUpdate): void {
    switch (update.sessionUpdate) {
      case 'agent_message_chunk':
        if (update.content?.type === 'text' && update.content.text) {
          this.appendAssistantMessage(update.content.text);
        }
        break;

      case 'tool_call':
        this.updateToolCall({
          id: update.toolCallId,
          title: update.title,
          status: update.status as 'pending' | 'running' | 'completed' | 'failed',
          content: update.content
        });
        break;

      case 'tool_call_update':
        if (update.status) {
          this.updateToolCallStatus(update.toolCallId, update.status);
        }
        break;

      case 'plan':
        // Handle plan updates if needed
        break;
    }
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

  private updateToolCall(toolCall: AcpToolCall): void {
    this.toolCalls.update(calls => {
      const existing = calls.find(c => c.id === toolCall.id);
      if (existing) {
        return calls.map(c => c.id === toolCall.id ? { ...c, ...toolCall } : c);
      }
      return [...calls, toolCall];
    });
  }

  private updateToolCallStatus(id: string, status: string): void {
    this.toolCalls.update(calls =>
      calls.map(c => c.id === id ? { ...c, status: status as any } : c)
    );
  }

  clearError(): void {
    this.sessionState.update(s => ({ ...s, error: null }));
  }

  clearMessages(): void {
    this.messages.set([]);
    this.toolCalls.set([]);
  }
}
