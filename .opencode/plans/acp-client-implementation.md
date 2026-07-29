# ACP Client 实现方案

## 1. 背景与目标

### 现状

- `chrome-acp/proxy-server` 作为 ACP Client，通过 `acp.ClientSideConnection` 与 ACP Agent 子进程通信（stdio），同时暴露 WebSocket 给浏览器扩展
- `packages/agent` 是本地代理服务，提供文件系统访问、PTY 终端、A2A 代理等功能
- 两者架构相似但协议不同：`packages/agent` 使用自定义 JSON 协议，`chrome-acp` 使用 ACP 标准协议

### 目标

在 `packages/agent` 中实现 ACP Client 模块，使 `packages/agent` 能够：
- 接收前端（浏览器/编辑器）通过 WebSocket 发送的请求
- 通过 stdio 启动并连接一个 ACP Agent 子进程
- 双向转发 ACP JSON-RPC 消息
- 支持 ACP 协议的所有核心操作：initialize、newSession、loadSession、prompt、cancel 等

### 架构

```
Browser/Frontend
    ↕ WebSocket (自定义 JSON 桥接协议)
packages/agent (ACP Client)
    ↕ stdio ndJsonStream (ACP JSON-RPC protocol)
ACP Agent Process (spawned)
```

### 与现有功能的关系

- 现有 WebSocket（`/ws/terminal`、`/ws/file-watch`）不受影响
- ACP WebSocket 使用独立端点 `/ws/acp`
- 两种协议共存，通过 URL 路径区分

---

## 2. 文件变更清单

### 2.1 新增文件

| 文件 | 说明 |
|------|------|
| `src/acp/types.ts` | ACP WebSocket 桥接协议类型定义 |
| `src/acp/ws-stream.ts` | 将 WebSocket 适配为 ACP `Stream`（`ReadableStream<AnyMessage>` + `WritableStream<AnyMessage>`）|
| `src/acp/agent-process.ts` | 管理 ACP Agent 子进程的生命周期（spawn/kill/stdio）|
| `src/acp/client.ts` | ACP Client 核心逻辑：创建 `ClientSideConnection`，处理 session、prompt、permission 等 |
| `src/acp/index.ts` | 暴露 `setupAcpWebSocket` 函数，挂载到 HTTP server 的 WebSocket upgrade |

### 2.2 修改文件

| 文件 | 修改内容 |
|------|----------|
| `src/server.ts` | 在 `setupWebSocket` 调用旁新增 `setupAcpWebSocket(httpServer, sslConfig)` |
| `src/index.ts` | 导出 ACP 相关类型和函数 |

---

## 3. 详细设计

### 3.1 `src/acp/types.ts` — WebSocket 桥接协议

定义 WebSocket 上的自定义消息协议（参照 `chrome-acp/proxy-server/src/server.ts` 的消息模式）：

