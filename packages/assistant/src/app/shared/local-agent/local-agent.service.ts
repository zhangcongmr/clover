import { Injectable, signal } from '@angular/core';
import { MyConfigService } from '../../my-config.service';

const DEFAULT_PORTS = [9120, 9121, 9122, 9123];
const PROBE_TIMEOUT_MS = 1500;
const REPROBE_INTERVAL_MS = 15000;

export interface LocalFileRequest {
  type: 'file-request';
  action: string;
  path: string;
  content?: string;
  newName?: string;
  requestId?: string;
}

export interface LocalFileResponse {
  type: 'file-service';
  success: boolean;
  requestId?: string;
  data?: any;
  message?: string;
}

@Injectable({ providedIn: 'root' })
export class LocalAgentService {
  private agentUrl = '';
  private cachedToken: string | null = null;
  private tokenExpiry: number = 0;
  private wsConnection: WebSocket | null = null;
  private pendingRequests = new Map<string, (res: LocalFileResponse) => void>();
  private isConnecting = false;
  private reprobeTimer: any = null;

  /** Agent 可用状态（组件可订阅） */
  isAvailable = signal(false);
  /** Agent 地址 */
  connectedUrl = signal<string>('');

  constructor(private myConfigService: MyConfigService) {
    // 从配置读取自定义 Agent 地址
    const configUrl = this.myConfigService.getAgentUrl();
    if (configUrl) {
      this.agentUrl = configUrl;
    }
  }

  setAgentUrl(url: string) {
    this.agentUrl = url;
  }

  getAgentUrl(): string {
    return this.agentUrl || `http://127.0.0.1:9120`;
  }

  async getToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.tokenExpiry) {
      return this.cachedToken;
    }

    const url = this.getAgentUrl();
    const res = await fetch(`${url}/token`);
    if (!res.ok) throw new Error(`Token request failed: ${res.status}`);
    const data = await res.json();
    this.cachedToken = data.token;
    this.tokenExpiry = Date.now() + (data.expiresIn * 1000) - 5000;
    return this.cachedToken!;
  }

  async checkAgentAvailable(url?: string): Promise<boolean> {
    const target = url || this.getAgentUrl();
    try {
      const res = await fetch(`${target}/health`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
      return res.ok;
    } catch {
      return false;
    }
  }

  // 自动探测：尝试常见端口，找到可用的 Agent
  async probeAndConnect(): Promise<boolean> {
    // 如果已配置固定地址，直接探测
    if (this.agentUrl) {
      const ok = await this.checkAgentAvailable(this.agentUrl);
      this.isAvailable.set(ok);
      if (ok) this.connectedUrl.set(this.agentUrl);
      return ok;
    }

    // 依次探测默认端口
    for (const port of DEFAULT_PORTS) {
      const url = `http://127.0.0.1:${port}`;
      const ok = await this.checkAgentAvailable(url);
      if (ok) {
        this.agentUrl = url;
        this.isAvailable.set(true);
        this.connectedUrl.set(url);
        console.log(`[LocalAgent] Found agent at ${url}`);
        return true;
      }
    }

    this.isAvailable.set(false);
    this.connectedUrl.set('');
    return false;
  }

  // 启动定期探测
  startAutoProbe() {
    this.probeAndConnect();
    this.reprobeTimer = setInterval(() => {
      this.probeAndConnect();
    }, REPROBE_INTERVAL_MS);
  }

  // 停止定期探测
  stopAutoProbe() {
    if (this.reprobeTimer) {
      clearInterval(this.reprobeTimer);
      this.reprobeTimer = null;
    }
  }

  async connectFileService(): Promise<WebSocket> {
    if (this.wsConnection && this.wsConnection.readyState === WebSocket.OPEN) {
      return this.wsConnection;
    }

    if (this.isConnecting) {
      return new Promise((resolve) => {
        const check = setInterval(() => {
          if (this.wsConnection && this.wsConnection.readyState === WebSocket.OPEN) {
            clearInterval(check);
            resolve(this.wsConnection);
          }
        }, 100);
      });
    }

    this.isConnecting = true;

    try {
      const token = await this.getToken();
      const url = this.getAgentUrl();
      const wsUrl = `${url.replace(/^http/, 'ws')}?token=${token}`;

      return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          ws.send(JSON.stringify({ type: 'file-service' }));
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'file-service' && msg.success) {
              this.wsConnection = ws;
              this.isConnecting = false;
              this.isAvailable.set(true);
              resolve(ws);
              return;
            }

            if (msg.requestId && this.pendingRequests.has(msg.requestId)) {
              const cb = this.pendingRequests.get(msg.requestId)!;
              this.pendingRequests.delete(msg.requestId);
              cb(msg);
            }
          } catch (e) {
            console.error('[LocalAgent] Message parse error:', e);
          }
        };

        ws.onerror = (err) => {
          this.isConnecting = false;
          this.isAvailable.set(false);
          reject(err);
        };

        ws.onclose = () => {
          this.wsConnection = null;
          this.isConnecting = false;
          this.pendingRequests.clear();
        };
      });
    } catch (err) {
      this.isConnecting = false;
      throw err;
    }
  }

  async sendFileRequest(request: LocalFileRequest): Promise<LocalFileResponse> {
    if (!this.wsConnection || this.wsConnection.readyState !== WebSocket.OPEN) {
      await this.connectFileService();
    }

    return new Promise((resolve, reject) => {
      const requestId = request.requestId || `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const requestWithId = { ...request, requestId };

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('Request timeout'));
      }, 30000);

      this.pendingRequests.set(requestId, (response) => {
        clearTimeout(timeout);
        if (response.success) {
          resolve(response);
        } else {
          reject(new Error(response.message || 'Request failed'));
        }
      });

      this.wsConnection!.send(JSON.stringify(requestWithId));
    });
  }

  async listDir(path: string): Promise<any[]> {
    const res = await this.sendFileRequest({ type: 'file-request', action: 'listDir', path });
    return res.data;
  }

  async readFile(path: string): Promise<string> {
    const res = await this.sendFileRequest({ type: 'file-request', action: 'readFile', path });
    return res.data.content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    await this.sendFileRequest({ type: 'file-request', action: 'writeFile', path, content });
  }

  async deleteFile(path: string): Promise<void> {
    await this.sendFileRequest({ type: 'file-request', action: 'deleteFile', path });
  }

  async createFile(path: string): Promise<void> {
    await this.sendFileRequest({ type: 'file-request', action: 'createFile', path });
  }

  async createDir(path: string): Promise<void> {
    await this.sendFileRequest({ type: 'file-request', action: 'createDir', path });
  }

  async rename(oldPath: string, newName: string): Promise<void> {
    await this.sendFileRequest({ type: 'file-request', action: 'rename', path: oldPath, newName });
  }

  async stat(path: string): Promise<any> {
    const res = await this.sendFileRequest({ type: 'file-request', action: 'stat', path });
    return res.data;
  }

  async exists(path: string): Promise<boolean> {
    const res = await this.sendFileRequest({ type: 'file-request', action: 'exists', path });
    return res.data.exists;
  }

  disconnect() {
    this.stopAutoProbe();
    if (this.wsConnection) {
      this.wsConnection.close();
      this.wsConnection = null;
    }
    this.pendingRequests.clear();
  }
}
