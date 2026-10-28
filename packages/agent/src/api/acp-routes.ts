import { logger } from '../helpers/logger.js';
import type { Express, NextFunction, Request, Response } from 'express';
import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { AcpSessionManager } from '../acp/session-manager.js';
import { getInstallJob } from '../acp/agent-install.js';
import type { AgentRegistry } from '../acp/agent-registry.js';
import { SseManager, StreamConflictError } from '../acp/sse-manager.js';
import type { TokenManager } from '../agent/auth.js';
import type { FileService } from '../agent/file-service.js';
import type { McpServerRegistry } from '../mcp/registry.js';
import { createRequireAuth } from './middleware.js';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import type * as acp from '@agentclientprotocol/sdk';

const PROJECTS_DIR = join(homedir(), '.clover');
const PROJECTS_FILE = join(PROJECTS_DIR, 'projects.json');
const TASKS_FILE = join(PROJECTS_DIR, 'tasks.json');
const SELECTED_FILE = join(PROJECTS_DIR, 'selected.json');
const AGENT_CONFIG_FILE = join(PROJECTS_DIR, 'agent-config.json');

/**
 * 临时开关：会话所有权栅栏（`requireSessionOwner`）。
 *
 * 目前**默认关闭** —— 任何调用方都能对会话发命令（prompt / cancel /
 * permission / load / resume / config），不做 epoch 校验。
 *
 * 恢复方式（二选一）：
 * - 启动时设置 `CLOVER_ENFORCE_OWNERSHIP=1`；
 * - 或把下面的默认值改成 `true`。
 *
 * TODO(ownership): 恢复默认开启后删除这个开关。
 */
const ENFORCE_SESSION_OWNER = process.env.CLOVER_ENFORCE_OWNERSHIP === '1';

interface ProjectSession {
  sessionId: string;
  agentId: string;
  title?: string;
  updatedAt?: string;
}

interface ProjectInfo {
  name: string;
  path: string;
  type: 'project' | 'task';
  sessions: ProjectSession[];
  id?: string;
  createdAt?: string;
}

function readProjects(): ProjectInfo[] {
  if (!existsSync(PROJECTS_FILE)) return [];
  try {
    const raw = JSON.parse(readFileSync(PROJECTS_FILE, 'utf-8'));
    return raw.map((p: any) => ({
      name: p.name,
      path: p.path,
      type: 'project' as const,
      sessions: p.sessions || [],
    }));
  } catch {
    return [];
  }
}

function writeProjects(projects: ProjectInfo[]): void {
  mkdirSync(PROJECTS_DIR, { recursive: true });
  const data = projects.filter(p => p.type === 'project').map(p => ({
    name: p.name,
    path: p.path,
    sessions: p.sessions,
  }));
  writeFileSync(PROJECTS_FILE, JSON.stringify(data, null, 2));
}

function readTasks(): ProjectInfo[] {
  if (!existsSync(TASKS_FILE)) return [];
  try {
    const raw = JSON.parse(readFileSync(TASKS_FILE, 'utf-8'));
    const tasks = Array.isArray(raw) ? raw : [];
    return tasks
      .map((t: any) => ({ ...t, type: 'task' as const }))
      .sort((a: ProjectInfo, b: ProjectInfo) =>
        new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
      );
  } catch {
    return [];
  }
}

function writeTasks(tasks: ProjectInfo[]): void {
  mkdirSync(PROJECTS_DIR, { recursive: true });
  const data = tasks.map(t => ({
    name: t.name,
    path: t.path,
    sessions: t.sessions,
    id: t.id,
    createdAt: t.createdAt,
  }));
  writeFileSync(TASKS_FILE, JSON.stringify(data, null, 2));
}

/** Agent 配置持久化条目：按 agentId 保存 configOptions（mode/model 选择器）。 */
interface AgentConfigEntry {
  configOptions: acp.SessionConfigOption[];
  updatedAt?: string;
}

type AgentConfigFile = Record<string, AgentConfigEntry>;

function readAgentConfigFile(): AgentConfigFile {
  if (!existsSync(AGENT_CONFIG_FILE)) return {};
  try {
    const raw = JSON.parse(readFileSync(AGENT_CONFIG_FILE, 'utf-8'));
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as AgentConfigFile : {};
  } catch {
    return {};
  }
}

