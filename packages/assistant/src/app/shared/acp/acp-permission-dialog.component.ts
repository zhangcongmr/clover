import { Component, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface PermissionRequest {
  params: any;
  resolve: (response: any) => void;
}

@Component({
  selector: 'app-acp-permission-dialog',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './acp-permission-dialog.component.html',
  styleUrls: ['./acp-permission-dialog.component.css']
})
export class AcpPermissionDialogComponent implements OnInit, OnDestroy {
  isVisible = signal<boolean>(false);
  currentRequest = signal<PermissionRequest | null>(null);
  toolTitle = signal<string>('');
  toolCallId = signal<string>('');
  options = signal<Array<{ optionId: string; label: string; description?: string }>>([]);

  private boundHandler = this.handlePermissionRequest.bind(this);

  ngOnInit(): void {
    window.addEventListener('acp-permission-request', this.boundHandler as EventListener);
  }

  ngOnDestroy(): void {
    window.removeEventListener('acp-permission-request', this.boundHandler as EventListener);
  }

  private handlePermissionRequest(event: Event): void {
    const customEvent = event as CustomEvent<PermissionRequest>;
    const { params, resolve } = customEvent.detail;

    this.currentRequest.set({ params, resolve });
    this.toolTitle.set(params.toolCall?.title || 'Tool Execution');
    this.toolCallId.set(params.toolCall?.toolCallId || '');
    this.options.set(params.options || []);
    this.isVisible.set(true);
  }

  selectOption(optionId: string): void {
    const request = this.currentRequest();
    if (request) {
      request.resolve({
        outcome: {
          outcome: 'selected',
          optionId
        }
      });
    }
    this.close();
  }

  cancel(): void {
    const request = this.currentRequest();
    if (request) {
      request.resolve({
        outcome: {
          outcome: 'cancelled',
          reason: 'User cancelled'
        }
      });
    }
    this.close();
  }

  private close(): void {
    this.isVisible.set(false);
    this.currentRequest.set(null);
    this.toolTitle.set('');
    this.toolCallId.set('');
    this.options.set([]);
  }
}
