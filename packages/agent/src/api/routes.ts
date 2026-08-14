import express from 'express';
import { TokenManager } from '../agent/auth.js';
import { FileService } from '../agent/file-service.js';
import { createRequireAuth } from './middleware.js';
import { setAcpConfig, getAcpConfig, storeAcpHttpServer, isAcpHttpServerReady } from '../acp/index.js';

export interface AgentServices {
  tokenManager: TokenManager;
  fileService: FileService;
}

export function setupAgentRoutes(app: express.Application, services: AgentServices): void {
  const { tokenManager, fileService } = services;

  app.use('/api/local', express.json());

  const requireAuth = createRequireAuth(tokenManager);

  // Token endpoint
  app.get('/api/local/auth/token', (_req, res) => {
    const { token, expiresAt } = tokenManager.generate();
    res.json({ token, expiresIn: Math.floor((expiresAt - Date.now()) / 1000) });
  });

  // Health check
  app.get('/api/local/health', (_req, res) => {
    res.json({ status: 'ok', readonly: process.env['LUXIO_READONLY'] === 'true' });
  });

  // ACP config endpoint
  app.post('/api/local/acp/config', (req, res) => {
    const { command, args, env } = req.body;
    if (!command) {
      res.status(400).json({ success: false, message: 'command is required' });
      return;
    }

    // Register httpServer from the request if not already registered
    if (!isAcpHttpServerReady()) {
      const httpServer = (req.socket as any)?.server;
      if (httpServer) {
        const isHttps = req.protocol === 'https';
        storeAcpHttpServer(httpServer, isHttps);  // Store without triggering trySetup
      }
    }

    setAcpConfig({ command, args, env });  // This will trigger trySetup once
    res.json({ success: true, config: getAcpConfig() });
  });

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
}
