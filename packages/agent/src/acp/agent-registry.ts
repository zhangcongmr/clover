import { exec } from 'node:child_process';
import { existsSync } from 'node:fs';
import { SseAcpClient } from './sse-client.js';
import type { SseAcpClientConfig } from './sse-client.js';
import type { AgentConfig } from './acp-agent.types.js';

/**
 * Runtime status of an agent.
 *
 * Display precedence (fixed): connected > unavailable > offline > available.
 * - `connected`   连接：子进程已启动并且 initialize 执行成功
 * - `unavailable` 不可用：Agent 未安装（PATH 探测失败）
 * - `offline`     离线：Agent 已安装但子进程未启动（预热失败/进程退出）
 * - `available`   可用：Agent 已安装（运行态尚未判定/预热进行中）
 * - `unknown`     尚未探测（前端显示“检查中”）
 */
export type AgentRuntimeStatus = 'unknown' | 'available' | 'unavailable' | 'offline' | 'connected';

export interface AgentStatusInfo {
  id: string;
  name: string;
  command: string;
  args?: string[];
  description?: string;
  installed: boolean | null;
  status: AgentRuntimeStatus;
  agentInfo?: unknown;
  capabilities?: unknown;
  error?: string;
  lastChecked: number;
}

interface AgentState {
  config: AgentConfig;
  installed: boolean | null;
  status: AgentRuntimeStatus;
  /** Shared ACP connection (spawn + initialize) owned by this registry. */
  connection: SseAcpClient | null;
  error?: string;
  lastChecked: number;
  /** In-flight spawn+initialize attempt (dedupes concurrent callers). */
  inflight: Promise<void> | null;
  /** In-flight checkNow (dedupe). */
  checking: Promise<AgentStatusInfo> | null;
}

const PROBE_TIMEOUT_MS = 5000;

/**
 * Probe whether a command is available on PATH without spawning it.
 * Commands containing a path separator are checked directly on disk.
 */
function probeCommand(command: string): Promise<boolean> {
  if (command.includes('/') || command.includes('\\')) {
    return Promise.resolve(existsSync(command));
  }
  const cmdline = process.platform === 'win32'
    ? `where "${command}"`
    : `command -v "${command}"`;
  return new Promise((resolve) => {
    exec(cmdline, { timeout: PROBE_TIMEOUT_MS, windowsHide: true }, (error) => {
      resolve(!error);
    });
  });
}

/**
 * Owns the warm, pre-initialized ACP connection for every known agent.
 *
 * - Server startup calls `warmupAll()`: probes each agent on PATH and then
 *   spawns + initializes the subprocess IN PARALLEL — without creating any
 *   wrapper session or Redis subscription.
 * - Session code calls `getOrCreate()`: reuses the warm connection when it
 *   is ready, otherwise falls back to spawn+initialize on the spot.
 * - Settings calls `getStatus()` / `checkNow()` for the Agents management UI.
 */
export class AgentRegistry {
  /** Known agents by their public id. */
  private statesById: Map<string, AgentState> = new Map();
  /** All states by `command|args|env` key (includes ad-hoc session states). */
  private stateByKey: Map<string, AgentState> = new Map();

