import { logger } from '../helpers/logger.js';
import { client, type ClientApp, type ClientConnection, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import type * as acp from '@agentclientprotocol/sdk';
import { AgentProcess } from './agent-process.js';
import { RedisClient } from '../redis/client.js';

export interface SseAcpClientConfig {
  agentCommand?: string;
  agentArgs?: string[];
  agentEnv?: Record<string, string>;
}

const INITIALIZE_TIMEOUT_MS = 30_000;

/**
 * SSE-based ACP Client that bridges Redis pub/sub to an ACP agent process.
 *
 * Architecture (multi-session / multiplexed):
 *   Browser ←→ Redis Pub/Sub ←→ SseAcpClient ←→ stdio ←→ Agent Process
 *
 * One SseAcpClient owns ONE agent process + ONE ACP connection, and serves
 * MANY ACP sessions concurrently. Every inbound call is keyed by the ACP
 * session id and every outbound event is routed directly to that session's
 * Redis channel (`acp:events:${acpSessionId}`) — no reverse lookup needed.
 */
export class SseAcpClient {
  private agentProcess: AgentProcess | null = null;
  private clientApp: ClientApp | null = null;
  private clientConnection: ClientConnection | null = null;
  private agentCapabilities: acp.AgentCapabilities | null = null;
  private agentInfo: unknown = null;
  private configOptionsCache: acp.SessionConfigOption[] | null = null;
  /**
   * Latest `available_commands_update` from the agent. The `session/new`
   * response carries no commands, and the corresponding notification is
   * usually published before any SSE has connected (frontend connects after
   * session creation), so it is merged into the create/load/resume responses.
   */
  private availableCommandsCache: acp.AvailableCommand[] | null = null;
  private pendingPermissions: Map<string, { resolve: (outcome: any) => void; timeout: ReturnType<typeof setTimeout>; acpSessionId?: string }> = new Map();

  /**
   * Connection generation counter.
   *
   * Every connect (and every connection loss) bumps it, which invalidates all
   * session bindings that were established on the previous connection — the
   * exact semantics the old per-connection binding table provided, without
   * keeping a session registry inside the client.
   *
   * The session manager stores the generation a session was bound at, so
   * "is this ACP session hosted on the live connection?" is answered by
   * comparing numbers instead of looking up a table.
   */
  private generation = 0;

  /** Current connection generation (see `generation`). */
  get connectionGeneration(): number {
    return this.generation;
  }

  /**
   * ACP sessions with a prompt currently in flight.
   */
  private inFlightPrompts: Set<string> = new Set();

  private connectionStateListeners: Set<(connected: boolean) => void> = new Set();
  /** Guards duplicate status broadcasts from the close/process-exit double fire. */
  private notifiedConnected = false;

  private config: SseAcpClientConfig;
  private redis: RedisClient;
  private unsubscribers: (() => void)[] = [];
  private connectPromise: Promise<void> | null = null;

  constructor(
    /** Logical id used for log lines only (e.g. `agent:<id>`). */
    private readonly logId: string,
    config: SseAcpClientConfig,
    redis?: RedisClient,
  ) {
    this.config = config;
    this.redis = redis || RedisClient.getInstance();
  }

  // ==========================================================================
  // Connection lifecycle
  // ==========================================================================

  /**
   * Connect to the agent process (spawn + initialize). Serialized so
   * concurrent callers (warmup, SSE reconnect, prompt lazy-recovery) cannot
   * spawn two agent processes for the same connection.
   */
  async connect(params: { command?: string; args?: string[]; env?: Record<string, string> }): Promise<void> {
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

  private async connectInternal(params: { command?: string; args?: string[]; env?: Record<string, string> }): Promise<void> {
    const command = params.command || this.config.agentCommand;
    const args = params.args || this.config.agentArgs;
    const env = params.env || this.config.agentEnv;

    if (!command) {
      throw new Error('No agent command configured');
    }

    // Clean up existing connection
    if (this.agentProcess) {
      this.agentProcess.kill();
      this.agentProcess = null;
      this.clientConnection = null;
    }

    // 1. Spawn agent process
    this.agentProcess = new AgentProcess(this.logId);
    this.agentProcess.spawn({ command, args, env });

    // 2. Create stdio-based ACP stream
    const stream = this.agentProcess.createStream();

    // 3. Create ClientApp
    this.clientApp = this.createClientApp();

    // 4. Connect to the agent
    this.clientConnection = this.clientApp.connect(stream);

    // 5. Handle connection close
    this.clientConnection.closed.then(() => {
      logger.log(`[SSE ACP Client] Connection closed for: ${this.logId}`);
      this.clientConnection = null;
      this.handleConnectionLost();
    });

    // 6. Initialize the connection (bounded so a hanging agent cannot stall warmup)
    let initResult: { agentInfo?: unknown; agentCapabilities?: acp.AgentCapabilities };
    try {
      initResult = await SseAcpClient.withTimeout(
        this.clientConnection.agent.request('initialize', {
          protocolVersion: PROTOCOL_VERSION,
          clientInfo: {
            name: 'clover-agent-sse',
            version: '1.0.0',
          },
          clientCapabilities: {
            fs: {
              readTextFile: true,
              writeTextFile: true,
            },
          },
        }),
        INITIALIZE_TIMEOUT_MS,
        'initialize',
      );
    } catch (error) {
      logger.error(`[SSE ACP Client] Initialize failed for ${this.logId}:`, (error as Error).message);
      this.clientConnection = null;
      this.agentProcess?.kill();
      this.agentProcess = null;
      throw error;
    }

    logger.log(`[SSE ACP Client] Agent initialized for: ${this.logId}`);

    // 7. Store capabilities
    this.agentInfo = initResult.agentInfo ?? null;
    this.agentCapabilities = initResult.agentCapabilities ?? null;

    // 8. New connection → new generation: every session bound on the previous
    // connection becomes stale and has to be resumed before use.
    this.generation++;
    this.notifiedConnected = true;
    this.notifyConnectionState(true);

    // 9. Handle process exit
    this.agentProcess.onClose(() => {
      this.clientConnection = null;
      this.handleConnectionLost();
    });
  }

  private handleConnectionLost(): void {
    this.agentCapabilities = null;
    this.agentInfo = null;
    // Connection died: bump the generation so all session bindings on it are
    // considered stale (they are restored via session/resume on next use).
    this.generation++;
    if (this.notifiedConnected) {
      this.notifiedConnected = false;
      // The session manager publishes the `status` event to the affected
      // sessions' channels (it owns the session records); the client only
      // reports the connection state change.
      this.notifyConnectionState(false);
    }
  }

  private static async withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`ACP ${label} timed out after ${ms}ms`)), ms);
      promise.then(
        (value) => { clearTimeout(timer); resolve(value); },
        (error) => { clearTimeout(timer); reject(error); },
      );
    });
  }

  /**
   * Whether the agent connection is live right now.
   */
  isConnected(): boolean {
    return this.clientConnection !== null && (this.agentProcess?.isRunning() ?? false);
  }

  getAgentInfo(): unknown {
    return this.agentInfo;
  }

  getAgentCapabilities(): acp.AgentCapabilities | null {
    return this.agentCapabilities;
  }

  // ==========================================================================
  // Callbacks (multi-listener)
  // ==========================================================================

  /**
   * Subscribe to connection state changes (true = spawned+initialized,
   * false = connection/process lost). Returns an unsubscribe function.
   */
  onConnectionState(cb: (connected: boolean) => void): () => void {
    this.connectionStateListeners.add(cb);
    return () => this.connectionStateListeners.delete(cb);
  }

  private notifyConnectionState(connected: boolean): void {
    for (const cb of this.connectionStateListeners) {
      try {
        cb(connected);
      } catch (error) {
        logger.error(`[SSE ACP Client] connection state listener error (agent: ${this.logId}):`, error);
      }
    }
  }

  // ==========================================================================
  // Event routing (agent -> session channel)
  // ==========================================================================

  private publishToSession(acpSessionId: string, event: any): void {
    const channel = `acp:events:${acpSessionId}`;
    this.redis.publish(channel, JSON.stringify({
      ...event,
      timestamp: Date.now(),
    }));
  }

  // ==========================================================================
  // ClientApp handlers (agent pushes)
  // ==========================================================================

  /**
   * Create ClientApp with handlers
   */
  private createClientApp(): ClientApp {
    const pendingPermissions = this.pendingPermissions;

    return client({ name: 'clover-agent-sse' })
      .onNotification('session/update', (ctx) => {
        // v1 schema: `session/update` params = { sessionId, update: { sessionUpdate, ... } }
        const notification = ctx.params as acp.SessionNotification;
        const sessionId = notification?.sessionId;
        const update = notification?.update;
        // Keep the config/command caches current when the agent pushes changes
        if (update?.sessionUpdate === 'config_option_update' && update.configOptions) {
          this.configOptionsCache = update.configOptions;
        }
        if (update?.sessionUpdate === 'available_commands_update' && update.availableCommands) {
          this.availableCommandsCache = update.availableCommands;
        }
        // Route the update directly to the session's own Redis channel
        if (sessionId) {
          this.publishToSession(sessionId, {
            type: 'session_update',
            payload: ctx.params,
          });
        } else {
          logger.warn(`[SSE ACP Client] Dropped session/update without a session id (agent: ${this.logId})`);
        }
      })
      .onRequest('session/request_permission', async (ctx) => {
        // Forward permission request to the session's channel and wait for its response
        const requestId = `perm_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
        const params = ctx.params;
        const acpSessionId = params?.sessionId;

        if (!acpSessionId) {
          logger.warn(`[SSE ACP Client] Permission request without a session id (agent: ${this.logId}); cancelling`);
          return { outcome: { outcome: 'cancelled' as const } };
        }

        logger.log(`[SSE ACP Client] Permission requested: ${requestId} (session: ${acpSessionId})`);

        this.publishToSession(acpSessionId, {
          type: 'permission_request',
          payload: {
            requestId,
            sessionId: acpSessionId,
            options: params.options,
            toolCall: params.toolCall,
          },
        });

        // Wait for frontend response via Redis
        const outcome = await new Promise<acp.RequestPermissionOutcome>((resolve) => {
          const timeout = setTimeout(() => {
            logger.log(`[SSE ACP Client] Permission request timed out: ${requestId}`);
            pendingPermissions.delete(requestId);
            resolve({ outcome: 'cancelled' });
          }, 5 * 60 * 1000);

          pendingPermissions.set(requestId, { resolve, timeout, acpSessionId });
        });

        logger.log(`[SSE ACP Client] Permission response: ${requestId}`, outcome);
        return { outcome };
      })
      .onRequest('fs/read_text_file', async (ctx) => {
        logger.log(`[SSE ACP Client] Read file: ${ctx.params.path}`);
        return { content: '' };
      })
      .onRequest('fs/write_text_file', async (ctx) => {
        logger.log(`[SSE ACP Client] Write file: ${ctx.params.path}`);
        return {};
      });
  }

  // ==========================================================================
  // Inbound operations (frontend -> agent), all keyed by ACP session id
  // ==========================================================================

  /**
   * Handle prompt request for a specific ACP session.
   *
   * The session manager guarantees the ACP session is hosted on this
   * connection (it resumes it when the connection was replaced), so no
   * membership table is needed here.
   */
  async handlePrompt(acpSessionId: string, content: acp.ContentBlock[]): Promise<{ stopReason: string; acpSessionId: string }> {
    if (!this.clientConnection) {
      throw new Error('Not connected to agent');
    }

    const sessionId = acpSessionId;

    logger.log(`[SSE ACP Client] Sending prompt to session: ${sessionId}`);

    this.inFlightPrompts.add(sessionId);
    try {
      const result = await this.clientConnection.agent.request('session/prompt', {
        sessionId,
        prompt: content,
      });

      logger.log(`[SSE ACP Client] Prompt completed (session: ${sessionId}): ${result.stopReason}`);

      return { stopReason: result.stopReason, acpSessionId: sessionId };
    } catch (error) {
      logger.error(`[SSE ACP Client] Prompt failed (session: ${sessionId}):`, error);
      // 附带 ACP session id：调用方据此把「本轮结束」事件投递到该会话的频道
      if (error && typeof error === 'object') {
        (error as { acpSessionId?: string }).acpSessionId = sessionId;
      }
      throw error;
    } finally {
      this.inFlightPrompts.delete(sessionId);
    }
  }

  /**
   * Whether a prompt is currently running for the given ACP session.
   */
  isPrompting(acpSessionId: string): boolean {
    return this.inFlightPrompts.has(acpSessionId);
  }

  /**
   * Cancel the in-flight prompt of a specific ACP session.
   */
  async handleCancel(acpSessionId: string): Promise<void> {
    if (!this.clientConnection) {
      return;
    }

    this.cancelPendingPermissions(acpSessionId);

    try {
      await this.clientConnection.agent.notify('session/cancel', {
        sessionId: acpSessionId,
      });
      logger.log(`[SSE ACP Client] Cancel sent for session: ${acpSessionId}`);
    } catch (error) {
      logger.error(`[SSE ACP Client] Failed to cancel (session: ${acpSessionId}):`, error);
    }
  }

  /**
   * Handle permission response
   */
  handlePermissionResponse(requestId: string, outcome: acp.RequestPermissionOutcome): void {
    const pending = this.pendingPermissions.get(requestId);
    if (!pending) {
      logger.warn(`[SSE ACP Client] Unknown permission response: ${requestId}`);
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingPermissions.delete(requestId);
    pending.resolve(outcome);
  }

  /**
   * Create a new ACP session on this connection.
   *
   * `session/new` is issued directly instead of via the SDK's session builder:
   * the builder only wraps the response in an `ActiveSession` handle whose sole
   * purpose is to tear down the SDK's own local update queue (we route
   * `session/update` notifications ourselves), so the handle would only add
   * state to dispose of.
   */
  async handleNewSession(params: { cwd?: string; mcpServers?: acp.McpServer[] }): Promise<any> {
    if (!this.clientConnection) {
      throw new Error('Not connected to agent');
    }

    const cwd = params.cwd;
    if (!cwd || !String(cwd).trim()) {
      throw new Error('cwd is required to create an ACP session');
    }

    const sessionResponse = await this.clientConnection.agent.request('session/new', {
      cwd,
      mcpServers: params.mcpServers ?? [],
    });

    logger.log(`[SSE ACP Client] Session created: ${sessionResponse.sessionId}`);

    return {
      ...sessionResponse,
      // Expose the resolved cwd so the frontend can persist accurate session records.
      cwd,
      // The agent pushes available commands as a notification that may land
      // before any SSE subscriber exists (frontend connects after creation).
      availableCommands: this.availableCommandsCache ?? [],
    };
  }

  /**
   * List sessions from agent (connection-level operation).
   */
  async handleListSessions(params: { cwd?: string; cursor?: string }): Promise<any> {
    if (!this.clientConnection) {
      throw new Error('Not connected to agent');
    }

    logger.log(`[SSE ACP Client] Listing sessions (agent: ${this.logId})`);

    try {
      const result = await this.clientConnection.agent.request('session/list', {
        cwd: params.cwd,
        cursor: params.cursor,
      });

      logger.log(`[SSE ACP Client] Sessions listed (agent: ${this.logId})`);
      return result;
    } catch (error) {
      logger.error(`[SSE ACP Client] Failed to list sessions (agent: ${this.logId}):`, error);
      throw error;
    }
  }

  /**
   * Load a session from agent (keyed by the ACP session id itself).
   */
  async handleLoadSession(acpSessionId: string, params: { cwd: string; mcpServers?: acp.McpServer[] }): Promise<any> {
    if (!this.clientConnection) {
      throw new Error('Not connected to agent');
    }

    const cwd = params.cwd;

    logger.log(`[SSE ACP Client] Loading session: ${acpSessionId}`);

    try {
      // No binding bookkeeping needed: `session/update` notifications carry
      // their own session id and are routed straight to that session's channel.
      const result = await this.clientConnection.agent.request('session/load', {
        sessionId: acpSessionId,
        cwd,
        mcpServers: params.mcpServers || [],
      });

      logger.log(`[SSE ACP Client] Session loaded: ${acpSessionId}`);

      return {
        ...this.mergeConfigOptions({ sessionId: acpSessionId, ...result }),
        availableCommands: this.availableCommandsCache ?? [],
      };
    } catch (error) {
      logger.error(`[SSE ACP Client] Failed to load session ${acpSessionId}:`, error);
      throw error;
    }
  }

  /**
   * Resume a session from agent (keyed by the ACP session id itself).
   */
  async handleResumeSession(acpSessionId: string, params: { cwd: string; mcpServers?: acp.McpServer[] }): Promise<any> {
    if (!this.clientConnection) {
      throw new Error('Not connected to agent');
    }

    // Resume is the recovery path for a session whose context was lost
    // (agent crash / connection replaced): the agent has to support it.
    const resumeCapability = this.agentCapabilities?.sessionCapabilities?.resume;
    if (resumeCapability === undefined || resumeCapability === null) {
      throw new Error('Agent does not support session resume; load the previous session from history or start a new one');
    }

    const cwd = params.cwd;

    logger.log(`[SSE ACP Client] Resuming session: ${acpSessionId}`);

    try {
      const result = await this.clientConnection.agent.request('session/resume', {
        sessionId: acpSessionId,
        cwd,
        mcpServers: params.mcpServers || [],
      });

      logger.log(`[SSE ACP Client] Session resumed: ${acpSessionId}`);

      return {
        ...this.mergeConfigOptions({ sessionId: acpSessionId, ...result }),
        availableCommands: this.availableCommandsCache ?? [],
      };
    } catch (error) {
      logger.error(`[SSE ACP Client] Failed to resume session ${acpSessionId}:`, error);
      throw error;
    }
  }

  /**
   * Delete a session from agent.
   */
  async handleDeleteSession(acpSessionId: string): Promise<void> {
    if (!this.clientConnection) {
      throw new Error('Not connected to agent');
    }

    // Check if agent supports session deletion
    const deleteCapability = this.agentCapabilities?.sessionCapabilities?.delete;
    if (deleteCapability === undefined || deleteCapability === null) {
      throw new Error('Agent does not support session deletion');
    }

    logger.log(`[SSE ACP Client] Deleting session: ${acpSessionId}`);

    try {
      await this.clientConnection.agent.request('session/delete', {
        sessionId: acpSessionId,
      });

      logger.log(`[SSE ACP Client] Session deleted: ${acpSessionId}`);
    } catch (error) {
      logger.error(`[SSE ACP Client] Failed to delete session ${acpSessionId}:`, error);
      throw error;
    }
  }

  /**
   * Set config option on agent for an ACP session.
   */
  async handleSetConfigOption(acpSessionId: string, params: {
    configId: string;
    type: 'id' | 'boolean';
    value: string | boolean;
  }): Promise<any> {
    if (!this.clientConnection) {
      throw new Error('Not connected to agent');
    }

    logger.log(`[SSE ACP Client] Setting config option: ${params.configId} (session: ${acpSessionId})`);

    try {
      const result = await this.clientConnection.agent.request('session/set_config_option', {
        sessionId: acpSessionId,
        configId: params.configId,
        ...(params.type === 'boolean'
          ? { type: 'boolean' as const, value: params.value as boolean }
          : { type: 'id' as const, value: params.value as string }),
      });

      logger.log(`[SSE ACP Client] Config option set: ${params.configId}`);

      // Cache the complete config state so it survives session load/resume
      if (result?.configOptions) {
        this.configOptionsCache = result.configOptions;
      }

      return result;
    } catch (error) {
      logger.error(`[SSE ACP Client] Failed to set config option (session: ${acpSessionId}, config: ${params.configId}):`, error);
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
   * Cancel pending permissions, optionally scoped to one ACP session.
   *
   * Public because the session manager drops a session record (e.g. the
   * session was deleted): its outstanding permission requests would otherwise
   * stay unanswered until the 5-minute timeout.
   */
  cancelPendingPermissions(acpSessionId?: string): void {
    for (const [requestId, pending] of this.pendingPermissions) {
      if (acpSessionId !== undefined && pending.acpSessionId !== acpSessionId) {
        continue;
      }
      clearTimeout(pending.timeout);
      pending.resolve({ outcome: 'cancelled' });
      this.pendingPermissions.delete(requestId);
    }
  }

  /**
   * Disconnect and cleanup (full teardown — the process is killed).
   */
  disconnect(): void {
    this.cancelPendingPermissions();

    this.clientConnection?.close();
    this.clientConnection = null;

    this.clientApp = null;

    if (this.agentProcess) {
      this.agentProcess.kill();
      this.agentProcess = null;
    }

    this.handleConnectionLost();

    // Unsubscribe from Redis
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers = [];
  }
}

export default SseAcpClient;