```ts
import type * as acp from '@agentclientprotocol/sdk';

// ============================================================================
// ContentBlock 类型 (与 ACP SDK 一致)
// ============================================================================

export interface ContentBlock {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
  uri?: string;
  name?: string;
}

// ============================================================================
// PromptCapabilities (来自 ACP 协议)
// ============================================================================

export interface PromptCapabilities {
  audio?: boolean;
  embeddedContext?: boolean;
  image?: boolean;
}

// ============================================================================
// SessionModelState (来自 ACP 协议)
// ============================================================================

export interface SessionModelState {
  availableModels: Array<{
    modelId: string;
    name: string;
    description?: string | null;
  }>;
  currentModelId: string;
}

// ============================================================================
// AgentCapabilities (来自 ACP 协议)
// ============================================================================

export interface AgentCapabilities {
  _meta?: Record<string, unknown> | null;
  loadSession?: boolean;
  mcpCapabilities?: {
    _meta?: Record<string, unknown> | null;
    clientServers?: boolean;
  };
  promptCapabilities?: PromptCapabilities;
  sessionCapabilities?: {
    _meta?: Record<string, unknown> | null;
    fork?: Record<string, unknown> | null;
    list?: Record<string, unknown> | null;
    resume?: Record<string, unknown> | null;
  };
}

// ============================================================================
// WebSocket Client → Agent 消息
// ============================================================================

export type AcpWsMessage =
  | { type: 'connect'; payload: { command: string; args?: string[]; cwd?: string } }
  | { type: 'disconnect' }
  | { type: 'new_session'; payload: { cwd?: string } }
  | { type: 'prompt'; payload: { content: ContentBlock[] } }
  | { type: 'cancel' }
  | { type: 'set_session_model'; payload: { modelId: string } }
  | { type: 'list_sessions'; payload?: { cwd?: string; cursor?: string } }
  | { type: 'load_session'; payload: { sessionId: string; cwd?: string } }
  | { type: 'resume_session'; payload: { sessionId: string; cwd?: string } }
  | { type: 'permission_response'; payload: { requestId: string; outcome: { outcome: 'cancelled' } | { outcome: 'selected'; optionId: string } } }
  | { type: 'ping' };

// ============================================================================
// WebSocket Agent → Client 响应
// ============================================================================

export type AcpWsResponse =
  | { type: 'status'; payload: { connected: boolean; agentInfo?: { name?: string; version?: string }; capabilities?: AgentCapabilities } }
  | { type: 'session_created'; payload: acp.NewSessionResponse & { promptCapabilities?: PromptCapabilities; models?: SessionModelState } }
  | { type: 'session_loaded'; payload: { sessionId: string; promptCapabilities?: PromptCapabilities; models?: SessionModelState } }
  | { type: 'session_resumed'; payload: { sessionId: string; promptCapabilities?: PromptCapabilities; models?: SessionModelState } }
  | { type: 'session_list'; payload: { sessions: acp.SessionInfo[]; nextCursor?: string; _meta?: unknown } }
  | { type: 'prompt_complete'; payload: acp.PromptResponse }
  | { type: 'session_update'; payload: acp.SessionNotification }
  | { type: 'permission_request'; payload: { requestId: string; sessionId: string; options: unknown[]; toolCall: unknown } }
  | { type: 'model_changed'; payload: { modelId: string } }
  | { type: 'error'; payload: { message: string } }
  | { type: 'pong' };

// ============================================================================
// MCP Server 配置 (用于 newSession)
// ============================================================================

export interface McpServer {
  type: 'http' | 'sse' | 'stdio';
  url?: string;
  name?: string;
  headers?: Array<{ key: string; value: string }>;
  command?: string;
  args?: string[];
}

// ============================================================================
// Permission 管理
// ============================================================================

export interface PendingPermission {
  resolve: (outcome: { outcome: 'cancelled' } | { outcome: 'selected'; optionId: string }) => void;
  timeout: ReturnType<typeof setTimeout>;
}
```

### 3.2 `src/acp/ws-stream.ts` — WebSocket → ACP Stream 适配器

核心：将 WebSocket 包装为 ACP SDK 要求的 `Stream` 类型（`ReadableStream<AnyMessage>` + `WritableStream<AnyMessage>`）。

```ts
import type { Stream } from '@agentclientprotocol/sdk';

/**
 * Create an ACP Stream from a ws library WebSocket.
 *
 * The ws WebSocket uses Node.js event model, so we adapt it to
 * the Web Streams API that the ACP SDK expects.
 */
export function createWsStream(ws: import('ws').WebSocket): Stream {
  let readableController: ReadableStreamDefaultController;
  let writableClosed = false;

  // Readable: ws messages → ReadableStream<AnyMessage>
  const readable = new ReadableStream({
    start(controller) {
      readableController = controller;

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          controller.enqueue(message);
        } catch (err) {
          console.error('[ACP ws-stream] Failed to parse message:', err);
        }
      });

      ws.on('close', () => {
        try { controller.close(); } catch {}
      });

      ws.on('error', (err) => {
        try { controller.error(err); } catch {}
      });
    },
  });

  // Writable: AnyMessage → ws.send()
  const writable = new WritableStream({
    async write(message) {
      if (ws.readyState === 1 /* OPEN */) {
        ws.send(JSON.stringify(message));
      }
    },
    close() {
      writableClosed = true;
    },
    abort() {
      writableClosed = true;
    },
  });

  return { readable, writable };
}
```

**关键点**：
- `ws` 库的 `WebSocket` 使用事件模型（`on('message')`），需要适配为 Web Streams API
- ACP SDK 内部的 `Connection` 类通过 `stream.readable.getReader()` 读消息、`stream.writable.getWriter()` 写消息
- 消息格式是 `AnyMessage`（JSON-RPC 2.0），直接 JSON 序列化/反序列化即可

