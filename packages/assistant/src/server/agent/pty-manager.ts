import { platform } from 'node:os';
import { existsSync } from 'node:fs';

type NodePty = {
  spawn: (file: string, args: string[], options: {
    name: string;
    cols: number;
    rows: number;
    cwd: string;
    env: Record<string, string>;
  }) => IPty;
};

export interface IPty {
  write(data: string): void;
  kill(signal?: number | string): void;
  onData(callback: (data: string) => void): void;
  onExit(callback: (event: { exitCode: number | null; signal: number | null }) => void): void;
  resize(cols: number, rows: number): void;
}

function loadNodePty() {
  const moduleName = 'node-pty';
  const runtimeRequire = (globalThis as any)['require']
    || (() => {
      const req = new Function('return require')();
      return (name: string) => req(name);
    })();

  try {
    return runtimeRequire(moduleName) as NodePty;
  } catch (error) {
    throw new Error(`Failed to load node-pty at runtime: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export interface PtyInstance {
  pty: IPty;
  id: string;
  createdAt: number;
}

export class PtyManager {
  private instances = new Map<string, PtyInstance>();
  private maxInstances: number;
  private idleTimeout: number;

  constructor(maxInstances: number = 10, idleTimeoutMs: number = 30 * 60 * 1000) {
    this.maxInstances = maxInstances;
    this.idleTimeout = idleTimeoutMs;
    this.startIdleCheck();
  }

  create(cols: number, rows: number, cwd: string): PtyInstance {
    if (this.instances.size >= this.maxInstances) {
      throw new Error(`Max PTY instances (${this.maxInstances}) reached`);
    }

    const id = `pty_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const shell = platform() === 'win32' ? 'powershell.exe' : (process.env['SHELL'] || '/bin/bash');

    const validCwd = (cwd && existsSync(cwd)) ? cwd : process.cwd();
    const { spawn } = loadNodePty();

    const pty = spawn(shell, [], {
      name: 'xterm-color',
      cols,
      rows,
      cwd: validCwd,
      env: process.env as Record<string, string>
    });

    const instance: PtyInstance = {
      pty,
      id,
      createdAt: Date.now()
    };

    this.instances.set(id, instance);
    return instance;
  }

  destroy(id: string): boolean {
    const instance = this.instances.get(id);
    if (!instance) return false;

    try {
      instance.pty.kill();
    } catch {
      // PTY may already be dead
    }

    this.instances.delete(id);
    return true;
  }

  getById(id: string): PtyInstance | undefined {
    return this.instances.get(id);
  }

  getAll(): PtyInstance[] {
    return Array.from(this.instances.values());
  }

  private startIdleCheck() {
    setInterval(() => {
      const now = Date.now();
      for (const [id, instance] of this.instances) {
        if (now - instance.createdAt > this.idleTimeout) {
          this.destroy(id);
        }
      }
    }, 60_000);
  }
}
