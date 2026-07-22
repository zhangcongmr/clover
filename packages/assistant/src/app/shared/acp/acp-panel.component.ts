import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AcpService } from './acp.service';
import { AcpSessionManagerComponent } from './acp-session-manager.component';
import { AcpChatComponent } from './acp-chat.component';
import { AcpToolCallsComponent } from './acp-tool-calls.component';
import { AcpPermissionDialogComponent } from './acp-permission-dialog.component';

@Component({
  selector: 'app-acp-panel',
  standalone: true,
  imports: [
    CommonModule,
    AcpSessionManagerComponent,
    AcpChatComponent,
    AcpToolCallsComponent,
    AcpPermissionDialogComponent
  ],
  template: `
    <div class="acp-panel-container">
      <app-acp-session-manager />
      
      <div class="acp-panel-content">
        <app-acp-chat />
        
        @if (acpService.toolCalls().length > 0) {
          <div class="acp-panel-sidebar">
            <app-acp-tool-calls />
          </div>
        }
      </div>

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

    .acp-panel-content {
      flex: 1;
      display: flex;
      overflow: hidden;
    }

    .acp-panel-content app-acp-chat {
      flex: 1;
      min-width: 0;
    }

    .acp-panel-sidebar {
      width: 300px;
      border-left: 1px solid var(--vscode-editorGroup-border);
      overflow-y: auto;
      background-color: var(--vscode-sideBar-background);
    }

    @media (max-width: 768px) {
      .acp-panel-sidebar {
        display: none;
      }
    }
  `]
})
export class AcpPanelComponent {
  protected acpService = inject(AcpService);
}