### 3.3 `src/acp/agent-process.ts` — Agent 子进程管理

```ts
import { spawn, type ChildProcess } from 'node:child_process';
import { Writable, Readable } from 'node:stream';

export interface AgentProcessConfig {
  command: string;
  args?: string[];
  cwd?: string;
}

export class AgentProcess {
  private process: ChildProcess | null = null;

  spawn(config: AgentProcessConfig): void {
    const { command, args = [], cwd } = config;

    console.log(`[ACP Agent] Spawning: ${command} ${args.join(' ')}`);

    this.process = spawn(command, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'inherit'],
      shell: true,
    });

    this.process.on('close', (code) => {
      console.log(`[ACP Agent] Process exited with code: ${code}`);
      this.process = null;
    });

    this.process.on('error', (err) => {
      console.error('[ACP Agent] Process error:', err.message);
      this.process = null;
    });
  }

  /**
   * Get agent's stdout as a Web ReadableStream (for ndJsonStream input).
   */
  getStdoutStream(): ReadableStream<Uint8Array> {
    if (!this.process?.stdout) throw new Error('Agent process not running');
    return Readable.toWeb(this.process.stdout) as unknown as ReadableStream<Uint8Array>;
  }

  /**
   * Get agent's stdin as a Web WritableStream (for ndJsonStream output).
   */
  getStdinStream(): WritableStream<Uint8Array> {
    if (!this.process?.stdin) throw new Error('Agent process not running');
    return Writable.toWeb(this.process.stdin) as unknown as WritableStream<Uint8Array>;
  }

  kill(): void {
    if (this.process) {
      console.log('[ACP Agent] Killing process');
      this.process.kill();
      this.process = null;
    }
  }

  isRunning(): boolean {
    return this.process !== null && !this.process.killed;
  }

  onClose(cb: (code: number | null) => void): void {
    this.process?.on('close', cb);
  }
}
```

**与 chrome-acp 的区别**：
- chrome-acp 的 `agent.ts` 是旧版手动解析 ndjson 的实现，已被 `server.ts` 中的 `ndJsonStream` 方案替代
- 此处直接使用 `Readable.toWeb()` / `Writable.toWeb()` 将 Node.js 流转为 Web Streams，再传给 `acp.ndJsonStream()`

### 3.4 `src/acp/client.ts` — ACP Client 核心

参照 `chrome-acp/proxy-server/src/server.ts` 的 `handleConnect`、`handleNewSession`、`handlePrompt` 等函数，封装为类：

```ts
import * as acp from '@agentclientprotocol/sdk';
import { createWsStream } from './ws-stream.js';
import { AgentProcess } from './agent-process.js';
import type {
  AgentCapabilities,
  PromptCapabilities,
  SessionModelState,
  PendingPermission,
  ContentBlock,
} from './types.js';

const PERMISSION_TIMEOUT_MS = 5 * 60 * 1000;

function generateRequestId(): string {
  return `perm_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

export interface AcpClientConfig {
  /** Default working directory for new sessions */
  defaultCwd: string;
}

export class AcpClient {
  private connection: acp.ClientSideConnection | null = null;
  private agentProcess: AgentProcess | null = null;
  private sessionId: string | null = null;
  private sessionCwd: string | null = null;
  private pendingPermissions: Map<string, PendingPermission> = new Map();
  private agentCapabilities: AgentCapabilities | null = null;
  private promptCapabilities: PromptCapabilities | null = null;
  private modelState: SessionModelState | null = null;

  constructor(
    private ws: import('ws').WebSocket,
    private config: AcpClientConfig,
  ) {}

  // ========================================================================
  // WebSocket message dispatcher
  // ========================================================================

