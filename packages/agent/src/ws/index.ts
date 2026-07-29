import type http from 'node:http';
import type https from 'node:https';
import { WebSocketServer, WebSocket } from 'ws';
import { TokenManager } from '../agent/auth.js';
import { FileService } from '../agent/file-service.js';
import { PtyManager } from '../agent/pty-manager.js';
import type { PtyInitMessage, FileWatchStartMessage, FileWatchStopMessage } from '../agent/protocol.js';

export interface WebSocketServices {
  tokenManager: TokenManager;
  fileService: FileService;
  ptyManager: PtyManager;
}

export interface WebSocketOptions {
  logPrefix?: string;
}

export function setupWebSocket(
  httpServer: http.Server | https.Server,
  services: WebSocketServices,
  sslConfig?: { cert: Buffer; key: Buffer } | null,
  options: WebSocketOptions = {},
): void {
  const { tokenManager, fileService, ptyManager } = services;
  const logPrefix = options.logPrefix || '[Agent]';
  const protocol = sslConfig ? 'https' : 'http';

  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
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
    }
    // Do NOT destroy other paths — let other upgrade handlers (e.g. /ws/acp) handle them
  });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url || '/', `${protocol}://${req.headers.host}`);
    const isFileWatch = url.pathname === '/ws/file-watch';

    if (isFileWatch) {
      const watchedFiles = new Set<string>();
      console.log(`${logPrefix} File-watch WebSocket connected`);

    ws.on('message', async (data) => {
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

    ws.on('message', async (data) => {
      const msg = data.toString();

      if (!ptyId) {
        // First message: init PTY
        try {
          const init: PtyInitMessage = JSON.parse(msg);
          if (init.type === 'pty') {
            const instance = await ptyManager.create(init.cols, init.rows, init.cwd || process.cwd());
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
}
