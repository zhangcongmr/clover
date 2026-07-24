import { Component, inject, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AcpService } from './acp.service';
import { AcpSessionManagerComponent } from './acp-session-manager.component';
import { AcpChatComponent } from './acp-chat.component';
import { AcpPermissionDialogComponent } from './acp-permission-dialog.component';

@Component({
  selector: 'app-acp-panel',
  standalone: true,
  imports: [
    CommonModule,
    AcpSessionManagerComponent,
    AcpChatComponent,
    AcpPermissionDialogComponent
  ],
  template: `
    <div class="acp-panel-container">
      <app-acp-session-manager (closePanel)="closePanel.emit()" />
      <app-acp-chat />
      <app-acp-permission-dialog />
    </div>
  `,
  styles: [`
    .acp-panel-container {
      display: flex;
      flex-direction: column;
      height: 100%;
      background-color: var(--vscode-background);
    }
  `]
})
export class AcpPanelComponent {
  closePanel = output<void>();
  protected acpService = inject(AcpService);
}