  async handleMessage(msg: { type: string; payload?: any }): Promise<void> {
    switch (msg.type) {
      case 'connect':
        await this.connect(msg.payload);
        break;
      case 'disconnect':
        this.disconnect();
        break;
      case 'new_session':
        await this.newSession(msg.payload || {});
        break;
      case 'prompt':
        await this.prompt(msg.payload);
        break;
      case 'cancel':
        await this.cancel();
        break;
      case 'set_session_model':
        await this.setSessionModel(msg.payload);
        break;
      case 'list_sessions':
        await this.listSessions(msg.payload || {});
        break;
      case 'load_session':
        await this.loadSession(msg.payload);
        break;
      case 'resume_session':
        await this.resumeSession(msg.payload);
        break;
      case 'permission_response':
        this.handlePermissionResponse(msg.payload);
        break;
      case 'ping':
        this.send('pong');
        break;
      default:
        this.send('error', { message: `Unknown message type: ${msg.type}` });
    }
  }

  // ========================================================================
  // Connect: spawn agent process + create ACP connection
  // ========================================================================

  private async connect(params: { command: string; args?: string[]; cwd?: string }): Promise<void> {
    // Kill existing process if any
    if (this.agentProcess) {
      this.cancelPendingPermissions();
      this.agentProcess.kill();
      this.agentProcess = null;
      this.connection = null;
    }

    try {
      // 1. Spawn agent process
      this.agentProcess = new AgentProcess();
      this.agentProcess.spawn({
        command: params.command,
        args: params.args,
        cwd: params.cwd || this.config.defaultCwd,
      });

      // 2. Create stdio-based ACP stream (same as chrome-acp)
      const inputStream = this.agentProcess.getStdoutStream();
      const outputStream = this.agentProcess.getStdinStream();
      const stdioStream = acp.ndJsonStream(outputStream, inputStream);

      // 3. Create ClientSideConnection
      this.connection = new acp.ClientSideConnection(
        (agent) => this.createClientHandler(agent),
        stdioStream,
      );

      // 4. Initialize
      const initResult = await this.connection.initialize({
        protocolVersion: acp.PROTOCOL_VERSION,
        clientInfo: {
          name: 'luxio-agent',
          version: '1.0.0',
        },
        clientCapabilities: {
          fs: {
            readTextFile: true,
            writeTextFile: true,
          },
        },
      });

      // 5. Store capabilities
      const agentCaps = initResult.agentCapabilities;
      this.agentCapabilities = agentCaps ? {
        _meta: agentCaps._meta,
        loadSession: agentCaps.loadSession,
        mcpCapabilities: agentCaps.mcpCapabilities,
        promptCapabilities: agentCaps.promptCapabilities,
        sessionCapabilities: agentCaps.sessionCapabilities,
      } : null;
      this.promptCapabilities = agentCaps?.promptCapabilities ?? null;

      console.log('[ACP Client] Agent initialized', {
        protocolVersion: initResult.protocolVersion,
        loadSession: this.agentCapabilities?.loadSession,
      });

      // 6. Notify frontend
      this.send('status', {
        connected: true,
        agentInfo: initResult.agentInfo,
        capabilities: this.agentCapabilities,
      });

      // 7. Handle connection close
      this.connection.closed.then(() => {
        console.log('[ACP Client] Agent connection closed');
        this.connection = null;
        this.sessionId = null;
        this.send('status', { connected: false });
      });

      // 8. Handle process exit
      this.agentProcess.onClose(() => {
        this.send('status', { connected: false });
      });

    } catch (error) {
      console.error('[ACP Client] Failed to connect:', error);
      this.send('error', {
        message: `Failed to connect: ${(error as Error).message}`,
      });
    }
  }

  // ========================================================================
  // Create ACP Client handler (permission, session updates, fs)
  // ========================================================================

  private createClientHandler(agentConn: acp.AgentSideConnection): acp.Client {
    return {
      async requestPermission(params) {
        const requestId = generateRequestId();
        console.log('[ACP Client] Permission requested:', requestId, params.toolCall.title);

        const outcomePromise = new Promise<{ outcome: 'cancelled' } | { outcome: 'selected'; optionId: string }>((resolve) => {
          const timeout = setTimeout(() => {
            console.log('[ACP Client] Permission request timed out:', requestId);
            // Access pendingPermissions via closure
            // (stored in outer AcpClient instance)
            resolve({ outcome: 'cancelled' });
          }, PERMISSION_TIMEOUT_MS);

          // Store pending - this will be handled by the outer AcpClient
          // We need a reference to the outer instance
        });

        // Send permission request to frontend
        // Note: we need access to `this` from the outer class
        // This is handled via the closure in createClientHandler
        return { outcome: 'cancelled' };
      },

      async sessionUpdate(params) {
        // Forward to frontend
        this.send('session_update', params);
      },

      async readTextFile(params) {
        console.log('[ACP Client] Read file:', params.path);
        // TODO: Delegate to FileService or forward to extension
        return { content: '' };
      },

      async writeTextFile(params) {
        console.log('[ACP Client] Write file:', params.path);
        // TODO: Delegate to FileService or forward to extension
        return {};
      },
    } as acp.Client;
  }

