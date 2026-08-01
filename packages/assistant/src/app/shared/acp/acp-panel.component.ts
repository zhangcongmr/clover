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
    <div class="card-base acp-panel-container" [class.has-chat]="acpService.hasOpenedSession()">
      <app-acp-session-manager (closePanel)="closePanel.emit()" (maximizePanel)="maximizePanel.emit()" (restorePanel)="restorePanel.emit()" (dockPositionChange)="dockPositionChange.emit($event)" [isMaximized]="isMaximized()" [dockPosition]="dockPosition()" />
      @if (acpService.hasOpenedSession()) {
        <app-acp-chat />
      }
      <app-acp-chat-input />
      <app-acp-permission-dialog />
    </div>
  `,
  host: {
    '[class.dock-left]': "dockPosition() === 'left'"
  },
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      overflow: auto;
      position: relative;
      z-index: 10;
      background-color: var(--vscode-editor-background);
      margin: 5px 5px 5px 0;
    }
    :host(.dock-left) {
      margin: 5px 0 5px 5px;
    }
    .card-base {
      background-color: var(--vscode-editor-background);
      border-radius: 0;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15), 0 1px 3px rgba(0, 0, 0, 0.1);
      border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.2));
    }
    .acp-panel-container {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
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
  dockPositionChange = output<'left' | 'right'>();
  isMaximized = input<boolean>(false);
  dockPosition = input<'left' | 'right'>('right');
  protected acpService = inject(AcpService);
}
