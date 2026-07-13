import express from 'express';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { v4 as uuidv4 } from 'uuid';
import { A2AClient } from '@a2a-js/sdk/client';
import type { MessageSendParams, Part, SendMessageSuccessResponse, Task } from '@a2a-js/sdk';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createHttpsServer } from 'node:https';
import { createServer as createHttpServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { TokenManager } from './agent/auth.ts';
import { FileService } from './agent/file-service.ts';
import { PtyManager } from './agent/pty-manager.ts';
import type { PtyInitMessage, FileWatchStartMessage, FileWatchStopMessage } from './agent/protocol.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadSslConfig() {
  const certPath = process.env['SSL_CERT_PATH'] || join(__dirname, '../../ssl/cert.pem');
  const keyPath = process.env['SSL_KEY_PATH'] || join(__dirname, '../../ssl/key.pem');

  if (existsSync(certPath) && existsSync(keyPath)) {
    return {
      cert: readFileSync(certPath),
      key: readFileSync(keyPath),
    };
  }
  return null;
}

const rootDir = resolve(__dirname, '../..');
const distDir = join(rootDir, 'dist');
const isDev = !existsSync(join(distDir, 'index.html'));

const app = express();
let client: A2AClient | null = null;
const enableStreaming = process.env['ENABLE_STREAMING'] !== 'false';

// --- Agent services ---
const tokenSecret = process.env['EDITOR_TOKEN_SECRET'] || process.env['LUXIO_TOKEN_SECRET'];
const tokenManager = new TokenManager(tokenSecret, 30);
const fileService = new FileService(process.env['LUXIO_READONLY'] === 'true');
const ptyManager = new PtyManager();

// CORS fixed whitelist
const editorPorts = [5178, 5179, 5173, 4200, 4000];
const allowedOrigins = editorPorts.flatMap(p => [
  `http://localhost:${p}`,
  `https://localhost:${p}`,
  `http://127.0.0.1:${p}`,
  `https://127.0.0.1:${p}`,
]);

// CORS middleware
app.use((req, res, next) => {
  const origin = req.headers.origin || '';
  if (!origin || allowedOrigins.some(o => origin.startsWith(o))) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  next();
});

// Parse JSON for API routes
app.use('/api/local', express.json());

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
if (isDev) {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    root: rootDir,
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}

// --- Local Agent API Routes ---

// Token endpoint
app.get('/api/local/auth/token', (_req, res) => {
  const { token, expiresAt } = tokenManager.generate();
  res.json({ token, expiresIn: Math.floor((expiresAt - Date.now()) / 1000) });
});

// Health check
app.get('/api/local/health', (_req, res) => {
  res.json({ status: 'ok', readonly: process.env['LUXIO_READONLY'] === 'true' });
});

// Auth middleware for file operations
function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token || !tokenManager.verify(token)) {
    res.status(401).json({ success: false, message: 'Unauthorized' });
    return;
  }
  next();
}

// File operation endpoints
app.post('/api/local/scan', requireAuth, async (req, res) => {
  const { path: dirPath, depth, ignore } = req.body;
  if (!dirPath) {
    res.status(400).json({ success: false, message: 'path is required' });
    return;
  }
  const result = await fileService.handle({ type: 'file-request', action: 'scan', path: dirPath, ...req.body, depth, ignore } as any);
  res.json(result);
});

app.post('/api/local/listDir', requireAuth, async (req, res) => {
  const { path: dirPath } = req.body;
  if (!dirPath) {
    res.status(400).json({ success: false, message: 'path is required' });
    return;
  }
  const result = await fileService.handle({ type: 'file-request', action: 'listDir', path: dirPath });
  res.json(result);
});

app.post('/api/local/readFile', requireAuth, async (req, res) => {
  const { path: filePath } = req.body;
  if (!filePath) {
    res.status(400).json({ success: false, message: 'path is required' });
    return;
  }
  const result = await fileService.handle({ type: 'file-request', action: 'readFile', path: filePath });
  res.json(result);
});

app.post('/api/local/writeFile', requireAuth, async (req, res) => {
  const { path: filePath, content } = req.body;
  if (!filePath) {
    res.status(400).json({ success: false, message: 'path is required' });
    return;
  }
  const result = await fileService.handle({ type: 'file-request', action: 'writeFile', path: filePath, content });
  res.json(result);
});

app.post('/api/local/deleteFile', requireAuth, async (req, res) => {
  const { path: filePath } = req.body;
  if (!filePath) {
    res.status(400).json({ success: false, message: 'path is required' });
    return;
  }
  const result = await fileService.handle({ type: 'file-request', action: 'deleteFile', path: filePath });
  res.json(result);
});

app.post('/api/local/createFile', requireAuth, async (req, res) => {
  const { path: filePath } = req.body;
  if (!filePath) {
    res.status(400).json({ success: false, message: 'path is required' });
    return;
  }
  const result = await fileService.handle({ type: 'file-request', action: 'createFile', path: filePath });
  res.json(result);
});