  // ========================================================================
  // Session operations
  // ========================================================================

  private async newSession(params: { cwd?: string }): Promise<void> {
    if (!this.connection) {
      this.send('error', { message: 'Not connected to agent' });
      return;
    }

    try {
      const sessionCwd = params.cwd || this.config.defaultCwd;
      const result = await this.connection.newSession({
        cwd: sessionCwd,
      });

      this.sessionId = result.sessionId;
      this.sessionCwd = sessionCwd;
      this.modelState = result.models ?? null;

      console.log('[ACP Client] Session created:', result.sessionId);

      this.send('session_created', {
        ...result,
        promptCapabilities: this.promptCapabilities,
        models: this.modelState,
      });
    } catch (error) {
      console.error('[ACP Client] Failed to create session:', error);
      this.send('error', {
        message: `Failed to create session: ${(error as Error).message}`,
      });
    }
  }

  private async prompt(params: { content: ContentBlock[] }): Promise<void> {
    if (!this.connection || !this.sessionId) {
      this.send('error', { message: 'No active session' });
      return;
    }

    try {
      console.log('[ACP Client] Sending prompt');
      const result = await this.connection.prompt({
        sessionId: this.sessionId,
        prompt: params.content as acp.ContentBlock[],
      });

      console.log('[ACP Client] Prompt completed:', result.stopReason);
      this.send('prompt_complete', result);
    } catch (error) {
      console.error('[ACP Client] Prompt failed:', error);
      this.send('error', {
        message: `Prompt failed: ${(error as Error).message}`,
      });
    }
  }

  private async cancel(): Promise<void> {
    if (!this.connection || !this.sessionId) return;

    this.cancelPendingPermissions();

    try {
      await this.connection.cancel({ sessionId: this.sessionId });
      console.log('[ACP Client] Cancel sent');
    } catch (error) {
      console.error('[ACP Client] Failed to cancel:', error);
    }
  }

  private async setSessionModel(params: { modelId: string }): Promise<void> {
    if (!this.connection || !this.sessionId) {
      this.send('error', { message: 'No active session' });
      return;
    }

    if (!this.modelState) {
      this.send('error', { message: 'Model selection not supported' });
      return;
    }

    try {
      await this.connection.unstable_setSessionModel({
        sessionId: this.sessionId,
        modelId: params.modelId,
      });
      this.modelState = { ...this.modelState, currentModelId: params.modelId };
      this.send('model_changed', { modelId: params.modelId });
    } catch (error) {
      this.send('error', {
        message: `Failed to set model: ${(error as Error).message}`,
      });
    }
  }

  private async listSessions(params: { cwd?: string; cursor?: string }): Promise<void> {
    if (!this.connection) {
      this.send('error', { message: 'Not connected to agent' });
      return;
    }

    if (!this.agentCapabilities?.sessionCapabilities?.list) {
      this.send('error', { message: 'Listing sessions not supported' });
      return;
    }

    try {
      const result = await this.connection.unstable_listSessions({
        cwd: params.cwd,
        cursor: params.cursor,
      });
      this.send('session_list', {
        sessions: result.sessions,
        nextCursor: result.nextCursor,
        _meta: result._meta,
      });
    } catch (error) {
      this.send('error', {
        message: `Failed to list sessions: ${(error as Error).message}`,
      });
    }
  }

