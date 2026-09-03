import { Component, inject, ViewChild, ElementRef, computed, afterNextRender, effect, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AcpService, AcpMessage } from './acp.service';
import { AcpPlanComponent } from './acp-plan.component';
import { AcpQuestionComponent, QuestionItem } from './acp-question.component';
import { EditDiffPipe, ReadInfoPipe, ParseDiffPipe, FormatMessagePipe } from './tool-call-info.pipe';
import type { ContentBlock, ImageContent, AudioContent, EmbeddedResource } from './acp-websocket.service';

const INITIAL_LOAD = 30;
const LOAD_MORE = 50;

export interface MessageGroup {
  type: 'user' | 'assistant' | 'intermediate';
  messages: AcpMessage[];
}

@Component({
  selector: 'app-acp-chat',
  standalone: true,
  imports: [CommonModule, AcpPlanComponent, AcpQuestionComponent, EditDiffPipe, ReadInfoPipe, ParseDiffPipe, FormatMessagePipe],
  templateUrl: './acp-chat.component.html',
  styleUrls: ['./acp-chat.component.css']
})
export class AcpChatComponent implements OnDestroy {
  @ViewChild('messagesContainer') private messagesContainer!: ElementRef;

  protected acpService = inject(AcpService);

  private isLoadingMore = false;
  private isNearBottom = true;
  private rafId: number | null = null;

  visibleCount = signal(INITIAL_LOAD);

  /** Tracks which intermediate sections are collapsed (keyed by first message id). */
  private collapsedSections = new Set<string>();

  readonly activeTodosMessages = computed(() => this.acpService.activeTodosMessages());

  readonly activeQuestionsMessages = computed(() => this.acpService.activeQuestionsMessages());

  todosCollapsed = false;

  readonly visibleMessages = computed<AcpMessage[]>(() => {
    if (this.acpService.isReplayingHistory()) return [];
    const all = this.acpService.messages();
    return all.slice(-this.visibleCount());
  });

  readonly hasMoreMessages = computed(() => {
    if (this.acpService.isReplayingHistory()) return false;
    return this.acpService.messages().length > this.visibleCount();
  });

  /** Grouped messages for rendering - recomputes only when messages or processing state changes. */
  readonly groupedMessages = computed<MessageGroup[]>(() => {
    if (this.acpService.isReplayingHistory()) return [];
    const messages = this.visibleMessages();

    if (this.acpService.isProcessing()) {
      return messages.map(msg => ({ type: msg.role as 'user' | 'assistant' | 'intermediate', messages: [msg] }));
    }

    const groups: MessageGroup[] = [];
    let currentRound: AcpMessage[] = [];

    for (const msg of messages) {
      if (msg.role === 'user') {
        if (currentRound.length > 0) {
          this.flushRound(groups, currentRound);
          currentRound = [];
        }
        groups.push({ type: 'user', messages: [msg] });
      } else {
        currentRound.push(msg);
      }
    }

    if (currentRound.length > 0) {
      this.flushRound(groups, currentRound);
    }

    return groups;
  });

  constructor() {
    afterNextRender(() => {
      this.scrollToBottom();
    });

    effect(() => {
      const msgs = this.acpService.messages();
      if (msgs.length > 0 && this.isNearBottom && !this.acpService.isReplayingHistory()) {
        this.scheduleScrollToBottom();
      }
    });

    // After replay ends, scroll to bottom once (ensures DOM is painted)
    effect(() => {
      const replaying = this.acpService.isReplayingHistory();
      if (!replaying && this.acpService.messages().length > 0) {
        setTimeout(() => this.scrollToBottom(), 50);
      }
    });

    effect(() => {
      const processing = this.acpService.isProcessing();
      if (!processing) {
        this.collapsedSections.clear();
      }
    });
  }

