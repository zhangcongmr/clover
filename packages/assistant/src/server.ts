import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { join } from 'node:path';
import { createServer, setupAgentMiddleware } from '@luxio/agent';

const rootDir = join(import.meta.dirname, '..');
const browserDistFolder = join(rootDir, 'browser');

const app = express();
const angularApp = new AngularNodeAppEngine({
  allowedHosts: ['localhost', '192.168.153.129', '127.0.0.1', '192.168.253.110'],
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
    corsPorts: [4200, 4000],
    corsOrigins: ['192.168.153.129'],
    rootDir,
    staticDir: browserDistFolder,
    app,
  });
} else {
  setupAgentMiddleware(app, {
    corsPorts: [4200, 4000],
    corsOrigins: ['192.168.153.129'],
    staticDir: browserDistFolder,
  });
  // Note: In dev mode, ACP WebSocket setup requires httpServer access.
  // The config endpoint (POST /api/local/acp/config) will work,
  // but WebSocket /ws/acp won't be available until setAcpHttpServer is called.
}

export const reqHandler = createNodeRequestHandler(app);