app.post('/api/local/createDir', requireAuth, async (req, res) => {
  const { path: dirPath } = req.body;
  if (!dirPath) {
    res.status(400).json({ success: false, message: 'path is required' });
    return;
  }
  const result = await fileService.handle({ type: 'file-request', action: 'createDir', path: dirPath });
  res.json(result);
});

app.post('/api/local/rename', requireAuth, async (req, res) => {
  const { path: oldPath, newName } = req.body;
  if (!oldPath || !newName) {
    res.status(400).json({ success: false, message: 'path and newName are required' });
    return;
  }
  const result = await fileService.handle({ type: 'file-request', action: 'rename', path: oldPath, newName });
  res.json(result);
});

app.post('/api/local/stat', requireAuth, async (req, res) => {
  const { path: filePath } = req.body;
  if (!filePath) {
    res.status(400).json({ success: false, message: 'path is required' });
    return;
  }
  const result = await fileService.handle({ type: 'file-request', action: 'stat', path: filePath });
  res.json(result);
});

app.post('/api/local/exists', requireAuth, async (req, res) => {
  const { path: filePath } = req.body;
  if (!filePath) {
    res.status(400).json({ success: false, message: 'path is required' });
    return;
  }
  const result = await fileService.handle({ type: 'file-request', action: 'exists', path: filePath });
  res.json(result);
});

app.post('/api/local/openInFileExplorer', requireAuth, async (req, res) => {
  const { path: filePath } = req.body;
  if (!filePath) {
    res.status(400).json({ success: false, message: 'path is required' });
    return;
  }
  const result = await fileService.handle({ type: 'file-request', action: 'openInFileExplorer', path: filePath });
  res.json(result);
});

// --- A2A Routes ---

