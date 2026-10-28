import { Component, ElementRef, effect, HostListener, inject, input, output, signal, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CollabService, type CollabMessage, type CollabMode, type CollabSessionTarget } from './collab.service';
import { CollabSessionDetailComponent } from './collab-session-detail.component';
import { AcpPermissionDialogComponent } from '../../../shared/acp/acp-permission-dialog.component';
import type { ConfigOption } from '../../../shared/acp/acp.model';

interface ModeTab {
  id: CollabMode;
  label: string;
  hint: string;
}

interface RolePreset {
  role: string;
  /** Default responsibility text auto-filled when this role is picked. */
  responsibility: string;
}

@Component({
  selector: 'app-collab-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, AcpPermissionDialogComponent, CollabSessionDetailComponent],
  templateUrl: './collab-panel.component.html',
  styleUrls: ['./collab-panel.component.css'],
})
export class CollabPanelComponent {
  protected readonly collab = inject(CollabService);
  protected readonly close = output<void>();
  /** Whether the left sidebar is collapsed; keeps header space free for the floating toggle. */
  sidebarCollapsed = input<boolean>(false);

  /** Collaboration mode tabs (01 single / 02 pipeline / 03 parallel / 04 voluntary claim). */
  protected readonly modes: ModeTab[] = [
    { id: 'single', label: 'Single', hint: 'One prompt is routed to exactly one Session; done when it finishes' },
    { id: 'pipeline', label: 'Pipeline', hint: 'Sessions hand off in sequence; output flows stage by stage' },
    { id: 'parallel', label: 'Parallel', hint: 'Sessions handle mutually independent sub-tasks concurrently' },
    { id: 'voluntary', label: 'Voluntary claim', hint: 'On completion it broadcasts; remaining Sessions decide whether to take over' },
  ];

  /** Preset session roles offered by the picker dropdown, each with a default responsibility. */
  protected readonly rolePresets: RolePreset[] = [
    {
      role: 'Code review expert',
      responsibility:
        'Review code changes for correctness, security and performance: check edge cases and error handling, find potential defects and security risks, point out performance bottlenecks, and give actionable fix suggestions with priorities.',
    },
    {
      role: 'Documentation writer',
      responsibility:
        'Write and maintain clear, accurate documentation: organize structure and information hierarchy, add usage examples and configuration notes, keep terminology and writing style consistent, and ensure the docs stay in sync with the implementation.',
    },
    {
      role: 'Documentation reviewer',
      responsibility:
        'Review documentation for accuracy and readability: verify the content matches the implementation, validate that reproduction steps and examples are correct and terminology is consistent, and point out missing information with concrete suggestions.',
    },
  ];

  @ViewChild('messageScroll') private messageScroll?: ElementRef<HTMLElement>;

  protected draft = signal('');
  /** Whether the per-session mode/model settings block is expanded. */
  protected showAgentSettings = signal(false);

  /** Key (`participantId::optionId`) of the currently open custom select dropdown. */
  protected openSelectKey = signal<string | null>(null);
  /** Viewport position/size computed when a dropdown opens (escapes the scroll clip via `position: fixed`). */
  protected openSelectPos = signal<{ left: number; top: number; width: number } | null>(null);

  /** Session whose full `session/load` detail is docked on the right (null = closed). */
  protected readonly detailTarget = signal<CollabSessionTarget | null>(null);

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

  /** Picks a preset role and pre-fills its default responsibility (unless the role is cleared). */
  protected onParticipantRolePreset(id: string, role: string): void {
    const preset = this.rolePresets.find(item => item.role === role);
    if (!preset) {
      this.collab.updateParticipant(id, { role });
      return;
    }
    this.collab.updateParticipant(id, { role: preset.role, responsibility: preset.responsibility });
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
    if (this.openSelectKey()) {
      this.closeSelect();
      return;
    }
    if (this.detailTarget()) {
      this.closeSessionDetail();
    }
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

  /** Human label of a participant id (for "Handed off from" / "Relinquished" annotations). */
  protected participantLabel(participantId: string | undefined): string {
    return this.collab.participantLabel(participantId);
  }

  /** Human label of an ACP session id (fallback for older metadata). */
  protected sessionLabel(sessionId: string | undefined): string {
    return this.collab.participantLabelBySession(sessionId);
  }

  /** Joins relinquished participant ids into a display label. */
  protected relinquishedLabel(list: string[] | undefined): string {
    return (list ?? []).map(id => this.collab.participantLabel(id)).join(', ');
  }

  // --- Session detail panel -------------------------------------------------

  /** ACP session behind a transcript message (null = not backed by a session). */
  protected sessionTarget(message: CollabMessage): CollabSessionTarget | null {
    return this.collab.sessionTargetOf(message);
  }

  /** Opens (or switches) the right-hand session detail panel. */
  protected openSessionDetail(target: CollabSessionTarget | null, event?: Event): void {
    if (!target) return;
    event?.stopPropagation();
    if (this.detailTarget()?.sessionId === target.sessionId) return;
    this.detailTarget.set(target);
  }

  protected closeSessionDetail(): void {
    this.detailTarget.set(null);
  }

  private scrollToBottom(): void {
    const element = this.messageScroll?.nativeElement;
    if (element) element.scrollTop = element.scrollHeight;
  }
}
