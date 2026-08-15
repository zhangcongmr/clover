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
  showSettings = input<boolean>(false);
  settingsChange = output<boolean>();
  protected localAgentService = inject(LocalAgentService);
  protected acpService = inject(AcpService);

  // HTTP URL for SSE connection (not WebSocket)
  protected httpProtocol = window.location.protocol === 'https:' ? 'https' : 'http';
  protected ipAndPort = this.localAgentService.getBaseUrl().replace(/^((https|http)?:\/\/)?/, '').replace(/\/$/, '');
  serverUrl = signal<string>(`${this.httpProtocol}://${this.ipAndPort}`);
  authToken = signal<string>('');
  workingDir = signal<string>('');
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

      // 工作目录为必选项，为空时阻止连接
      if (!cwd) {
        this.acpService.setError('Working Directory is required');
        return;
      }
      
      // Set ACP config with the selected agent
      const agent = this.acpService.selectedAgent();
      if (agent) {
        await this.acpService.setAcpConfig({ command: agent.command, args: agent.args, env: agent.env });
      }

      // Connect via SSE (creates session and connects to SSE)
      await this.acpService.connect(this.serverUrl());
      this.settingsChange.emit(false);
    } catch (error: any) {
      console.error('[ACP Session] Connection failed:', error);
    }
  }

  async disconnect(): Promise<void> {
    await this.acpService.disconnect();
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

}
