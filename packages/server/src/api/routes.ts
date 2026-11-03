import express from 'express';
import { TokenManager } from '../local/auth.js';
import { FileService } from '../local/file-service.js';
import { createRequireAuth } from './middleware.js';
import type {
  ScanRequest,
  ScanResponse,
  ListDirRequest,
  ListDirResponse,
  ReadFileRequest,
  ReadFileResponse,
  WriteFileRequest,
  WriteFileResponse,
  DeleteFileRequest,
  DeleteFileResponse,
  CreateFileRequest,
  CreateFileResponse,
  CreateDirRequest,
  CreateDirResponse,
  RenameRequest,
  RenameResponse,
  StatRequest,
  StatResponse,
  ExistsRequest,
  ExistsResponse,
  OpenInFileExplorerRequest,
  OpenInFileExplorerResponse,
  TokenResponse,
  HealthResponse,
  LocalFileErrorResponse,
} from './local-types.js';

export interface LocalServices {
  tokenManager: TokenManager;
  fileService: FileService;
}

export function setupLocalRoutes(app: express.Application, services: LocalServices): void {
  const { tokenManager, fileService } = services;

  app.use('/api/local', express.json());

  const requireAuth = createRequireAuth(tokenManager);

  // Token endpoint
  app.get<Record<string, string>, TokenResponse | LocalFileErrorResponse, any, any, any>(
    '/api/local/auth/token',
    (_req, res) => {
      const { token, expiresAt } = tokenManager.generate();
      res.json({ token, expiresIn: Math.floor((expiresAt - Date.now()) / 1000) });
    },
  );

  // Health check
  app.get<Record<string, string>, HealthResponse | LocalFileErrorResponse, any, any, any>(
    '/api/local/health',
    (_req, res) => {
      res.json({ status: 'ok', readonly: process.env['CLOVER_READONLY'] === 'true' });
    },
  );

  // File operation endpoints
  app.post<
    Record<string, string>,
    ScanResponse | LocalFileErrorResponse,
    ScanRequest,
    any,
    any
  >('/api/local/scan', requireAuth, async (req, res) => {
    const { path: dirPath, depth, ignore } = req.body;
    if (!dirPath) {
      res.status(400).json({ success: false, message: 'path is required' });
      return;
    }
    const result = await fileService.handle({ type: 'file-request', action: 'scan', path: dirPath, depth, ignore } as any);
    res.json(result as ScanResponse);
  });

  app.post<
    Record<string, string>,
    ListDirResponse | LocalFileErrorResponse,
    ListDirRequest,
    any,
    any
  >('/api/local/listDir', requireAuth, async (req, res) => {
    const { path: dirPath } = req.body;
    if (!dirPath) {
      res.status(400).json({ success: false, message: 'path is required' });
      return;
    }
    const result = await fileService.handle({ type: 'file-request', action: 'listDir', path: dirPath });
    res.json(result as ListDirResponse);
  });

  app.post<
    Record<string, string>,
    ReadFileResponse | LocalFileErrorResponse,
    ReadFileRequest,
    any,
    any
  >('/api/local/readFile', requireAuth, async (req, res) => {
    const { path: filePath } = req.body;
    if (!filePath) {
      res.status(400).json({ success: false, message: 'path is required' });
      return;
    }
    const result = await fileService.handle({ type: 'file-request', action: 'readFile', path: filePath });
    res.json(result as ReadFileResponse);
  });

  app.post<
    Record<string, string>,
    WriteFileResponse | LocalFileErrorResponse,
    WriteFileRequest,
    any,
    any
  >('/api/local/writeFile', requireAuth, async (req, res) => {
    const { path: filePath, content } = req.body;
    if (!filePath) {
      res.status(400).json({ success: false, message: 'path is required' });
      return;
    }
    const result = await fileService.handle({ type: 'file-request', action: 'writeFile', path: filePath, content });
    res.json(result as WriteFileResponse);
  });

  app.post<
    Record<string, string>,
    DeleteFileResponse | LocalFileErrorResponse,
    DeleteFileRequest,
    any,
    any
  >('/api/local/deleteFile', requireAuth, async (req, res) => {
    const { path: filePath } = req.body;
    if (!filePath) {
      res.status(400).json({ success: false, message: 'path is required' });
      return;
    }
    const result = await fileService.handle({ type: 'file-request', action: 'deleteFile', path: filePath });
    res.json(result as DeleteFileResponse);
  });

  app.post<
    Record<string, string>,
    CreateFileResponse | LocalFileErrorResponse,
    CreateFileRequest,
    any,
    any
  >('/api/local/createFile', requireAuth, async (req, res) => {
    const { path: filePath } = req.body;
    if (!filePath) {
      res.status(400).json({ success: false, message: 'path is required' });
      return;
    }
    const result = await fileService.handle({ type: 'file-request', action: 'createFile', path: filePath });
    res.json(result as CreateFileResponse);
  });

  app.post<
    Record<string, string>,
    CreateDirResponse | LocalFileErrorResponse,
    CreateDirRequest,
    any,
    any
  >('/api/local/createDir', requireAuth, async (req, res) => {
    const { path: dirPath } = req.body;
    if (!dirPath) {
      res.status(400).json({ success: false, message: 'path is required' });
      return;
    }
    const result = await fileService.handle({ type: 'file-request', action: 'createDir', path: dirPath });
    res.json(result as CreateDirResponse);
  });

  app.post<
    Record<string, string>,
    RenameResponse | LocalFileErrorResponse,
    RenameRequest,
    any,
    any
  >('/api/local/rename', requireAuth, async (req, res) => {
    const { path: oldPath, newName } = req.body;
    if (!oldPath || !newName) {
      res.status(400).json({ success: false, message: 'path and newName are required' });
      return;
    }
    const result = await fileService.handle({ type: 'file-request', action: 'rename', path: oldPath, newName });
    res.json(result as RenameResponse);
  });

  app.post<
    Record<string, string>,
    StatResponse | LocalFileErrorResponse,
    StatRequest,
    any,
    any
  >('/api/local/stat', requireAuth, async (req, res) => {
    const { path: filePath } = req.body;
    if (!filePath) {
      res.status(400).json({ success: false, message: 'path is required' });
      return;
    }
    const result = await fileService.handle({ type: 'file-request', action: 'stat', path: filePath });
    res.json(result as StatResponse);
  });

  app.post<
    Record<string, string>,
    ExistsResponse | LocalFileErrorResponse,
    ExistsRequest,
    any,
    any
  >('/api/local/exists', requireAuth, async (req, res) => {
    const { path: filePath } = req.body;
    if (!filePath) {
      res.status(400).json({ success: false, message: 'path is required' });
      return;
    }
    const result = await fileService.handle({ type: 'file-request', action: 'exists', path: filePath });
    res.json(result as ExistsResponse);
  });

  app.post<
    Record<string, string>,
    OpenInFileExplorerResponse | LocalFileErrorResponse,
    OpenInFileExplorerRequest,
    any,
    any
  >('/api/local/openInFileExplorer', requireAuth, async (req, res) => {
    const { path: filePath } = req.body;
    if (!filePath) {
      res.status(400).json({ success: false, message: 'path is required' });
      return;
    }
    const result = await fileService.handle({ type: 'file-request', action: 'openInFileExplorer', path: filePath });
    res.json(result as OpenInFileExplorerResponse);
  });
}