function writeAgentConfigFile(data: AgentConfigFile): void {
  mkdirSync(PROJECTS_DIR, { recursive: true });
  writeFileSync(AGENT_CONFIG_FILE, JSON.stringify(data, null, 2));
}

export interface AcpRouteOptions {
  tokenManager: TokenManager;
  sessionManager: AcpSessionManager;
  sseManager: SseManager;
  fileService: FileService;
  mcpRegistry?: McpServerRegistry;
  /** Agent 预热注册表（启动预热 + Settings Agents 管理）。 */
  registry?: AgentRegistry;
}

/**
 * 解析断点续传游标（标准 `Last-Event-ID` 头）。
 *
 * 非法值一律忽略（当作首次连接），避免一个坏游标让客户端卡在补发分支。
 */
function parseLastEventId(req: Request): number | undefined {
  const raw = req.get('Last-Event-ID');

  if (raw === undefined || raw === '') return undefined;

  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : undefined;
}

/**
 * 页面实例标识（前端每次加载生成）；长度做上限保护。
 *
 * header 优先（流端点），回退 body（`session/load` 等 REST 端点）。
 */
function parseClientId(req: Request): string | undefined {
  const raw = req.get('X-Client-Id')
    ?? (typeof req.body?.clientId === 'string' ? req.body.clientId : undefined);

  const trimmed = raw?.trim();
  return trimmed ? trimmed.slice(0, 128) : undefined;
}

/** 所有权代次（header 优先，回退 body）。 */
function parseEpoch(req: Request): number | undefined {
  const raw = req.get('X-Epoch') ?? req.body?.epoch;
  if (raw === undefined || raw === '') return undefined;

  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : undefined;
}

/** 是否允许接管他人持有的会话（仅显式用户操作会带）。 */
function parseTakeover(req: Request): boolean {
  const header = req.get('X-Takeover');
  return header === '1' || header === 'true';
}

