import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { join } from 'node:path';
import { createServer as createHttpsServer } from 'node:https';
import { createServer as createHttpServer } from 'node:http';
import {
  TokenManager, FileService, PtyManager,
  setupAgentRoutes, setupA2ARoute, setupWebSocket,
  createCORSMiddleware, loadSslConfig,
} from '@luxio/agent';

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine({
  allowedHosts: ['localhost', '192.168.153.129', '127.0.0.1', '192.168.253.110'],
});

// --- Agent services ---
const tokenManager = new TokenManager(process.env['LUXIO_TOKEN_SECRET'], 30);
const fileService = new FileService(process.env['LUXIO_READONLY'] === 'true');
const ptyManager = new PtyManager();

// CORS
app.use(createCORSMiddleware([4200, 4000], ['192.168.153.129']));

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

// --- Agent API routes ---
setupAgentRoutes(app, { fileService, tokenManager });

// --- A2A route ---
setupA2ARoute(app);

/**
 * Handle all other requests by rendering the Angular application.
 */
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next(),
    )
    .catch(next);
});

/**
 * Start the server if this module is the main entry point, or it is ran via PM2.
 */
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 4200;
  const sslConfig = loadSslConfig(join(import.meta.dirname, '../ssl'));

  const httpServer = sslConfig
    ? createHttpsServer(sslConfig, app)
    : createHttpServer(app);

  httpServer.listen(port, () => {
    const protocol = sslConfig ? 'https' : 'http';
    console.log(`Node Express server listening on ${protocol}://localhost:${port}`);
  });

  // --- WebSocket ---
  setupWebSocket(httpServer, { tokenManager, fileService, ptyManager }, sslConfig);
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);
