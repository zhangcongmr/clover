import { Component, ElementRef, effect, HostListener, inject, input, output, signal, computed, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CollabService, type CollabMessage, type CollabMode, type CollabSessionTarget } from './collab.service';
import { CollabSessionDetailComponent } from './collab-session-detail.component';
import { AcpPermissionDialogComponent } from '../../../shared/acp/acp-permission-dialog.component';
import type { ConfigOption } from '../../../shared/acp/acp.model';
import type { AgentRuntimeStatus, AgentStatusInfo } from '../../../shared/acp/acp-sse.service';

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

/** View-model wrapper exposing an agent's runtime status as a displayable label + css class. */
interface AgentOptionView {
  agent: AgentStatusInfo;
  /** Whether the agent can actually be bound to a session right now. */
  selectable: boolean;
  statusLabel: string;
  statusClass: string;
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
  /** Filter input of the agent-picker dropdown (exists only while the picker is open). */
  @ViewChild('agentFilterInput') private agentFilterInputRef?: ElementRef<HTMLInputElement>;

  protected draft = signal('');
  /** Whether the per-session mode/model settings block is expanded. */
  protected showAgentSettings = signal(false);

  /** Key (`participantId::optionId`) of the currently open custom select dropdown. */
  protected openSelectKey = signal<string | null>(null);
  /** Viewport position/size computed when a dropdown opens (escapes the scroll clip via `position: fixed`). */
  protected openSelectPos = signal<{ left: number; top: number; width: number } | null>(null);

  /** Participant id whose agent-picker dropdown is open (null = closed; only one open at a time). */
  protected agentPickerKey = signal<string | null>(null);
  /** Filter text of the open agent picker. */
  protected agentFilter = signal('');
  /** Keyboard/mouse highlighted agent id of the open agent picker. */
  protected agentHighlightId = signal<string | null>(null);
  /** Viewport position/size of the open agent picker panel (escapes the scroll clip via `position: fixed`). */
  protected agentPickerPos = signal<{ left: number; top: number; width: number } | null>(null);

  /** Session whose full `session/load` detail is docked on the right (null = closed). */
  protected readonly detailTarget = signal<CollabSessionTarget | null>(null);

  /** Human label per runtime status, shown as a badge inside the agent picker. */
  private static readonly agentStatusText: Record<AgentRuntimeStatus, string> = {
    connected: 'Connected',
    available: 'Available',
    unknown: 'Status unknown',
    unavailable: 'Unavailable',
    offline: 'Offline',
  };

  /** Css class per runtime status, shared by the status dot and badge. */
  private static readonly agentStatusClass: Record<AgentRuntimeStatus, string> = {
    connected: 'st-connected',
    available: 'st-available',
    unknown: 'st-unknown',
    unavailable: 'st-unavailable',
    offline: 'st-offline',
  };

  /** Only agents that are actually reachable can be bound to a session. */
  private static isAgentSelectable(status: AgentRuntimeStatus): boolean {
    return status === 'connected' || status === 'available';
  }

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

  // --- Agent picker dropdown (create-time session agent selection) ------------

  private agentView(agent: AgentStatusInfo): AgentOptionView {
    return {
      agent,
      selectable: CollabPanelComponent.isAgentSelectable(agent.status),
      statusLabel: CollabPanelComponent.agentStatusText[agent.status],
      statusClass: CollabPanelComponent.agentStatusClass[agent.status],
    };
  }

  /** Agent registry entry by id (undefined when nothing/an unknown id is bound). */
  protected agentById(id: string): AgentStatusInfo | undefined {
    return this.collab.availableAgents().find(a => a.id === id);
  }

  protected agentStatusClass(status: AgentRuntimeStatus): string {
    return CollabPanelComponent.agentStatusClass[status];
  }

  /** All agents matching the open picker's filter, selectable ones first (stable within groups). */
  protected readonly filteredAgentViews = computed<AgentOptionView[]>(() => {
    const q = this.agentFilter().trim().toLowerCase();
    return this.collab
      .availableAgents()
      .map(a => this.agentView(a))
      .filter(
        v =>
          !q ||
          v.agent.name.toLowerCase().includes(q) ||
          v.agent.id.toLowerCase().includes(q),
      )
      // The group headers in the template assume selectable items come first;
      // sort keeps registry order inside each group (stable sort).
      .sort((a, b) => Number(b.selectable) - Number(a.selectable));
  });

