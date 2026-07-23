import { Component, inject, signal } from '@angular/core';
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
  protected acpService = inject(AcpService);

  serverUrl = signal<string>('ws://localhost:9315/ws');
  showSettings = signal<boolean>(false);
  showSessionHistory = signal<boolean>(false);
  showFileExplorer = signal<boolean>(false);

  async connect(): Promise<void> {
    const url = this.serverUrl().trim();
    if (!url) {
      return;
    }

    try {
      await this.acpService.connect(url);
      await this.acpService.createSession();
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
    this.showSessionHistory.update(v => !v);
    if (this.showSessionHistory()) {
      this.acpService.listSessions();
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
    this.showSessionHistory.set(false);
  }

  resumeSession(sessionId: string): void {
    this.acpService.resumeSession(sessionId);
    this.showSessionHistory.set(false);
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

  getModelName(): string {
    const modelId = this.acpService.currentModelId();
    const models = this.acpService.sessionState().models?.models;
    if (!modelId || !models) return 'Unknown';
    const model = models.find(m => m.modelId === modelId);
    return model?.name || modelId;
  }
}
