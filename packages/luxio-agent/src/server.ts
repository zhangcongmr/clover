import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { isAbsolute, join } from 'node:path';
import { existsSync } from 'node:fs';
import type { Server } from 'node:http';
import { TokenManager } from './auth.js';
import { FileService } from './file-service.js';
import { PtyManager } from './pty-manager.js';
import type {
  AgentConfig,
  AgentMessage,
  PtyInitMessage,
  PtyResizeMessage,
  LocalFileRequest,
  TokenResponse
} from './protocol.js';

const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:4200',
  'http://localhost:4000',
  'http://127.0.0.1:4200',
  'http://127.0.0.1:4000'
];

export class AgentServer {
  private server: Server;
  private wss: WebSocketServer;
  private tokenManager: TokenManager;
  private fileService: FileService;
  private ptyManager: PtyManager;
  private config: AgentConfig;

  constructor(config: AgentConfig) {
    this.config = config;
    this.tokenManager = new TokenManager(config.tokenSecret, config.tokenTTL || 30);
    this.fileService = new FileService(config.workspacePath, config.readonly);
    this.ptyManager = new PtyManager();

    this.server = createServer((req, res) => this.handleHttpRequest(req, res));
    this.wss = new WebSocketServer({ noServer: true });

    this.server.on('upgrade', (req, socket, head) => {
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.wss.emit('connection', ws, req);
      });
    });

    this.wss.on('connection', (ws, req) => {
      this.handleWsConnection(ws, req);
    });
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.config.port, this.config.host, () => {
        console.log(`[luxio-agent] Listening on ${this.config.host}:${this.config.port}`);
        console.log(`[luxio-agent] Workspace: ${this.config.workspacePath}`);
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      // 关闭所有 PTY
      for (const instance of this.ptyManager.getAll()) {
        this.ptyManager.destroy(instance.id);
      }
      this.wss.close();
      // 超时强制退出，防止 close 回调不触发导致卡住
      const timer = setTimeout(() => resolve(), 2000);
      this.server.close(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private handleHttpRequest(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const origin = req.headers.origin || '';
    const allowed = this.config.allowedOrigins || DEFAULT_ALLOWED_ORIGINS;
    const corsOrigin = origin && allowed.some(o => origin.startsWith(o)) ? origin : allowed[0];

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', corsOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    // Handle preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (url.pathname === '/token' && req.method === 'GET') {
      this.handleTokenRequest(req, res);
      return;
    }

    if (url.pathname === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', workspace: this.config.workspacePath }));
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  }

  private handleTokenRequest(req: IncomingMessage, res: ServerResponse) {
    // Origin 校验
    const origin = req.headers.origin || '';
    const allowed = this.config.allowedOrigins || DEFAULT_ALLOWED_ORIGINS;
    if (origin && !allowed.some(o => origin.startsWith(o))) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Origin not allowed' }));
      return;
    }

    const { token, expiresAt } = this.tokenManager.generate();
    const response: TokenResponse = {
      token,
      expiresIn: Math.round((expiresAt - Date.now()) / 1000)
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
  }

  private handleWsConnection(ws: WebSocket, req: IncomingMessage) {
    // 解析 token
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const token = url.searchParams.get('token');

    if (!token || !this.tokenManager.verify(token)) {
      ws.close(4001, 'Invalid or missing token');
      return;
    }

    // Origin 校验
    const origin = req.headers.origin || '';
    const allowed = this.config.allowedOrigins || DEFAULT_ALLOWED_ORIGINS;
    if (origin && !allowed.some(o => origin.startsWith(o))) {
      ws.close(4003, 'Origin not allowed');
      return;
    }

    let connectionType: 'file-service' | 'pty' | null = null;
    let ptyId: string | null = null;

    ws.on('message', async (data: RawData) => {
      const messageStr = data.toString();

      // 第一条消息决定连接类型
      if (!connectionType) {
        try {
          const msg = JSON.parse(messageStr) as AgentMessage;

          if (msg.type === 'file-service') {
            connectionType = 'file-service';
            ws.send(JSON.stringify({ type: 'file-service', success: true, message: 'Connected' }));
            return;
          }

          if (msg.type === 'pty') {
            connectionType = 'pty';
            const ptyMsg = msg as PtyInitMessage;
            // cwd 解析：优先绝对路径，其次拼接 workspace，最后尝试直接使用（兼容各种场景）
            let cwd: string;
            if (ptyMsg.cwd && isAbsolute(ptyMsg.cwd)) {
              cwd = ptyMsg.cwd;
            } else if (ptyMsg.cwd && existsSync(join(this.config.workspacePath, ptyMsg.cwd))) {
              cwd = join(this.config.workspacePath, ptyMsg.cwd);
            } else if (ptyMsg.cwd && existsSync(ptyMsg.cwd)) {
              cwd = ptyMsg.cwd;
            } else {
              cwd = this.config.workspacePath;
            }
            console.log('[PTY] Creating with cwd:', cwd);
            const instance = this.ptyManager.create(ptyMsg.cols, ptyMsg.rows, cwd);
            ptyId = instance.id;

            // PTY 输出 → WS
            instance.pty.onData((output: string) => {
              console.log('[PTY] Output:', JSON.stringify(output.substring(0, 50)));
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(output);
              }
            });

            instance.pty.onExit(() => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.close(1000, 'PTY exited');
              }
            });

            // 不发送 pty-ready 消息，直接让 PTY 输出到终端
            return;
          }

          ws.close(4002, 'First message must be file-service or pty');
          return;
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error('[Server] Invalid init message:', msg);
          ws.close(4002, 'Invalid init message');
          return;
        }
      }

      // 后续消息处理
      if (connectionType === 'file-service') {
        try {
          const request: LocalFileRequest = JSON.parse(messageStr);
          const response = await this.fileService.handle(request);
          ws.send(JSON.stringify(response));
        } catch (err: any) {
          ws.send(JSON.stringify({
            type: 'file-service',
            success: false,
            message: err.message
          }));
        }
        return;
      }

      if (connectionType === 'pty' && ptyId) {
        const instance = this.ptyManager.getById(ptyId);
        if (!instance) {
          ws.close(1000, 'PTY not found');
          return;
        }

        // 尝试解析为 resize 消息
        try {
          const msg = JSON.parse(messageStr) as PtyResizeMessage;
          if (msg.type === 'resize') {
            instance.pty.resize(msg.cols, msg.rows);
            return;
          }
        } catch (e: unknown) {
          if (!(e instanceof SyntaxError)) {
            console.error('[PTY] Unexpected error parsing message:', e);
          }
          // SyntaxError → 不是 JSON，作为 PTY 输入处理
        }

        // 原始数据 → PTY 输入
        console.log('[PTY] Raw data type:', typeof messageStr, 'length:', messageStr.length, 'preview:', JSON.stringify(messageStr.substring(0, 100)));
        instance.pty.write(messageStr);
      }
    });

    ws.on('close', () => {
      if (ptyId) {
        this.ptyManager.destroy(ptyId);
      }
    });

    ws.on('error', (err) => {
      console.error('[luxio-agent] WebSocket error:', err.message);
      if (ptyId) {
        this.ptyManager.destroy(ptyId);
      }
    });
  }
}
