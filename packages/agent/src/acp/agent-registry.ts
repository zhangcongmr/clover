import { logger } from '../helpers/logger.js';
import { SseAcpClient } from './sse-client.js';
import type { SseAcpClientConfig } from './sse-client.js';
import type { AgentConfig, AgentStatusInfo } from './acp-agent.types.js';
import { invalidateAgentCommandCache, probeAgentVersion, probePackageVersion, probePathCommand } from './agent-probe.js';
import type { EventSink } from '../events/event-sink.js';

/** Remember the resolved install paths of the last probe. */
function applyProbePaths(
  state: { cliPath?: string },
  probe: { cliPath?: string },
): void {
  state.cliPath = probe.cliPath;
}

/**
 * Probe whether an agent can be launched, without spawning a session.
 *
 * - binary / plain CLI agents: the command is looked up on PATH; commands
 *   containing a path separator are checked directly on disk (binary installs
 *   under ~/.clover/agents/<id>/).
 * - npx / uvx agents: the runner shim on PATH says nothing about the package,
 *   so the package itself is run (`npx -y <pkg> --version` /
 *   `uvx <pkg> --version`, mirroring the installer's verification) and the
 *   parsed version is returned alongside.
 */
async function probeCommand(
  state: Pick<AgentStatusInfo, 'command' | 'args'>,
): Promise<{
  installed: boolean;
  error?: string;
  cliPath?: string;
  version?: string;
}> {
  if (state.command === 'npx' || state.command === 'uvx') {
    const pkg = state.args?.[0];
    if (!pkg) {
      return { installed: false, error: `No package specified for ${state.command} agent` };
    }
    const runnerPath = probePathCommand(state.command).path;
    const result = await probePackageVersion(state.command, pkg);
    return result.ok
      ? { installed: true, cliPath: runnerPath, version: result.version }
      : { installed: false, error: result.error ?? `${state.command} package not runnable: ${pkg}` };
  }

  const probe = probePathCommand(state.command);
  return probe.found
    ? { installed: true, cliPath: probe.path }
    : { installed: false, error: missingAgentHint(state.command) };
}

/** Human-readable hint for a command that cannot be found. */
function missingAgentHint(command: string): string {
  return `Command not found in PATH: ${command}`;
}

/**
 * Owns the warm, pre-initialized ACP connection for every known agent.
 *
 * - Server startup calls `warmupAll()`: probes each agent on PATH and then
 *   spawns + initializes the subprocess IN PARALLEL — without creating any
 *   session or event-stream subscription.
 * - Session code calls `getOrCreate()`: reuses the warm connection when it
 *   is ready, otherwise falls back to spawn+initialize on the spot.
 * - Settings calls `getStatus()` / `checkNow()` for the Agents management UI.
 *
 * Registry states are plain `AgentStatusInfo` objects: the persisted fields
 * double as the persistence source of truth, while `connection` / `inflight`
 * / `checking` hold the non-serializable runtime internals.
 */
export class AgentRegistry {
  /** Known agents by their public id. */
  private statesById: Map<string, AgentStatusInfo> = new Map();
  /** All states by `command|args|env` key (includes ad-hoc session states). */
  private stateByKey: Map<string, AgentStatusInfo> = new Map();

  constructor(
    private agentConfigs: AgentConfig[] = [],
    /** 事件面出口：注入后所有 agent 连接共用同一个事件流实现。 */
    private sink?: EventSink,
  ) {
    for (const config of this.agentConfigs) {
      const state: AgentStatusInfo = {
        ...config,
        status: 'unknown',
        connection: null,
        lastChecked: 0,
        inflight: null,
        checking: null,
      };
      this.statesById.set(config.id, state);
      this.stateByKey.set(AgentRegistry.key(config.command, config.args, config.env), state);
    }
  }

  private static key(
    command: string,
    args: string[] | undefined,
    env: Record<string, string> | undefined,
  ): string {
    return `${command}|${JSON.stringify(args ?? [])}|${JSON.stringify(env ?? {})}`;
  }

  // ==========================================================================
  // Warmup (server startup)
  // ==========================================================================

