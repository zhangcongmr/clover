import express from 'express';
import type { Express, NextFunction, Request, Response } from 'express';
import { createRequireAuth } from '../middleware.js';
import type { TokenManager } from '../../agent/auth.js';
import type { AcpSessionManager } from '../../acp/session-manager.js';
import { AVAILABLE_AGENTS } from '../../acp/acp-agent.types.js';
import { buildCollabAgentCard } from './agent-card.js';
import { CollabSpaceStore } from './spaces.js';
import { BridgeRunner } from './bridge-runner.js';
import { BridgeExecutor, OrchestratorExecutor } from './executors.js';
import { createA2aBundle, type A2aBundle } from './bundles.js';

export interface A2aCollabRouteOptions {
  tokenManager: TokenManager;
  sessionManager: AcpSessionManager;
}

function fallbackBaseUrl(): string {
  const override = process.env.A2A_BASE_URL;
  if (override && override.trim()) return override.trim().replace(/\/+$/, '');
  return `http://localhost:${process.env.PORT || 4200}`;
}

function baseUrlOf(req: Request): string {
  const override = process.env.A2A_BASE_URL;
  if (override && override.trim()) return override.trim().replace(/\/+$/, '');
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http');
  const host = String(req.headers.host || `localhost:${process.env.PORT || 4200}`);
  return `${proto}://${host}`;
}

function agentSkill(agentId: string, name: string, description: string) {
  return {
    id: agentId,
    name,
    description,
    tags: ['coding', 'collab', agentId],
    examples: [],
    inputModes: ['text'],
    outputModes: ['text', 'task-status'],
    securityRequirements: [],
  };
}

/**
 * A2A collaboration surface:
 *
 *  - `POST   /api/a2a/collab/spaces`         create a space (one ACP wrapper session per agent)
 *  - `DELETE /api/a2a/collab/spaces/:spaceId` close a space and release its sessions
 *  - `GET    /api/a2a/orchestrator/...`       orchestrator agent card + JSON-RPC endpoint
 *  - `GET    /api/a2a/agents/:agentId/...`    per-agent agent card + JSON-RPC endpoint
 *
 * All routes require a bearer (or `?token=`) auth token.
 */
