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
      case 'pending':
        return '⏳';
      case 'in_progress':
        return '🔄';
      case 'completed':
        return '✅';
      case 'failed':
        return '❌';
      default:
        return '❓';
    }
  }

  getStatusClass(status: string): string {
    switch (status) {
      case 'pending':
        return 'status-pending';
      case 'in_progress':
        return 'status-running';
      case 'completed':
        return 'status-completed';
      case 'failed':
        return 'status-failed';
      default:
        return 'status-unknown';
    }
  }

  getKindIcon(kind?: string): string {
    switch (kind) {
      case 'read':
        return '📖';
      case 'edit':
        return '✏️';
      case 'delete':
        return '🗑️';
      case 'move':
        return '📦';
      case 'search':
        return '🔍';
      case 'execute':
        return '⚡';
      case 'think':
        return '💭';
      case 'fetch':
        return '🌐';
      case 'switch_mode':
        return '🔄';
      default:
        return '🔧';
    }
  }

  formatJson(obj: unknown): string {
    if (!obj) return '';
    try {
      return JSON.stringify(obj, null, 2);
    } catch {
      return String(obj);
    }
  }

  getFilePath(toolCall: AcpToolCall): string | null {
    if (toolCall.locations && toolCall.locations.length > 0) {
      return toolCall.locations[0].path;
    }
    return null;
  }
}
