import { logger } from './helpers/logger.js';
import express from 'express';
import type http from 'node:http';
import type https from 'node:https';
import { createServer as createHttpsServer } from 'node:https';
import { createServer as createHttpServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { createCORSMiddleware } from './api/middleware.js';
import { loadSslConfig } from './helpers/index.js';
import { FileService } from './agent/file-service.js';
import { TokenManager } from './agent/auth.js';
import { PtyManager } from './agent/pty-manager.js';
import { setupAgentRoutes } from './api/routes.js';
import { setupA2ARoute } from './api/a2a.js';
import { setupWebSocket } from './ws/index.js';
import { setupAcpRoutes } from './api/acp-routes.js';
import { setupA2aCollabRoutes } from './api/a2a-collab/routes.js';
import { createMcpRoutes } from './api/mcp-routes.js';
import { createSkillRoutes } from './api/skill-routes.js';
import { getSharedEventSink } from './events/in-process-event-sink.js';
import { SseManager } from './acp/sse-manager.js';
import { AcpSessionManager } from './acp/session-manager.js';
import { AgentRegistry } from './acp/agent-registry.js';
import { readAcpConfigFile } from './api/acp-routes.js';
import { McpServerRegistry } from './mcp/index.js';
import { SkillRegistry } from './skills/index.js';
import type { AgentConfig } from './acp/acp-agent.types.js';

export interface StaticOptions {
  maxAge?: string | number;
  index?: boolean;
  redirect?: boolean;
}

export interface ServerConfig {
  port?: number;
  portEnvKey?: string;
  defaultPort?: number;
  tokenSecret?: string;
  tokenSecretEnvKey?: string;
  corsPorts: number[];
  corsOrigins?: string[];
  rootDir?: string;
  sslDir?: string;
  logPrefix?: string;
  logUrlPath?: string;
  app?: express.Express;
  staticDir?: string;
  staticOptions?: StaticOptions;
}

export interface ServerInstance {
  app: express.Express;
  httpServer: ReturnType<typeof createHttpServer>;
  tokenManager: TokenManager;
  fileService: FileService;
  ptyManager: PtyManager;
  mcpRegistry: McpServerRegistry;
  skillRegistry: SkillRegistry;
  agentRegistry: AgentRegistry;
}

export interface AgentMiddlewareOptions {
  corsPorts: number[];
  corsOrigins?: string[];
  tokenSecret?: string;
  tokenSecretEnvKey?: string;
  staticDir?: string;
  staticOptions?: StaticOptions;
}

export function setupAgentMiddleware(
  app: express.Express,
  options: AgentMiddlewareOptions,
): { tokenManager: TokenManager; fileService: FileService; ptyManager: PtyManager; mcpRegistry: McpServerRegistry; skillRegistry: SkillRegistry; agentRegistry: AgentRegistry } {
  const {
    corsPorts,
    corsOrigins = [],
    tokenSecret,
    tokenSecretEnvKey = 'CLOVER_TOKEN_SECRET',
    staticDir,
    staticOptions = { maxAge: '1y', index: false, redirect: false },
  } = options;

  const secret = tokenSecret ?? process.env[tokenSecretEnvKey];
  const tokenManager = new TokenManager(secret, 30);
  const fileService = new FileService(process.env['CLOVER_READONLY'] === 'true');
  const ptyManager = new PtyManager();

  app.use(createCORSMiddleware(corsPorts, corsOrigins));

  if (staticDir) {
    app.use(express.static(staticDir, staticOptions));
  }

  setupAgentRoutes(app, { fileService, tokenManager });
  setupA2ARoute(app);

  // Setup MCP Registry and routes
  const mcpRegistry = new McpServerRegistry();

  // Setup ACP SSE routes
  // 事件面出口：进程级共享的进程内实现（单进程部署，无外部依赖）。
  const eventSink = getSharedEventSink();
  const sseManager = new SseManager(eventSink);
  // AgentRegistry 仅管理 ~/.clover/acp.json 中用户已安装的 agent（registry / disk 来源）。
  // AVAILABLE_AGENTS 是代码内置的 agent 识别模板，不写入 acp.json，也不参与此处合并。
  const persistedAgents = readAcpConfigFile().agents;
  const agentRegistry = new AgentRegistry(persistedAgents, eventSink);
  const sessionManager = new AcpSessionManager(agentRegistry, eventSink);
  setupAcpRoutes(app, { tokenManager, sessionManager, sseManager, fileService, mcpRegistry, registry: agentRegistry });

  // A2A collaboration routes (orchestrator + per-agent bridges + spaces)
  setupA2aCollabRoutes(app, { tokenManager, sessionManager, registry: agentRegistry });

  // MCP routes
  app.use('/api/mcp', createMcpRoutes(mcpRegistry));

  // Skills routes（HTTP catalog 由前端浏览器直连查询，后端不缓存）
  const skillRegistry = new SkillRegistry();
  app.use('/api/skills', createSkillRoutes(skillRegistry));

  return { tokenManager, fileService, ptyManager, mcpRegistry, skillRegistry, agentRegistry };
}

export function createServer(config: ServerConfig): ServerInstance {
  const {
    port: portInput,
    portEnvKey = 'PORT',
    defaultPort = 4200,
    rootDir,
    sslDir: sslDirInput,
    logPrefix = '',
    logUrlPath = '',
    app: existingApp,
    ...middlewareOptions
  } = config;

  const port = portInput ?? (Number(process.env[portEnvKey]) || defaultPort);
  const sslDir = sslDirInput ?? (rootDir ? join(rootDir, 'ssl') : undefined);
  const app = existingApp || express();

  const services = setupAgentMiddleware(app, middlewareOptions);

  // 启动阶段：异步并列预热全部 Agent 子进程并 initialize（不落 session 记录）
  // session、不订阅 Redis、不阻塞 server 启动）。session/create·load·
  // resume·prompt 仍会在 ensureConnected 中兜底 spawn+initialize。
  services.agentRegistry.warmupAll().catch((error) => {
    logger.error('[AgentRegistry] Warmup failed:', error);
  });

  const sslConfig = sslDir ? loadSslConfig(sslDir) : null;

  const httpServer = sslConfig
    ? createHttpsServer(sslConfig, app)
    : createHttpServer(app);

  httpServer.listen(port, () => {
    const protocol = sslConfig ? 'https' : 'http';
    const prefix = logPrefix ? `${logPrefix} ` : '';
    const addresses = listIpv4Addresses();
    const urls = [
      `${protocol}://localhost:${port}${logUrlPath}`,
      ...addresses.map((ip) => `${protocol}://${ip}:${port}${logUrlPath}`),
    ];
    logger.log(`${prefix}Server listening on:\n${urls.map((u) => `  ${u}`).join('\n')}`);
  });

  setupWebSocket(httpServer, services, sslConfig, { logPrefix });

  return { app, httpServer, ...services };
}

function listIpv4Addresses(): string[] {
  const addresses: string[] = [];
  for (const infos of Object.values(networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family === 'IPv4' && !info.internal) {
        addresses.push(info.address);
      }
    }
  }
  return [...new Set(addresses)];
}
