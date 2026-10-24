import { Component, ElementRef, effect, HostListener, inject, output, signal, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CollabService, type CollabMessage, type CollabMode } from './collab.service';
import { AcpPermissionDialogComponent } from '../../../shared/acp/acp-permission-dialog.component';
import type { ConfigOption } from '../../../shared/acp/acp.model';

interface ModeTab {
  id: CollabMode;
  label: string;
  hint: string;
}

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

  /** Collaboration mode tabs (01 单点 / 02 流水线 / 03 并行 / 04 自愿认领). */
  protected readonly modes: ModeTab[] = [
    { id: 'single', label: '单点', hint: '一条提示词只路由到 1 个 Session，完成即结束' },
    { id: 'pipeline', label: '流水线', hint: '多个 Session 顺序接棒，输出逐级传递' },
    { id: 'parallel', label: '并行', hint: '多个 Session 同时处理互不依赖的子任务' },
    { id: 'voluntary', label: '自愿认领', hint: '完成后广播，其余 Session 自行判断是否接手' },
  ];

  /** Preset session roles offered by the picker dropdown. */
  protected readonly rolePresets: string[] = ['代码审查专家', '文档撰写专家', '文档评审专家'];

  @ViewChild('messageScroll') private messageScroll?: ElementRef<HTMLElement>;

  protected draft = signal('');
  /** Whether the per-session mode/model settings block is expanded. */
  protected showAgentSettings = signal(false);

  /** Key (`participantId::optionId`) of the currently open custom select dropdown. */
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

  protected setMode(mode: CollabMode): void {
    this.collab.collabMode.set(mode);
  }

  // --- Session slot editing (create-time) -----------------------------------

  protected addParticipant(): void {
    this.collab.addParticipant();
  }

  protected removeParticipant(id: string): void {
    this.collab.removeParticipant(id);
  }

  protected onParticipantAgent(id: string, agentId: string): void {
    this.collab.updateParticipant(id, { agentId });
  }

  protected onParticipantRole(id: string, field: 'role' | 'responsibility', value: string): void {
    this.collab.updateParticipant(id, { [field]: value });
  }

  // --- Mode configuration ---------------------------------------------------

  protected addSubTask(): void {
    this.collab.addSubTask();
  }

  protected removeSubTask(id: string): void {
    this.collab.removeSubTask(id);
  }

  protected onSubTaskPrompt(id: string, value: string): void {
    this.collab.updateSubTask(id, { prompt: value });
  }

  protected onSubTaskRole(id: string, value: string): void {
    this.collab.updateSubTask(id, { targetRole: value });
  }

  protected onSubTaskParticipant(id: string, value: string): void {
    this.collab.updateSubTask(id, { targetParticipantId: value });
  }

  protected moveStage(participantId: string, delta: number): void {
    this.collab.movePipelineStage(participantId, delta);
  }

  protected setNumber(signalRef: { set(value: number): void }, value: unknown): void {
    signalRef.set(this.collab.clampTurns(Number(value)));
  }

  /** Applies a mode/model change to one participating session. */
  protected onConfigChange(participantId: string, option: ConfigOption, value: string | boolean): void {
    if (option.currentValue === value) return;
    void this.collab.setAgentConfigOption(
      participantId,
      option.id,
      option.type === 'boolean' ? 'boolean' : 'id',
      value,
    );
  }

  private selectKey(participantId: string, option: ConfigOption): string {
    return `${participantId}::${option.id}`;
  }

  /** Label of the option's current value, shown on the closed trigger. */
  protected optionLabel(option: ConfigOption): string {
    const match = (option.options ?? []).find(o => o.value === option.currentValue);
    if (match) return match.name;
    return typeof option.currentValue === 'string' ? option.currentValue : '';
  }

  protected isSelectOpen(participantId: string, option: ConfigOption): boolean {
    return this.openSelectKey() === this.selectKey(participantId, option);
  }

  /** Opens/closes the custom dropdown, anchored to the trigger's viewport rect. */
  protected toggleSelect(participantId: string, option: ConfigOption, event: MouseEvent): void {
    event.stopPropagation();
    if (this.isSelectOpen(participantId, option)) {
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
    this.openSelectKey.set(this.selectKey(participantId, option));
    this.openSelectPos.set({ left: rect.left, top, width });
  }

  protected chooseOption(participantId: string, option: ConfigOption, value: string): void {
    this.onConfigChange(participantId, option, value);
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
    if (!this.collab.canSend(text)) return;
    this.draft.set('');
    void this.collab.send(text);
  }

  protected trackMessage(_index: number, message: CollabMessage): string {
    return message.id;
  }

  protected statusLabel(message: CollabMessage): string {
    if (message.participantId) return this.collab.participantLabel(message.participantId);
    if (message.agentId) {
      const label = this.collab.agentLabelOf(message.agentId);
      return message.agentRole ? `${label} · ${message.agentRole}` : label;
    }
    return '';
  }

  /** Human label of a participant id (for "接棒自" / "放弃" annotations). */
  protected participantLabel(participantId: string | undefined): string {
    return this.collab.participantLabel(participantId);
  }

  /** Human label of an ACP session id (fallback for older metadata). */
  protected sessionLabel(sessionId: string | undefined): string {
    return this.collab.participantLabelBySession(sessionId);
  }

  /** Joins relinquished participant ids into a display label. */
  protected relinquishedLabel(list: string[] | undefined): string {
    return (list ?? []).map(id => this.collab.participantLabel(id)).join('、');
  }

  private scrollToBottom(): void {
    const element = this.messageScroll?.nativeElement;
    if (element) element.scrollTop = element.scrollHeight;
  }
}
