import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AcpService, AcpToolCall } from './acp.service';

@Component({
  selector: 'app-acp-tool-calls',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './acp-tool-calls.component.html',
  styleUrls: ['./acp-tool-calls.component.css']
})
export class AcpToolCallsComponent {
  protected acpService = inject(AcpService);

  getStatusIcon(status: string): string {
    switch (status) {
      case 'running':
        return 'M12 2v4m0 12v4m-7.07-15.07l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4m-15.07 7.07l2.83-2.83m8.48-8.48l2.83-2.83';
      case 'completed':
        return 'M20 6L9 17l-5-5';
      case 'failed':
        return 'M18 6L6 18M6 6l12 12';
      default:
        return 'M12 8v4m0 4h.01';
    }
  }

  getStatusClass(status: string): string {
    switch (status) {
      case 'running':
        return 'status-running';
      case 'completed':
        return 'status-completed';
      case 'failed':
        return 'status-failed';
      default:
        return 'status-pending';
    }
  }

  formatToolCallId(id: string): string {
    return id.substring(0, 8) + '...';
  }

  trackByToolCallId(index: number, toolCall: AcpToolCall): string {
    return toolCall.id;
  }
}
