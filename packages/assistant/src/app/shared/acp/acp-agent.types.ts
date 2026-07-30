export interface AgentConfig {
  id: string;
  name: string;
  command: string;
  args?: string[];
  description?: string;
}

export const AVAILABLE_AGENTS: AgentConfig[] = [
  { id: 'opencode', name: 'OpenCode', command: 'opencode', args: ['acp'], description: 'Open-source terminal AI assistant' },
  { id: 'claude', name: 'Claude Code', command: 'acp-proxy', args: ['--no-auth', 'claude-code-acp'], description: "Anthropic's coding agent" },
  { id: 'codex', name: 'Codex CLI', command: 'acp-proxy', args: ['--no-auth', 'codex-acp'], description: "OpenAI's coding agent" },
  { id: 'gemini', name: 'Gemini CLI', command: 'gemini', args: ['--', '--experimental-acp'], description: "Google's AI agent" },
  { id: 'qwen', name: 'Qwen Code', command: 'qwen', args: ['--', '--acp'], description: 'Free coding agent' },
  { id: 'augment', name: 'Augment Code', command: 'auggie', args: ['--', '--acp'], description: "Augment's AI coding agent" },
];