app.post('/a2a', (req, res) => {
  let originalBody = '';

  req.on('data', chunk => {
    originalBody += chunk.toString();
  });

  req.on('end', async () => {
    let sendParams: MessageSendParams;

    if (isJson(originalBody)) {
      const requestData = JSON.parse(originalBody);
      const contextId = requestData.contextId;

      if (requestData.event) {
        console.log('[a2a-middleware] Received JSON UI event:', requestData.event);
        sendParams = {
          message: {
            messageId: uuidv4(),
            contextId,
            role: 'user',
            parts: [
              {
                kind: 'data',
                data: requestData.event,
                metadata: {mimeType: 'application/a2ui+json'},
              } as Part,
            ],
            kind: 'message',
          },
        };
      } else if (requestData.query) {
        console.log('[a2a-middleware] Received text query:', requestData.query);
        sendParams = {
          message: {
            messageId: uuidv4(),
            contextId,
            role: 'user',
            parts: [{kind: 'text', text: requestData.query}],
            kind: 'message',
          },
        };
      } else {
        console.log('[a2a-middleware] Received legacy JSON event:', originalBody);
        sendParams = {
          message: {
            messageId: uuidv4(),
            contextId,
            role: 'user',
            parts: [
              {
                kind: 'data',
                data: requestData,
                metadata: {mimeType: 'application/a2ui+json'},
              } as Part,
            ],
            kind: 'message',
          },
        };
      }
    } else {
      console.log('[a2a-middleware] Received plain text query:', originalBody);
      sendParams = {
        message: {
          messageId: uuidv4(),
          role: 'user',
          parts: [{kind: 'text', text: originalBody}],
          kind: 'message',
        },
      };
    }

    try {
      const client = await createOrGetClient();
      if (enableStreaming) {
        await handleStreamingResponse(client, sendParams, res);
      } else {
        await handleNonStreamingResponse(client, sendParams, res);
      }
    } catch (error: any) {
      console.error('Request error:', error.message);
      if (!res.headersSent) {
        res.status(500).json({error: error.message});
      } else if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({error: error.message})}\n\n`);
        res.end();
      }
    }
  });
});

async function handleStreamingResponse(
  client: A2AClient,
  sendParams: MessageSendParams,
  res: express.Response,
) {
  process.stdout.write('[server] Streaming mode enabled\n');
  const stream = client.sendMessageStream(sendParams);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.status(200);

  for await (const event of stream) {
    console.log(`[server] Received event from agent: ${event.kind}`);
    let parts: Part[] = [];
    if (event.kind === 'task' || event.kind === 'status-update') {
      parts = event.status.message?.parts || [];
    } else if (event.kind === 'artifact-update') {
      parts = event.artifact.parts || [];
    }

    if (parts.length > 0) {
      console.log(`[server] Streaming ${parts.length} parts to client`);
      console.log(`[server] Streaming parts: ${JSON.stringify(parts)}`);
      const responseData = {
        parts,
        contextId: (event as any).contextId || (event as any).status?.message?.contextId,
      };
      res.write(`data: ${JSON.stringify(responseData)}\n\n`);
    }
  }
  res.end();
  console.log('[server] Stream finished');
}

async function handleNonStreamingResponse(
  client: A2AClient,
  sendParams: MessageSendParams,
  res: express.Response,
) {
  process.stdout.write('[server] Streaming mode disabled\n');
  const response = await client.sendMessage(sendParams);
  res.set('Cache-Control', 'no-store');

  if ('error' in response) {
    console.error('Error:', response.error.message);
    res.status(500).json({error: response.error.message});
    return;
  }

  const result = (response as SendMessageSuccessResponse).result as Task;
  res.json({
    parts: result.kind === 'task' ? result.status.message?.parts || [] : [],
    contextId: result.contextId,
  });
}

/**
 * Handle all other requests: serve index.html for SPA routing
 * (Vite middleware in dev already handles this, so this is for production)
 */
if (!isDev) {
  app.use((_req, res) => {
    res.sendFile(join(distDir, 'index.html'));
  });
}

/**
 * Start the server if this module is the main entry point.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 5178.
 * Supports HTTPS via SSL_CERT_PATH and SSL_KEY_PATH environment variables,
 * falling back to HTTP if certificates are not found.
 */
const port = process.env['PORT'] || 5178;
const sslConfig = loadSslConfig();

const httpServer = sslConfig
  ? createHttpsServer(sslConfig, app)
  : createHttpServer(app);

httpServer.listen(port, () => {
  const protocol = sslConfig ? 'https' : 'http';
  const mode = isDev ? 'development' : 'production';
  console.log(`[Editor Server] ${mode} mode listening on ${protocol}://localhost:${port}`);
});

// --- WebSocket PTY ---
const wss = new WebSocketServer({ noServer: true });

httpServer.on('upgrade', (req, socket, head) => {
  const protocol = sslConfig ? 'https' : 'http';
  const url = new URL(req.url || '/', `${protocol}://${req.headers.host}`);

  if (url.pathname === '/ws/terminal' || url.pathname === '/ws/file-watch') {
    const token = url.searchParams.get('token');
    if (!token || !tokenManager.verify(token)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', (ws, req) => {
  const protocol = sslConfig ? 'https' : 'http';
  const url = new URL(req.url || '/', `${protocol}://${req.headers.host}`);
  const isFileWatch = url.pathname === '/ws/file-watch';

  if (isFileWatch) {
    const watchedFiles = new Set<string>();
    console.log('[Editor Server] File-watch WebSocket connected');

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'file-watch-start') {
          const startMsg = msg as FileWatchStartMessage;
          fileService.startWatching(startMsg.path, (eventType) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                type: 'file-watch-event',
                path: startMsg.path,
                eventType,
                requestId: startMsg.requestId
              }));
            }
          });
          watchedFiles.add(startMsg.path);
        } else if (msg.type === 'file-watch-stop') {
          const stopMsg = msg as FileWatchStopMessage;
          fileService.stopWatching(stopMsg.path);
          watchedFiles.delete(stopMsg.path);
        }
      } catch (e) {
        console.error('Failed to handle file-watch message:', e);
      }
    });

    ws.on('close', () => {
      watchedFiles.forEach(path => fileService.stopWatching(path));
      watchedFiles.clear();
    });

    ws.on('error', () => {
      watchedFiles.forEach(path => fileService.stopWatching(path));
      watchedFiles.clear();
    });

    return;
  }

  // --- PTY handling ---
  let ptyId: string | null = null;

  ws.on('message', (data) => {
    const msg = data.toString();

    if (!ptyId) {
      // First message: init PTY
      try {
        const init: PtyInitMessage = JSON.parse(msg);
        if (init.type === 'pty') {
          const instance = ptyManager.create(init.cols, init.rows, init.cwd || process.cwd());
          ptyId = instance.id;

          instance.pty.onData((output) => {
            if (ws.readyState === WebSocket.OPEN) ws.send(output);
          });
          instance.pty.onExit(() => {
            if (ws.readyState === WebSocket.OPEN) ws.close(1000, 'PTY exited');
          });
        }
      } catch (e) {
        console.error('Failed to create PTY:', e);
        ws.close(4002, 'Invalid init message');
      }
      return;
    }

    // Subsequent messages: PTY input or resize
    const instance = ptyManager.getById(ptyId);
    if (!instance) { ws.close(1000, 'PTY not found'); return; }

    try {
      const resizeMsg = JSON.parse(msg);
      if (resizeMsg.type === 'resize') {
        instance.pty.resize(resizeMsg.cols, resizeMsg.rows);
        return;
      }
    } catch (e) { /* not JSON, treat as PTY input */ }

    instance.pty.write(msg);
  });

  ws.on('close', () => { if (ptyId) ptyManager.destroy(ptyId); });
  ws.on('error', () => { if (ptyId) ptyManager.destroy(ptyId); });
});

async function fetchWithCustomHeader(url: string | URL | Request, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set('X-A2A-Extensions', 'https://a2ui.org/a2a-extension/a2ui/v0.9');
  const newInit = {...init, headers};
  return fetch(url, newInit);
}

async function createOrGetClient() {
  client ??= await A2AClient.fromCardUrl('http://localhost:10002/.well-known/agent-card.json', {
    fetchImpl: fetchWithCustomHeader,
  });
  return client;
}

function isJson(str: string): boolean {
  try {
    const parsed = JSON.parse(str);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
  } catch (err) {
    console.warn(err);
    return false;
  }
}