  private async loadSession(params: { sessionId: string; cwd?: string }): Promise<void> {
    if (!this.connection) {
      this.send('error', { message: 'Not connected to agent' });
      return;
    }

    if (!this.agentCapabilities?.loadSession) {
      this.send('error', { message: 'Loading sessions not supported' });
      return;
    }

    try {
      const sessionCwd = params.cwd || this.config.defaultCwd;
      const result = await this.connection.loadSession({
        sessionId: params.sessionId,
        cwd: sessionCwd,
      });

      this.sessionId = params.sessionId;
      this.sessionCwd = sessionCwd;
      this.modelState = result.models ?? null;

      this.send('session_loaded', {
        sessionId: params.sessionId,
        promptCapabilities: this.promptCapabilities,
        models: this.modelState,
      });
    } catch (error) {
      this.send('error', {
        message: `Failed to load session: ${(error as Error).message}`,
      });
    }
  }

  private async resumeSession(params: { sessionId: string; cwd?: string }): Promise<void> {
    if (!this.connection) {
      this.send('error', { message: 'Not connected to agent' });
      return;
    }

    if (!this.agentCapabilities?.sessionCapabilities?.resume) {
      this.send('error', { message: 'Resuming sessions not supported' });
      return;
    }

    try {
      const sessionCwd = params.cwd || this.config.defaultCwd;
      const result = await this.connection.unstable_resumeSession({
        sessionId: params.sessionId,
        cwd: sessionCwd,
      });

      this.sessionId = params.sessionId;
      this.sessionCwd = sessionCwd;
      this.modelState = result.models ?? null;

      this.send('session_resumed', {
        sessionId: params.sessionId,
        promptCapabilities: this.promptCapabilities,
        models: this.modelState,
      });
    } catch (error) {
      this.send('error', {
        message: `Failed to resume session: ${(error as Error).message}`,
      });
    }
  }

  // ========================================================================
  // Permission handling
  // ========================================================================

  private handlePermissionResponse(payload: {
    requestId: string;
    outcome: { outcome: 'cancelled' } | { outcome: 'selected'; optionId: string };
  }): void {
    const pending = this.pendingPermissions.get(payload.requestId);
    if (!pending) {
      console.warn('[ACP Client] Unknown permission response:', payload.requestId);
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingPermissions.delete(payload.requestId);
    pending.resolve(payload.outcome);
  }

  private cancelPendingPermissions(): void {
    for (const [requestId, pending] of this.pendingPermissions) {
      clearTimeout(pending.timeout);
      pending.resolve({ outcome: 'cancelled' });
    }
    this.pendingPermissions.clear();
  }

  // ========================================================================
  // Disconnect / cleanup
  // ========================================================================

  disconnect(): void {
    this.cancelPendingPermissions();

    if (this.agentProcess) {
      this.agentProcess.kill();
      this.agentProcess = null;
    }

    this.connection = null;
    this.sessionId = null;
    this.sessionCwd = null;

    this.send('status', { connected: false });
  }

  // ========================================================================
  // Utility: send message to frontend
  // ========================================================================

  private send(type: string, payload?: unknown): void {
    if (this.ws.readyState === 1 /* OPEN */) {
      this.ws.send(JSON.stringify({ type, payload }));
    }
  }
}
```

### 3.5 `src/acp/index.ts` — WebSocket 端点挂载

```ts
import type http from 'node:http';
import type https from 'node:https';
import { WebSocketServer, WebSocket } from 'ws';
import { AcpClient } from './client.js';

export interface AcpWebSocketOptions {
  logPrefix?: string;
  defaultCwd?: string;
}

export function setupAcpWebSocket(
  httpServer: http.Server | https.Server,
  sslConfig?: { cert: Buffer; key: Buffer } | null,
  options: AcpWebSocketOptions = {},
): void {
  const { logPrefix = '[ACP]', defaultCwd = process.cwd() } = options;
  const protocol = sslConfig ? 'https' : 'http';

  const wss = new WebSocketServer({ noServer: true });

  // Handle WebSocket upgrade for /ws/acp
  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '/', `${protocol}://${req.headers.host}`);

    if (url.pathname === '/ws/acp') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    }
    // Other paths are handled by existing WebSocket handlers
  });

  // Handle ACP WebSocket connections
  wss.on('connection', (ws, req) => {
    console.log(`${logPrefix} Client connected from ${req.socket.remoteAddress}`);

    const client = new AcpClient(ws, { defaultCwd });

    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString());
        await client.handleMessage(msg);
      } catch (error) {
        console.error(`${logPrefix} Message error:`, error);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'error',
            payload: { message: `Error: ${(error as Error).message}` },
          }));
        }
      }
    });

    ws.on('close', () => {
      console.log(`${logPrefix} Client disconnected`);
      client.disconnect();
    });

    ws.on('error', (err) => {
      console.error(`${logPrefix} WebSocket error:`, err.message);
      client.disconnect();
    });
  });
}
```

### 3.6 修改 `src/server.ts`

在 `setupWebSocket` 调用旁新增 ACP WebSocket：

```ts
import { setupAcpWebSocket } from './acp/index.js';