  ngOnDestroy(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
    }
  }

  toggleTodosCollapse(): void {
    this.todosCollapsed = !this.todosCollapsed;
  }

  isIntermediateSectionCollapsed(sectionId: string): boolean {
    return !this.collapsedSections.has(sectionId);
  }

  toggleIntermediateSection(sectionId: string): void {
    if (this.collapsedSections.has(sectionId)) {
      this.collapsedSections.delete(sectionId);
    } else {
      this.collapsedSections.add(sectionId);
    }
  }

  isDiffCollapsed(toolCallId: string): boolean {
    return this.collapsedSections.has(`diff-${toolCallId}`);
  }

  toggleDiffCollapse(toolCallId: string): void {
    const key = `diff-${toolCallId}`;
    if (this.collapsedSections.has(key)) {
      this.collapsedSections.delete(key);
    } else {
      this.collapsedSections.add(key);
    }
  }

  private flushRound(groups: MessageGroup[], round: AcpMessage[]): void {
    let lastAssistantIdx = -1;
    for (let i = round.length - 1; i >= 0; i--) {
      if (round[i].role === 'assistant') {
        lastAssistantIdx = i;
        break;
      }
    }

    if (lastAssistantIdx === -1) {
      groups.push({ type: 'intermediate', messages: round });
    } else {
      if (lastAssistantIdx > 0) {
        groups.push({ type: 'intermediate', messages: round.slice(0, lastAssistantIdx) });
      }
      groups.push({ type: 'assistant', messages: [round[lastAssistantIdx]] });
    }
  }

  get hasPlans(): boolean {
    return this.acpService.plans().size > 0;
  }

  onScroll(): void {
    const element = this.messagesContainer?.nativeElement;
    if (!element) return;

    const threshold = 100;
    this.isNearBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight < threshold;

    if (this.isLoadingMore || !this.hasMoreMessages()) return;

    if (element.scrollTop < 50) {
      this.isLoadingMore = true;
      const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
      this.visibleCount.set(Math.min(this.visibleCount() + LOAD_MORE, this.acpService.messages().length));
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          element.scrollTop = element.scrollHeight - element.clientHeight - distanceFromBottom;
          this.isLoadingMore = false;
        });
      });
    }
  }

  private scheduleScrollToBottom(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
    }
    this.rafId = requestAnimationFrame(() => {
      this.rafId = requestAnimationFrame(() => {
        this.scrollToBottom();
        this.rafId = null;
      });
    });
  }

  scrollToBottom(smooth = true): void {
    const element = this.messagesContainer?.nativeElement;
    if (!element) return;
    const top = element.scrollHeight - element.clientHeight;
    if (smooth) {
      element.scrollTo({ top, behavior: 'smooth' });
    } else {
      element.scrollTop = top;
    }
  }

  trackByMessageId(index: number, message: AcpMessage): string {
    return message.id;
  }

  trackByGroupIndex(index: number, group: MessageGroup): string {
    return group.messages[0]?.id ?? `group-${index}`;
  }

  formatTime(date: Date): string {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  blockDataUrl(block: ImageContent | AudioContent): string {
    return `data:${block.mimeType};base64,${block.data}`;
  }

  resourceName(block: EmbeddedResource): string {
    const uri = block.resource.uri;
    return uri.split(/[\\/]/).pop() || uri;
  }

  resourcePreview(block: EmbeddedResource): string {
    const text = block.resource.text ?? '';
    return text.length > 200 ? text.slice(0, 200) + '…' : text;
  }

  resourceDownloadUrl(block: EmbeddedResource): string {
    const mime = block.resource.mimeType ?? 'application/octet-stream';
    return `data:${mime};base64,${block.resource.blob ?? ''}`;
  }

  getToolStatusIcon(status?: string): string {
    switch (status) {
      case 'pending': return '⏳';
      case 'in_progress': return '🔄';
      case 'completed': return '✅';
      case 'failed': return '❌';
      default: return '❓';
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

  hasTodos(message: AcpMessage): boolean {
    return this.getTodos(message) !== null;
  }

  getTodos(message: AcpMessage): Array<{ content: string; status: string; priority: string }> | null {
    const rawOutput = message.toolRawOutput as any;
    const fromOutput = rawOutput?.metadata?.todos;
    if (Array.isArray(fromOutput) && fromOutput.length > 0) return fromOutput;
    const rawInput = message.toolRawInput as any;
    const fromInput = rawInput?.todos;
    if (Array.isArray(fromInput) && fromInput.length > 0) return fromInput;
    return null;
  }

  completedCount(message: AcpMessage): number {
    return this.getTodos(message)?.filter((t: any) => t.status === 'completed').length ?? 0;
  }

  totalCount(message: AcpMessage): number {
    return this.getTodos(message)?.length ?? 0;
  }

  getQuestions(message: AcpMessage): QuestionItem[] {
    const rawInput = message.toolRawInput as any;
    if (rawInput && Array.isArray(rawInput.questions)) {
      return rawInput.questions;
    }
    return [];
  }

  onQuestionSubmit(toolCallId: string, answers: string[]): void {
    this.acpService.submitQuestionAnswers(toolCallId, answers);
  }

  onQuestionIgnore(toolCallId: string): void {
    this.acpService.ignoreQuestions(toolCallId);
  }
}
