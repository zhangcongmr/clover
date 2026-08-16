import { client, type ClientApp, type ClientConnection, type ActiveSession, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import type * as acp from '@agentclientprotocol/sdk';
import { AgentProcess } from './agent-process.js';
import { RedisClient } from '../redis/client.js';

export interface SseAcpClientConfig {
  defaultCwd: string;
  agentCommand?: string;
  agentArgs?: string[];
  agentEnv?: Record<string, string>;
}

/**
 * SSE-based ACP Client that bridges Redis pub/sub to an ACP agent process.
 *
 * Architecture:
 *   Browser ←→ Redis Pub/Sub ←→ SseAcpClient ←→ stdio ←→ Agent Process
 *
 * Each session gets its own SseAcpClient instance with its own
 * agent process and ACP connection.
 */
export class SseAcpClient {
  private agentProcess: AgentProcess | null = null;
  private clientApp: ClientApp | null = null;
  private clientConnection: ClientConnection | null = null;
  private activeSession: ActiveSession | null = null;
  private loadedSessionId: string | null = null;
  private pendingPermissions: Map<string, { resolve: (outcome: any) => void; timeout: ReturnType<typeof setTimeout> }> = new Map();
  private agentCapabilities: acp.AgentCapabilities | null = null;
  private configOptionsCache: acp.SessionConfigOption[] | null = null;
  private sessionId: string;
  private redis: RedisClient;
  private unsubscribers: (() => void)[] = [];
  private onDisconnectedCallback: (() => void) | null = null;
  private onAgentSessionChangeCallback: (() => void) | null = null;
  private connectPromise: Promise<void> | null = null;

  constructor(
    sessionId: string,
    private config: SseAcpClientConfig,
    redis?: RedisClient,
  ) {
    this.sessionId = sessionId;
    this.redis = redis || RedisClient.getInstance();
  }

  /**
   * Connect to the agent process. Serialized so concurrent callers (e.g. the
   * SSE reconnect path and the prompt lazy-recovery path) cannot spawn two
   * agent processes for the same wrapper.
   */
  async connect(params: { command?: string; args?: string[]; cwd?: string; env?: Record<string, string> }): Promise<void> {
    if (this.connectPromise) {
      await this.connectPromise;
      return;
    }
    this.connectPromise = this.connectInternal(params);
    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  private async connectInternal(params: { command?: string; args?: string[]; cwd?: string; env?: Record<string, string> }): Promise<void> {
    const command = params.command || this.config.agentCommand;
    const args = params.args || this.config.agentArgs;
    const cwd = params.cwd || this.config.defaultCwd;
    const env = params.env || this.config.agentEnv;

    if (!command) {
      throw new Error('No agent command configured');
    }

    // Clean up existing connection
    if (this.agentProcess) {
      this.agentProcess.kill();
      this.agentProcess = null;
      this.clientConnection = null;
      this.activeSession = null;
      this.loadedSessionId = null;
      this.agentCapabilities = null;
    }

    // 1. Spawn agent process
    this.agentProcess = new AgentProcess();
    this.agentProcess.spawn({ command, args, cwd, env });

    // 2. Create stdio-based ACP stream
    const stream = this.agentProcess.createStream();

    // 3. Create ClientApp
    this.clientApp = this.createClientApp();

    // 4. Connect to the agent
    this.clientConnection = this.clientApp.connect(stream);

    // 5. Handle connection close
    this.clientConnection.closed.then(() => {
      console.log(`[SSE ACP Client] Connection closed for session: ${this.sessionId}`);
      this.clientConnection = null;
      this.activeSession = null;
      this.loadedSessionId = null;
      this.agentCapabilities = null;
      this.publishEvent({
        type: 'status',
        payload: { connected: false },
      });
      this.onDisconnectedCallback?.();
    });

    // 6. Initialize the connection
    const initResult = await this.clientConnection.agent.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      clientInfo: {
        name: 'luxio-agent-sse',
        version: '1.0.0',
      },
      clientCapabilities: {
        fs: {
          readTextFile: true,
          writeTextFile: true,
        },
      },
    });

    console.log(`[SSE ACP Client] Agent initialized for session: ${this.sessionId}`);

    // 7. Store capabilities
    this.agentCapabilities = initResult.agentCapabilities ?? null;

    // 8. Notify frontend
    this.publishEvent({
      type: 'status',
      payload: {
        connected: true,
        agentInfo: initResult.agentInfo,
        capabilities: initResult.agentCapabilities,
      },
    });

    // 9. Handle process exit
    this.agentProcess.onClose(() => {
      this.clientConnection = null;
      this.activeSession = null;
      this.loadedSessionId = null;
      this.agentCapabilities = null;
      this.publishEvent({
        type: 'status',
        payload: { connected: false },
      });
      this.onDisconnectedCallback?.();
    });
  }

  /**
   * Register a callback fired when the agent process/connection is lost.
   */
  onDisconnected(cb: () => void): void {
    this.onDisconnectedCallback = cb;
  }

  /**
   * Register a callback fired when the underlying ACP session id changes
   * (created / loaded / resumed / deleted). Used to persist the agent session
   * id so it can be resumed after a crash.
   */
  onAgentSessionChange(cb: () => void): void {
    this.onAgentSessionChangeCallback = cb;
  }

  /**
   * Whether the agent connection is live right now.
   */
  isConnected(): boolean {
    return this.clientConnection !== null && (this.agentProcess?.isRunning() ?? false);
  }

  /**
   * The current underlying agent session id, if any.
   */
  getAgentSessionId(): string | null {
    return this.activeSession?.sessionId ?? this.loadedSessionId ?? null;
  }

  /**
   * Reconnect to the agent process using the original config.
   */
  async reconnect(): Promise<void> {
    await this.connect({
      command: this.config.agentCommand,
      args: this.config.agentArgs,
      cwd: this.config.defaultCwd,
      env: this.config.agentEnv,
    });
  }

  /**
   * Ensure the agent is connected and has an active ACP session.
   *
   * - Reconnects the agent process if the connection was lost.
   * - If a previous agent session id is known, resumes it (context continuity).
   * - Never creates a fresh session here: new sessions are created explicitly by
   *   the frontend via `session/create`. If there is nothing to resume it throws,
   *   so the caller can surface the failure instead of silently losing context.
   */
  async ensureSession(resumeSessionId?: string | null, resumeCwd?: string): Promise<void> {
    if (!this.isConnected()) {
      await this.reconnect();
    }
    if (this.activeSession || this.loadedSessionId) {
      return;
    }

    if (!resumeSessionId) {
      throw new Error('No previous agent session to resume; create a new session or load one from history');
    }

    const cwd = resumeCwd ?? this.config.defaultCwd;

    const resumeCapability = this.agentCapabilities?.sessionCapabilities?.resume;
    if (resumeCapability === undefined || resumeCapability === null) {
      throw new Error('Agent does not support session resume; load the previous session from history or start a new one');
    }
    await this.handleResumeSession({ sessionId: resumeSessionId, cwd });
  }

  /**
   * Create ClientApp with handlers
   */
  private createClientApp(): ClientApp {
    const sessionId = this.sessionId;
    const pendingPermissions = this.pendingPermissions;

    return client({ name: 'luxio-agent-sse' })
      .onNotification('session/update', (ctx) => {
        // Keep the config cache current when the agent pushes config changes
        const update = ctx.params as { sessionUpdate?: string; configOptions?: acp.SessionConfigOption[] };
        if (update?.sessionUpdate === 'config_option_update' && update.configOptions) {
          this.configOptionsCache = update.configOptions;
        }
        // Forward session updates to Redis
        this.publishEvent({
          type: 'session_update',
          payload: ctx.params,
        });
      })
      .onRequest('session/request_permission', async (ctx) => {
        // Forward permission request to Redis and wait for response
        const requestId = `perm_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
        const params = ctx.params;

        console.log(`[SSE ACP Client] Permission requested: ${requestId}`);

        this.publishEvent({
          type: 'permission_request',
          payload: {
            requestId,
            sessionId: params.sessionId,
            options: params.options,
            toolCall: params.toolCall,
          },
        });

        // Wait for frontend response via Redis
        const outcome = await new Promise<acp.RequestPermissionOutcome>((resolve) => {
          const timeout = setTimeout(() => {
            console.log(`[SSE ACP Client] Permission request timed out: ${requestId}`);
            pendingPermissions.delete(requestId);
            resolve({ outcome: 'cancelled' });
          }, 5 * 60 * 1000);

          pendingPermissions.set(requestId, { resolve, timeout });
        });

        console.log(`[SSE ACP Client] Permission response: ${requestId}`, outcome);
        return { outcome };
      })
      .onRequest('fs/read_text_file', async (ctx) => {
        console.log(`[SSE ACP Client] Read file: ${ctx.params.path}`);
        return { content: '' };
      })
      .onRequest('fs/write_text_file', async (ctx) => {
        console.log(`[SSE ACP Client] Write file: ${ctx.params.path}`);
        return {};
      });
  }

  /**
   * Handle prompt request
   */
  async handlePrompt(content: acp.ContentBlock[]): Promise<{ stopReason: string }> {
    if (!this.clientConnection) {
      throw new Error('Not connected to agent');
    }

    const sessionId = this.activeSession?.sessionId ?? this.loadedSessionId;
    if (!sessionId) {
      throw new Error('No active session');
    }

    console.log(`[SSE ACP Client] Sending prompt to session: ${sessionId}`);

    try {
      const result = await this.clientConnection.agent.request('session/prompt', {
        sessionId,
        prompt: content,
      });

      console.log(`[SSE ACP Client] Prompt completed: ${result.stopReason}`);

      return { stopReason: result.stopReason };
    } catch (error) {
      console.error(`[SSE ACP Client] Prompt failed:`, error);
      throw error;
    }
  }

  /**
   * Handle cancel request
   */
  async handleCancel(): Promise<void> {
    const sessionId = this.activeSession?.sessionId ?? this.loadedSessionId;
    if (!this.clientConnection || !sessionId) {
      return;
    }

    this.cancelPendingPermissions();

    try {
      await this.clientConnection.agent.notify('session/cancel', {
        sessionId,
      });
      console.log(`[SSE ACP Client] Cancel sent for session: ${sessionId}`);
    } catch (error) {
      console.error(`[SSE ACP Client] Failed to cancel:`, error);
    }
  }

  /**
   * Handle permission response
   */
  handlePermissionResponse(requestId: string, outcome: acp.RequestPermissionOutcome): void {
    const pending = this.pendingPermissions.get(requestId);
    if (!pending) {
      console.warn(`[SSE ACP Client] Unknown permission response: ${requestId}`);
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingPermissions.delete(requestId);
    pending.resolve(outcome);
  }

  /**
   * Create a new session
   */
  async handleNewSession(params: { cwd?: string }): Promise<acp.NewSessionResponse> {
    if (!this.clientConnection) {
      throw new Error('Not connected to agent');
    }

    const cwd = params.cwd || this.config.defaultCwd;

    // Dispose previous session if any
    this.activeSession?.dispose();
    this.loadedSessionId = null;

    // Create and start a new session
    this.activeSession = await this.clientConnection.agent
      .buildSession(cwd)
      .start();

    const sessionResponse = this.activeSession.newSessionResponse;

    console.log(`[SSE ACP Client] Session created: ${this.activeSession.sessionId}`);

    // Start reading session updates in the background
    this.readSessionUpdates();

    this.onAgentSessionChangeCallback?.();
    return this.mergeConfigOptions(sessionResponse);
  }

  /**
   * List sessions from agent
   */
  async handleListSessions(params: { cwd?: string; cursor?: string }): Promise<any> {
    if (!this.clientConnection) {
      throw new Error('Not connected to agent');
    }

    console.log(`[SSE ACP Client] Listing sessions`);

    try {
      const result = await this.clientConnection.agent.request('session/list', {
        cwd: params.cwd,
        cursor: params.cursor,
      });

      console.log(`[SSE ACP Client] Sessions listed`);
      return result;
    } catch (error) {
      console.error(`[SSE ACP Client] Failed to list sessions:`, error);
      throw error;
    }
  }

  /**
   * Load a session from agent
   */
  async handleLoadSession(params: { sessionId: string; cwd?: string }): Promise<any> {
    if (!this.clientConnection) {
      throw new Error('Not connected to agent');
    }

    const cwd = params.cwd || this.config.defaultCwd;

    console.log(`[SSE ACP Client] Loading session: ${params.sessionId}`);

    try {
      // Dispose previous session if any
      this.activeSession?.dispose();
      this.activeSession = null;

      const result = await this.clientConnection.agent.request('session/load', {
        sessionId: params.sessionId,
        cwd,
        mcpServers: [],
      });

      this.loadedSessionId = params.sessionId;

      console.log(`[SSE ACP Client] Session loaded: ${params.sessionId}`);

      this.onAgentSessionChangeCallback?.();
      return this.mergeConfigOptions({ sessionId: params.sessionId, ...result });
    } catch (error) {
      console.error(`[SSE ACP Client] Failed to load session:`, error);
      throw error;
    }
  }

  /**
   * Resume a session from agent
   */
  async handleResumeSession(params: { sessionId: string; cwd?: string }): Promise<any> {
    if (!this.clientConnection) {
      throw new Error('Not connected to agent');
    }

    const cwd = params.cwd || this.config.defaultCwd;

    console.log(`[SSE ACP Client] Resuming session: ${params.sessionId}`);

    try {
      // Dispose previous session if any
      this.activeSession?.dispose();
      this.activeSession = null;

      const result = await this.clientConnection.agent.request('session/resume', {
        sessionId: params.sessionId,
        cwd,
        mcpServers: [],
      });

      this.loadedSessionId = params.sessionId;

      console.log(`[SSE ACP Client] Session resumed: ${params.sessionId}`);

      this.onAgentSessionChangeCallback?.();
      return this.mergeConfigOptions({ sessionId: params.sessionId, ...result });
    } catch (error) {
      console.error(`[SSE ACP Client] Failed to resume session:`, error);
      throw error;
    }
  }

  /**
   * Delete a session from agent
   */
  async handleDeleteSession(params: { sessionId: string }): Promise<void> {
    if (!this.clientConnection) {
      throw new Error('Not connected to agent');
    }

    // Check if agent supports session deletion
    const deleteCapability = this.agentCapabilities?.sessionCapabilities?.delete;
    if (deleteCapability === undefined || deleteCapability === null) {
      throw new Error('Agent does not support session deletion');
    }

    console.log(`[SSE ACP Client] Deleting session: ${params.sessionId}`);

    try {
      await this.clientConnection.agent.request('session/delete', {
        sessionId: params.sessionId,
      });

      // Clean up local state if deleted session is the active one
      if (
        this.loadedSessionId === params.sessionId ||
        this.activeSession?.sessionId === params.sessionId
      ) {
        this.activeSession?.dispose();
        this.activeSession = null;
        this.loadedSessionId = null;
      }

      this.onAgentSessionChangeCallback?.();
      console.log(`[SSE ACP Client] Session deleted: ${params.sessionId}`);
    } catch (error) {
      console.error(`[SSE ACP Client] Failed to delete session:`, error);
      throw error;
    }
  }

  /**
   * Set config option on agent
   */
  async handleSetConfigOption(params: {
    sessionId: string;
    configId: string;
    type: 'id' | 'boolean';
    value: string | boolean;
  }): Promise<any> {
    if (!this.clientConnection) {
      throw new Error('Not connected to agent');
    }

    const sessionId = this.activeSession?.sessionId ?? this.loadedSessionId;
    if (!sessionId) {
      throw new Error('No active session');
    }

    console.log(`[SSE ACP Client] Setting config option: ${params.configId}`);

    try {
      const result = await this.clientConnection.agent.request('session/set_config_option', {
        sessionId,
        configId: params.configId,
        ...(params.type === 'boolean'
          ? { type: 'boolean' as const, value: params.value as boolean }
          : { type: 'id' as const, value: params.value as string }),
      });

      console.log(`[SSE ACP Client] Config option set: ${params.configId}`);

      // Cache the complete config state so it survives session load/resume
      if (result?.configOptions) {
        this.configOptionsCache = result.configOptions;
      }

      return result;
    } catch (error) {
      console.error(`[SSE ACP Client] Failed to set config option:`, error);
      throw error;
    }
  }

  /**
   * Merge the cached (latest) config state into a session response.
   *
   * The agent may not persist config option changes to disk, so a fresh
   * `session/load` or `session/resume` can return stale `currentValue`s.
   * Overlay the cached values (from the last `set_config_option` response)
   * on top of whatever the agent returned.
   */
  private mergeConfigOptions<T extends { configOptions?: acp.SessionConfigOption[] | null }>(response: T): T {
    if (!this.configOptionsCache?.length) {
      return response;
    }
    if (!response.configOptions?.length) {
      return { ...response, configOptions: this.configOptionsCache };
    }
    const cacheById = new Map(this.configOptionsCache.map(o => [o.id, o]));
    const configOptions = response.configOptions.map(o => cacheById.get(o.id) ?? o);
    return { ...response, configOptions };
  }

  /**
   * Background loop that reads session updates
   */
  private async readSessionUpdates(): Promise<void> {
    const session = this.activeSession;
    if (!session) return;

    try {
      while (true) {
        const message = await session.nextUpdate();

        if (message.kind === 'stop') {
          console.log(`[SSE ACP Client] Prompt completed: ${message.stopReason}`);
          this.publishEvent({
            type: 'prompt_complete',
            payload: message.response,
          });
          break;
        }
      }
    } catch (error) {
      if (!this.activeSession) {
        return;
      }
      console.error(`[SSE ACP Client] Error reading session updates:`, error);
    }
  }

  /**
   * Publish event to Redis
   */
  private publishEvent(event: any): void {
    const channel = `acp:events:${this.sessionId}`;
    this.redis.publish(channel, JSON.stringify({
      ...event,
      timestamp: Date.now(),
    }));
  }

  /**
   * Cancel all pending permissions
   */
  private cancelPendingPermissions(): void {
    for (const [requestId, pending] of this.pendingPermissions) {
      clearTimeout(pending.timeout);
      pending.resolve({ outcome: 'cancelled' });
    }
    this.pendingPermissions.clear();
  }

  /**
   * Disconnect and cleanup
   */
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

    // Unsubscribe from Redis
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers = [];
  }
}

export default SseAcpClient;