// ... existing code ...

export function createServer(config: ServerConfig): ServerInstance {
  // ... existing code ...

  const services = setupAgentMiddleware(app, middlewareOptions);

  // ... existing HTTP server creation ...

  setupWebSocket(httpServer, services, sslConfig, { logPrefix });

  // 新增：ACP WebSocket
  setupAcpWebSocket(httpServer, sslConfig, {
    logPrefix,
    defaultCwd: rootDir || process.cwd(),
  });

  return { app, httpServer, ...services };
}
```

### 3.7 修改 `src/index.ts`

新增导出：

```ts
// ACP Client
export { setupAcpWebSocket } from './acp/index.js';
export type { AcpWebSocketOptions } from './acp/index.js';
export { AcpClient } from './acp/client.js';
export type { AcpClientConfig } from './acp/client.js';
export type {
  AcpWsMessage,
  AcpWsResponse,
  AgentCapabilities,
  PromptCapabilities,
  SessionModelState,
  ContentBlock,
  McpServer,
} from './acp/types.js';
```

---

## 4. 协议设计

### 4.1 WebSocket 端点

```
/ws/acp
```

### 4.2 消息格式

所有消息均为 JSON 格式：

```jsonc
// Client → Agent (frontend 发送)
{ "type": "connect", "payload": { "command": "claude", "args": ["--acp"], "cwd": "/path/to/project" } }
{ "type": "new_session", "payload": { "cwd": "/path/to/project" } }
{ "type": "prompt", "payload": { "content": [{ "type": "text", "text": "Hello" }] } }
{ "type": "cancel" }
{ "type": "permission_response", "payload": { "requestId": "perm_xxx", "outcome": { "outcome": "selected", "optionId": "allow" } } }

// Agent → Client (server 推送)
{ "type": "status", "payload": { "connected": true, "agentInfo": { "name": "claude" }, "capabilities": {} } }
{ "type": "session_created", "payload": { "sessionId": "xxx", "promptCapabilities": {}, "models": {} } }
{ "type": "session_update", "payload": { "sessionId": "xxx", "update": { ... } } }
{ "type": "permission_request", "payload": { "requestId": "perm_xxx", "sessionId": "xxx", "options": [...], "toolCall": {...} } }
{ "type": "prompt_complete", "payload": { "stopReason": "end_turn" } }
{ "type": "error", "payload": { "message": "..." } }
```

### 4.3 Permission 流程

```
Agent 需要权限
    ↓
packages/agent 收到 requestPermission 回调
    ↓
发送 permission_request 到 frontend (WebSocket)
    ↓
Frontend 展示权限对话框，用户决策
    ↓
Frontend 发送 permission_response 到 packages/agent
    ↓
packages/agent 解析 pending permission 的 Promise
    ↓
返回结果给 Agent
```

---

## 5. 数据流

### 5.1 完整连接流程

```
Frontend                          packages/agent                    ACP Agent
    ↓                                    ↓                              ↓
WebSocket 连接 /ws/acp                   ↓                              ↓
    ↓                                    ↓                              ↓
发送 { type: "connect", payload: { command, args, cwd } }
    ↓                                    ↓                              ↓
    ↓                          spawn(command, args, cwd)              ↓
    ↓                                    ↓                              ↓
    ↓                          acp.ndJsonStream(stdin, stdout)        ↓
    ↓                                    ↓                              ↓
    ↓                          new ClientSideConnection(client, stream)
    ↓                                    ↓                              ↓
    ↓                          connection.initialize(...)              ↓
    ↓                                    ↓  ──── JSON-RPC ──────→     ↓
    ↓                                    ↓  ←──── JSON-RPC ──────     ↓
    ↓                          收到 InitializeResponse                 ↓
    ↓  ←── { type: "status", payload: { connected: true, ... } }     ↓
    ↓                                    ↓                              ↓
