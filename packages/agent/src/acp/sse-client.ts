import { client, type ClientApp, type ClientConnection, type ActiveSession, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import type * as acp from '@agentclientprotocol/sdk';
import { AgentProcess } from './agent-process.js';
import { RedisClient } from '../redis/client.js';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';

export interface SseAcpClientConfig {
  defaultCwd: string;
  agentCommand?: string;
  agentArgs?: string[];
  agentEnv?: Record<string, string>;
}

/**
 * An ACP session bound to one wrapper session on this shared connection.
 * One connection multiplexes many of these (wrapper 1:N acp session).
 */
interface SessionBinding {
  acpSessionId: string;
  /** SDK session handle; only present for sessions created via session/new. */
  activeSession: ActiveSession | null;
  cwd: string;
}

const INITIALIZE_TIMEOUT_MS = 30_000;

/**
 * SSE-based ACP Client that bridges Redis pub/sub to an ACP agent process.
 *
 * Architecture (multi-session / multiplexed):
 *   Browser ←→ Redis Pub/Sub ←→ SseAcpClient ←→ stdio ←→ Agent Process
 *
 * One SseAcpClient owns ONE agent process + ONE ACP connection, and serves
 * MANY wrapper sessions concurrently. Every inbound call is keyed by
 * wrapperSessionId and every outbound event is routed back to the owning
 * wrapper's Redis channel (`acp:events:${wrapperId}`).
 */
export class SseAcpClient {
  private agentProcess: AgentProcess | null = null;
  private clientApp: ClientApp | null = null;
  private clientConnection: ClientConnection | null = null;
  private agentCapabilities: acp.AgentCapabilities | null = null;
  private agentInfo: unknown = null;
  private configOptionsCache: acp.SessionConfigOption[] | null = null;
  private pendingPermissions: Map<string, { resolve: (outcome: any) => void; timeout: ReturnType<typeof setTimeout>; wrapperId?: string }> = new Map();

  /** wrapperSessionId -> ACP session bound to it. */
  private sessionBindings: Map<string, SessionBinding> = new Map();
  /** acpSessionId -> wrapperSessionId (reverse routing for agent pushes). */
  private reverseAcp: Map<string, string> = new Map();
  /** All wrapper sessions currently bound to this connection. */
  private attachedWrappers: Set<string> = new Set();

  private connectionStateListeners: Set<(connected: boolean) => void> = new Set();
  private agentSessionChangeListeners: Set<(wrapperId: string, acpSessionId: string | null) => void> = new Set();
  /** Guards duplicate status broadcasts from the close/process-exit double fire. */
  private notifiedConnected = false;

  private config: SseAcpClientConfig;
  private redis: RedisClient;
  private unsubscribers: (() => void)[] = [];
  private connectPromise: Promise<void> | null = null;

  constructor(
    /** Logical id used for log lines only (e.g. wrapper id or `agent:<id>`). */
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
  async connect(params: { command?: string; args?: string[]; env?: Record<string, string>; cwd?: string }): Promise<void> {
    if (this.connectPromise) {
      await this.connectPromise;
      return;
    }
    if (params.cwd) {
      this.config.defaultCwd = params.cwd;
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
      this.clearBindings();
    }

    // 1. Spawn agent process
    this.agentProcess = new AgentProcess();
    this.agentProcess.spawn({ command, args, env });

    // 2. Create stdio-based ACP stream
    const stream = this.agentProcess.createStream();

    // 3. Create ClientApp
    this.clientApp = this.createClientApp();

    // 4. Connect to the agent
    this.clientConnection = this.clientApp.connect(stream);

    // 5. Handle connection close
    this.clientConnection.closed.then(() => {
      console.log(`[SSE ACP Client] Connection closed for: ${this.logId}`);
      this.clientConnection = null;
      this.clearBindings();
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
      console.error(`[SSE ACP Client] Initialize failed for ${this.logId}:`, (error as Error).message);
      this.clientConnection = null;
      this.agentProcess?.kill();
      this.agentProcess = null;
      this.clearBindings();
      throw error;
    }

    console.log(`[SSE ACP Client] Agent initialized for: ${this.logId}`);

    // 7. Store capabilities
    this.agentInfo = initResult.agentInfo ?? null;
    this.agentCapabilities = initResult.agentCapabilities ?? null;

    // 8. Notify every wrapper bound to this connection (none during warmup)
    this.notifiedConnected = true;
    this.broadcastEvent({
      type: 'status',
      payload: {
        connected: true,
        agentInfo: this.agentInfo,
        capabilities: this.agentCapabilities,
      },
    });
    this.notifyConnectionState(true);

    // 9. Handle process exit
    this.agentProcess.onClose(() => {
      this.clientConnection = null;
      this.clearBindings();
      this.handleConnectionLost();
    });
  }

  private handleConnectionLost(): void {
    this.agentCapabilities = null;
    this.agentInfo = null;
    if (this.notifiedConnected) {
      this.notifiedConnected = false;
      this.broadcastEvent({
        type: 'status',
        payload: { connected: false },
      });
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
   * Reconnect to the agent process using the original config.
   */
  async reconnect(): Promise<void> {
    await this.connect({
      command: this.config.agentCommand,
      args: this.config.agentArgs,
      env: this.config.agentEnv,
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
  // Wrapper binding (multi-session routing tables)
  // ==========================================================================

  /**
   * Bind a wrapper session to this connection. If the connection is already
   * live, the wrapper immediately receives a status snapshot.
   */
  attach(wrapperId: string): void {
    const isNew = !this.attachedWrappers.has(wrapperId);
    this.attachedWrappers.add(wrapperId);
    if (isNew && this.isConnected()) {
      this.publishToWrapper(wrapperId, {
        type: 'status',
        payload: {
          connected: true,
          agentInfo: this.agentInfo,
          capabilities: this.agentCapabilities,
        },
      });
    }
  }

  /**
   * Unbind a wrapper session. The agent process is NOT killed — it stays
   * warm for other/future wrapper sessions.
   */
  detach(wrapperId: string): void {
    this.attachedWrappers.delete(wrapperId);
    this.cancelPendingPermissions(wrapperId);
    this.unbind(wrapperId);
  }

  private bind(wrapperId: string, binding: SessionBinding): void {
    // Drop the previous binding of THIS wrapper only (never touch others).
    this.unbind(wrapperId);
    this.sessionBindings.set(wrapperId, binding);
    this.reverseAcp.set(binding.acpSessionId, wrapperId);
  }

  private unbind(wrapperId: string): void {
    const binding = this.sessionBindings.get(wrapperId);
    if (!binding) return;
    this.sessionBindings.delete(wrapperId);
    if (binding.acpSessionId && this.reverseAcp.get(binding.acpSessionId) === wrapperId) {
      this.reverseAcp.delete(binding.acpSessionId);
    }
    if (binding.activeSession) {
      try {
        binding.activeSession.dispose();
      } catch {
        // ignore: session handle already gone
      }
    }
  }

  /** Called when the connection dies: every binding is stale (agent-side
   *  session ids survive on disk and are restored via resume). */
  private clearBindings(): void {
    for (const [, binding] of this.sessionBindings) {
      if (binding.activeSession) {
        try {
          binding.activeSession.dispose();
        } catch {
          // ignore
        }
      }
    }
    this.sessionBindings.clear();
    this.reverseAcp.clear();
    // attachedWrappers intentionally kept: wrappers stay bound to this
    // connection object so a later reconnect reuses the same routing.
  }

  /**
   * The ACP session id bound to a wrapper session, if any.
   */
  getAcpSessionId(wrapperId: string): string | null {
    return this.sessionBindings.get(wrapperId)?.acpSessionId ?? null;
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

  /**
   * Subscribe to per-wrapper ACP session id changes (created / loaded /
   * resumed / deleted). Used to persist the agent session id so it can be
   * resumed after a crash. Returns an unsubscribe function.
   */
  onAgentSessionChange(cb: (wrapperId: string, acpSessionId: string | null) => void): () => void {
    this.agentSessionChangeListeners.add(cb);
    return () => this.agentSessionChangeListeners.delete(cb);
  }

  private notifyConnectionState(connected: boolean): void {
    for (const cb of this.connectionStateListeners) {
      try {
        cb(connected);
      } catch (error) {
        console.error('[SSE ACP Client] connection state listener error:', error);
      }
    }
  }

  private notifyAgentSessionChange(wrapperId: string, acpSessionId: string | null): void {
    for (const cb of this.agentSessionChangeListeners) {
      try {
        cb(wrapperId, acpSessionId);
      } catch (error) {
        console.error('[SSE ACP Client] agent session change listener error:', error);
      }
    }
  }

  // ==========================================================================
  // Event routing (agent -> wrapper)
  // ==========================================================================

  private publishToWrapper(wrapperId: string, event: any): void {
    const channel = `acp:events:${wrapperId}`;
    this.redis.publish(channel, JSON.stringify({
      ...event,
      timestamp: Date.now(),
    }));
  }

  private broadcastEvent(event: any): void {
    for (const wrapperId of this.attachedWrappers) {
      this.publishToWrapper(wrapperId, event);
    }
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
        const update = ctx.params as { sessionId?: string; sessionUpdate?: string; configOptions?: acp.SessionConfigOption[] };
        // Keep the config cache current when the agent pushes config changes
        if (update?.sessionUpdate === 'config_option_update' && update.configOptions) {
          this.configOptionsCache = update.configOptions;
        }
        // Route the update to the wrapper session that owns this ACP session
        const wrapperId = update.sessionId ? this.reverseAcp.get(update.sessionId) : undefined;
        if (wrapperId) {
          this.publishToWrapper(wrapperId, {
            type: 'session_update',
            payload: ctx.params,
          });
        } else {
          console.warn(`[SSE ACP Client] Dropped session/update for unmapped session: ${update?.sessionId}`);
        }
      })
      .onRequest('session/request_permission', async (ctx) => {
        // Forward permission request to the owning wrapper and wait for its response
        const requestId = `perm_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
        const params = ctx.params;
        const wrapperId = this.reverseAcp.get(params.sessionId);

        if (!wrapperId) {
          console.warn(`[SSE ACP Client] Permission request for unmapped session ${params.sessionId}; cancelling`);
          return { outcome: { outcome: 'cancelled' as const } };
        }

        console.log(`[SSE ACP Client] Permission requested: ${requestId} (wrapper: ${wrapperId})`);

        this.publishToWrapper(wrapperId, {
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

          pendingPermissions.set(requestId, { resolve, timeout, wrapperId });
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

  // ==========================================================================
  // Inbound operations (wrapper -> agent), all keyed by wrapperSessionId
  // ==========================================================================

  /**
   * Ensure the wrapper has a live connection and an active ACP session.
   *
   * - Reconnects the agent process if the connection was lost.
   * - If a previous agent session id is known, resumes it (context continuity).
   * - Never creates a fresh session here: new sessions are created explicitly by
   *   the frontend via `session/create`.
   */
  async ensureSession(wrapperId: string, resumeSessionId?: string | null, resumeCwd?: string): Promise<void> {
    if (!this.isConnected()) {
      await this.reconnect();
    }
    if (this.sessionBindings.has(wrapperId)) {
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
    await this.handleResumeSession(wrapperId, { sessionId: resumeSessionId, cwd });
  }

  /**
   * Handle prompt request for a specific wrapper session.
   */
  async handlePrompt(wrapperId: string, content: acp.ContentBlock[]): Promise<{ stopReason: string }> {
    if (!this.clientConnection) {
      throw new Error('Not connected to agent');
    }

    const sessionId = this.sessionBindings.get(wrapperId)?.acpSessionId;
    if (!sessionId) {
      throw new Error('No active session');
    }

    console.log(`[SSE ACP Client] Sending prompt to session: ${sessionId} (wrapper: ${wrapperId})`);

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
   * Cancel the in-flight prompt of a specific wrapper session.
   */
  async handleCancel(wrapperId: string): Promise<void> {
    const sessionId = this.sessionBindings.get(wrapperId)?.acpSessionId;
    if (!this.clientConnection || !sessionId) {
      return;
    }

    this.cancelPendingPermissions(wrapperId);

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
   * Create a new ACP session for a wrapper session.
   */
  async handleNewSession(wrapperId: string, params: { cwd?: string; mcpServers?: acp.McpServer[] }): Promise<acp.NewSessionResponse> {
    if (!this.clientConnection) {
      throw new Error('Not connected to agent');
    }

    // 前端未传 cwd（New Task）时，按原始规则生成新的时间戳目录，而不是复用内部 session 的默认 cwd。
    let cwd = params.cwd;
    if (!cwd || !String(cwd).trim()) {
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
      cwd = join(homedir(), '.clover', ts);
      mkdirSync(cwd, { recursive: true });
    }

    // Dispose the previous session of THIS wrapper only
    this.unbind(wrapperId);

    // Create and start a new session with mcpServers support
    const sessionBuilder = this.clientConnection.agent.buildSession(cwd);
    params.mcpServers?.forEach(mcpServer => sessionBuilder.withMcpServer(mcpServer));
    const activeSession = await sessionBuilder.start();

    this.bind(wrapperId, {
      acpSessionId: activeSession.sessionId,
      activeSession,
      cwd,
    });

    const sessionResponse = activeSession.newSessionResponse;

    console.log(`[SSE ACP Client] Session created: ${activeSession.sessionId} (wrapper: ${wrapperId})`);

    // Start reading session updates in the background
    this.startUpdateLoop(wrapperId, activeSession);

    this.notifyAgentSessionChange(wrapperId, activeSession.sessionId);
    return this.mergeConfigOptions({
      ...sessionResponse,
      // Expose the resolved cwd so the frontend can persist accurate session records.
      cwd,
    });
  }

  /**
   * List sessions from agent (connection-level operation).
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
   * Load a session from agent for a wrapper session.
   */
  async handleLoadSession(wrapperId: string, params: { sessionId: string; cwd?: string; mcpServers?: acp.McpServer[] }): Promise<any> {
    if (!this.clientConnection) {
      throw new Error('Not connected to agent');
    }

    const cwd = params.cwd || this.config.defaultCwd;

    console.log(`[SSE ACP Client] Loading session: ${params.sessionId} (wrapper: ${wrapperId})`);

    try {
      // Dispose the previous session of THIS wrapper only
      this.unbind(wrapperId);
      // Bind before the request so updates emitted during load are routed
      this.bind(wrapperId, { acpSessionId: params.sessionId, activeSession: null, cwd });

      const result = await this.clientConnection.agent.request('session/load', {
        sessionId: params.sessionId,
        cwd,
        mcpServers: params.mcpServers || [],
      });

      console.log(`[SSE ACP Client] Session loaded: ${params.sessionId}`);

      this.notifyAgentSessionChange(wrapperId, params.sessionId);
      return this.mergeConfigOptions({ sessionId: params.sessionId, ...result });
    } catch (error) {
      this.unbind(wrapperId);
      console.error(`[SSE ACP Client] Failed to load session:`, error);
      throw error;
    }
  }

  /**
   * Resume a session from agent for a wrapper session.
   */
  async handleResumeSession(wrapperId: string, params: { sessionId: string; cwd?: string; mcpServers?: acp.McpServer[] }): Promise<any> {
    if (!this.clientConnection) {
      throw new Error('Not connected to agent');
    }

    const cwd = params.cwd || this.config.defaultCwd;

    console.log(`[SSE ACP Client] Resuming session: ${params.sessionId} (wrapper: ${wrapperId})`);

    try {
      // Dispose the previous session of THIS wrapper only
      this.unbind(wrapperId);
      // Bind before the request so updates emitted during resume are routed
      this.bind(wrapperId, { acpSessionId: params.sessionId, activeSession: null, cwd });

      const result = await this.clientConnection.agent.request('session/resume', {
        sessionId: params.sessionId,
        cwd,
        mcpServers: params.mcpServers || [],
      });

      console.log(`[SSE ACP Client] Session resumed: ${params.sessionId}`);

      this.notifyAgentSessionChange(wrapperId, params.sessionId);
      return this.mergeConfigOptions({ sessionId: params.sessionId, ...result });
    } catch (error) {
      this.unbind(wrapperId);
      console.error(`[SSE ACP Client] Failed to resume session:`, error);
      throw error;
    }
  }

  /**
   * Delete a session from agent.
   */
  async handleDeleteSession(wrapperId: string, params: { sessionId: string }): Promise<void> {
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

      // Clean up the local binding only when it belongs to this wrapper
      const binding = this.sessionBindings.get(wrapperId);
      if (binding && binding.acpSessionId === params.sessionId) {
        this.unbind(wrapperId);
      }

      this.notifyAgentSessionChange(wrapperId, this.sessionBindings.get(wrapperId)?.acpSessionId ?? null);
      console.log(`[SSE ACP Client] Session deleted: ${params.sessionId}`);
    } catch (error) {
      console.error(`[SSE ACP Client] Failed to delete session:`, error);
      throw error;
    }
  }

  /**
   * Set config option on agent for a wrapper session.
   */
  async handleSetConfigOption(wrapperId: string, params: {
    configId: string;
    type: 'id' | 'boolean';
    value: string | boolean;
  }): Promise<any> {
    if (!this.clientConnection) {
      throw new Error('Not connected to agent');
    }

    const sessionId = this.sessionBindings.get(wrapperId)?.acpSessionId;
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
   * Background loop that reads updates for one wrapper's session. Routes
   * `stop` back to that wrapper's channel as `prompt_complete`.
   */
  private startUpdateLoop(wrapperId: string, session: ActiveSession): void {
    const acpSessionId = session.sessionId;
    const isCurrent = () => this.sessionBindings.get(wrapperId)?.acpSessionId === acpSessionId;

    void (async () => {
      try {
        while (isCurrent()) {
          const message = await session.nextUpdate();

          if (message.kind === 'stop') {
            console.log(`[SSE ACP Client] Prompt completed: ${message.stopReason}`);
            this.publishToWrapper(wrapperId, {
              type: 'prompt_complete',
              payload: message.response,
            });
            break;
          }
        }
      } catch (error) {
        if (!isCurrent()) {
          return;
        }
        console.error(`[SSE ACP Client] Error reading session updates:`, error);
      }
    })();
  }

  /**
   * Cancel pending permissions, optionally scoped to one wrapper session.
   */
  private cancelPendingPermissions(wrapperId?: string): void {
    for (const [requestId, pending] of this.pendingPermissions) {
      if (wrapperId !== undefined && pending.wrapperId !== wrapperId) {
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

    for (const [, binding] of this.sessionBindings) {
      if (binding.activeSession) {
        try {
          binding.activeSession.dispose();
        } catch {
          // ignore
        }
      }
    }
    this.sessionBindings.clear();
    this.reverseAcp.clear();
    this.attachedWrappers.clear();

    this.clientConnection?.close();
    this.clientConnection = null;

    this.clientApp = null;

    if (this.agentProcess) {
      this.agentProcess.kill();
      this.agentProcess = null;
    }

    this.clearBindings();
    this.handleConnectionLost();

    // Unsubscribe from Redis
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers = [];
  }
}

export default SseAcpClient;
