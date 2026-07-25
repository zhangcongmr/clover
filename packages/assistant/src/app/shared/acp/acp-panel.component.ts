import { Component, inject, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AcpService } from './acp.service';
import { AcpSessionManagerComponent } from './acp-session-manager.component';
import { AcpChatComponent } from './acp-chat.component';
import { AcpChatInputComponent } from './acp-chat-input.component';
import { AcpPermissionDialogComponent } from './acp-permission-dialog.component';


@Component({
  selector: 'app-acp-panel',
  standalone: true,
  imports: [
    CommonModule,
    AcpSessionManagerComponent,
    AcpChatComponent,
    AcpChatInputComponent,
    AcpPermissionDialogComponent
  ],
  template: `
    <div class="acp-panel-container" [class.has-chat]="acpService.hasOpenedSession()">
      <app-acp-session-manager (closePanel)="closePanel.emit()" />
      @if (acpService.hasOpenedSession()) {
        <app-acp-chat />
      }
      <app-acp-chat-input />
      <app-acp-permission-dialog />
    </div>
  `,
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
    }
    .acp-panel-container {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      background-color: var(--vscode-background);
    }
    .acp-panel-container app-acp-session-manager {
      flex: 1;
      min-height: 0;
    }
    .acp-panel-container.has-chat app-acp-session-manager {
      flex: none;
    }
    .acp-panel-container app-acp-chat {
      flex: 1;
      min-height: 0;
    }
    .acp-panel-container app-acp-chat-input {
      flex-shrink: 0;
    }
  `]
})
export class AcpPanelComponent {
  closePanel = output<void>();
  protected acpService = inject(AcpService);
}
