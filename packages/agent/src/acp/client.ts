import { client, type ClientApp, type ClientConnection, type ActiveSession, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import type * as acp from '@agentclientprotocol/sdk';
import type { WebSocket } from 'ws';
import { AgentProcess } from './agent-process.js';
import type { PendingPermission, AcpWsMessage, AcpWsResponse } from './types.js';

const PERMISSION_TIMEOUT_MS = 5 * 60 * 1000;

function generateRequestId(): string {
  return `perm_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

function send(ws: WebSocket, type: string, payload?: unknown): void {
  if (ws.readyState === 1 /* OPEN */) {
    ws.send(JSON.stringify({ type, payload }));
  }
}

export interface AcpClientConfig {
  defaultCwd: string;
  agentCommand?: string;
  agentArgs?: string[];
}

/**
 * ACP Client that bridges a WebSocket connection to an ACP agent process.
 *
 * Architecture:
 *   Browser ←→ WebSocket (custom JSON) ←→ AcpClient ←→ stdio (ACP JSON-RPC) ←→ Agent Process
 *
 * Each WebSocket connection gets its own AcpClient instance with its own
 * agent process and ACP connection.
 */
export class AcpClient {
  private agentProcess: AgentProcess | null = null;
  private clientApp: ClientApp | null = null;
  private clientConnection: ClientConnection | null = null;
  private activeSession: ActiveSession | null = null;
  private loadedSessionId: string | null = null;
  private pendingPermissions: Map<string, PendingPermission> = new Map();
  private agentCapabilities: acp.AgentCapabilities | null = null;

  constructor(
    private ws: WebSocket,
    private config: AcpClientConfig,
  ) {}

  // ==========================================================================
  // WebSocket message dispatcher
  // ==========================================================================

  async handleMessage(msg: AcpWsMessage): Promise<void> {
    switch (msg.type) {
      case 'connect':
        await this.connect(msg.payload || {});
        break;
      case 'disconnect':
        this.disconnect();
        break;
      case 'new_session':
        await this.newSession(msg.payload || {});
        break;
      case 'prompt':
        await this.prompt(msg.payload);
        break;
      case 'cancel':
        await this.cancel();
        break;
      case 'permission_response':
        this.handlePermissionResponse(msg.payload);
        break;
      case 'list_sessions':
        await this.listSessions(msg.payload || {});
        break;
      case 'load_session':
        await this.loadSession(msg.payload);
        break;
      case 'resume_session':
        await this.resumeSession(msg.payload);
        break;
      case 'delete_session':
        await this.deleteSession(msg.payload);
        break;
      case 'set_session_model':
        await this.setSessionModel(msg.payload);
        break;
      case 'set_config_option':
        await this.setSessionConfigOption(msg.payload);
        break;
      case 'ping':
        send(this.ws, 'pong');
        break;
      default:
        send(this.ws, 'error', { message: `Unknown message type: ${(msg as { type: string }).type}` });
    }
  }

  // ==========================================================================
  // Connect: spawn agent + create ACP connection
  // ==========================================================================

  private async connect(params: { command?: string; args?: string[]; cwd?: string }): Promise<void> {
    // Use config defaults when frontend doesn't provide command
    const command = params.command || this.config.agentCommand;
    const args = params.args || this.config.agentArgs;
    const cwd = params.cwd || this.config.defaultCwd;

    if (!command) {
      send(this.ws, 'error', { message: 'No agent command configured. Send { type: "connect", payload: { command: "..." } } or configure a default command.' });
      return;
    }

    // Clean up existing connection
    if (this.agentProcess) {
      this.cancelPendingPermissions();
      this.activeSession?.dispose();
      this.clientConnection?.close();
      this.agentProcess.kill();
      this.agentProcess = null;
      this.clientConnection = null;
      this.activeSession = null;
      this.agentCapabilities = null;
    }

    try {
      // 1. Spawn agent process
      this.agentProcess = new AgentProcess();
      this.agentProcess.spawn({
        command,
        args,
        cwd,
      });

      // 2. Create stdio-based ACP stream
      const stream = this.agentProcess.createStream();

      // 3. Create ClientApp with handlers for this connection
      this.clientApp = this.createClientApp();

      // 4. Connect to the agent
      this.clientConnection = this.clientApp.connect(stream);

      // 5. Handle connection close
      this.clientConnection.closed.then(() => {
        console.log('[ACP Client] Connection closed');
        this.clientConnection = null;
        this.activeSession = null;
        this.agentCapabilities = null;
        send(this.ws, 'status', { connected: false });
      });

      // 6. Initialize the connection
      const initResult = await this.clientConnection.agent.request('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        clientInfo: {
          name: 'luxio-agent',
          version: '1.0.0',
        },
        clientCapabilities: {
          fs: {
            readTextFile: true,
            writeTextFile: true,
          },
        },
      });

      console.log('[ACP Client] Agent initialized', {
        protocolVersion: initResult.protocolVersion,
        agentInfo: initResult.agentInfo,
      });

      // 7. Store capabilities for capability-gated methods
      this.agentCapabilities = initResult.agentCapabilities ?? null;

      // 8. Notify frontend
      send(this.ws, 'status', {
        connected: true,
        agentInfo: initResult.agentInfo,
        capabilities: initResult.agentCapabilities,
      });

      // 8. Handle process exit
      this.agentProcess.onClose(() => {
        send(this.ws, 'status', { connected: false });
      });

    } catch (error) {
      console.error('[ACP Client] Failed to connect:', error);
      send(this.ws, 'error', {
        message: `Failed to connect: ${(error as Error).message}`,
      });
    }
  }

  // ==========================================================================
  // Create ClientApp with handlers for this connection
  // ==========================================================================

  private createClientApp(): ClientApp {
    const ws = this.ws;
    const pendingPermissions = this.pendingPermissions;

    return client({ name: 'luxio-agent' })
      .onNotification('session/update', (ctx) => {
        // Forward session updates to the frontend
        send(ws, 'session_update', ctx.params);
      })
      .onRequest('session/request_permission', async (ctx) => {
        // Forward permission request to frontend and wait for response
        const requestId = generateRequestId();
        const params = ctx.params;

        console.log('[ACP Client] Permission requested:', requestId, params.toolCall);

        send(ws, 'permission_request', {
          requestId,
          sessionId: params.sessionId,
          options: params.options,
          toolCall: params.toolCall,
        });

        // Wait for frontend response
        const outcome = await new Promise<acp.RequestPermissionOutcome>((resolve) => {
          const timeout = setTimeout(() => {
            console.log('[ACP Client] Permission request timed out:', requestId);
            pendingPermissions.delete(requestId);
            resolve({ outcome: 'cancelled' });
          }, PERMISSION_TIMEOUT_MS);

          pendingPermissions.set(requestId, { resolve, timeout });
        });

        console.log('[ACP Client] Permission response:', requestId, outcome);
        return { outcome };
      })
      .onRequest('fs/read_text_file', async (ctx) => {
        console.log('[ACP Client] Read file:', ctx.params.path);
        // TODO: Delegate to FileService
        return { content: '' };
      })
      .onRequest('fs/write_text_file', async (ctx) => {
        console.log('[ACP Client] Write file:', ctx.params.path);
        // TODO: Delegate to FileService
        return {};
      });
  }

  // ==========================================================================
  // Session operations
  // ==========================================================================

  private async newSession(params: { cwd?: string }): Promise<void> {
    if (!this.clientConnection) {
      send(this.ws, 'error', { message: 'Not connected to agent' });
      return;
    }

    try {
      const cwd = params.cwd || this.config.defaultCwd;

      // Dispose previous session if any
      this.activeSession?.dispose();
      this.loadedSessionId = null;

      // Create and start a new session
      this.activeSession = await this.clientConnection.agent
        .buildSession(cwd)
        .start();

      const sessionResponse = this.activeSession.newSessionResponse;

      console.log('[ACP Client] Session created:', this.activeSession.sessionId);

      send(this.ws, 'session_created', sessionResponse);

      // Start reading session updates in the background
      this.readSessionUpdates();

    } catch (error) {
      console.error('[ACP Client] Failed to create session:', error);
      send(this.ws, 'error', {
        message: `Failed to create session: ${(error as Error).message}`,
      });
    }
  }

  /**
   * Background loop that reads session updates and forwards them to the frontend.
   */
  private async readSessionUpdates(): Promise<void> {
    const session = this.activeSession;
    if (!session) return;

    try {
      while (true) {
        const message = await session.nextUpdate();

        if (message.kind === 'stop') {
          console.log('[ACP Client] Prompt completed:', message.stopReason);
          send(this.ws, 'prompt_complete', message.response);
          break;
        }

        // session_update messages are already forwarded by the onNotification handler
      }
    } catch (error) {
      if (!this.activeSession) {
        // Session was disposed, expected
        return;
      }
      console.error('[ACP Client] Error reading session updates:', error);
    }
  }

  private async prompt(params: { content: acp.ContentBlock[] }): Promise<void> {
    const sessionId = this.activeSession?.sessionId ?? this.loadedSessionId;

    if (!sessionId || !this.clientConnection) {
      send(this.ws, 'error', { message: 'No active session' });
      return;
    }

    try {
      console.log('[ACP Client] Sending prompt to session:', sessionId);
      const result = await this.clientConnection.agent.request('session/prompt', {
        sessionId,
        prompt: params.content,
      });

      console.log('[ACP Client] Prompt completed:', result.stopReason);
      send(this.ws, 'prompt_complete', result);

    } catch (error) {
      console.error('[ACP Client] Prompt failed:', error);
      send(this.ws, 'error', {
        message: `Prompt failed: ${(error as Error).message}`,
      });
    }
  }

  private async cancel(): Promise<void> {
    const sessionId = this.activeSession?.sessionId ?? this.loadedSessionId;
    if (!this.clientConnection || !sessionId) {
      return;
    }

    this.cancelPendingPermissions();

    try {
      await this.clientConnection.agent.notify('session/cancel', {
        sessionId,
      });
      console.log('[ACP Client] Cancel sent');
    } catch (error) {
      console.error('[ACP Client] Failed to cancel:', error);
    }
  }

  private async listSessions(params: { cwd?: string; cursor?: string }): Promise<void> {
    if (!this.clientConnection) {
      send(this.ws, 'error', { message: 'Not connected to agent' });
      return;
    }

    try {
      const result = await this.clientConnection.agent.request('session/list', {
        cwd: params.cwd,
        cursor: params.cursor,
      });
      send(this.ws, 'session_list', result);
    } catch (error) {
      send(this.ws, 'error', {
        message: `Failed to list sessions: ${(error as Error).message}`,
      });
    }
  }

  private async loadSession(params: { sessionId: string; cwd?: string }): Promise<void> {
    if (!this.clientConnection) {
      send(this.ws, 'error', { message: 'Not connected to agent' });
      return;
    }

    try {
      const cwd = params.cwd || this.config.defaultCwd;

      this.activeSession?.dispose();

      // Load session metadata
      const loadResult = await this.clientConnection.agent.request('session/load', {
        sessionId: params.sessionId,
        cwd,
        mcpServers: [],
      });

      // Resume session to make it active (without replay)
      await this.clientConnection.agent.request('session/resume', {
        sessionId: params.sessionId,
        cwd,
        mcpServers: [],
      });

      // Store session ID so prompt() can send directly
      this.loadedSessionId = params.sessionId;

      console.log('[ACP Client] Session loaded and resumed:', params.sessionId);

      send(this.ws, 'session_loaded', {
        sessionId: params.sessionId,
        ...loadResult,
      });

    } catch (error) {
      console.error('[ACP Client] Failed to load session:', error);
      send(this.ws, 'error', {
        message: `Failed to load session: ${(error as Error).message}`,
      });
    }
  }

  private async resumeSession(params: { sessionId: string; cwd?: string }): Promise<void> {
    if (!this.clientConnection) {
      send(this.ws, 'error', { message: 'Not connected to agent' });
      return;
    }

    try {
      const cwd = params.cwd || this.config.defaultCwd;

      this.activeSession?.dispose();

      const result = await this.clientConnection.agent.request('session/resume', {
        sessionId: params.sessionId,
        cwd,
        mcpServers: [],
      });

      // Store session ID so prompt() can send directly
      this.loadedSessionId = params.sessionId;

      console.log('[ACP Client] Session resumed:', params.sessionId);

      send(this.ws, 'session_resumed', {
        sessionId: params.sessionId,
        ...result,
      });

    } catch (error) {
      send(this.ws, 'error', {
        message: `Failed to resume session: ${(error as Error).message}`,
      });
    }
  }

  private async deleteSession(params: { sessionId: string }): Promise<void> {
    if (!this.clientConnection) {
      send(this.ws, 'error', { message: 'Not connected to agent' });
      return;
    }

    // Per the ACP spec, clients MUST verify the session.delete capability
    // before attempting to delete a session. Supplying {} means the agent
    // supports deletion; omitting the field or setting it to null means it
    // does not, and clients MUST NOT attempt to call session/delete.
    const deleteCapability = this.agentCapabilities?.sessionCapabilities?.delete;
    if (deleteCapability === undefined || deleteCapability === null) {
      send(this.ws, 'error', {
        message: 'Agent does not support session deletion',
      });
      return;
    }

    try {
      const sessionId = params.sessionId;

      await this.clientConnection.agent.request('session/delete', { sessionId });

      console.log('[ACP Client] Session deleted:', sessionId);

      // If the deleted session is the currently loaded/active one, clean up local state.
      if (
        this.loadedSessionId === sessionId ||
        this.activeSession?.sessionId === sessionId
      ) {
        this.activeSession?.dispose();
        this.activeSession = null;
        this.loadedSessionId = null;
      }

      send(this.ws, 'session_deleted', { sessionId });
    } catch (error) {
      console.error('[ACP Client] Failed to delete session:', error);
      send(this.ws, 'error', {
        message: `Failed to delete session: ${(error as Error).message}`,
      });
    }
  }

  private async setSessionModel(params: { modelId: string }): Promise<void> {
    if (!this.clientConnection || !this.activeSession) {
      send(this.ws, 'error', { message: 'No active session' });
      return;
    }

    // Model selection is not supported in ACP SDK v1.2.1
    // The unstable_setSessionModel from v0.14.1 was removed
    send(this.ws, 'error', {
      message: 'Model selection is not supported in this ACP version',
    });
  }

  private async setSessionConfigOption(params: { sessionId: string; configId: string; type: 'id' | 'boolean'; value: string | boolean }): Promise<void> {
    if (!this.clientConnection) {
      send(this.ws, 'error', { message: 'No active connection' });
      return;
    }

    try {
      const result = await this.clientConnection.agent.request('session/set_config_option', {
        sessionId: params.sessionId,
        configId: params.configId,
        ...(params.type === 'boolean'
          ? { type: 'boolean' as const, value: params.value as boolean }
          : { value: params.value as string }),
      });

      send(this.ws, 'config_option_update', { configOptions: result.configOptions });
    } catch (error) {
      console.error('[ACP Client] Failed to set config option:', error);
      send(this.ws, 'error', {
        message: `Failed to set config option: ${(error as Error).message}`,
      });
    }
  }

  // ==========================================================================
  // Permission handling
  // ==========================================================================

  private handlePermissionResponse(payload: {
    requestId: string;
    outcome: acp.RequestPermissionOutcome;
  }): void {
    const pending = this.pendingPermissions.get(payload.requestId);
    if (!pending) {
      console.warn('[ACP Client] Unknown permission response:', payload.requestId);
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingPermissions.delete(payload.requestId);
    pending.resolve(payload.outcome);
  }

  private cancelPendingPermissions(): void {
    for (const [requestId, pending] of this.pendingPermissions) {
      clearTimeout(pending.timeout);
      pending.resolve({ outcome: 'cancelled' });
    }
    this.pendingPermissions.clear();
  }

  // ==========================================================================
  // Disconnect / cleanup
  // ==========================================================================

  disconnect(): void {
    this.cancelPendingPermissions();

    this.activeSession?.dispose();
    this.activeSession = null;
    this.loadedSessionId = null;

    this.clientConnection?.close();
    this.clientConnection = null;

    this.clientApp = null;

    if (this.agentProcess) {
      this.agentProcess.kill();
      this.agentProcess = null;
    }

    send(this.ws, 'status', { connected: false });
  }
}
