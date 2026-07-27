import express from 'express';
import { createServer as createHttpsServer } from 'node:https';
import { createServer as createHttpServer } from 'node:http';
import { join } from 'node:path';
import { createCORSMiddleware } from './api/middleware.js';
import { loadSslConfig } from './helpers/index.js';
import { FileService } from './agent/file-service.js';
import { TokenManager } from './agent/auth.js';
import { PtyManager } from './agent/pty-manager.js';
import { setupAgentRoutes } from './api/routes.js';
import { setupA2ARoute } from './api/a2a.js';
import { setupWebSocket } from './ws/index.js';

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

export function createServer(config: ServerConfig): ServerInstance {
  const {
    port: portInput,
    portEnvKey = 'PORT',
    defaultPort = 4200,
    tokenSecret: tokenSecretInput,
    tokenSecretEnvKey = 'LUXIO_TOKEN_SECRET',
    corsPorts,
    corsOrigins = [],
    rootDir,
    sslDir: sslDirInput,
    logPrefix = '',
    app: existingApp,
    staticDir,
    staticOptions = { maxAge: '1y', index: false, redirect: false },
  } = config;

  const port = portInput ?? (Number(process.env[portEnvKey]) || defaultPort);
  const tokenSecret = tokenSecretInput ?? process.env[tokenSecretEnvKey];
  const sslDir = sslDirInput ?? (rootDir ? join(rootDir, 'ssl') : undefined);

  const app = existingApp || express();

  const tokenManager = new TokenManager(tokenSecret, 30);
  const fileService = new FileService(process.env['LUXIO_READONLY'] === 'true');
  const ptyManager = new PtyManager();

  app.use(createCORSMiddleware(corsPorts, corsOrigins));

  if (staticDir) {
    app.use(express.static(staticDir, staticOptions));
  }

  setupAgentRoutes(app, { fileService, tokenManager });
  setupA2ARoute(app);

  const sslConfig = sslDir ? loadSslConfig(sslDir) : null;

  const httpServer = sslConfig
    ? createHttpsServer(sslConfig, app)
    : createHttpServer(app);

  httpServer.listen(port, () => {
    const protocol = sslConfig ? 'https' : 'http';
    const prefix = logPrefix ? `${logPrefix} ` : '';
    console.log(`${prefix}Server listening on ${protocol}://localhost:${port}`);
  });

  setupWebSocket(httpServer, { tokenManager, fileService, ptyManager }, sslConfig, {
    logPrefix,
  });

  return { app, httpServer, tokenManager, fileService, ptyManager };
}
