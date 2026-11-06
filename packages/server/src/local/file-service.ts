import { logger } from '../helpers/logger.js';
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
import { join, basename, resolve, dirname, sep } from 'node:path';
import { statSync, watch, type FSWatcher } from 'node:fs';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { LocalFileRequest, LocalFileResponse } from './protocol.js';

const execAsync = promisify(exec);

/** How long a single drive probe may take before the drive is considered absent. */
const DRIVE_PROBE_TIMEOUT_MS = 1000;

export interface ScanNode {
  name: string;
  kind: 'directory' | 'file';
  absolutePath: string;
  /** Platform of the machine running this service, e.g. "win32" or "linux". */
  platform?: NodeJS.Platform;
  /** Separator used by `absolutePath` on that platform ("\\" on Windows). */
  separator?: '\\' | '/';
  children?: ScanNode[];
}

/** A mountable filesystem root, e.g. "C:\\" on Windows or "/" on POSIX. */
export interface RootEntry {
  /** Display label, e.g. "C:" or "/". */
  name: string;
  /** Absolute path used to scan the root. */
  path: string;
}

export interface RootsResult {
  platform: NodeJS.Platform;
  separator: '\\' | '/';
  roots: RootEntry[];
}

export class FileService {
  private readonly: boolean;
  private watchers = new Map<string, FSWatcher>();

