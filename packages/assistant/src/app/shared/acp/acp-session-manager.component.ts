import { Component, inject, signal, input, output, effect, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AcpService } from './acp.service';
import { SessionInfo } from './acp-websocket.service';
import { LocalAgentService } from '../local-agent/local-agent.service';

@Component({
  selector: 'app-acp-session-manager',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './acp-session-manager.component.html',
  styleUrls: ['./acp-session-manager.component.css']
})
export class AcpSessionManagerComponent {
  closePanel = output<void>();
  maximizePanel = output<void>();
  restorePanel = output<void>();
  dockPositionChange = output<'left' | 'right'>();
  isMaximized = input<boolean>(false);
  dockPosition = input<'left' | 'right'>('right');
  protected localAgentService = inject(LocalAgentService);
  protected acpService = inject(AcpService);
  showDockMenu = signal<boolean>(false);

  protected wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  protected ipAndPort = this.localAgentService.getBaseUrl().replace(/^((https|http)?:\/\/)?/, '').replace(/\/$/, '');
  serverUrl = signal<string>(`${this.wsProtocol}://${this.ipAndPort}/ws/acp`);
  authToken = signal<string>('');
  workingDir = signal<string>('');
  showSettings = signal<boolean>(false);
  protected canDeleteSession = computed(() => this.acpService.canDeleteSession());
  private autoConnectAttempted = false;

  constructor() {
    effect(() => {
      const hint = this.acpService.workingDirHint();
      this.workingDir.set(hint);
      if (hint && !this.autoConnectAttempted && !this.acpService.sessionState().isConnected && !this.acpService.sessionState().isConnecting) {
        this.autoConnectAttempted = true;
        this.connect();
      }
    });

    effect(() => {
      const show = this.acpService.showSessionHistory();
      const connected = this.acpService.isConnected();
      if (show && connected) {
        this.acpService.listSessions(this.acpService.workingDirHint());
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

  toggleDockMenu(): void {
    this.showDockMenu.update(v => !v);
  }

  setDockPosition(position: 'left' | 'right'): void {
    this.dockPositionChange.emit(position);
    this.showDockMenu.set(false);
  }

}
