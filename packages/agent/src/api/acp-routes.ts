import type { Express, Request, Response } from 'express';
import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { AcpSessionManager } from '../acp/session-manager.js';
import { SseManager } from '../acp/sse-manager.js';
import { RedisClient } from '../redis/client.js';
import type { TokenManager } from '../agent/auth.js';
import type { FileService } from '../agent/file-service.js';
import { createRequireAuth } from './middleware.js';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const PROJECTS_DIR = join(homedir(), '.clover');
const PROJECTS_FILE = join(PROJECTS_DIR, 'projects.json');
const TASKS_FILE = join(PROJECTS_DIR, 'tasks.json');
const SELECTED_FILE = join(PROJECTS_DIR, 'selected.json');

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

export interface AcpRouteOptions {
  tokenManager: TokenManager;
  sessionManager: AcpSessionManager;
  sseManager: SseManager;
  redis: RedisClient;
  fileService: FileService;
}

export function setupAcpRoutes(app: Express, options: AcpRouteOptions): void {
  const { tokenManager, sessionManager, sseManager, redis, fileService } = options;
  const requireAuth = createRequireAuth(tokenManager);

  // Parse JSON bodies for ACP routes. Generous enough for base64 media
  // attachments (frontend caps each file at 10MB, ~13MB base64), while still
  // rejecting oversized payloads.
  app.use('/api/acp', express.json({ limit: '20mb' }));
  app.use('/api/acp', requireAuth);

  // ============================================================================
  // SSE 事件流端点
  // ============================================================================

  /**
   * GET /api/acp/events/:sessionId
   * 建立 SSE 连接，持续接收服务器事件
   */
  app.get('/api/acp/events/:sessionId', (req: Request, res: Response) => {
    const sessionId = req.params.sessionId as string;

    // 验证会话是否存在
    const session = sessionManager.getSession(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    // 添加 SSE 连接
    sseManager.addConnection(sessionId, res);

    // 如果 agent 未连接，自动重连并恢复会话（优先 resume 旧会话延续上下文）
    if (!sessionManager.isAgentConnected(sessionId)) {
      sessionManager.connectSession(sessionId)
        .then(() => sessionManager.ensureAgentSession(sessionId))
        .then(() => {
          sseManager.sendToConnection(sessionId, {
            type: 'status',
            payload: { connected: true },
            timestamp: Date.now(),
          });
        })
        .catch((error) => {
          console.error(`[ACP Routes] Auto-reconnect failed for ${sessionId}:`, error);
          sessionManager.publishEvent(sessionId, {
            type: 'error',
            payload: { message: `Agent recovery failed: ${(error as Error).message}` },
            timestamp: Date.now(),
          });
        });
    } else {
      // agent 已连接：直接告知前端当前状态（初始连接也保证收到 status）
      sseManager.sendToConnection(sessionId, {
        type: 'status',
        payload: { connected: true },
        timestamp: Date.now(),
      });
    }
  });

  // ============================================================================
  // 会话管理端点
  // ============================================================================

  /**
   * POST /api/acp/session
   * 创建新的 ACP 会话
   */
  app.post('/api/acp/session', async (req: Request, res: Response) => {
    try {
      const { cwd: rawCwd, agentCommand, agentArgs, agentEnv } = req.body;

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

      // 创建会话
      const sessionId = await sessionManager.createSession({
        cwd: String(cwd).trim(),
        agentCommand,
        agentArgs,
        agentEnv,
      });

      // 连接到 agent
      await sessionManager.connectSession(sessionId);

      res.json({
        success: true,
        sessionId,
        cwd: String(cwd).trim(),
        message: 'Session created and connected',
      });
    } catch (error) {
      console.error('[ACP Routes] Create session error:', error);
      res.status(500).json({
        success: false,
        error: (error as Error).message,
      });
    }
  });

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
  // Prompt 端点
  // ============================================================================

  /**
   * POST /api/acp/prompt
   * 发送 prompt 请求
   */
  app.post('/api/acp/prompt', async (req: Request, res: Response) => {
    const { sessionId, content } = req.body;
    const requestId = uuidv4();

    if (!sessionId || !content) {
      res.status(400).json({ error: 'sessionId and content are required' });
      return;
    }

    // 检查会话是否存在
    const session = sessionManager.getSession(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    try {
      // 确保 agent 连接并拥有活跃会话（agent 崩溃后在此懒恢复）
      await sessionManager.ensureAgentSession(sessionId);

      // 发布 prompt 请求到 Redis
      await redis.publish(`acp:prompt:${sessionId}`, JSON.stringify({
        type: 'prompt',
        sessionId,
        payload: { content },
        requestId,
        timestamp: Date.now(),
      }));

      res.json({
        success: true,
        requestId,
        message: 'Prompt sent',
      });
    } catch (error) {
      console.error('[ACP Routes] Send prompt error:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // ============================================================================
  // 会话操作端点
  // ============================================================================

  /**
   * POST /api/acp/session/create
   * 创建新的 ACP 会话（在已连接的客户端中）
   */
  app.post('/api/acp/session/create', async (req: Request, res: Response) => {
    const { sessionId, cwd } = req.body;

    if (!sessionId) {
      res.status(400).json({ error: 'sessionId is required' });
      return;
    }

    try {
      const result = await sessionManager.createAcpSession(sessionId, cwd);
      res.json({ success: true, ...result });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * POST /api/acp/session/list
   * 列出会话（同步等待 agent 返回）
   */
  app.post('/api/acp/session/list', async (req: Request, res: Response) => {
    const { sessionId, cwd, cursor } = req.body;

    if (!sessionId) {
      res.status(400).json({ error: 'sessionId is required' });
      return;
    }

    try {
      const result = await sessionManager.listAcpSessions(sessionId, cwd, cursor);
      res.json({ success: true, ...result });
    } catch (error) {
      console.error('[ACP Routes] List sessions error:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * POST /api/acp/list-all-sessions
   * 聚合列出所有 agent 的会话（每个 agent 独立 create → connect → list → 清理）
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
    const allSessions: any[] = [];
    const failures: { agentId: string; error: string }[] = [];

    for (const agent of agents) {
      if (!agent || typeof agent.id !== 'string' || typeof agent.command !== 'string') {
        continue;
      }

      let sessionId: string | null = null;
      try {
        sessionId = await sessionManager.createSession({
          cwd: workingDir,
          agentCommand: agent.command,
          agentArgs: agent.args,
          agentEnv: agent.env,
        });

        await sessionManager.connectSession(sessionId);

        const result = await sessionManager.listAcpSessions(sessionId, workingDir);
        const sessions: any[] = result?.sessions ?? [];

        for (const s of sessions) {
          allSessions.push({ ...s, agentId: agent.id });
        }
      } catch (error) {
        console.warn(`[ACP Routes] Failed to list sessions for agent ${agent.id}:`, (error as Error).message || error);
        failures.push({ agentId: agent.id, error: (error as Error).message || String(error) });
      } finally {
        if (sessionId) {
          try {
            await sessionManager.removeSession(sessionId);
          } catch (cleanupError) {
            console.warn(`[ACP Routes] Failed to clean up wrapper session for agent ${agent.id}:`, cleanupError);
          }
        }
      }
    }

    res.json({ success: true, sessions: allSessions, failures });
  });

  /**
   * POST /api/acp/session/load
   * 加载会话（同步等待 agent 返回）
   */
  app.post('/api/acp/session/load', async (req: Request, res: Response) => {
    const { sessionId, loadSessionId, cwd } = req.body;

    if (!sessionId || !loadSessionId) {
      res.status(400).json({ error: 'sessionId and loadSessionId are required' });
      return;
    }

    try {
      const result = await sessionManager.loadAcpSession(sessionId, loadSessionId, cwd);
      res.json({ success: true, ...result });
    } catch (error) {
      console.error('[ACP Routes] Load session error:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * POST /api/acp/session/resume
   * 恢复会话（同步等待 agent 返回）
   */
  app.post('/api/acp/session/resume', async (req: Request, res: Response) => {
    const { sessionId, resumeSessionId, cwd } = req.body;

    if (!sessionId || !resumeSessionId) {
      res.status(400).json({ error: 'sessionId and resumeSessionId are required' });
      return;
    }

    try {
      const result = await sessionManager.resumeAcpSession(sessionId, resumeSessionId, cwd);
      res.json({ success: true, ...result });
    } catch (error) {
      console.error('[ACP Routes] Resume session error:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * POST /api/acp/session/delete
   * 删除会话（同步等待 agent 返回）
   */
  app.post('/api/acp/session/delete', async (req: Request, res: Response) => {
    const { sessionId, deleteSessionId } = req.body;

    if (!sessionId || !deleteSessionId) {
      res.status(400).json({ error: 'sessionId and deleteSessionId are required' });
      return;
    }

    try {
      await sessionManager.deleteAcpSession(sessionId, deleteSessionId);
      res.json({ success: true, message: 'Session deleted' });
    } catch (error) {
      console.error('[ACP Routes] Delete session error:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * POST /api/acp/config
   * 设置配置选项（同步等待 agent 返回）
   */
  app.post('/api/acp/config', async (req: Request, res: Response) => {
    const { sessionId, configId, type, value } = req.body;

    if (!sessionId || !configId || type === undefined || value === undefined) {
      res.status(400).json({ error: 'sessionId, configId, type, and value are required' });
      return;
    }

    try {
      const result = await sessionManager.setAcpConfigOption(sessionId, configId, type, value);
      res.json({ success: true, ...result });
    } catch (error) {
      console.error('[ACP Routes] Set config option error:', error);
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

  /**
   * POST /api/acp/cancel
   * 取消当前操作
   */
  app.post('/api/acp/cancel', async (req: Request, res: Response) => {
    const { sessionId } = req.body;

    if (!sessionId) {
      res.status(400).json({ error: 'sessionId is required' });
      return;
    }

    try {
      await redis.publish(`acp:prompt:${sessionId}`, JSON.stringify({
        type: 'cancel',
        sessionId,
        timestamp: Date.now(),
      }));

      res.json({ success: true, message: 'Cancel sent' });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  // ============================================================================
  // 权限端点
  // ============================================================================

  /**
   * POST /api/acp/permission
   * 发送权限响应
   */
  app.post('/api/acp/permission', async (req: Request, res: Response) => {
    const { sessionId, requestId, outcome } = req.body;

    if (!sessionId || !requestId || !outcome) {
      res.status(400).json({ error: 'sessionId, requestId, and outcome are required' });
      return;
    }

    try {
      await redis.publish(`acp:permission:${sessionId}`, JSON.stringify({
        type: 'permission_response',
        sessionId,
        requestId,
        payload: { outcome },
        timestamp: Date.now(),
      }));

      res.json({ success: true, message: 'Permission response sent' });
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
      redisConnected: redis.isPublisherReady(),
      redisMode: redis.isMemoryMode() ? 'memory' : 'redis',
    });
  });

  /**
   * GET /api/acp/health
   * 健康检查
   */
  app.get('/api/acp/health', (req: Request, res: Response) => {
    const redisReady = redis.isPublisherReady();
    const status = redisReady ? 'healthy' : 'degraded';

    res.status(redisReady ? 200 : 503).json({
      status,
      redis: redisReady ? 'connected' : 'disconnected',
      timestamp: Date.now(),
    });
  });

  // ============================================================================
  // Redis 模式配置
  // ============================================================================

  /**
   * GET /api/acp/redis-mode
   * 获取 Redis 模式 (memory 或 redis)
   */
  app.get('/api/acp/redis-mode', (req: Request, res: Response) => {
    res.json({
      mode: redis.isMemoryMode() ? 'memory' : 'redis',
      isMemoryMode: redis.isMemoryMode(),
    });
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
      console.error('[ACP Routes] List projects error:', error);
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
      console.error('[ACP Routes] List tasks error:', error);
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
        console.error('[ACP Routes] Add task error:', error);
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
        console.error('[ACP Routes] Add project error:', error);
        res.status(500).json({ error: (error as Error).message });
      }
    }
  });

  /**
   * POST /api/projects/delete
   * 删除项目或任务（通过 type 区分）
   */
  app.post('/api/projects/delete', async (req: Request, res: Response) => {
    const { name, type } = req.body;

    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }

    try {
      if (type === 'task') {
        const tasks = readTasks().filter(t => t.name !== name);
        writeTasks(tasks);
      } else {
        let projects = readProjects();
        projects = projects.filter(p => p.name !== name);
        writeProjects(projects);
      }
      res.json({ success: true });
    } catch (error) {
      console.error('[ACP Routes] Delete error:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  /**
   * POST /api/projects/save-session
   * 保存会话到项目
   */
  app.post('/api/projects/save-session', async (req: Request, res: Response) => {
    const { projectPath, session } = req.body;

    if (!projectPath || !session?.sessionId || !session?.agentId) {
      res.status(400).json({ error: 'projectPath, sessionId, and agentId are required' });
      return;
    }

    try {
      const projects = readProjects();
      const project = projects.find(p => p.path === projectPath);
      if (!project) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }

      const idx = project.sessions.findIndex(s => s.sessionId === session.sessionId && s.agentId === session.agentId);
      if (idx >= 0) {
        project.sessions[idx] = { ...project.sessions[idx], ...session };
      } else {
        project.sessions.push(session);
      }

      writeProjects(projects);
      res.json({ success: true, project });
    } catch (error) {
      console.error('[ACP Routes] Save session error:', error);
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
      console.error('[ACP Routes] Delete session error:', error);
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
      console.error('[ACP Routes] Get selected project error:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });

  app.post('/api/projects/selected', (req: Request, res: Response) => {
    const { selectedProject, selectedSessionId } = req.body;
    try {
      writeSelectedProject(selectedProject || null, selectedSessionId || null);
      res.json({ success: true });
    } catch (error) {
      console.error('[ACP Routes] Save selected project error:', error);
      res.status(500).json({ error: (error as Error).message });
    }
  });
}

export default setupAcpRoutes;