export function setupAcpRoutes(app: Express, options: AcpRouteOptions): void {
  const { tokenManager, sessionManager, sseManager, fileService, mcpRegistry, registry } = options;
  const requireAuth = createRequireAuth(tokenManager);

  // Parse JSON bodies for ACP routes. Generous enough for base64 media
  // attachments (frontend caps each file at 10MB, ~13MB base64), while still
  // rejecting oversized payloads.
  app.use('/api/acp', express.json({ limit: '20mb' }));
  app.use('/api/acp', requireAuth);

  /**
   * epoch 栅栏：只有当前持有者（或无人持有的脚本调用）能驱动会话。
   *
   * 凭据优先读 header（`X-Client-Id` / `X-Epoch`），回退到 body，兼容旧端点。
   */
  const requireSessionOwner = (req: Request, res: Response, next: NextFunction): void => {
    // 所有权栅栏当前默认关闭（见 ENFORCE_SESSION_OWNER）
    if (!ENFORCE_SESSION_OWNER) {
      next();
      return;
    }

    const sessionId = (req.params.sessionId as string | undefined) ?? req.body?.sessionId;
    const clientId = parseClientId(req);
    const epoch = parseEpoch(req);

    if (!sseManager.isOwner(sessionId ?? '', clientId, epoch)) {
      logger.warn(
        `[ACP Routes] Rejected ${req.method} ${req.path}: session ${sessionId} is owned by another client`,
      );
      res.status(409).json({ error: 'Session is owned by another client', code: 'SUPERSEDED' });
      return;
    }
    next();
  };

  /** 命令表：新传输端点的 `method` → 会话管理器直调。 */
  const streamCommands: Record<string, (sessionId: string, params: any, id?: string) => void> = {
    prompt: (sessionId, params, id) =>
      sessionManager.dispatchPrompt(sessionId, params.content ?? [], id ?? uuidv4()),
    cancel: (sessionId) => sessionManager.dispatchCancel(sessionId),
    permission: (sessionId, params) =>
      sessionManager.dispatchPermissionResponse(sessionId, params.requestId, params.outcome),
  };

  // ============================================================================
  // SSE 事件流端点
  // ============================================================================

  /**
   * 打开会话事件流（新传输端点）。
   *
   * 参数全部走 header（`X-Client-Id` / `X-Takeover` / `Last-Event-ID`）---- 暂时屏蔽
   * 冲突返回 409。---- 暂时屏蔽
   */
  const openStream = async (
    req: Request,
    res: Response,
    opts: { clientId?: string; takeover?: boolean; lastEventId?: number },
  ): Promise<void> => {
    const sessionId = req.params.sessionId as string;
    const agentId = typeof req.query.agentId === 'string' ? req.query.agentId : undefined;

    let session = sessionManager.getSession(sessionId);
    if (!session && agentId) {
      try {
        session = await sessionManager.ensureRecord(sessionId, agentId);
      } catch (error) {
        logger.warn(`[ACP Routes] Failed to ensure session record ${sessionId} (agent: ${agentId}):`, error);
      }
    }

    // 验证会话是否存在（后端重启且未带 agentId 时无法重建记录）
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    const attachedSession = session;

    try {
      sseManager.addConnection(sessionId, res, {
        clientId: opts.clientId,
        takeover: opts.takeover,
        lastEventId: opts.lastEventId,
      });
    } catch (error) {
      if (error instanceof StreamConflictError) {
        res.status(409).json({ error: error.message, code: error.code });
        return;
      }
      throw error;
    }

    // 如果 agent 未连接，自动重连并恢复会话（优先 resume 旧会话延续上下文）
    if (!sessionManager.isAgentConnected(sessionId)) {
      sessionManager.ensureAgentSession(sessionId)
        .then(() => {
          sseManager.sendToConnection(sessionId, {
            type: 'status',
            payload: {
              connected: true,
              agentInfo: attachedSession.client.getAgentInfo(),
              capabilities: attachedSession.client.getAgentCapabilities(),
            },
            timestamp: Date.now(),
          });
        })
        .catch((error) => {
          logger.error(`[ACP Routes] Auto-reconnect failed for ${sessionId}:`, error);
          sessionManager.publishEvent(sessionId, {
            type: 'error',
            payload: { message: `Agent recovery failed: ${(error as Error).message}` },
            timestamp: Date.now(),
          });
        });
    } else {
      // agent 已连接：直接告知前端当前状态（含 capabilities，供 UI 门控输入能力）
      sseManager.sendToConnection(sessionId, {
        type: 'status',
        payload: {
          connected: true,
          agentInfo: attachedSession.client.getAgentInfo(),
          capabilities: attachedSession.client.getAgentCapabilities(),
        },
        timestamp: Date.now(),
      });
    }
  };

  /**
   * GET /api/acp/stream/:sessionId
   *
   * 会话事件流（SSE + 显式契约，不是 MCP 传输）：
   * - `Accept: text/event-stream` 必需；
   * - `X-Client-Id` / `X-Takeover` / `Last-Event-ID` 走 header；
   * - 冲突返回 409。
   */
  app.get('/api/acp/stream/:sessionId', async (req: Request, res: Response) => {
    if (!req.accepts('text/event-stream')) {
      res.status(406).json({ error: 'Accept: text/event-stream is required' });
      return;
    }

    await openStream(req, res, {
      clientId: parseClientId(req),
      takeover: parseTakeover(req),
      lastEventId: parseLastEventId(req),
    });
  });

  /**
   * POST /api/acp/stream/:sessionId
   *
   * 命令通道：`{ id, method, params }` → 202 Accepted，输出全部走 GET 流。
   * 支持的方法：`prompt` / `cancel` / `permission`。
   */
  app.post('/api/acp/stream/:sessionId', requireSessionOwner, (req: Request, res: Response) => {
    const sessionId = req.params.sessionId as string;
    const { id, method, params } = (req.body ?? {}) as {
      id?: string;
      method?: string;
      params?: any;
    };

    if (!method) {
      res.status(400).json({ error: 'method is required' });
      return;
    }
    if (!sessionManager.getSession(sessionId)) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const handler = streamCommands[method];
    if (!handler) {
      res.status(400).json({ error: `Unknown method: ${method}` });
      return;
    }

    try {
      handler(sessionId, params ?? {}, id);
      res.status(202).json({ accepted: true, id: id ?? null });
    } catch (error) {
      logger.error(`[ACP Routes] Stream command failed (${method}, session: ${sessionId}):`, error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * DELETE /api/acp/stream/:sessionId
   * 释放事件流所有权（≠ 删除 ACP 会话）。
   */
  app.delete('/api/acp/stream/:sessionId', (req: Request, res: Response) => {
    const sessionId = req.params.sessionId as string;
    const released = sseManager.release(sessionId, parseClientId(req), parseEpoch(req));

    if (!released) {
      res.status(409).json({ error: 'Not the stream owner', code: 'SUPERSEDED' });
      return;
    }
    res.status(204).end();
  });

  // ============================================================================
  // 会话管理端点
  // ============================================================================

  /**
   * GET /api/acp/session/:sessionId
   * 获取会话状态
   */
  app.get('/api/acp/session/:sessionId', (req: Request, res: Response) => {
    const sessionId = req.params.sessionId as string;
    const session = sessionManager.getSession(sessionId);

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    res.json({
      sessionId: session.sessionId,
      status: session.status,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      hasConnection: sseManager.hasConnection(sessionId),
    });
  });

  /**
   * DELETE /api/acp/session/:sessionId
   * 删除会话
   */
  app.delete('/api/acp/session/:sessionId', async (req: Request, res: Response) => {
    const sessionId = req.params.sessionId as string;

    try {
      await sessionManager.removeSession(sessionId);
      res.json({ success: true, message: 'Session deleted' });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // ============================================================================
  // 会话操作端点
  // ============================================================================

  /**
   * POST /api/acp/session/create
   * 创建新的 ACP 会话（按 agentId 解析 agent，返回真实 ACP session id）
   *
   * 响应即会话创建结果：前端拿到 sessionId 后再建立 SSE 连接（先建会话、
   * 后开流；available_commands 等创建期通知由响应字段携带补偿）。
   */
  app.post('/api/acp/session/create', async (req: Request, res: Response) => {
    const { agentId, cwd: rawCwd, mcpServers } = req.body;

    if (!agentId || typeof agentId !== 'string') {
      res.status(400).json({ error: 'agentId is required' });
      return;
    }

    try {
      let cwd = rawCwd;
      if (cwd && String(cwd).trim()) {
        cwd = String(cwd).trim().replace(/^~(?=\/|\\|$)/, homedir());
      } else {
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
        cwd = join(PROJECTS_DIR, ts);
      }
      mkdirSync(cwd, { recursive: true });

      // Resolve MCP server names to full config objects via registry
      let resolvedMcpServers: acp.McpServer[] | undefined;
      if (Array.isArray(mcpServers) && mcpServers.length > 0 && mcpRegistry) {
        if (typeof mcpServers[0] === 'string') {
          // Array of names → resolve via registry
          resolvedMcpServers = mcpRegistry.resolveAll(mcpServers);
        } else {
          // Already full objects
          resolvedMcpServers = mcpServers as acp.McpServer[];
        }
      }

      const result = await sessionManager.createAcpSession(agentId, cwd, resolvedMcpServers);
      res.json({ success: true, agentId, ...result });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * POST /api/acp/session/list
   * 列出会话（同步等待 agent 返回；连接级操作，按 agentId 解析）
   */
  app.post('/api/acp/session/list', async (req: Request, res: Response) => {
    const { agentId, cwd, cursor } = req.body;

    if (!agentId) {
      res.status(400).json({ error: 'agentId is required' });
      return;
    }

    try {
      const result = await sessionManager.listAcpSessions(agentId, cwd, cursor);
      res.json({ success: true, ...result });
    } catch (error) {
      logger.error(`[ACP Routes] List sessions error (agent: ${agentId}):`, error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * POST /api/acp/list-all-sessions
   * 聚合列出所有 agent 的会话（直接复用 registry 预热连接，不落 session 记录）
   */
  app.post('/api/acp/list-all-sessions', async (req: Request, res: Response) => {
    const { cwd, agents } = req.body;

    if (!cwd || !String(cwd).trim()) {
      res.status(400).json({ error: 'cwd (working directory) is required' });
      return;
    }

    if (!Array.isArray(agents) || agents.length === 0) {
      res.status(400).json({ error: 'agents is required' });
      return;
    }

    const workingDir = String(cwd).trim();

    const results = await Promise.all(
      agents.map(async (agent): Promise<
        | { ok: true; agentId: string; sessions: any[] }
        | { ok: false; agentId: string; error: string }
        | null
      > => {
        if (!agent || typeof agent.id !== 'string' || typeof agent.command !== 'string') {
          return null;
        }

        try {
          const result = await sessionManager.listAgentSessions(
            { command: agent.command, args: agent.args, env: agent.env },
            workingDir,
          );
          return { ok: true, agentId: agent.id, sessions: result?.sessions ?? [] };
        } catch (error) {
          const message = (error as Error).message || String(error);
          logger.warn(`[ACP Routes] Failed to list sessions for agent ${agent.id}:`, message);
          return { ok: false, agentId: agent.id, error: message };
        }
      }),
    );

    const allSessions: any[] = [];
    const failures: { agentId: string; error: string }[] = [];

    for (const result of results) {
      if (!result) continue;
      if (result.ok) {
        for (const s of result.sessions) {
          allSessions.push({ ...s, agentId: result.agentId });
        }
      } else {
        failures.push({ agentId: result.agentId, error: result.error });
      }
    }

    res.json({ success: true, sessions: allSessions, failures });
  });

  /**
   * POST /api/acp/session/load
   * 加载会话（sessionId 即目标 ACP session id；agentId 解析 agent，同步等待）
   */
  app.post('/api/acp/session/load', requireSessionOwner, async (req: Request, res: Response) => {
    const { sessionId, agentId, cwd, mcpServers } = req.body;

    if (!sessionId) {
      res.status(400).json({ error: 'sessionId is required' });
      return;
    }

    try {
      // Resolve MCP server names to full config objects via registry
      let resolvedMcpServers: acp.McpServer[] | undefined;
      if (Array.isArray(mcpServers) && mcpServers.length > 0 && mcpRegistry) {
        if (typeof mcpServers[0] === 'string') {
          resolvedMcpServers = mcpRegistry.resolveAll(mcpServers);
        } else {
          resolvedMcpServers = mcpServers as acp.McpServer[];
        }
      }

      const result = await sessionManager.loadAcpSession(sessionId, { agentId, cwd, mcpServers: resolvedMcpServers });
      res.json({ success: true, ...result });
    } catch (error) {
      logger.error(`[ACP Routes] Load session error (session: ${sessionId}):`, error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * POST /api/acp/session/resume
   * 恢复会话（sessionId 即目标 ACP session id；agentId 解析 agent，同步等待）
   */
  app.post('/api/acp/session/resume', requireSessionOwner, async (req: Request, res: Response) => {
    const { sessionId, agentId, cwd, mcpServers } = req.body;

    if (!sessionId) {
      res.status(400).json({ error: 'sessionId is required' });
      return;
    }

    try {
      // Resolve MCP server names to full config objects via registry
      let resolvedMcpServers: acp.McpServer[] | undefined;
      if (Array.isArray(mcpServers) && mcpServers.length > 0 && mcpRegistry) {
        if (typeof mcpServers[0] === 'string') {
          resolvedMcpServers = mcpRegistry.resolveAll(mcpServers);
        } else {
          resolvedMcpServers = mcpServers as acp.McpServer[];
        }
      }

      const result = await sessionManager.resumeAcpSession(sessionId, { agentId, cwd, mcpServers: resolvedMcpServers });
      res.json({ success: true, ...result });
    } catch (error) {
      logger.error(`[ACP Routes] Resume session error (session: ${sessionId}):`, error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * POST /api/acp/session/delete
   * 删除会话（同步等待 agent 返回；agentId 仅在服务端记录丢失时用于解析 agent）
   */
  app.post('/api/acp/session/delete', async (req: Request, res: Response) => {
    const { sessionId, agentId } = req.body;

    if (!sessionId) {
      res.status(400).json({ error: 'sessionId is required' });
      return;
    }

    try {
      await sessionManager.deleteAcpSession(sessionId, agentId);
      res.json({ success: true, message: 'Session deleted' });
    } catch (error) {
      logger.error(`[ACP Routes] Delete session error (session: ${sessionId}):`, error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * POST /api/acp/config
   * 设置配置选项（同步等待 agent 返回）
   */
  app.post('/api/acp/config', requireSessionOwner, async (req: Request, res: Response) => {
    const { sessionId, configId, type, value } = req.body;

    if (!sessionId || !configId || type === undefined || value === undefined) {
      res.status(400).json({ error: 'sessionId, configId, type, and value are required' });
      return;
    }

    try {
      const result = await sessionManager.setAcpConfigOption(sessionId, configId, type, value);
      res.json({ success: true, ...result });
    } catch (error) {
      logger.error(`[ACP Routes] Set config option error (session: ${sessionId}, config: ${configId}):`, error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * GET /api/acp/agent-config?agentId=xxx
   * 读取指定 agent 持久化的 configOptions，页面加载后无需真实会话即可渲染选择器
   */
  app.get('/api/acp/agent-config', (req: Request, res: Response) => {
    const agentId = String(req.query.agentId || '').trim();
    if (!agentId) {
      res.status(400).json({ error: 'agentId is required' });
      return;
    }
    res.json({ success: true, configOptions: readAgentConfigFile()[agentId]?.configOptions ?? null });
  });

  /**
   * POST /api/acp/agent-config
   * 保存指定 agent 的 configOptions 到 ~/.clover/agent-config.json（按 agentId 为 key）
   */
  app.post('/api/acp/agent-config', (req: Request, res: Response) => {
    const { agentId, configOptions } = req.body;
    if (!agentId || typeof agentId !== 'string') {
      res.status(400).json({ error: 'agentId is required' });
      return;
    }
    if (!Array.isArray(configOptions)) {
      res.status(400).json({ error: 'configOptions must be an array' });
      return;
    }

    try {
      const data = readAgentConfigFile();
      const prev = data[agentId];
      if (prev && JSON.stringify(prev.configOptions) === JSON.stringify(configOptions)) {
        res.json({ success: true, unchanged: true });
        return;
      }
      data[agentId] = {
        configOptions,
        updatedAt: new Date().toISOString(),
      };
      writeAgentConfigFile(data);
      res.json({ success: true });
    } catch (error) {
      logger.error(`[ACP Routes] Save agent config error (agent: ${agentId}):`, error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * POST /api/acp/ping
   * Ping 检测连接（同步返回）
   */
  app.post('/api/acp/ping', async (req: Request, res: Response) => {
    const { sessionId } = req.body;

    if (!sessionId) {
      res.status(400).json({ error: 'sessionId is required' });
      return;
    }

    try {
      res.json({ success: true, pong: true, timestamp: Date.now() });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // ============================================================================
  // 状态端点
  // ============================================================================

  /**
   * GET /api/acp/status
   * 获取系统状态
   */
  app.get('/api/acp/status', (req: Request, res: Response) => {
    res.json({
      sessions: sessionManager.getSessionCount(),
      activeSessions: sessionManager.getActiveSessionCount(),
      connections: sseManager.getConnectionCount(),
      // 事件面传输：进程内（Redis 已移除，单进程部署）
      eventSink: 'in-process',
    });
  });

  /**
   * GET /api/acp/health
   * 健康检查（进程内事件总线没有外部依赖，服务在跑即健康）
   */
  app.get('/api/acp/health', (req: Request, res: Response) => {
    res.json({
      status: 'healthy',
      eventSink: 'in-process',
      timestamp: Date.now(),
    });
  });

  // ============================================================================
  // Agent 状态管理（Settings → Agents）
  // ============================================================================

  /**
   * GET /api/acp/agents
   * 列出全部 Agent 及其运行状态（可用/不可用/离线/连接）
   */
  app.get('/api/acp/agents', (_req: Request, res: Response) => {
    if (!registry) {
      res.status(503).json({ error: 'Agent registry not initialized' });
      return;
    }
    try {
      res.json({ agents: registry.getStatus() });
    } catch (error) {
      logger.error('[ACP Routes] List agents error:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * POST /api/acp/agents/:id/check
   * Check Now：重新检测安装状态并尝试将 Agent 拉起到“连接”状态
   */
  app.post('/api/acp/agents/:id/check', async (req: Request, res: Response) => {
    if (!registry) {
      res.status(503).json({ error: 'Agent registry not initialized' });
      return;
    }
    try {
      const agent = await registry.checkNow(String(req.params.id));
      res.json({ agent });
    } catch (error) {
      logger.error(`[ACP Routes] Check agent error (agent: ${req.params.id}):`, error);
      const message = (error as Error).message;
      res.status(message.startsWith('Unknown agent') ? 404 : 500).json({ error: message });
    }
  });

  /**
   * POST /api/acp/agents/:id/install
   * 安装缺失的组件（Agent CLI 或 ACP 适配器），安装完成后自动重新探测并尝试连接
   */
  app.post('/api/acp/agents/:id/install', (req: Request, res: Response) => {
    if (!registry) {
      res.status(503).json({ error: 'Agent registry not initialized' });
      return;
    }
    const agentId = String(req.params.id);
    try {
      const job = registry.startInstall(agentId);
      if (!job) {
        res.status(409).json({ error: `Nothing to install for agent: ${agentId}` });
        return;
      }
      res.json({ job });
    } catch (error) {
      logger.error(`[ACP Routes] Install agent error (agent: ${agentId}):`, error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * GET /api/acp/agents/install/:jobId
   * 安装任务进度（设置页轮询）
   */
  app.get('/api/acp/agents/install/:jobId', (req: Request, res: Response) => {
    const job = getInstallJob(String(req.params.jobId));
    if (!job) {
      res.status(404).json({ error: 'Install job not found' });
      return;
    }
    res.json({ job });
  });

  // ============================================================================
  // 项目管理端点（免认证，使用 /api/projects 路径）
  // ============================================================================

  app.use('/api/projects', express.json());

  /**
   * POST /api/projects
   * 列出所有项目
   */
  app.post('/api/projects', async (_req: Request, res: Response) => {
    try {
      const projects = readProjects();
      res.json({ success: true, projects });
    } catch (error) {
      logger.error('[ACP Routes] List projects error:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * POST /api/tasks
   * 列出所有任务
   */
  app.post('/api/tasks', async (_req: Request, res: Response) => {
    try {
      const tasks = readTasks();
      res.json({ success: true, tasks });
    } catch (error) {
      logger.error('[ACP Routes] List tasks error:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * POST /api/projects/add
   * 新增项目或任务（通过 type 区分）
   */
  app.post('/api/projects/add', async (req: Request, res: Response) => {
    const { name, path: projectPath, type, sessions, id, createdAt } = req.body;

    if (type === 'task') {
      if (!id || !name) {
        res.status(400).json({ error: 'id and name are required for tasks' });
        return;
      }
      try {
        const tasks = readTasks();
        const existing = tasks.findIndex(t => t.id === id);
        const task: ProjectInfo = {
          name,
          path: projectPath || '',
          type: 'task',
          sessions: sessions || [],
          id,
          createdAt: createdAt || new Date().toISOString(),
        };
        if (existing >= 0) {
          tasks[existing] = { ...tasks[existing], ...task };
        } else {
          tasks.unshift(task);
        }
        writeTasks(tasks);
        res.json({ success: true, task });
      } catch (error) {
        logger.error(`[ACP Routes] Add task error (id: ${id}):`, error);
        res.status(500).json({ error: (error as Error).message });
      }
    } else {
      if (!name || !projectPath) {
        res.status(400).json({ error: 'name and path are required' });
        return;
      }
      if (!existsSync(projectPath)) {
        res.status(400).json({ error: 'Directory does not exist' });
        return;
      }
      try {
        const projects = readProjects();
        if (projects.some(p => p.name === name)) {
          res.status(409).json({ error: 'Project already exists' });
          return;
        }
        projects.push({ name, path: projectPath, type: 'project', sessions: sessions || [] });
        writeProjects(projects);
        res.json({ success: true, projects });
      } catch (error) {
        logger.error(`[ACP Routes] Add project error (name: ${name}):`, error);
        res.status(500).json({ error: (error as Error).message });
      }
    }
  });

  /**
   * POST /api/projects/delete
   * 删除项目或任务（通过 type 区分）
   */
  app.post('/api/projects/delete', async (req: Request, res: Response) => {
    const { name, type, id } = req.body;

    if (type === 'task') {
      if (!id && !name) {
        res.status(400).json({ error: 'id or name is required for tasks' });
        return;
      }
    } else if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }

    try {
      if (type === 'task') {
        // 优先按 id 精确匹配，避免同名任务被误删；无 id 时回退按 name
        const tasks = readTasks().filter(t => (id ? t.id !== id : t.name !== name));
        writeTasks(tasks);
      } else {
        let projects = readProjects();
        projects = projects.filter(p => p.name !== name);
        writeProjects(projects);
      }
      res.json({ success: true });
    } catch (error) {
      logger.error(`[ACP Routes] Delete error (name: ${name}, type: ${type}):`, error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * POST /api/projects/save-session
   * 保存会话到项目（upsert）；path 不属于 project 时回退到 task 记录（tasks.json）
   */
  app.post('/api/projects/save-session', async (req: Request, res: Response) => {
    const { projectPath, session } = req.body;

    if (!projectPath || !session?.sessionId || !session?.agentId) {
      res.status(400).json({ error: 'projectPath, sessionId, and agentId are required' });
      return;
    }

    try {
      const matches = (s: ProjectSession) =>
        s.sessionId === session.sessionId && s.agentId === session.agentId;

      // 1. 已包含该会话的 project 记录
      const projects = readProjects();
      const ownerProject = projects.find(p => p.path === projectPath && p.sessions?.some(matches));
      if (ownerProject) {
        const idx = ownerProject.sessions.findIndex(matches);
        ownerProject.sessions[idx] = { ...ownerProject.sessions[idx], ...session };
        writeProjects(projects);
        res.json({ success: true, project: ownerProject });
        return;
      }

      // 2. 该会话可能属于 task 记录（tasks.json）——同步标题等字段
      const tasks = readTasks();
      const ownerTask = tasks.find(t => t.path === projectPath && t.sessions?.some(matches));
      if (ownerTask) {
        const idx = ownerTask.sessions.findIndex(matches);
        ownerTask.sessions[idx] = { ...ownerTask.sessions[idx], ...session };
        // 任务标题与会话标题保持一致（task.name 用于会话头部回填）
        if (session.title) ownerTask.name = session.title;
        writeTasks(tasks);
        res.json({ success: true, task: ownerTask });
        return;
      }

      // 3. 兼容原行为：path 命中 project 但会话尚不存在 → 追加
      const project = projects.find(p => p.path === projectPath);
      if (project) {
        project.sessions.push(session);
        writeProjects(projects);
        res.json({ success: true, project });
        return;
      }

      res.status(404).json({ error: 'Project not found' });
    } catch (error) {
      logger.error(`[ACP Routes] Save session error (session: ${session.sessionId}, agent: ${session.agentId}):`, error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * POST /api/projects/delete-session
   * 从项目中删除会话
   */
  app.post('/api/projects/delete-session', async (req: Request, res: Response) => {
    const { projectPath, sessionId } = req.body;

    if (!projectPath || !sessionId) {
      res.status(400).json({ error: 'projectPath and sessionId are required' });
      return;
    }

    try {
      const projects = readProjects();
      const project = projects.find(p => p.path === projectPath);
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      project.sessions = project.sessions.filter(s => s.sessionId !== sessionId);
      writeProjects(projects);
      res.json({ success: true });
    } catch (error) {
      logger.error(`[ACP Routes] Delete session error (session: ${sessionId}):`, error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  const SELECTED_PROJECT_FILE = join(PROJECTS_DIR, 'selected-project.json');

  function readSelectedProject(): { selectedProject: string | null; selectedSessionId: string | null } {
    if (!existsSync(SELECTED_PROJECT_FILE)) return { selectedProject: null, selectedSessionId: null };
    try {
      const raw = JSON.parse(readFileSync(SELECTED_PROJECT_FILE, 'utf-8'));
      return { selectedProject: raw.selectedProject || null, selectedSessionId: raw.selectedSessionId || null };
    } catch {
      return { selectedProject: null, selectedSessionId: null };
    }
  }

  function writeSelectedProject(name: string | null, sessionId: string | null): void {
    mkdirSync(PROJECTS_DIR, { recursive: true });
    writeFileSync(SELECTED_PROJECT_FILE, JSON.stringify({ selectedProject: name, selectedSessionId: sessionId }, null, 2));
  }

  app.get('/api/projects/selected', (_req: Request, res: Response) => {
    try {
      const { selectedProject, selectedSessionId } = readSelectedProject();
      res.json({ success: true, selectedProject, selectedSessionId });
    } catch (error) {
      logger.error('[ACP Routes] Get selected project error:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.post('/api/projects/selected', (req: Request, res: Response) => {
    const { selectedProject, selectedSessionId } = req.body;
    try {
      writeSelectedProject(selectedProject || null, selectedSessionId || null);
      res.json({ success: true });
    } catch (error) {
      logger.error(`[ACP Routes] Save selected project error (project: ${selectedProject}):`, error);
      res.status(500).json({ error: (error as Error).message });
    }
  });
}

export default setupAcpRoutes;
