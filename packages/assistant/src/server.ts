import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { join } from 'node:path';
import { createServer, setupServerMiddleware } from '@julyware/clover-server';

const rootDir = join(import.meta.dirname, '..');
const browserDistFolder = join(rootDir, 'browser');

const app = express();
const angularApp = new AngularNodeAppEngine({
  allowedHosts: ['localhost', '192.168.153.129', '127.0.0.1', '192.168.163.1', '192.168.153.146'],
});

// Angular SSR handler — skip API routes so agent routes can handle them
app.use((req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/ws')) {
    next();
    return;
  }
  angularApp
    .handle(req)
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next(),
    )
    .catch(next);
});

if (isMainModule(import.meta.url) || process.env['pm_id']) {
  createServer({
    // 放行任意来源的跨域读取：内网多机调试时前端可能来自任意 host/端口。
    // 注意这同时放开了携带凭证的请求，且 /api/local/auth/token 本身不需要
    // 鉴权 —— 仅适用于受信任网络，勿将本服务暴露到公网。
    corsAllowAnyOrigin: true,
    rootDir,
    staticDir: browserDistFolder,
    app,
  });
} else {
  // Angular's build-time prerender imports this module but never issues HTTP
  // requests, so agent warmup must not run at import time. Warm the agents
  // lazily on the first API/WebSocket request instead, once the dev/preview
  // server is actually serving traffic. This keeps `ng build` from spawning
  // ACP subprocesses (and from inheriting their processes/memory pressure).
  let services: ReturnType<typeof setupServerMiddleware> | null = null;
  let warmupRequested = false;

  app.use((req, _res, next) => {
    if (
      !warmupRequested &&
      services &&
      (req.path.startsWith('/api/') || req.path.startsWith('/ws'))
    ) {
      warmupRequested = true;
      services.agentRegistry.warmupAll().catch((error) => {
        console.error('[AgentRegistry] Warmup failed:', error);
      });
    }
    next();
  });

  services = setupServerMiddleware(app, {
    corsAllowAnyOrigin: true,
    staticDir: browserDistFolder,
  });
  // Note: In dev mode, ACP WebSocket setup requires httpServer access.
  // The config endpoint (POST /api/local/acp/config) will work,
  // but WebSocket /ws/acp won't be available until setAcpHttpServer is called.
}

export const reqHandler = createNodeRequestHandler(app);
