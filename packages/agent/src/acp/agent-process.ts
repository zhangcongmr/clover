import { spawn, type ChildProcess } from 'node:child_process';
import { Writable, Readable } from 'node:stream';
import type { Stream } from '@agentclientprotocol/sdk';
import { ndJsonStream } from '@agentclientprotocol/sdk';

export interface AgentProcessConfig {
  command: string;
  args?: string[];
  cwd?: string;
}

/**
 * Manages an ACP agent subprocess.
 *
 * Spawns the agent, provides stdio-based ACP Stream, and handles lifecycle.
 */
export class AgentProcess {
  private process: ChildProcess | null = null;

  /**
   * Spawn the agent process.
   */
  spawn(config: AgentProcessConfig): void {
    if (this.process) {
      this.kill();
    }

    const { command, args = [], cwd } = config;

    console.log(`[ACP AgentProcess] Spawning: ${command} ${args.join(' ')}`);

    this.process = spawn(command, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
    });

    // Log stderr for debugging
    if (this.process.stderr) {
      let stderrBuffer = '';
      this.process.stderr.on('data', (chunk: Buffer) => {
        stderrBuffer += chunk.toString();
        const lines = stderrBuffer.split('\n');
        stderrBuffer = lines.pop() || '';
        for (const line of lines) {
          if (line.trim()) {
            console.log(`[ACP Agent stderr] ${line}`);
          }
        }
      });
    }

    this.process.on('close', (code) => {
      console.log(`[ACP AgentProcess] Process exited with code: ${code}`);
      this.process = null;
    });

    this.process.on('error', (err) => {
      console.error('[ACP AgentProcess] Process error:', err.message);
      this.process = null;
    });
  }

  /**
   * Create an ACP Stream over the agent's stdio.
   *
   * Uses the SDK's `ndJsonStream` to convert between newline-delimited JSON
   * on stdio and the ACP `Stream` interface.
   */
  createStream(): Stream {
    if (!this.process?.stdin || !this.process?.stdout) {
      throw new Error('Agent process not running');
    }

    const inputStream = Readable.toWeb(
      this.process.stdout,
    ) as unknown as ReadableStream<Uint8Array>;

    const outputStream = Writable.toWeb(
      this.process.stdin,
    ) as unknown as WritableStream<Uint8Array>;

    return ndJsonStream(outputStream, inputStream);
  }

  /**
   * Kill the agent process.
   */
  kill(): void {
    if (this.process) {
      console.log('[ACP AgentProcess] Killing process');
      this.process.kill();
      this.process = null;
    }
  }

  /**
   * Check if the process is running.
   */
  isRunning(): boolean {
    return this.process !== null && !this.process.killed;
  }

  /**
   * Register a callback for when the process exits.
   */
  onClose(cb: (code: number | null) => void): void {
    this.process?.on('close', cb);
  }
}