  protected readonly availableCount = computed(
    () => this.filteredAgentViews().filter(v => v.selectable).length,
  );

  protected readonly unavailableCount = computed(
    () => this.filteredAgentViews().length - this.availableCount(),
  );

  protected isAgentPickerOpen(participantId: string): boolean {
    return this.agentPickerKey() === participantId;
  }

  /** Opens/closes the agent picker, anchored to the trigger's viewport rect. */
  protected toggleAgentPicker(participantId: string, agentId: string, event: MouseEvent): void {
    event.stopPropagation();
    if (this.isAgentPickerOpen(participantId)) {
      this.closeAgentPicker();
      return;
    }
    this.agentFilter.set('');
    const sel = this.agentById(agentId);
    const selView = sel ? this.agentView(sel) : null;
    const firstAvailable = this.filteredAgentViews().find(v => v.selectable);
    this.agentHighlightId.set(
      selView && selView.selectable ? selView.agent.id : (firstAvailable?.agent.id ?? null),
    );
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const width = Math.max(rect.width, 300);
    const panelHeight = Math.min(this.filteredAgentViews().length * 58 + 96, 340);
    let top = rect.bottom + 4;
    if (top + panelHeight > window.innerHeight) {
      const flipped = rect.top - panelHeight - 4;
      top = flipped >= 0 ? flipped : Math.max(8, window.innerHeight - panelHeight - 8);
    }
    this.agentPickerPos.set({ left: rect.left, top, width });
    this.agentPickerKey.set(participantId);
    // Focus the filter so the user can type immediately; arrow keys then navigate.
    setTimeout(() => this.agentFilterInputRef?.nativeElement.focus());
  }

  protected closeAgentPicker(): void {
    this.agentPickerKey.set(null);
    this.agentFilter.set('');
    this.agentPickerPos.set(null);
  }

  protected onAgentFilter(value: string): void {
    this.agentFilter.set(value);
    // Keep the keyboard highlight on a selectable item after filtering.
    const list = this.filteredAgentViews().filter(v => v.selectable);
    if (!list.some(v => v.agent.id === this.agentHighlightId())) {
      this.agentHighlightId.set(list[0]?.agent.id ?? null);
    }
  }

  /** Binds the picked agent to the session whose picker is open (unavailable items are refused). */
  protected selectAgent(view: AgentOptionView): void {
    if (!view.selectable) return;
    const participantId = this.agentPickerKey();
    if (participantId) this.onParticipantAgent(participantId, view.agent.id);
    this.closeAgentPicker();
  }

  protected onAgentPickerKeydown(event: KeyboardEvent): void {
    if (!this.agentPickerKey()) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      this.moveAgentHighlight(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const view = this.filteredAgentViews().find(v => v.agent.id === this.agentHighlightId());
      if (view) this.selectAgent(view);
    }
  }

  private moveAgentHighlight(dir: 1 | -1): void {
    const list = this.filteredAgentViews().filter(v => v.selectable);
    if (!list.length) return;
    const cur = list.findIndex(v => v.agent.id === this.agentHighlightId());
    const next = cur === -1 ? 0 : (cur + dir + list.length) % list.length;
    const id = list[next].agent.id;
    this.agentHighlightId.set(id);
    this.agentFilterInputRef?.nativeElement
      .closest('.ap-panel')
      ?.querySelector<HTMLElement>(`[data-id="${id}"]`)
      ?.scrollIntoView({ block: 'nearest' });
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
    const target = event.target as HTMLElement;
    // Trigger clicks stopPropagation, so only outside/panel clicks reach here;
    // panel clicks are handled by chooseOption (which closes explicitly).
    if (!target.closest('.settings-select-dropdown')) {
      this.closeSelect();
    }
    // Agent picker: option clicks bubble up here too, but selectAgent already
    // closed it; keep the panel open for clicks inside it (e.g. the filter).
    if (!target.closest('.ap-panel')) {
      this.closeAgentPicker();
    }
  }

  @HostListener('document:keydown.escape')
  protected onEscapeKey(): void {
    if (this.openSelectKey()) {
      this.closeSelect();
      return;
    }
    if (this.agentPickerKey()) {
      this.closeAgentPicker();
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
