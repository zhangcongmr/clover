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
import { RedisClient } from './redis/client.js';
import { SseManager } from './acp/sse-manager.js';
import { AcpSessionManager } from './acp/session-manager.js';

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
): { tokenManager: TokenManager; fileService: FileService; ptyManager: PtyManager } {
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

  // Setup ACP SSE routes
  const redis = RedisClient.getInstance();
  const sseManager = new SseManager(redis);
  const sessionManager = new AcpSessionManager(redis);
  setupAcpRoutes(app, { tokenManager, sessionManager, sseManager, redis, fileService });

  return { tokenManager, fileService, ptyManager };
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
    console.log(`${prefix}Server listening on:\n${urls.map((u) => `  ${u}`).join('\n')}`);
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