发送 { type: "new_session", payload: { cwd } }
    ↓                                    ↓                              ↓
    ↓                          connection.newSession({ cwd })          ↓
    ↓                                    ↓  ──── JSON-RPC ──────→     ↓
    ↓                                    ↓  ←──── JSON-RPC ──────     ↓
    ↓  ←── { type: "session_created", payload: { sessionId, ... } }  ↓
    ↓                                    ↓                              ↓
发送 { type: "prompt", payload: { content: [...] } }
    ↓                                    ↓                              ↓
    ↓                          connection.prompt({ sessionId, prompt })
    ↓                                    ↓  ──── JSON-RPC ──────→     ↓
    ↓                                    ↓  ←── session/update ──     ↓
    ↓  ←── { type: "session_update", payload: { ... } }              ↓
    ↓                                    ↓  ──── requestPermission ─→ ↓
    ↓  ←── { type: "permission_request", ... }                        ↓
    ↓                                    ↓                              ↓
发送 { type: "permission_response", ... }
    ↓                                    ↓  ──── permission result ─→  ↓
    ↓                                    ↓  ←──── PromptResponse ──   ↓
    ↓  ←── { type: "prompt_complete", payload: { stopReason } }      ↓
```

### 5.2 与 chrome-acp 的对比

| 方面 | chrome-acp/proxy-server | packages/agent (本方案) |
|------|------------------------|------------------------|
| 角色 | ACP Client (代理) | ACP Client (代理) |
| Agent 通信 | stdio ndJsonStream | stdio ndJsonStream |
| 前端通信 | WebSocket (自定义协议) | WebSocket (自定义协议) |
| 浏览器工具 | MCP 协议 (browser tabs/read/execute) | 不适用（本地文件系统由 FileService 提供） |
| 权限管理 | 5 分钟超时，自动取消 | 相同 |
| 心跳 | WebSocket ping/pong 30 秒 | 可选（ws 库原生支持） |
| HTTPS | 支持自签名证书 | 已有 `loadSslConfig` |

---

## 6. 实施步骤

### 阶段一：基础模块

1. 创建 `src/acp/types.ts` — 类型定义
2. 创建 `src/acp/ws-stream.ts` — WebSocket 适配器
3. 创建 `src/acp/agent-process.ts` — 子进程管理

### 阶段二：核心逻辑

4. 创建 `src/acp/client.ts` — ACP Client 核心
5. 创建 `src/acp/index.ts` — WebSocket 端点挂载

### 阶段三：集成

6. 修改 `src/server.ts` — 调用 `setupAcpWebSocket`
7. 修改 `src/index.ts` — 导出新模块

### 阶段四：验证

8. 安装 `@agentclientprotocol/sdk`（如未安装）
9. TypeScript 编译检查
10. 手动测试：启动一个 ACP Agent（如 claude-agent），通过 WebSocket 连接测试完整流程

---

## 7. 风险与注意事项

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| `@agentclientprotocol/sdk` 版本不兼容 | 编译失败 | 确认 `packages/agent/package.json` 中的版本与 chrome-acp 一致（`^0.14.1` 或 `^1.2.1`）|
| `ws` 库的 WebSocket 类型与浏览器 API 不同 | ws-stream 适配问题 | 使用 `ws` 库的事件模型，通过 `on('message')` / `on('close')` 适配 |
| Agent 子进程异常退出 | 连接中断 | 通过 `agentProcess.onClose()` 监听，通知前端断开 |
| 多客户端并发连接 | 资源竞争 | 每个 WebSocket 连接独立的 `AcpClient` 实例和子进程 |
| Permission 回调的闭包作用力 | 代码复杂度 | `createClientHandler` 中的 `this` 引用需要通过箭头函数或 bind 处理 |

---

## 8. 后续可选优化

- **MCP Server 代理**：在 `newSession` 中注入 MCP Server 配置，支持浏览器工具等扩展
- **文件系统桥接**：`readTextFile` / `writeTextFile` 回调委托给现有的 `FileService`，而非返回空内容
- **Session 历史管理**：支持 `listSessions` / `loadSession` / `resumeSession` 的完整实现
- **Heartbeat**：添加 WebSocket ping/pong 心跳检测死连接