  /**
   * Probe + spawn + initialize every known agent, all in parallel.
   * Never creates session records or event-stream subscriptions (startup phase
   * deliberately skips session-record creation).
   */
  async warmupAll(): Promise<void> {
    const configs = this.agentConfigs;
    if (!configs.length) return;
    logger.log(`[AgentRegistry] Warming up ${configs.length} agents in parallel...`);
    await Promise.all(configs.map(config => this.warmupOne(config)));
    logger.log(`[AgentRegistry] Warmup finished: ${this.getStatus().map(a => `${a.id}=${a.status}`).join(', ')}`);
  }

  /**
   * Probe one agent and try to bring it to `connected` (spawn + initialize).
   *
   * Single shared flow for both startup warmup and Check Now (`doCheck`
   * delegates here). Display precedence is preserved: an actually running
   * connection counts as `connected` even when the probe reports the command
   * missing. Errors are recorded on the state, never rethrown.
   */
  private async warmupOne(agent: Pick<AgentStatusInfo, 'id' | 'name' | 'command'>): Promise<void> {
    const state = this.statesById.get(agent.id);
    if (!state) return;

    try {
      const probe = await probeCommand(state);
      state.installed = probe.installed;
      applyProbePaths(state, probe);
      const probedVersion = probe.version ?? (state.cliPath ? probeAgentVersion(state.cliPath) : null);
      if (probedVersion) state.version = probedVersion;
      state.lastChecked = Date.now();

      if (!probe.installed) {
        if (state.connection?.isConnected()) {
          // Precedence: an actually running connection still counts as connected.
          state.status = 'connected';
          state.error = undefined;
        } else {
          state.status = 'unavailable';
          state.error = probe.error ?? missingAgentHint(state.command);
        }
        logger.log(`[AgentRegistry] ${agent.name}: unavailable (${state.error})`);
        return;
      }

      if (state.connection?.isConnected()) {
        state.status = 'connected';
        state.error = undefined;
        logger.log(`[AgentRegistry] ${agent.name}: connected`);
        return;
      }

      // Installed but not running: try to bring it up (spawn + initialize).
      state.status = 'available';
      await this.ensureConnected(state);
      state.status = 'connected';
      state.error = undefined;
      logger.log(`[AgentRegistry] ${agent.name}: connected`);
    } catch (error) {
      state.status = state.installed ? 'offline' : 'unavailable';
      state.error = (error as Error).message;
      logger.error(`[AgentRegistry] ${agent.name}: connect failed — ${state.error}`);
    }
  }

  // ==========================================================================
  // Connection reuse (the check logic for session/create·load·resume·prompt)
  // ==========================================================================

  /**
   * Get the shared connection for the given agent config.
   * Reuses the pre-warmed connection when ready; otherwise spawns and
   * initializes on the spot (the fallback path kept for robustness).
   */
  async getOrCreate(config: SseAcpClientConfig): Promise<SseAcpClient> {
    return this.ensureConnected(this.stateForSession(config));
  }

  /**
   * Resolve an agent's launch config (command/args/env) by its public id.
   * Returns null for unknown ids — callers surface the error to the frontend.
   */
  getConfigById(agentId: string): SseAcpClientConfig | null {
    const state = this.statesById.get(agentId);
    if (!state) return null;
    return {
      agentCommand: state.command,
      agentArgs: state.args,
      agentEnv: state.env,
    };
  }

  /** Existing connection for a session config without creating one. */
  getExisting(config: SseAcpClientConfig): SseAcpClient | null {
    return this.stateForSession(config).connection ?? null;
  }

  /** Whether a connection object is owned by this registry. */
  owns(connection: SseAcpClient | null | undefined): boolean {
    if (!connection) return false;
    for (const state of this.allStates()) {
      if (state.connection === connection) return true;
    }
    return false;
  }

