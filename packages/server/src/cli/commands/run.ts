import { resolve } from 'node:path';
import { readAcpConfigFile } from '../../acp/acp-config-store.js';
import type { AgentConfig } from '../../acp/acp-agent.types.js';
import { AgentRegistry } from '../../acp/agent-registry.js';
import { AcpSessionManager, type AcpSessionEvent } from '../../acp/session-manager.js';
import { getSharedEventSink } from '../../events/in-process-event-sink.js';
import { closeLogs, setLoggerConsoleTarget } from '../../helpers/logger.js';
import { CliUsageError } from '../errors.js';
import type { RequestPermissionOutcome } from '../../acp/types.js';

/**
 * `clover run` 的实现。
 *
 * 与 Web 端最大的差异：**完全脱离 Express / Vite**。agent 与会话都在进程内
 * 直接驱动，事件通过共享的事件总线推给 stdout。
 *
 * CLI 只读 `~/.clover/acp.json`：agent 由服务端 / Web UI 安装维护，CLI 既不
 * 注册也不安装，也不写任何配置文件。
 */

/** `clover run` 的解析结果。 */
export interface RunCommandOptions {
  /** 交给 agent 的提示词。 */
  prompt: string;
  /** 已安装 agent 的 id；缺省时若只装了一个则用它。 */
  agent?: string;
  /** workspace 根目录（默认当前目录）。 */
  root?: string;
  /** 输出原始会话事件（NDJSON），而不是人类可读文本。 */
  json: boolean;
  /** 自动同意权限请求（默认拒绝）。 */
  approve: boolean;
}

/** `clover run --help` 的帮助文本。 */
export const RUN_HELP = [
  'Usage:',
  '  clover run <prompt> [options]',
  '',
  'Options:',
  '  --agent <id>   Run with this agent id (it must be installed)',
  '  --root <dir>   Workspace directory (default: current directory)',
  '  --json         Print raw session events as NDJSON',
  '  --approve      Approve permission requests automatically',
  '  -h, --help     Show this help message',
].join('\n');

/**
 * 解析 `clover run` 的参数。
 *
 * 位置参数（提示词）可以出现在选项之前或之后；`--` 之后的一切都按提示词处理。
 */
export function parseRunArgs(args: readonly string[]): RunCommandOptions {
  let agent: string | undefined;
  let root: string | undefined;
  let json = false;
  let approve = false;
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--') {
      positionals.push(...args.slice(i + 1));
      break;
    }
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--approve') {
      approve = true;
      continue;
    }
    if (arg === '--agent' || arg === '--root') {
      const value = args[++i];
      if (value === undefined || value.startsWith('-')) {
        throw new CliUsageError(`Missing value for ${arg}`);
      }
      if (arg === '--agent') agent = value;
      else root = value;
      continue;
    }
    if (arg.startsWith('--agent=')) {
      agent = arg.slice('--agent='.length);
      continue;
    }
    if (arg.startsWith('--root=')) {
      root = arg.slice('--root='.length);
      continue;
    }
    if (arg.startsWith('-')) {
      throw new CliUsageError(`Unknown option: ${arg}`);
    }

    positionals.push(arg);
  }

  const prompt = positionals.join(' ').trim();
  if (!prompt) {
    throw new CliUsageError('Missing prompt. Usage: clover run "<prompt>" [options]');
  }

  return { prompt, agent, root, json, approve };
}

/**
 * 解析出要使用的 agent id。
 *
 * agent 只能来自 `~/.clover/acp.json`（服务端 / Web UI 安装维护），CLI 不注册
 * 也不安装。`--agent` 指定的 id 必须已安装；未指定时：只有一个已安装 agent 就
 * 直接用它，多个则要求显式指定（不猜、不交互）。
 */
export function resolveAgentId(agents: readonly AgentConfig[], requested?: string): string {
  if (!agents.length) {
    throw new CliUsageError(
      'No agents installed. Add one from the Clover web UI (Settings → Agents) first.',
    );
  }

  if (requested) {
    if (!agents.some((agent) => agent.id === requested)) {
      const known = agents.map((agent) => agent.id).join(', ');
      throw new CliUsageError(
        `Unknown agent: ${requested}. Install it from the Clover web UI (Settings → Agents) first.`
          + (known ? ` Installed agents: ${known}` : ''),
      );
    }
    return requested;
  }

  if (agents.length === 1) return agents[0].id;

  const known = agents.map((agent) => agent.id).join(', ');
  throw new CliUsageError(
    `Multiple agents installed. Pass --agent <id> to choose one. Installed agents: ${known}`,
  );
}

/** 解析 workspace 根目录：默认当前目录，`--root` 可覆盖。 */
export function resolveCwd(root?: string): string {
  return root ? resolve(root) : process.cwd();
}

/** 把毫秒数格式化成人类可读的时长。 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds - minutes * 60)}s`;
}

/** 权限选项的最小形状。 */
interface PermissionOptionLike {
  optionId: string;
  kind?: string;
}

/**
 * 从权限请求的选项里挑一个结果。
 *
 * ACP 只有两种结果形态：`cancelled`（拒绝）或 `selected`（选中某个 optionId）。
 * 允许时优先 `allow_once`，拒绝时优先 `reject_once`；都没有就退化成 `cancelled`。
 */