  constructor(private agentConfigs: AgentConfig[] = []) {
    for (const config of this.agentConfigs) {
      const state: AgentState = {
        config,
        installed: null,
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
   * Never creates wrapper sessions or Redis subscriptions (startup phase
   * deliberately skips the wrapper-session wrapping).
   */
  async warmupAll(): Promise<void> {
    const configs = this.agentConfigs;
    if (!configs.length) return;
    console.log(`[AgentRegistry] Warming up ${configs.length} agents in parallel...`);
    await Promise.all(configs.map(config => this.warmupOne(config)));
    console.log(`[AgentRegistry] Warmup finished: ${this.getStatus().map(a => `${a.id}=${a.status}`).join(', ')}`);
  }

  private async warmupOne(config: AgentConfig): Promise<void> {
    const state = this.statesById.get(config.id);
    if (!state) return;

    try {
      state.installed = await probeCommand(config.command);
      state.lastChecked = Date.now();

      if (!state.installed) {
        state.status = 'unavailable';
        state.error = `Command not found in PATH: ${config.command}`;
        console.log(`[AgentRegistry] ${config.name}: unavailable (${state.error})`);
        return;
      }

      if (state.status === 'unknown') {
        state.status = 'available';
      }

      await this.ensureConnected(state);
      console.log(`[AgentRegistry] ${config.name}: connected (warm)`);
    } catch (error) {
      state.status = state.installed ? 'offline' : 'unavailable';
      state.error = (error as Error).message;
      console.error(`[AgentRegistry] ${config.name}: warmup failed — ${state.error}`);
    }
  }

  // ==========================================================================
  // Connection reuse (the check logic for session/create·load·resume·prompt)
  // ==========================================================================

  /**
   * Get the shared connection for a wrapper session's agent config.
   * Reuses the pre-warmed connection when ready; otherwise spawns and
   * initializes on the spot (the fallback path kept for robustness).
   */
  async getOrCreate(config: SseAcpClientConfig): Promise<SseAcpClient> {
    return this.ensureConnected(this.stateForSession(config));
  }

  /** Existing connection for a session config without creating one. */
  getExisting(config: SseAcpClientConfig): SseAcpClient | null {
    return this.stateForSession(config).connection;
  }

  /** Whether a connection object is owned by this registry. */
  owns(connection: SseAcpClient | null | undefined): boolean {
    if (!connection) return false;
    for (const state of this.allStates()) {
      if (state.connection === connection) return true;
    }
    return false;
  }

  private ensureConnected(state: AgentState): Promise<SseAcpClient> {
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
      if (!state.connection?.isConnected()) {
        throw new Error(`Agent ${state.config.name} failed to connect`);
      }
      return state.connection;
    });
  }

  private async spawnAndInitialize(state: AgentState): Promise<void> {
    const command = state.config.command;
    const args = state.config.args ?? [];
    const env = state.config.env;

    let connection = state.connection;
    if (!connection) {
      connection = new SseAcpClient(`agent:${state.config.id}`, {
        agentCommand: command,
        agentArgs: args,
        agentEnv: env,
      });
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

  private async doCheck(state: AgentState): Promise<AgentStatusInfo> {
    try {
      state.installed = await probeCommand(state.config.command);
      state.lastChecked = Date.now();

      if (!state.installed) {
        // Precedence: an actually running connection still counts as connected.
        state.status = state.connection?.isConnected() ? 'connected' : 'unavailable';
        state.error = state.status === 'connected'
          ? undefined
          : `Command not found in PATH: ${state.config.command}`;
        return this.toInfo(state);
      }

      if (state.connection?.isConnected()) {
        state.status = 'connected';
        state.error = undefined;
        return this.toInfo(state);
      }

      // Installed but not running: try to bring it up (spawn + initialize).
      state.status = 'available';
      await this.ensureConnected(state);
      state.status = 'connected';
      state.error = undefined;
      return this.toInfo(state);
    } catch (error) {
      state.status = state.installed ? 'offline' : 'unavailable';
      state.error = (error as Error).message;
      return this.toInfo(state);
    }
  }

  private toInfo(state: AgentState): AgentStatusInfo {
    return {
      id: state.config.id,
      name: state.config.name,
      command: state.config.command,
      args: state.config.args,
      description: state.config.description,
      installed: state.installed,
      status: state.status,
      agentInfo: state.connection?.getAgentInfo() ?? undefined,
      capabilities: state.connection?.getAgentCapabilities() ?? undefined,
      error: state.error,
      lastChecked: state.lastChecked,
    };
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

  private allStates(): Set<AgentState> {
    return new Set([...this.statesById.values(), ...this.stateByKey.values()]);
  }

  /** Resolve (creating ad-hoc entries as needed) the state for a session config. */
  private stateForSession(config: SseAcpClientConfig): AgentState {
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
        if (state.config.command === command) {
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
    const state: AgentState = {
      config: adhoc,
      installed: null,
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
