import type { SseAcpClient } from './sse-client.js';

export type AgentSource = 'builtin' | 'registry' | 'disk';

export interface AgentConfig {
  id: string;
  name: string;
  command: string;
  args?: string[];
  description?: string;
  env?: Record<string, string>;
  /** 来源：builtin 内置、registry 来自 ACP Registry、disk 来自本地磁盘。 */
  source?: AgentSource;
  /** 版本号（registry 中的 version 或用户填写）。 */
  version?: string;
  /** 安装完成的 ISO 时间戳。 */
  installedAt?: string;
  /** 是否已安装：持久化时为布尔；探测场景下 null 表示尚未探测。 */
  installed?: boolean | null;
}

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

/**
 * Agent 的完整视图：继承 AgentConfig 的全部持久化字段（id/name/command/args/
 * env/description/source/version/installed/installedAt），再叠加 registry
 * 探测与连接产生的实时状态快照。
 *
 * 双重身份：
 * - `GET /api/acp/agents` 的响应结构（`AgentRegistry.toInfo` 只挑持久化字段 +
 *   运行时快照，`connection` / `inflight` / `checking` 不会被序列化）；
 * - `AgentRegistry` 的内部状态：`connection` / `inflight` / `checking` 持有
 *   不可序列化的运行时内部对象，持久化时由 `configOf` 只提取 AgentConfig 子集。
 */
export interface AgentStatusInfo extends AgentConfig {
  status: AgentRuntimeStatus;
  agentInfo?: unknown;
  capabilities?: unknown;
  error?: string;
  /** 探测解析出的 agent CLI 路径（settings UI 据此展示完整运行命令）。 */
  cliPath?: string;
  /** Registry 内部：warm connection 与去重 promise，进程内使用、不序列化。 */
  connection?: SseAcpClient | null;
  inflight?: Promise<void> | null;
  checking?: Promise<AgentStatusInfo> | null;
  /** 安装/最近一次探测的时间戳。 */
  lastChecked: number;
}

export const AVAILABLE_AGENTS: AgentConfig[] = [
  { id: 'opencode', name: 'OpenCode', command: 'opencode', args: ['acp'], description: 'Open-source terminal AI assistant' },
  {
    id: 'claude',
    name: 'Claude Code',
    command: 'claude-agent-acp',
    args: [],
    env: {
      'ANTHROPIC_API_KEY': 'sk-xxx',
      'ANTHROPIC_BASE_URL': 'https://api.deepseek.com/anthropic',
      'MODEL_ID': 'deepseek-v4-flash',
    },
    description: "Anthropic's coding agent",
  },
  { id: 'codex', name: 'Codex CLI', command: 'codex-acp', args: [], description: "OpenAI's coding agent" },
  { id: 'gemini', name: 'Gemini CLI', command: 'gemini', args: ['--experimental-acp'], description: "Google's AI agent" },
  { id: 'qwen', name: 'Qwen Code', command: 'qwen', args: ['--acp'], description: 'Free coding agent' },
  { id: 'auggie', name: 'Augment Code', command: 'auggie', args: ['--acp'], description: "Augment's AI coding agent" },
];
