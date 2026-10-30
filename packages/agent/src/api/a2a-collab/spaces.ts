import { logger } from '../../helpers/logger.js';
import { v4 as uuidv4 } from 'uuid';
import type * as acp from '@agentclientprotocol/sdk';
import type { AcpSessionManager } from '../../acp/session-manager.js';
import type { AgentRegistry } from '../../acp/agent-registry.js';

/**
 * One participating session inside a collaboration space.
 *
 * The session (`id`) is the primary key of the collaboration: it owns its ACP
 * session, its role/responsibility and its bound agent implementation
 * (`agentId`). Several sessions may bind the same `agentId`.
 */
export interface CollabMemberInfo {
  /** Participant/session key (primary key of the collaboration). */
  id: string;
  /** Bound agent implementation, e.g. `opencode` / `claude` / `gemini`. */
  agentId: string;
  /** Human role label, e.g. "代码审查专家". */
  role?: string;
  /** What this session is responsible for, used in routing / judgement prompts. */
  responsibility?: string;
  /** Machine-readable capability tags, e.g. ["code_review", "security_scan"]. */
  capabilities?: string[];
}

export interface CollabSpace {
  id: string;
  cwd: string;
  /** participantId → member info (Map order = declaration order). */
  members: Map<string, CollabMemberInfo>;
  /** participantId → ACP session id. */
  sessions: Map<string, string>;
  /** participantId → configOptions returned by session/new (mode/model selectors). */
  configOptions: Map<string, acp.SessionConfigOption[]>;
  /** Optional participant that routes each prompt to the answering session. */
  orchestratorId?: string;
  createdAt: number;
}

export interface CollabMemberInput {
  /** Client-generated participant id; a uuid is assigned when omitted. */
  id?: string;
  agentId: string;
  role?: string;
  responsibility?: string;
  capabilities?: string[];
}

export interface CreateSpaceOptions {
  cwd: string;
  /** Session slots to create (one ACP session each). */
  participants: CollabMemberInput[];
  /** Participant id designated as orchestrator (optional). */
  orchestratorId?: string;
}

/** Maximum length kept for a responsibility string (prompt-size guard). */
const RESPONSIBILITY_MAX_LEN = 200;

function clean(value: unknown): string | undefined {
  const trimmed = String(value ?? '').trim();
  return trimmed ? trimmed : undefined;
}

function cleanCapabilities(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const caps = [...new Set(value.map(item => String(item ?? '').trim()).filter(Boolean))];
  return caps.length > 0 ? caps : undefined;
}

/** Ordered participant ids of a space. */
export function memberIds(space: CollabSpace): string[] {
  return [...space.members.keys()];
}

/**
 * Process-local registry of collaboration spaces.
 *
 * A space owns one ACP session per participating session slot, all bound to a
 * shared working directory. Sessions are keyed by their participant id (not by
 * the agent implementation), so the same agent may appear in multiple slots.
 * Spaces are ephemeral: they live until the frontend closes them (or the
 * backend restarts) and are never persisted.
 */
export class CollabSpaceStore {
  private spaces: Map<string, CollabSpace> = new Map();

  constructor(
    private readonly sessionManager: AcpSessionManager,
    private readonly agentRegistry: AgentRegistry,
  ) {}

  async create(options: CreateSpaceOptions): Promise<CollabSpace> {
    const cwd = String(options.cwd ?? '').trim();
    if (!cwd) {
      throw new Error('cwd is required to create a collaboration space');
    }

    const inputs = Array.isArray(options.participants) ? options.participants : [];
    if (inputs.length === 0) {
      throw new Error('participants must contain at least one session');
    }

    // Build + validate members before touching any ACP session.
    const members = new Map<string, CollabMemberInfo>();
    for (const input of inputs) {
      const agentId = String(input?.agentId ?? '').trim();
      if (!agentId) {
        throw new Error('each participant requires an agentId');
      }
      if (!this.agentRegistry.getAgentConfig(agentId)) {
        throw new Error(`Unknown agent: ${agentId}`);
      }
      const participantId = String(input?.id ?? '').trim() || uuidv4();
      if (members.has(participantId)) {
        throw new Error(`Duplicate participant id: ${participantId}`);
      }
      const responsibility = clean(input?.responsibility);
      members.set(participantId, {
        id: participantId,
        agentId,
        role: clean(input?.role),
        responsibility: responsibility ? responsibility.slice(0, RESPONSIBILITY_MAX_LEN) : undefined,
        capabilities: cleanCapabilities(input?.capabilities),
      });
    }

    const orchestratorId = String(options.orchestratorId ?? '').trim() || undefined;
    if (orchestratorId && !members.has(orchestratorId)) {
      throw new Error('orchestratorId must be a participant of the collaboration space');
    }

    const space: CollabSpace = {
      id: uuidv4(),
      cwd,
      members,
      sessions: new Map(),
      configOptions: new Map(),
      orchestratorId,
      createdAt: Date.now(),
    };
    const created: string[] = [];

    try {
      for (const [participantId, info] of members) {
        const newSession = await this.sessionManager.createAcpSession(info.agentId, cwd);
        const acpSessionId = String(newSession?.sessionId ?? '');
        if (!acpSessionId) {
          throw new Error(`Agent ${info.agentId} returned no ACP session id`);
        }
        created.push(acpSessionId);
        space.sessions.set(participantId, acpSessionId);
        space.configOptions.set(
          participantId,
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
    const summary = [...members.values()]
      .map(info => (info.role ? `${info.id}:${info.agentId}(${info.role})` : `${info.id}:${info.agentId}`))
      .join(', ');
    logger.log(
      `[A2A Collab] Space created: ${space.id} (sessions: ${summary}` +
        `${orchestratorId ? `, orchestrator: ${orchestratorId}` : ''}, cwd: ${cwd})`,
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
