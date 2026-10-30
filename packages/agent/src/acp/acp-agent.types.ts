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
  /** 是否已安装。 */
  installed?: boolean;
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
