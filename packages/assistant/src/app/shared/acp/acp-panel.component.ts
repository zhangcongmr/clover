import { Component, inject, input, output } from '@angular/core';
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
      <app-acp-session-manager (closePanel)="closePanel.emit()" (maximizePanel)="maximizePanel.emit()" (restorePanel)="restorePanel.emit()" [isMaximized]="isMaximized()" />
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
      overflow: auto;
      position: relative;
      z-index: 10;
      height: 100%;
      border-left: 1px solid var(--vscode-editorGroup-border);
    }
    .acp-panel-container {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      background-color: var(--vscode-background);
    }

    .acp-panel-container.has-chat app-acp-session-manager {
      flex: none;
    }
  `]
})
export class AcpPanelComponent {
  closePanel = output<void>();
  maximizePanel = output<void>();
  restorePanel = output<void>();
  isMaximized = input<boolean>(false);
  protected acpService = inject(AcpService);
}
