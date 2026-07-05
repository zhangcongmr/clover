import { Injectable, signal } from '@angular/core';

const PROBE_TIMEOUT_MS = 1500;

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

  /** Agent availability status (components can subscribe) */
  isAvailable = signal(false);
  /** Agent URL */
  connectedUrl = signal<string>('');

  constructor() {
    // Read agentUrl from localStorage (UI Settings) - only in browser
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem('assistant_agentUrl');
      if (stored) {
        this.agentUrl = stored;
      }
    }
  }

  /** Get base URL for API requests (same-origin or agentUrl) */
  private getBaseUrl(): string {
    return this.agentUrl || window.location.origin;
  }

  /** Get the configured agentUrl (for display/terminal use) */
  getAgentUrl(): string {
    return this.agentUrl || window.location.origin;
  }

  /** Update agentUrl at runtime */
  setAgentUrl(url: string) {
    this.agentUrl = url;
    if (typeof localStorage !== 'undefined') {
      if (url) {
        localStorage.setItem('assistant_agentUrl', url);
      } else {
        localStorage.removeItem('assistant_agentUrl');
      }
    }
  }

  async getToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.tokenExpiry) {
      return this.cachedToken;
    }

    const base = this.getBaseUrl();
    const res = await fetch(`${base}/api/local/auth/token`);
    if (!res.ok) throw new Error(`Token request failed: ${res.status}`);
    const data = await res.json();
    this.cachedToken = data.token;
    this.tokenExpiry = Date.now() + (data.expiresIn * 1000) - 5000;
    return this.cachedToken!;
  }

  async checkAgentAvailable(url?: string): Promise<boolean> {
    const target = url || this.getBaseUrl();
    try {
      const res = await fetch(`${target}/api/local/health`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Probe and connect to the agent (same-origin or agentUrl) */
  async probeAndConnect(): Promise<boolean> {
    const ok = await this.checkAgentAvailable();
    this.isAvailable.set(ok);
    if (ok) this.connectedUrl.set(this.getBaseUrl());
    return ok;
  }

  /** Get WebSocket terminal URL */
  async getTerminalWsUrl(): Promise<string> {
    const token = await this.getToken();
    const base = this.getBaseUrl();
    const url = new URL(base);
    const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${url.host}/ws/terminal?token=${token}`;
  }

  // --- File operations (HTTP) ---

  async scanDir(path: string, depth: number = 1, ignore: string[] = []): Promise<any> {
    const token = await this.getToken();
    const base = this.getBaseUrl();
    const res = await fetch(`${base}/api/local/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ path, depth, ignore })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    return data.data;
  }

  async listDir(path: string): Promise<any[]> {
    const token = await this.getToken();
    const base = this.getBaseUrl();
    const res = await fetch(`${base}/api/local/listDir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ path })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    return data.data;
  }

  async readFile(path: string): Promise<string> {
    const token = await this.getToken();
    const base = this.getBaseUrl();
    const res = await fetch(`${base}/api/local/readFile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ path })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    return data.data.content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    const token = await this.getToken();
    const base = this.getBaseUrl();
    const res = await fetch(`${base}/api/local/writeFile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ path, content })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
  }

  async deleteFile(path: string): Promise<void> {
    const token = await this.getToken();
    const base = this.getBaseUrl();
    const res = await fetch(`${base}/api/local/deleteFile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ path })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
  }

  async createFile(path: string): Promise<void> {
    const token = await this.getToken();
    const base = this.getBaseUrl();
    const res = await fetch(`${base}/api/local/createFile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ path })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
  }

  async createDir(path: string): Promise<void> {
    const token = await this.getToken();
    const base = this.getBaseUrl();
    const res = await fetch(`${base}/api/local/createDir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ path })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
  }

  async rename(oldPath: string, newName: string): Promise<void> {
    const token = await this.getToken();
    const base = this.getBaseUrl();
    const res = await fetch(`${base}/api/local/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ path: oldPath, newName })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
  }

  async stat(path: string): Promise<any> {
    const token = await this.getToken();
    const base = this.getBaseUrl();
    const res = await fetch(`${base}/api/local/stat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ path })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    return data.data;
  }

  async exists(path: string): Promise<boolean> {
    const token = await this.getToken();
    const base = this.getBaseUrl();
    const res = await fetch(`${base}/api/local/exists`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ path })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    return data.data.exists;
  }

  disconnect() {
    this.cachedToken = null;
    this.tokenExpiry = 0;
    this.isAvailable.set(false);
    this.connectedUrl.set('');
  }
}