  constructor(readonly: boolean = false) {
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
      throw new Error('Server is running in read-only mode');
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
      case 'scan':
        return this.scan(filePath, (request as any).depth ?? 1, (request as any).ignore ?? []);
      case 'roots':
        return this.roots();
      case 'openInFileExplorer':
        return this.openInFileExplorer(filePath);
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  async scan(dirPath: string, depth: number = 1, ignore: string[] = []): Promise<ScanNode> {
    const resolved = resolve(dirPath);
    const ignoreSet = new Set(ignore);
    const root = await this.scanRecursive(resolved, depth, 0, ignoreSet);
    // Report the server's own platform so clients never have to guess whether
    // paths use "\" or "/" (the browser may run on a different OS).
    root.platform = process.platform;
    root.separator = sep === '\\' ? '\\' : '/';
    // A filesystem root has no basename, so label it with the drive ("C:") on
    // Windows and "/" elsewhere, letting the tree show an identifiable root.
    if (!root.name) {
      const drive = /^[A-Za-z]:/.exec(resolved);
      root.name = drive ? drive[0] : (process.platform === 'win32' ? resolved : '/');
    }
    return root;
  }

  /**
   * List the filesystem roots this machine can browse. Windows may expose
   * several partitions, so the picker needs all of them instead of assuming a
   * single root.
   */
  async roots(): Promise<RootsResult> {
    const roots: RootEntry[] = [];
    if (process.platform === 'win32') {
      // Probe every letter concurrently, and bound each probe: a mapped network
      // drive that is offline can block for seconds and must not delay the list.
      const letters = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));
      const probes = await Promise.all(
        letters.map(async (letter): Promise<RootEntry | null> => {
          const drive = `${letter}:\\`;
          const available = await Promise.race([
            access(drive).then(() => true).catch(() => false),
            new Promise<boolean>(resolve => setTimeout(() => resolve(false), DRIVE_PROBE_TIMEOUT_MS)),
          ]);
          return available ? { name: `${letter}:`, path: drive } : null;
        }),
      );
      roots.push(...probes.filter((root): root is RootEntry => root !== null));
    } else {
      roots.push({ name: '/', path: '/' });
    }
    return { platform: process.platform, separator: sep === '\\' ? '\\' : '/', roots };
  }

  private async scanRecursive(dirPath: string, maxDepth: number, currentDepth: number, ignoreSet: Set<string>): Promise<ScanNode> {
    const resolved = resolve(dirPath);
    const s = await stat(resolved).catch(() => null);
    const name = basename(resolved);
    const isDir = s?.isDirectory();

    const node: ScanNode = {
      name,
      kind: isDir ? 'directory' : 'file',
      absolutePath: resolved,
    };

    if (!isDir || currentDepth >= maxDepth) {
      return node;
    }

    let entries;
    try {
      entries = await readdir(resolved, { withFileTypes: true });
    } catch {
      return node;
    }

    const children: ScanNode[] = [];
    for (const entry of entries) {
      if (ignoreSet.has(entry.name)) continue;
      if (entry.name.startsWith('.') && entry.name !== '.') continue;

      try {
        const child = await this.scanRecursive(join(resolved, entry.name), maxDepth, currentDepth + 1, ignoreSet);
        children.push(child);
      } catch {
        // skip inaccessible entries
      }
    }

    node.children = children.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return node;
  }

  private async listDir(dirPath: string): Promise<any> {
    const resolved = resolve(dirPath);
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

    return items.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  private async readFile(filePath: string): Promise<any> {
    const resolved = resolve(filePath);
    const content = await readFile(resolved, 'utf-8');
    const s = await stat(resolved);
    return {
      content,
      size: s.size,
      contentType: 'text/plain'
    };
  }

  private async writeFile(filePath: string, content: string): Promise<any> {
    const resolved = resolve(filePath);
    await writeFile(resolved, content, 'utf-8');
    const s = await stat(resolved);
    return { size: s.size };
  }

  private async deleteFile(filePath: string): Promise<any> {
    const resolved = resolve(filePath);
    await rm(resolved, { recursive: true, force: true });
    return { deleted: true };
  }

  private async createFile(filePath: string): Promise<any> {
    const resolved = resolve(filePath);
    await writeFile(resolved, '', 'utf-8');
    return { created: true };
  }

  private async createDir(dirPath: string): Promise<any> {
    const resolved = resolve(dirPath);
    await mkdir(resolved, { recursive: true });
    return { created: true };
  }

  private async rename(oldPath: string, newName: string): Promise<any> {
    const resolvedOld = resolve(oldPath);
    const dir = join(resolvedOld, '..');
    const resolvedNew = resolve(dir, newName);
    await rename(resolvedOld, resolvedNew);
    return { renamed: true, newPath: resolvedNew };
  }

  private async stat(filePath: string): Promise<any> {
    const resolved = resolve(filePath);
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
      const resolved = resolve(filePath);
      await access(resolved);
      return { exists: true };
    } catch {
      return { exists: false };
    }
  }

  private async openInFileExplorer(filePath: string): Promise<any> {
    const resolved = resolve(filePath);
    const s = await stat(resolved).catch(() => null);
    if (!s) {
      throw new Error(`Path does not exist: ${resolved}`);
    }

    let command: string;
    const platform = process.platform;

    if (platform === 'win32') {
      if (s.isDirectory()) {
        command = `explorer.exe "${resolved}"`;
      } else {
        command = `explorer.exe /select,"${resolved}"`;
      }
    } else if (platform === 'darwin') {
      if (s.isDirectory()) {
        command = `open "${resolved}"`;
      } else {
        command = `open -R "${resolved}"`;
      }
    } else {
      if (s.isDirectory()) {
        command = `xdg-open "${resolved}"`;
      } else {
        command = `xdg-open "${dirname(resolved)}"`;
      }
    }

    await execAsync(command);
    return { opened: true, path: resolved };
  }

  startWatching(filePath: string, callback: (eventType: string) => void): void {
    if (this.watchers.has(filePath)) return;

    const resolved = resolve(filePath);

    let changeTimer: ReturnType<typeof setTimeout> | null = null;

    const doWatch = () => {
      try {
        const watcher = watch(resolved, { persistent: false }, (eventType: string) => {
          if (eventType === 'rename') {
            callback(eventType);
            this.stopWatching(filePath);
            setTimeout(() => doWatch(), 200);
          } else {
            if (changeTimer) clearTimeout(changeTimer);
            changeTimer = setTimeout(() => callback(eventType), 50);
          }
        });
        this.watchers.set(filePath, watcher);
        logger.log(`[FileService] Started watching: ${resolved}`);
      } catch (err) {
        logger.error(`[FileService] Failed to watch file: ${resolved}`, err);
      }
    };

    doWatch();
  }

  stopWatching(filePath: string): void {
    const watcher = this.watchers.get(filePath);
    if (watcher) {
      watcher.close();
      this.watchers.delete(filePath);
    }
  }

  stopAllWatching(): void {
    this.watchers.forEach(w => w.close());
    this.watchers.clear();
  }
}