  private ensureConnected(state: AgentStatusInfo): Promise<SseAcpClient> {
    if (state.connection?.isConnected()) {
      return Promise.resolve(state.connection);
    }

    // Single owner creates the attempt; concurrent callers join it, so a
    // burst of session requests can never spawn two processes.
    if (!state.inflight) {
      state.inflight = this.spawnAndInitialize(state).then(
        () => { state.inflight = null; },
        (error) => { state.inflight = null; throw error; },
      );
    }

    const inflight = state.inflight;
    return inflight.then(() => {
      const connection = state.connection;
      if (!connection?.isConnected()) {
        throw new Error(`Agent ${state.name} failed to connect`);
      }
      return connection;
    });
  }

  private async spawnAndInitialize(state: AgentStatusInfo): Promise<void> {
    const command = state.command;
    const args = state.args ?? [];
    const env = state.env;

    let connection = state.connection;
    if (!connection) {
      connection = new SseAcpClient(`agent:${state.id}`, {
        agentCommand: command,
        agentArgs: args,
        agentEnv: env,
      }, this.sink);
      state.connection = connection;

      // Track runtime status transitions driven by the connection itself.
      connection.onConnectionState((connected) => {
        if (connected) {
          state.status = 'connected';
          state.error = undefined;
        } else if (state.status === 'connected') {
          state.status = state.installed === false ? 'unavailable' : 'offline';
          state.error = state.error ?? 'Agent process exited';
        }
        state.lastChecked = Date.now();
      });
    }

    if (state.status === 'unknown' && state.installed !== false) {
      state.status = 'available';
    }

    try {
      await connection.connect({ command, args, env });
    } catch (error) {
      state.status = state.installed === false ? 'unavailable' : 'offline';
      state.error = (error as Error).message;
      state.lastChecked = Date.now();
      throw error;
    }

    state.status = 'connected';
    state.error = undefined;
    state.lastChecked = Date.now();
  }

  // ==========================================================================
  // Settings API (status listing + Check Now)
  // ==========================================================================

  getStatus(): AgentStatusInfo[] {
    return [...this.statesById.values()].map(state => this.toInfo(state));
  }

  /**
   * Re-probe installation and try to bring the agent to `connected`.
   * Dedupes concurrent checks for the same agent.
   */
  async checkNow(agentId: string): Promise<AgentStatusInfo> {
    const state = this.statesById.get(agentId);
    if (!state) {
      throw new Error(`Unknown agent: ${agentId}`);
    }
    if (state.checking) {
      return state.checking;
    }

    state.checking = this.doCheck(state).finally(() => {
      state.checking = null;
    });
    return state.checking;
  }

  private async doCheck(state: AgentStatusInfo): Promise<AgentStatusInfo> {
    // Explicit re-check: drop cached CLI lookups so a freshly installed agent
    // is picked up without restarting the server. warmupOne records probe and
    // connect results (including failures) on the state and never rethrows.
    invalidateAgentCommandCache();
    await this.warmupOne(state);
    return this.toInfo(state);
  }

  /** Extract the persisted AgentConfig subset from a registry state. */
  private configOf(state: AgentStatusInfo): AgentConfig {
    return {
      id: state.id,
      name: state.name,
      command: state.command,
      args: state.args,
      env: state.env,
      description: state.description,
      source: state.source,
      version: state.version,
      installed: state.installed,
      installedAt: state.installedAt,
    };
  }

  /** Snapshot for the settings UI: config fields + runtime status, without
   *  the non-serializable runtime internals (connection/inflight/checking). */
  private toInfo(state: AgentStatusInfo): AgentStatusInfo {
    return {
      ...this.configOf(state),
      status: state.status,
      agentInfo: state.connection?.getAgentInfo() ?? undefined,
      capabilities: state.connection?.getAgentCapabilities() ?? undefined,
      error: state.error,
      cliPath: state.cliPath,
      lastChecked: state.lastChecked,
    };
  }

