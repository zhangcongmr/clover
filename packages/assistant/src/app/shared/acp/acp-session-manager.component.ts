import { Component, inject, signal, output, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AcpService } from './acp.service';
import { SessionInfo, DirItem } from './acp-websocket.service';

@Component({
  selector: 'app-acp-session-manager',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './acp-session-manager.component.html',
  styleUrls: ['./acp-session-manager.component.css']
})
export class AcpSessionManagerComponent {
  closePanel = output<void>();
  protected acpService = inject(AcpService);

  protected wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  serverUrl = signal<string>(`${this.wsProtocol}://localhost:9315/ws`);
  authToken = signal<string>('');
  workingDir = signal<string>('');
  showSettings = signal<boolean>(false);
  showFileExplorer = signal<boolean>(false);
  protected canDeleteSession = signal<boolean>(false);

  constructor() {
    effect(() => {
      const hint = this.acpService.workingDirHint();
      this.workingDir.set(hint);
      if (hint && !this.acpService.sessionState().isConnected && !this.acpService.sessionState().isConnecting) {
        this.connect();
      }
    });
  }

  async connect(): Promise<void> {
    const url = this.serverUrl().trim();
    if (!url) {
      return;
    }

    try {
      const token = this.authToken().trim();
      const cwd = this.workingDir().trim();
      let connectUrl = url;
      
      if (token) {
        const urlObj = new URL(connectUrl);
        urlObj.searchParams.set('token', token);
        connectUrl = urlObj.toString();
      }

      await this.acpService.connect(connectUrl);
      this.showSettings.set(false);
    } catch (error: any) {
      console.error('[ACP Session] Connection failed:', error);
    }
  }

  async disconnect(): Promise<void> {
    await this.acpService.disconnect();
  }

  toggleSettings(): void {
    this.showSettings.update(v => !v);
  }

  toggleSessionHistory(): void {
    this.acpService.showSessionHistory.update(v => !v);
    if (this.acpService.showSessionHistory()) {
      this.acpService.listSessions(this.acpService.workingDirHint());
    }
  }

  toggleFileExplorer(): void {
    this.showFileExplorer.update(v => !v);
    if (this.showFileExplorer()) {
      this.acpService.listDir('');
    }
  }

  clearChat(): void {
    this.acpService.clearMessages();
  }

  loadSession(sessionId: string): void {
    this.acpService.loadSession(sessionId);
  }

  resumeSession(sessionId: string): void {
    this.acpService.resumeSession(sessionId);
  }

  deleteSession(sessionId: string): void {
    if (confirm('Are you sure you want to delete this session?')) {
      this.acpService.deleteSession(sessionId);
    }
  }

  navigateDir(path: string): void {
    this.acpService.listDir(path);
  }

  openFile(path: string): void {
    this.acpService.readFile(path);
  }

  goBackDir(): void {
    const currentPath = this.acpService.currentDirPath();
    const parentPath = currentPath.split('/').slice(0, -1).join('/');
    this.acpService.listDir(parentPath);
  }

}