export function pickPermissionOutcome(
  options: readonly PermissionOptionLike[] | undefined,
  approve: boolean,
): RequestPermissionOutcome {
  const list = options ?? [];
  const wanted = approve ? ['allow_once', 'allow_always'] : ['reject_once', 'reject_always'];
  for (const kind of wanted) {
    const match = list.find((option) => option.kind === kind);
    if (match) return { outcome: 'selected', optionId: match.optionId };
  }
  return { outcome: 'cancelled' };
}

/** 会话事件里与权限请求相关的载荷形状。 */
interface PermissionRequestPayload {
  requestId?: string;
  options?: PermissionOptionLike[];
}

/**
 * 执行 `clover run`，返回进程退出码。
 *
 * 退出码：正常结束 0；用法错误 / ACP 错误 1；Ctrl-C 130。
 */
export async function runCommand(options: RunCommandOptions): Promise<number> {
  // stdout 留给 agent 的输出（`--json` 时是 NDJSON），库日志一律走 stderr，
  // 否则日志会和 agent 的回答混在一起。
  setLoggerConsoleTarget('stderr');

  const agents = readAcpConfigFile().agents;

  let agentId: string;
  let cwd: string;
  try {
    agentId = resolveAgentId(agents, options.agent);
    cwd = resolveCwd(options.root);
  } catch (error) {
    if (error instanceof CliUsageError) {
      console.error(error.message);
      return 1;
    }
    throw error;
  }

  const sink = getSharedEventSink();
  const registry = new AgentRegistry(agents, sink);
  const sessions = new AcpSessionManager(registry, sink);

  let sessionId: string | undefined;
  let interrupted = false;

  const onInterrupt = () => {
    interrupted = true;
    // 摘掉监听后，第二次 Ctrl-C 回到 Node 默认行为（直接退出）。
    process.off('SIGINT', onInterrupt);
    if (sessionId) void sessions.cancelPrompt(sessionId).catch(() => undefined);
  };
  process.on('SIGINT', onInterrupt);

  const startedAt = Date.now();
  try {
    // 预检：先探测命令是否可用并连接，失败时给出可读原因，
    // 而不是等到 initialize 超时才报错。
    const status = await registry.checkNow(agentId);
    if (status.status === 'unavailable' || status.status === 'offline') {
      throw new Error(status.error ?? `Agent "${agentId}" is not available`);
    }

    const created = await sessions.createAcpSession(agentId, cwd);
    sessionId = created.sessionId as string;

    if (!options.json) {
      console.error(`→ agent      ${agentId}`);
      console.error(`→ workspace  ${cwd}`);
    }

    const result = await sessions.promptAndWait(
      sessionId,
      [{ type: 'text', text: options.prompt }],
      (event) => handleEvent(event, options, sessions, sessionId!),
    );

    if (interrupted) return 130;
    if (!options.json) {
      console.error(`✓ done in ${formatDuration(Date.now() - startedAt)} (${result.stopReason})`);
    }
    return 0;
  } catch (error) {
    if (interrupted) {
      console.error('Interrupted.');
      return 130;
    }
    console.error(`✗ ${(error as Error)?.message ?? error}`);
    return 1;
  } finally {
    process.off('SIGINT', onInterrupt);
    sessions.destroy();
    // 必须销毁：agent 子进程否则会一直挂着，CLI 无法退出。
    registry.destroy();
    // 释放日志文件句柄，否则进程同样无法退出。
    await closeLogs();
  }
}

/**
 * 处理一条会话事件。
 *
 * agent 的文本输出走 stdout（可被管道消费），其余提示走 stderr。
 */
function handleEvent(
  event: AcpSessionEvent,
  options: RunCommandOptions,
  sessions: AcpSessionManager,
  sessionId: string,
): void {
  if (event.type === 'permission_request') {
    // Web 端由 UI 应答权限请求，CLI 没有 UI —— 必须在这里代答，
    // 否则 agent 会一直等到超时。
    const payload = event.payload as PermissionRequestPayload | undefined;
    if (payload?.requestId) {
      const outcome = pickPermissionOutcome(payload.options, options.approve);
      if (!options.json) {
        const label = options.approve ? 'approved' : 'denied';
        console.error(`⚠ permission ${label}: ${describePermission(payload.options, outcome)}`);
      }
      // 事件是通过 sink.append 同步扇出的，此时 agent 侧的 pending 还没登记，
      // 直接应答会被丢弃 —— 必须延到下一个 tick。
      const requestId = payload.requestId;
      setTimeout(() => {
        sessions.dispatchPermissionResponse(sessionId, requestId, outcome);
      }, 0);
    }
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(event)}\n`);
    return;
  }

  if (event.type === 'session_update') {
    const update = event.payload?.update;
    if (update?.sessionUpdate === 'agent_message_chunk') {
      const content = update.content;
      if (content?.type === 'text') process.stdout.write(content.text);
    }
    return;
  }

  if (event.type === 'error') {
    console.error(`✗ ${event.payload?.message ?? 'unknown error'}`);
  }
}

/** 描述一次权限请求的处置结果（用于日志）。 */
function describePermission(
  options: readonly PermissionOptionLike[] | undefined,
  outcome: RequestPermissionOutcome,
): string {
  if (outcome.outcome === 'cancelled') return 'cancelled';
  const match = options?.find((option) => option.optionId === outcome.optionId);
  return match?.kind ?? outcome.optionId;
}
