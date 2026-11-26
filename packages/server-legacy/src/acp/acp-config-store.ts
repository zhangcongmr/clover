import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AgentConfig } from './acp-agent.types.js';

/**
 * Persistent store for user-installed ACP agents: `~/.clover/acp.json`.
 *
 * Only agents the user explicitly installed (ACP Registry / local disk) live
 * here — builtin recognition templates are code constants and never persisted.
 * The installer writes an entry after a successful install; uninstall removes
 * it again.
 */

const CLOVER_DIR = join(homedir(), '.clover');
export const ACP_CONFIG_FILE = join(CLOVER_DIR, 'acp.json');

export interface AcpConfigFile {
  version: string;
  agents: AgentConfig[];
}

export const ACP_CONFIG_VERSION = '1.0.0';

export function readAcpConfigFile(): AcpConfigFile {
  if (!existsSync(ACP_CONFIG_FILE)) return { version: ACP_CONFIG_VERSION, agents: [] };
  try {
    const raw = JSON.parse(readFileSync(ACP_CONFIG_FILE, 'utf-8'));
    const agents = Array.isArray(raw?.agents) ? raw.agents as AgentConfig[] : [];
    return { version: raw?.version ?? ACP_CONFIG_VERSION, agents };
  } catch {
    return { version: ACP_CONFIG_VERSION, agents: [] };
  }
}

export function writeAcpConfigFile(data: AcpConfigFile): void {
  mkdirSync(CLOVER_DIR, { recursive: true });
  writeFileSync(ACP_CONFIG_FILE, JSON.stringify(data, null, 2));
}

/** Persist (or update, by id) one installed agent entry in `~/.clover/acp.json`. */
export function upsertAcpAgent(entry: AgentConfig): void {
  const config = readAcpConfigFile();
  const existing = config.agents.findIndex(a => a.id === entry.id);
  if (existing >= 0) {
    config.agents[existing] = { ...config.agents[existing], ...entry };
  } else {
    config.agents.push(entry);
  }
  writeAcpConfigFile(config);
}

/** Remove one agent entry by id. Returns false when the id was not present. */
export function removeAcpAgent(agentId: string): boolean {
  const config = readAcpConfigFile();
  const filtered = config.agents.filter(a => a.id !== agentId);
  if (filtered.length === config.agents.length) return false;
  config.agents = filtered;
  writeAcpConfigFile(config);
  return true;
}
