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
  styleUrls: ['./acp-session-manager.component.css'],
  host: {
    '(document:click)': 'onDocumentClick($event)'
  }
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

  // HTTP URL for SSE connection (not WebSocket)
  protected httpProtocol = window.location.protocol === 'https:' ? 'https' : 'http';
  protected ipAndPort = this.localAgentService.getBaseUrl().replace(/^((https|http)?:\/\/)?/, '').replace(/\/$/, '');
  serverUrl = signal<string>(`${this.httpProtocol}://${this.ipAndPort}`);
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
  }

  async connect(): Promise<void> {
    try {
      const cwd = this.workingDir().trim();
      
      // Set ACP config with the selected agent
      const agent = this.acpService.selectedAgent();
      if (agent) {
        await this.acpService.setAcpConfig({ command: agent.command, args: agent.args });
      }

      // Connect via SSE (creates session and connects to SSE)
      await this.acpService.connect(this.serverUrl());
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

  async loadSession(sessionId: string): Promise<void> {
    await this.acpService.loadSession(sessionId);
  }

  async resumeSession(sessionId: string): Promise<void> {
    await this.acpService.resumeSession(sessionId);
  }

  async deleteSession(sessionId: string): Promise<void> {
    if (confirm('Are you sure you want to delete this session?')) {
      await this.acpService.deleteSession(sessionId);
    }
  }

  toggleDockMenu(): void {
    this.showDockMenu.update(v => !v);
  }

  setDockPosition(position: 'left' | 'right'): void {
    this.dockPositionChange.emit(position);
    this.showDockMenu.set(false);
  }

  onDocumentClick(event: MouseEvent): void {
    if (this.showDockMenu()) {
      this.showDockMenu.set(false);
    }
  }

}
