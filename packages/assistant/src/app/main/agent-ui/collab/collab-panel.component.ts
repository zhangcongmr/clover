import { Component, ElementRef, effect, inject, output, signal, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CollabService, type CollabMessage } from './collab.service';
import { AcpPermissionDialogComponent } from '../../../shared/acp/acp-permission-dialog.component';
import type { ConfigOption } from '../../../shared/acp/acp.model';

@Component({
  selector: 'app-collab-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, AcpPermissionDialogComponent],
  templateUrl: './collab-panel.component.html',
  styleUrls: ['./collab-panel.component.css'],
})
export class CollabPanelComponent {
  protected readonly collab = inject(CollabService);
  protected readonly close = output<void>();

  @ViewChild('messageScroll') private messageScroll?: ElementRef<HTMLElement>;

  protected draft = signal('');
  /** Whether the per-agent mode/model settings block is expanded. */
  protected showAgentSettings = signal(false);

  constructor() {
    // Keep the transcript pinned to the bottom while chunks stream in.
    effect(() => {
      this.collab.messages();
      queueMicrotask(() => this.scrollToBottom());
    });
  }

  protected setDraft(value: string): void {
    this.draft.set(value);
  }

  /** Applies a mode/model change to one space agent's session. */
  protected onConfigChange(agentId: string, option: ConfigOption, value: string | boolean): void {
    if (option.currentValue === value) return;
    void this.collab.setAgentConfigOption(agentId, option.id, option.type === 'boolean' ? 'boolean' : 'id', value);
  }

  /** Enter sends; Shift+Enter keeps the default newline. */
  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.send();
    }
  }

  protected send(): void {
    const text = this.draft().trim();
    if (!text || this.collab.sending()) return;
    this.draft.set('');
    void this.collab.send(text);
  }

  protected trackMessage(_index: number, message: CollabMessage): string {
    return message.id;
  }

  protected statusLabel(message: CollabMessage): string {
    if (message.agentId) {
      const agent = this.collab.availableAgents().find(a => a.id === message.agentId);
      return agent?.name ?? message.agentId;
    }
    return '';
  }

  private scrollToBottom(): void {
    const element = this.messageScroll?.nativeElement;
    if (element) element.scrollTop = element.scrollHeight;
  }
}
