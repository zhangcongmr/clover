import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import type * as acp from '@agentclientprotocol/sdk';
import type { McpServerConfig, McpServersStore } from './types.js';

const STORE_DIR = join(homedir(), '.clover');
const STORE_FILE = join(STORE_DIR, 'mcp-servers.json');

export class McpServerRegistry {
  private store: McpServersStore = { servers: {} };

  constructor() {
    this.loadStore();
  }

  private loadStore(): void {
    try {
      if (existsSync(STORE_FILE)) {
        const data = readFileSync(STORE_FILE, 'utf-8');
        this.store = JSON.parse(data);
      }
    } catch (error) {
      console.error('[MCP Registry] Failed to load store:', error);
      this.store = { servers: {} };
    }
  }

  private saveStore(): void {
    try {
      if (!existsSync(STORE_DIR)) {
        mkdirSync(STORE_DIR, { recursive: true });
      }
      writeFileSync(STORE_FILE, JSON.stringify(this.store, null, 2));
    } catch (error) {
      console.error('[MCP Registry] Failed to save store:', error);
    }
  }

  resolve(name: string): acp.McpServer | null {
    const config = this.store.servers[name];
    if (!config) {
      console.warn(`[MCP Registry] Server not found: ${name}`);
      return null;
    }

    if (config.type === 'stdio') {
      return {
        name,
        command: config.command,
        args: config.args,
        env: this.resolveEnv(config.env),
      };
    } else if (config.type === 'http') {
      return {
        type: 'http',
        name,
        url: config.url,
        headers: this.resolveHeaders(config.headers),
      };
    }

    return null;
  }

  resolveAll(names: string[]): acp.McpServer[] {
    return names
      .map(name => this.resolve(name))
      .filter((s): s is acp.McpServer => s !== null);
  }

  upsert(name: string, config: Omit<McpServerConfig, 'name'>): void {
    // 清理名称中的不可见字符
    const cleanName = name.trim();
    this.store.servers[cleanName] = { ...config, name: cleanName } as McpServerConfig;
    this.saveStore();
    console.log(`[MCP Registry] Server "${cleanName}" saved`);
  }

  remove(name: string): boolean {
    if (!this.store.servers[name]) return false;
    delete this.store.servers[name];
    this.saveStore();
    console.log(`[MCP Registry] Server "${name}" removed`);
    return true;
  }

  get(name: string): McpServerConfig | null {
    return this.store.servers[name] || null;
  }

  list(): McpServerConfig[] {
    return Object.values(this.store.servers);
  }

  private resolveEnv(env?: Record<string, string>): Array<{ name: string; value: string }> {
    if (!env) return [];
    return Object.entries(env).map(([name, value]) => ({
      name,
      value: value.replace(/\$\{(\w+)\}/g, (_, envName) => process.env[envName] || ''),
    }));
  }

  private resolveHeaders(headers?: Record<string, string>): Array<{ name: string; value: string }> {
    if (!headers) return [];
    return Object.entries(headers).map(([name, value]) => ({
      name,
      value: value.replace(/\$\{(\w+)\}/g, (_, envName) => process.env[envName] || ''),
    }));
  }
}
