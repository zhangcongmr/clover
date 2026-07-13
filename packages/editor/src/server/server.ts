import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createServer as createHttpsServer } from 'node:https';
import { createServer as createHttpServer } from 'node:http';
import { existsSync } from 'node:fs';
import {
  TokenManager, FileService, PtyManager,
  setupAgentRoutes, setupA2ARoute, setupWebSocket,
  createCORSMiddleware, loadSslConfig,
} from '@luxio/agent';

declare const isProdBuild: boolean | undefined;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isCompiled = isProdBuild === true;
const rootDir = isCompiled ? resolve(__dirname, '..') : resolve(__dirname, '../..');
const distDir = isCompiled ? join(__dirname, 'dist') : join(rootDir, 'dist');
const isDev = !existsSync(join(distDir, 'index.html'));

const app = express();

// --- Agent services ---
const tokenSecret = process.env['EDITOR_TOKEN_SECRET'] || process.env['LUXIO_TOKEN_SECRET'];
const tokenManager = new TokenManager(tokenSecret, 30);
const fileService = new FileService(process.env['LUXIO_READONLY'] === 'true');

// --- CORS ---
app.use(createCORSMiddleware([5178, 5179, 5173, 4200, 4000]));

// --- Static files (production only) ---
if (!isDev) {
  app.use(
    express.static(distDir, {
      maxAge: '1y',
      index: false,
      redirect: false,
    }),
  );
}

// --- Development mode: Vite middleware ---
if (!isProdBuild && isDev) {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    root: rootDir,
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}

// --- Agent API routes ---
setupAgentRoutes(app, { fileService, tokenManager });

// --- A2A route ---
setupA2ARoute(app);

// --- SPA fallback (production) ---
if (!isDev) {
  app.use((_req, res) => {
    res.sendFile(join(distDir, 'index.html'));
  });
}

// --- Server start ---
const port = process.env['PORT'] || 5178;
const sslRoot = isCompiled ? __dirname : rootDir;
const sslConfig = loadSslConfig(join(sslRoot, 'ssl'));

const httpServer = sslConfig
  ? createHttpsServer(sslConfig, app)
  : createHttpServer(app);

httpServer.listen(port, () => {
  const protocol = sslConfig ? 'https' : 'http';
  const mode = isDev ? 'development' : 'production';
  console.log(`[Editor Server] ${mode} mode listening on ${protocol}://localhost:${port}`);
});

// --- WebSocket ---
const ptyManager = new PtyManager();
setupWebSocket(httpServer, { tokenManager, fileService, ptyManager }, sslConfig, {
  logPrefix: '[Editor Server]',
});
