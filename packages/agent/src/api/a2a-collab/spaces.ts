import { logger } from '../../helpers/logger.js';
import { v4 as uuidv4 } from 'uuid';
import type * as acp from '@agentclientprotocol/sdk';
import type { AcpSessionManager } from '../../acp/session-manager.js';
import { AVAILABLE_AGENTS } from '../../acp/acp-agent.types.js';

export interface CollabSpace {
  id: string;
  cwd: string;
  agentIds: string[];
  /** agentId → ACP session id (one ACP session per participating agent). */
  sessions: Map<string, string>;
  /** agentId → configOptions returned by session/new (mode/model selectors). */
  configOptions: Map<string, acp.SessionConfigOption[]>;
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
 * A space owns one ACP session per participating agent, all bound to a
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
      sessions: new Map(),
      configOptions: new Map(),
      orchestratorAgentId: orchestratorAgentId || undefined,
      createdAt: Date.now(),
    };
    const created: string[] = [];

    try {
      for (const agentId of agentIds) {
        const newSession = await this.sessionManager.createAcpSession(agentId, cwd);
        const acpSessionId = String(newSession?.sessionId ?? '');
        if (!acpSessionId) {
          throw new Error(`Agent ${agentId} returned no ACP session id`);
        }
        created.push(acpSessionId);
        space.sessions.set(agentId, acpSessionId);
        space.configOptions.set(
          agentId,
          Array.isArray(newSession?.configOptions) ? newSession.configOptions : [],
        );
      }
    } catch (error) {
      // Roll back partially created sessions
      for (const acpSessionId of created) {
        try {
          await this.sessionManager.removeSession(acpSessionId);
        } catch {
          /* ignore cleanup errors */
        }
      }
      throw error;
    }

    this.spaces.set(space.id, space);
    logger.log(
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
    for (const acpSessionId of space.sessions.values()) {
      try {
        await this.sessionManager.removeSession(acpSessionId);
      } catch (error) {
        logger.warn(`[A2A Collab] Failed to release session ${acpSessionId}:`, error);
      }
    }
    logger.log(`[A2A Collab] Space closed: ${spaceId}`);
    return true;
  }
}
