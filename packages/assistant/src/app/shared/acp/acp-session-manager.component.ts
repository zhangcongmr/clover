import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AcpService } from './acp.service';

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

  clearChat(): void {
    this.acpService.clearMessages();
  }
}
