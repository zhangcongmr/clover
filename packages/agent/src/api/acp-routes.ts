import type { Express, Request, Response } from 'express';
import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { AcpSessionManager } from '../acp/session-manager.js';
import { SseManager } from '../acp/sse-manager.js';
import { RedisClient } from '../redis/client.js';
import type { TokenManager } from '../agent/auth.js';
import { createRequireAuth } from './middleware.js';

export interface AcpRouteOptions {
  tokenManager: TokenManager;
  sessionManager: AcpSessionManager;
  sseManager: SseManager;
  redis: RedisClient;
}

export function setupAcpRoutes(app: Express, options: AcpRouteOptions): void {
  const { tokenManager, sessionManager, sseManager, redis } = options;
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
      const { cwd, agentCommand, agentArgs, agentEnv } = req.body;

      // 工作目录为必选项，为空时拒绝创建会话
      if (!cwd || !String(cwd).trim()) {
        res.status(400).json({ error: 'cwd (working directory) is required' });
        return;
      }

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
    const { sessionId, cursor } = req.body;

    if (!sessionId) {
      res.status(400).json({ error: 'sessionId is required' });
      return;
    }

    try {
      const result = await sessionManager.listAcpSessions(sessionId, undefined, cursor);
      res.json({ success: true, ...result });
    } catch (error) {
      console.error('[ACP Routes] List sessions error:', error);
      res.status(500).json({ error: (error as Error).message });
    }
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
}

export default setupAcpRoutes;
