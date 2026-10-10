import { Component, ElementRef, effect, HostListener, inject, output, signal, ViewChild } from '@angular/core';
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

  /** Key (`agentId::optionId`) of the currently open custom select dropdown. */
  protected openSelectKey = signal<string | null>(null);
  /** Viewport position/size computed when a dropdown opens (escapes the scroll clip via `position: fixed`). */
  protected openSelectPos = signal<{ left: number; top: number; width: number } | null>(null);

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

  private selectKey(agentId: string, option: ConfigOption): string {
    return `${agentId}::${option.id}`;
  }

  /** Label of the option's current value, shown on the closed trigger. */
  protected optionLabel(option: ConfigOption): string {
    const match = (option.options ?? []).find(o => o.value === option.currentValue);
    if (match) return match.name;
    return typeof option.currentValue === 'string' ? option.currentValue : '';
  }

  protected isSelectOpen(agentId: string, option: ConfigOption): boolean {
    return this.openSelectKey() === this.selectKey(agentId, option);
  }

  /** Opens/closes the custom dropdown, anchored to the trigger's viewport rect. */
  protected toggleSelect(agentId: string, option: ConfigOption, event: MouseEvent): void {
    event.stopPropagation();
    if (this.isSelectOpen(agentId, option)) {
      this.closeSelect();
      return;
    }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const width = Math.max(rect.width, 160);
    const panelHeight = Math.min((option.options?.length ?? 0) * 36 + 2, 400);
    let top = rect.bottom + 4;
    if (top + panelHeight > window.innerHeight) {
      const flipped = rect.top - panelHeight - 4;
      top = flipped >= 0 ? flipped : Math.max(8, window.innerHeight - panelHeight - 8);
    }
    this.openSelectKey.set(this.selectKey(agentId, option));
    this.openSelectPos.set({ left: rect.left, top, width });
  }

  protected chooseOption(agentId: string, option: ConfigOption, value: string): void {
    this.onConfigChange(agentId, option, value);
    this.closeSelect();
  }

  protected closeSelect(): void {
    this.openSelectKey.set(null);
    this.openSelectPos.set(null);
  }

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: MouseEvent): void {
    // Trigger clicks stopPropagation, so only outside/panel clicks reach here;
    // panel clicks are handled by chooseOption (which closes explicitly).
    if (!(event.target as HTMLElement).closest('.settings-select-dropdown')) {
      this.closeSelect();
    }
  }

  @HostListener('document:keydown.escape')
  protected onEscapeKey(): void {
    this.closeSelect();
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