  /**
   * Remove an agent from the registry (Settings → Uninstall).
   *
   * Precheck first: when the agent has been spawned, tear down its warm
   * connection and wait until the child process has actually exited — the
   * caller deletes the agent's install directory right after, and on Windows
   * the executable stays locked while the process is still running.
   * Returns false when the agent id is unknown.
   */
  async removeConfig(agentId: string): Promise<boolean> {
    const state = this.statesById.get(agentId);
    if (!state) return false;

    if (state.connection) {
      const wasRunning = state.connection.isConnected();
      try {
        await state.connection.disconnectAndWait();
        if (wasRunning) {
          logger.log(`[AgentRegistry] ${state.name}: spawned agent process stopped (uninstall)`);
        }
      } catch (error) {
        logger.warn(`[AgentRegistry] ${state.name}: failed to stop connection cleanly:`, error);
      }
      state.connection = null;
    }

    this.statesById.delete(agentId);
    for (const [key, entry] of this.stateByKey) {
      if (entry === state) this.stateByKey.delete(key);
    }
    return true;
  }

  /**
   * Look up a registered agent's full config by id.
   * Returns null when the agent id is unknown (not present in the installed
   * agent list loaded from ~/.clover/acp.json).
   */
  getAgentConfig(agentId: string): AgentConfig | null {
    const state = this.statesById.get(agentId);
    return state ? this.configOf(state) : null;
  }

  /**
   * Dynamically add a new agent config to the registry (e.g. after installing
   * from ACP Registry or Add Agent From Disk). Probes the command immediately
   * so missing/install state is known without a prior `checkNow`.
   * Returns false if the agent id already exists.
   */
  async addConfig(config: AgentConfig): Promise<boolean> {
    if (this.statesById.has(config.id)) return false;

    const state: AgentStatusInfo = {
      ...config,
      status: 'unknown',
      connection: null,
      lastChecked: 0,
      inflight: null,
      checking: null,
    };
    this.statesById.set(config.id, state);
    this.stateByKey.set(AgentRegistry.key(config.command, config.args, config.env), state);

    // Probe the command immediately so missing/install state is known.
    try {
      const probe = await probeCommand(config);
      state.installed = probe.installed;
      applyProbePaths(state, probe);
      const probedVersion = probe.version ?? (state.cliPath ? probeAgentVersion(state.cliPath) : null);
      if (probedVersion) state.version = probedVersion;
      state.lastChecked = Date.now();
      state.status = probe.installed ? 'available' : 'unavailable';
      state.error = probe.error ?? missingAgentHint(config.command);
    } catch (error) {
      state.status = 'unavailable';
      state.error = (error as Error).message;
    }

    return true;
  }

  // ==========================================================================
  // Teardown
  // ==========================================================================

  destroy(): void {
    for (const state of this.allStates()) {
      try {
        state.connection?.disconnect();
      } catch {
        // ignore teardown errors
      }
      state.connection = null;
      state.status = state.installed === false
        ? 'unavailable'
        : state.installed === true
          ? 'offline'
          : 'unknown';
      state.inflight = null;
      state.checking = null;
    }
  }

  // ==========================================================================
  // Internals
  // ==========================================================================

  private allStates(): Set<AgentStatusInfo> {
    return new Set([...this.statesById.values(), ...this.stateByKey.values()]);
  }

  /** Resolve (creating ad-hoc entries as needed) the state for a session config. */
  private stateForSession(config: SseAcpClientConfig): AgentStatusInfo {
    const command = config.agentCommand || 'opencode';
    const args = config.agentArgs;
    const env = config.agentEnv;

    // Exact match on command + args + env.
    const exact = this.stateByKey.get(AgentRegistry.key(command, args, env));
    if (exact) {
      return exact;
    }

    // Caller omitted args/env entirely → inherit the known agent definition.
    if (args === undefined && env === undefined) {
      for (const state of this.statesById.values()) {
        if (state.command === command) {
          return state;
        }
      }
    }

    // Unknown combination → ad-hoc state (tracked for the connection, but
    // not listed in getStatus() since it has no public agent id).
    const normalizedArgs = args ?? ['acp'];
    const adhoc: AgentConfig = {
      id: `adhoc:${command}`,
      name: command,
      command,
      args: normalizedArgs,
      env,
    };
    const state: AgentStatusInfo = {
      ...adhoc,
      status: 'unknown',
      connection: null,
      lastChecked: 0,
      inflight: null,
      checking: null,
    };
    this.stateByKey.set(AgentRegistry.key(command, normalizedArgs, env), state);
    return state;
  }
}

export default AgentRegistry;
