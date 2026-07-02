import {
  readdir,
  readFile,
  writeFile,
  rm,
  stat,
  mkdir,
  rename,
  access
} from 'node:fs/promises';
import { join, basename } from 'node:path';
import { statSync } from 'node:fs';
import { validatePath } from './security.js';
import type { LocalFileRequest, LocalFileResponse } from './protocol.js';

export class FileService {
  private basePath: string;
  private readonly: boolean;

  constructor(basePath: string, readonly: boolean = false) {
    this.basePath = basePath;
    this.readonly = readonly;
  }

  async handle(request: LocalFileRequest): Promise<LocalFileResponse> {
    try {
      const result = await this.execute(request);
      return { type: 'file-service', success: true, requestId: request.requestId, data: result };
    } catch (err: any) {
      return { type: 'file-service', success: false, requestId: request.requestId, message: err.message };
    }
  }

  private async execute(request: LocalFileRequest): Promise<any> {
    const { action, path: filePath, content, newName } = request;

    if (this.readonly && ['writeFile', 'deleteFile', 'createFile', 'createDir', 'rename'].includes(action)) {
      throw new Error('Agent is running in read-only mode');
    }

    switch (action) {
      case 'listDir':
        return this.listDir(filePath);
      case 'readFile':
        return this.readFile(filePath);
      case 'writeFile':
        return this.writeFile(filePath, content || '');
      case 'deleteFile':
        return this.deleteFile(filePath);
      case 'createFile':
        return this.createFile(filePath);
      case 'createDir':
        return this.createDir(filePath);
      case 'rename':
        if (!newName) throw new Error('newName is required for rename');
        return this.rename(filePath, newName);
      case 'stat':
        return this.stat(filePath);
      case 'exists':
        return this.exists(filePath);
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  private async listDir(dirPath: string): Promise<any> {
    const resolved = validatePath(this.basePath, dirPath);
    const entries = await readdir(resolved, { withFileTypes: true });
    const items = [];

    for (const entry of entries) {
      try {
        const fullPath = join(resolved, entry.name);
        const s = statSync(fullPath, { throwIfNoEntry: false });
        items.push({
          name: entry.name,
          kind: entry.isDirectory() ? 'directory' : 'file',
          size: s?.size || 0,
          mtime: s?.mtime?.toISOString() || null
        });
      } catch {
        items.push({
          name: entry.name,
          kind: entry.isDirectory() ? 'directory' : 'file',
          size: 0,
          mtime: null
        });
      }
    }

    return items;
  }

  private async readFile(filePath: string): Promise<any> {
    const resolved = validatePath(this.basePath, filePath);
    const content = await readFile(resolved, 'utf-8');
    const s = await stat(resolved);
    return {
      content,
      size: s.size,
      contentType: 'text/plain'
    };
  }

  private async writeFile(filePath: string, content: string): Promise<any> {
    const resolved = validatePath(this.basePath, filePath);
    await writeFile(resolved, content, 'utf-8');
    const s = await stat(resolved);
    return { size: s.size };
  }

  private async deleteFile(filePath: string): Promise<any> {
    const resolved = validatePath(this.basePath, filePath);
    await rm(resolved, { recursive: true, force: true });
    return { deleted: true };
  }

  private async createFile(filePath: string): Promise<any> {
    const resolved = validatePath(this.basePath, filePath);
    await writeFile(resolved, '', 'utf-8');
    return { created: true };
  }

  private async createDir(dirPath: string): Promise<any> {
    const resolved = validatePath(this.basePath, dirPath);
    await mkdir(resolved, { recursive: true });
    return { created: true };
  }

  private async rename(oldPath: string, newName: string): Promise<any> {
    const resolvedOld = validatePath(this.basePath, oldPath);
    const dir = join(resolvedOld, '..');
    const resolvedNew = validatePath(dir, newName);
    await rename(resolvedOld, resolvedNew);
    return { renamed: true, newPath: resolvedNew };
  }

  private async stat(filePath: string): Promise<any> {
    const resolved = validatePath(this.basePath, filePath);
    const s = await stat(resolved);
    return {
      name: basename(resolved),
      kind: s.isDirectory() ? 'directory' : 'file',
      size: s.size,
      mtime: s.mtime.toISOString()
    };
  }

  private async exists(filePath: string): Promise<any> {
    try {
      const resolved = validatePath(this.basePath, filePath);
      await access(resolved);
      return { exists: true };
    } catch {
      return { exists: false };
    }
  }
}