export function setupA2aCollabRoutes(app: Express, options: A2aCollabRouteOptions): void {
  const { tokenManager, sessionManager } = options;
  const requireAuth = createRequireAuth(tokenManager);

  const spaces = new CollabSpaceStore(sessionManager);
  const timeoutMs = Number(process.env.A2A_BRIDGE_TIMEOUT_MS) || 10 * 60 * 1000;
  const routeTimeoutMs = Number(process.env.A2A_ROUTE_TIMEOUT_MS) || 30 * 1000;
  const runner = new BridgeRunner(sessionManager, spaces, timeoutMs, routeTimeoutMs);

  app.use('/api/a2a', requireAuth);

  // ==========================================================================
  // Collaboration spaces
  // ==========================================================================

  app.post('/api/a2a/collab/spaces', express.json(), async (req: Request, res: Response) => {
    try {
      const cwd = typeof req.body?.cwd === 'string' ? req.body.cwd : '';
      const agentIds = Array.isArray(req.body?.agentIds) ? req.body.agentIds : [];
      const orchestratorAgentId =
        typeof req.body?.orchestratorAgentId === 'string' ? req.body.orchestratorAgentId : undefined;
      const space = await spaces.create({ cwd, agentIds, orchestratorAgentId });
      res.json({
        success: true,
        spaceId: space.id,
        cwd: space.cwd,
        orchestratorAgentId: space.orchestratorAgentId ?? null,
        agents: space.agentIds.map(agentId => ({
          agentId,
          sessionId: space.wrappers.get(agentId)!,
          configOptions: space.configOptions.get(agentId) ?? [],
        })),
      });
    } catch (error) {
      console.error('[A2A Collab] Create space error:', error);
      res.status(400).json({ success: false, message: (error as Error).message });
    }
  });

  app.delete('/api/a2a/collab/spaces/:spaceId', async (req: Request, res: Response) => {
    try {
      const removed = await spaces.remove(String(req.params.spaceId));
      if (!removed) {
        res.status(404).json({ success: false, message: 'Collaboration space not found' });
        return;
      }
      res.json({ success: true });
    } catch (error) {
      console.error('[A2A Collab] Remove space error:', error);
      res.status(500).json({ success: false, message: (error as Error).message });
    }
  });

  // ==========================================================================
  // Orchestrator A2A server
  // ==========================================================================

  const orchestratorBundle = createA2aBundle({
    initialBaseUrl: fallbackBaseUrl(),
    buildCard: baseUrl =>
      buildCollabAgentCard({
        name: 'Collaboration Orchestrator',
        description:
          'Routes each collaboration prompt to a target coding agent inside a ' +
          'shared workspace and streams the agent reply back as a task artifact.',
        dialUrl: `${baseUrl}/api/a2a/orchestrator/`,
        skill: {
          id: 'multi_agent_collab',
          name: 'Multi-Agent Collaboration',
          description:
            'Dispatch a prompt to one of the agents of the current collaboration ' +
            'space (explicit target or keyword routing) and stream its reply.',
          tags: ['collab', 'orchestrator', 'multi-agent'],
          examples: ['让 opencode 分析这个项目', '帮我审查这段代码'],
          inputModes: ['text'],
          outputModes: ['text', 'task-status'],
          securityRequirements: [],
        },
      }),
    executor: new OrchestratorExecutor(runner),
  });

  // ==========================================================================
  // Per-agent A2A servers (lazy bundles)
  // ==========================================================================

  const agentBundles = new Map<string, A2aBundle>();

  function getAgentBundle(agentId: string, baseUrl: string): A2aBundle {
    const config = AVAILABLE_AGENTS.find(agent => agent.id === agentId);
    if (!config) {
      throw new Error(`Unknown agent: ${agentId}`);
    }
    let bundle = agentBundles.get(agentId);
    if (!bundle) {
      bundle = createA2aBundle({
        initialBaseUrl: baseUrl,
        buildCard: cardBaseUrl =>
          buildCollabAgentCard({
            name: config.name,
            description: config.description ?? `${config.name} coding agent bridge`,
            dialUrl: `${cardBaseUrl}/api/a2a/agents/${encodeURIComponent(agentId)}/`,
            skill: agentSkill(agentId, config.name, config.description ?? `${config.name} coding agent`),
          }),
        executor: new BridgeExecutor(agentId, runner),
      });
      agentBundles.set(agentId, bundle);
    }
    bundle.setBaseUrl(baseUrl);
    return bundle;
  }

  // ==========================================================================
  // Mounting (card path first, then the JSON-RPC dial path)
  // ==========================================================================

  const mountBundle = (
    basePath: string,
    resolve: (req: Request) => A2aBundle,
  ): void => {
    app.use(`${basePath}/.well-known/agent-card.json`, (req: Request, res: Response, next: NextFunction) => {
      let bundle: A2aBundle;
      try {
        bundle = resolve(req);
      } catch (error) {
        res.status(404).json({ success: false, message: (error as Error).message });
        return;
      }
      bundle.cardRouter(req, res, next);
    });

    app.use(basePath, (req: Request, res: Response, next: NextFunction) => {
      if (req.method !== 'POST') {
        next();
        return;
      }
      let bundle: A2aBundle;
      try {
        bundle = resolve(req);
      } catch (error) {
        res.status(404).json({ success: false, message: (error as Error).message });
        return;
      }
      bundle.rpcRouter(req, res, next);
    });
  };

  mountBundle('/api/a2a/orchestrator', req => {
    orchestratorBundle.setBaseUrl(baseUrlOf(req));
    return orchestratorBundle;
  });

  mountBundle('/api/a2a/agents/:agentId', req =>
    getAgentBundle(String(req.params.agentId), baseUrlOf(req)),
  );
}
