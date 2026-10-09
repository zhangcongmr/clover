import { v4 as uuidv4 } from 'uuid';
import type { AcpSessionManager } from '../../acp/session-manager.js';
import { AVAILABLE_AGENTS } from '../../acp/acp-agent.types.js';

export interface CollabSpace {
  id: string;
  cwd: string;
  agentIds: string[];
  /** agentId → wrapper session id (one wrapper session per participating agent). */
  wrappers: Map<string, string>;
  /** Optional member agent that routes each prompt to the answering agent. */
  orchestratorAgentId?: string;
  createdAt: number;
}

export interface CreateSpaceOptions {
  cwd: string;
  agentIds: string[];
  orchestratorAgentId?: string;
}

/**
 * Process-local registry of collaboration spaces.
 *
 * A space owns one ACP wrapper session per participating agent, all bound to a
 * shared working directory. Spaces are ephemeral: they live until the frontend
 * closes them (or the backend restarts) and are never persisted.
 */
export class CollabSpaceStore {
  private spaces: Map<string, CollabSpace> = new Map();

  constructor(private readonly sessionManager: AcpSessionManager) {}

  async create(options: CreateSpaceOptions): Promise<CollabSpace> {
    const cwd = String(options.cwd ?? '').trim();
    if (!cwd) {
      throw new Error('cwd is required to create a collaboration space');
    }

    const agentIds = [...new Set((options.agentIds ?? []).map(id => String(id).trim()).filter(Boolean))];
    if (agentIds.length === 0) {
      throw new Error('agentIds must contain at least one agent');
    }
    for (const agentId of agentIds) {
      if (!AVAILABLE_AGENTS.some(agent => agent.id === agentId)) {
        throw new Error(`Unknown agent: ${agentId}`);
      }
    }

    const orchestratorAgentId = String(options.orchestratorAgentId ?? '').trim();
    if (orchestratorAgentId && !agentIds.includes(orchestratorAgentId)) {
      throw new Error('orchestratorAgentId must be a member of the collaboration space');
    }

    const space: CollabSpace = {
      id: uuidv4(),
      cwd,
      agentIds,
      wrappers: new Map(),
      orchestratorAgentId: orchestratorAgentId || undefined,
      createdAt: Date.now(),
    };
    const created: string[] = [];

    try {
      for (const agentId of agentIds) {
        const config = AVAILABLE_AGENTS.find(agent => agent.id === agentId)!;
        const wrapperId = await this.sessionManager.createSession({
          agentCommand: config.command,
          agentArgs: config.args,
          agentEnv: config.env,
        });
        created.push(wrapperId);
        await this.sessionManager.connectSession(wrapperId);
        await this.sessionManager.createAcpSession(wrapperId, cwd);
        space.wrappers.set(agentId, wrapperId);
      }
    } catch (error) {
      // Roll back partially created wrapper sessions
      for (const wrapperId of created) {
        try {
          await this.sessionManager.removeSession(wrapperId);
        } catch {
          /* ignore cleanup errors */
        }
      }
      throw error;
    }

    this.spaces.set(space.id, space);
    console.log(
      `[A2A Collab] Space created: ${space.id} (agents: ${agentIds.join(', ')}` +
        `${orchestratorAgentId ? `, orchestrator: ${orchestratorAgentId}` : ''}, cwd: ${cwd})`,
    );
    return space;
  }

  get(spaceId: string | undefined): CollabSpace | undefined {
    if (!spaceId) return undefined;
    return this.spaces.get(spaceId);
  }

  async remove(spaceId: string): Promise<boolean> {
    const space = this.spaces.get(spaceId);
    if (!space) return false;

    this.spaces.delete(spaceId);
    for (const wrapperId of space.wrappers.values()) {
      try {
        await this.sessionManager.removeSession(wrapperId);
      } catch (error) {
        console.warn(`[A2A Collab] Failed to release wrapper ${wrapperId}:`, error);
      }
    }
    console.log(`[A2A Collab] Space closed: ${spaceId}`);
    return true;
  }
}
