import { Component, inject, ViewChild, ElementRef, computed, afterNextRender, effect, OnDestroy, signal, Input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AcpService, AcpMessage } from './acp.service';
import { AcpPlanComponent } from './acp-plan.component';
import { AcpQuestionComponent, QuestionItem } from './acp-question.component';
import { EditDiffPipe, ReadInfoPipe, ParseDiffPipe, FormatMessagePipe, ResourceNamePipe, CompletedCountPipe, FileDiffViewPipe, RagResultPipe, buildChangedFiles, extractRagResult, type ChangedFile } from './tool-call-info.pipe';
import { RagResultComponent } from './rag-result.component';
import { CopyCodeButtonDirective } from './copy-code-button.directive';
import { A2uiJsonRendererComponent } from './a2ui-json-renderer.component';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { DYNAMIC_VIRTUAL_SCROLL_STRATEGY_PROVIDER } from './dynamic-virtual-scroll.strategy';
import type { ContentBlock, ImageContent, AudioContent, EmbeddedResource } from './acp.model';

export interface MessageGroup {
  type: 'user' | 'assistant' | 'intermediate' | 'error';
  messages: AcpMessage[];
  isNew?: boolean;
}

@Component({
  selector: 'app-acp-chat',
  standalone: true,
  imports: [CommonModule, ScrollingModule, AcpPlanComponent, AcpQuestionComponent, EditDiffPipe, ReadInfoPipe, ParseDiffPipe, FormatMessagePipe, ResourceNamePipe, CompletedCountPipe, FileDiffViewPipe, RagResultPipe, RagResultComponent, CopyCodeButtonDirective, A2uiJsonRendererComponent],
  providers: [DYNAMIC_VIRTUAL_SCROLL_STRATEGY_PROVIDER],
  templateUrl: './acp-chat.component.html',
  styleUrls: ['./acp-chat.component.css']
})
export class AcpChatComponent implements OnDestroy {
  @ViewChild('messagesContainer', { read: ElementRef }) private messagesContainer?: ElementRef<HTMLElement>;

  themeApply = output<Record<string, any>>();

  protected acpService = inject(AcpService);

  isNearBottom = signal(true);
  private rafId: number | null = null;

  /** Tracks which intermediate sections are collapsed (keyed by first message id). */
  private collapsedSections = new Set<string>();

  /**
   * Intermediate sections that are open. History defaults to collapsed; the round
   * currently streaming is opened automatically and stays open after it finishes.
   * Reset whenever the bound session changes (load/resume).
   */
  private readonly expandedSections = signal<ReadonlySet<string>>(new Set());

  /** Session the section state belongs to; used to avoid resetting on every sessionState update. */
  private sectionSessionId: string | null = null;

  readonly activeTodosMessages = computed(() => this.acpService.activeTodosMessages());

  readonly activeQuestionsMessages = computed(() => this.acpService.activeQuestionsMessages());

  /** Per-assistant-message file changes, aggregated per finished round. */
  readonly changedFilesMap = computed<Map<string, ChangedFile[]>>(() => {
    const messages = this.acpService.messages();
    const cwd = this.acpService.sessionState().cwd || this.acpService.selectedProjectPath() || undefined;
    return buildChangedFiles(messages, cwd);
  });

  /** Files changed before the given assistant message (null when there are none). */
  changedFilesFor(message: AcpMessage): ChangedFile[] | null {
    return this.changedFilesMap().get(message.id) ?? null;
  }

  totalAdditions(files: ChangedFile[]): number {
    return files.reduce((sum, f) => sum + f.additions, 0);
  }

  totalDeletions(files: ChangedFile[]): number {
    return files.reduce((sum, f) => sum + f.deletions, 0);
  }

  private expandedFileChanges = new Set<string>();

  isFileExpanded(messageId: string, fileKey: string): boolean {
    return this.expandedFileChanges.has(`${messageId}::${fileKey}`);
  }

  toggleFileChange(messageId: string, fileKey: string): void {
    const key = `${messageId}::${fileKey}`;
    if (this.expandedFileChanges.has(key)) {
      this.expandedFileChanges.delete(key);
    } else {
      this.expandedFileChanges.add(key);
    }
  }

  todosCollapsed = false;

  /** Grouped messages for rendering - recomputes only when messages or processing state changes. */
  readonly groupedMessages = computed<MessageGroup[]>(() => {
    if (this.acpService.isReplayingHistory()) return [];
    const messages = this.acpService.messages();
    const processingStartTime = this.acpService.processingStartTime();

    if (this.acpService.isProcessing() && processingStartTime !== null) {
      const preMessages: AcpMessage[] = [];
      const postMessages: AcpMessage[] = [];

      for (const msg of messages) {
        if (msg.timestamp.getTime() < processingStartTime) {
          preMessages.push(msg);
        } else {
          postMessages.push(msg);
        }
      }

      const groups = this.groupMessages(preMessages);

      for (const msg of postMessages) {
        const groupType: MessageGroup['type'] = (msg.role === 'tool_call' || msg.role === 'tool_call_update' || msg.role === 'thought')
          ? 'intermediate'
          : msg.role;
        groups.push({ type: groupType, messages: [msg], isNew: true });
      }

      return groups;
    }

    return this.groupMessages(messages);
  });

  constructor() {
    afterNextRender(() => {
      this.scrollToBottom();
    });

    effect(() => {
      const msgs = this.acpService.messages();
      if (msgs.length > 0 && this.isNearBottom() && !this.acpService.isReplayingHistory()) {
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

    // 加载/切换会话后，历史步骤全部回到「收起」的默认状态。
    effect(() => {
      const sessionId = this.acpService.sessionState().sessionId;
      if (sessionId === this.sectionSessionId) return;
      this.sectionSessionId = sessionId;
      this.expandedSections.set(new Set());
    });

    // 正在流式输出的这一轮保持展开；结束后这些 key 留在集合里，步骤不会突然收起。
    effect(() => {
      if (!this.acpService.isProcessing()) return;
      const liveKeys = this.groupedMessages()
        .filter(group => group.type === 'intermediate' && group.isNew)
        .map(group => this.sectionKey(group))
        .filter(key => !!key);
      if (liveKeys.length === 0) return;
      this.expandedSections.update(prev => {
        const missing = liveKeys.filter(key => !prev.has(key));
        if (missing.length === 0) return prev;
        return new Set([...prev, ...missing]);
      });
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

  private sectionKey(group: MessageGroup): string {
    return group.messages[0]?.id ?? '';
  }

  isIntermediateSectionCollapsed(group: MessageGroup): boolean {
    // 新消息（processing 开始后）默认展开，历史步骤默认收起。
    if (group.isNew) return false;
    return !this.expandedSections().has(this.sectionKey(group));
  }

  toggleIntermediateSection(group: MessageGroup): void {
    const key = this.sectionKey(group);
    if (!key) return;
    this.expandedSections.update(prev => {
      const next = new Set(prev);
      if (!next.delete(key)) {
        next.add(key);
      }
      return next;
    });
  }

  isExpanded(message: AcpMessage): boolean {
    const key = `expand-${message.toolCallId}`;
    if (this.collapsedSections.has(key)) {
      return false;
    }
    if (this.acpService.isProcessing() && this.acpService.processingStartTime() !== null) {
      return message.timestamp.getTime() < this.acpService.processingStartTime()!;
    }
    return true;
  }

  toggleExpand(message: AcpMessage): void {
    if (message.toolKind !== 'edit' && message.toolKind !== 'read' && !extractRagResult(message)) return;
    const key = `expand-${message.toolCallId}`;
    if (this.collapsedSections.has(key)) {
      this.collapsedSections.delete(key);
    } else {
      this.collapsedSections.add(key);
    }
  }

  private groupMessages(messages: AcpMessage[]): MessageGroup[] {
    const groups: MessageGroup[] = [];
    let currentRound: AcpMessage[] = [];

    for (const msg of messages) {
      if (msg.role === 'user') {
        if (currentRound.length > 0) {
          this.flushRound(groups, currentRound);
          currentRound = [];
        }
        groups.push({ type: 'user', messages: [msg] });
      } else if (msg.role === 'error') {
        // 错误消息独立成组：intermediate 组的模板没有 error 分支，
        // 混入 round 会不可见。
        if (currentRound.length > 0) {
          this.flushRound(groups, currentRound);
          currentRound = [];
        }
        groups.push({ type: 'error', messages: [msg] });
      } else {
        currentRound.push(msg);
      }
    }

    if (currentRound.length > 0) {
      this.flushRound(groups, currentRound);
    }

    return groups;
  }

  /**
   * 一轮会话（两条 user 消息之间）内可能存在 1 : N 的 assistant 消息：
   * ACP 回放与实时推送都按 part 顺序给出 assistant → thought/tool_call → assistant …，
   * 只要中间插入了非 assistant 消息，就会新起一条 assistant 消息。
   *
   * 因此这里按出现顺序切分：每遇到一条 assistant 就单独成组（保留全部 N 条），
   * 它与下一条 assistant 之间的 thought/tool_call 归入一个可折叠的 intermediate 组；
   * 轮次末尾的步骤同样单独成组，不会被丢弃。
   */
  private flushRound(groups: MessageGroup[], round: AcpMessage[]): void {
    let steps: AcpMessage[] = [];

    for (const msg of round) {
      if (msg.role === 'assistant') {
        if (steps.length > 0) {
          groups.push({ type: 'intermediate', messages: steps });
          steps = [];
        }
        groups.push({ type: 'assistant', messages: [msg] });
      } else {
        steps.push(msg);
      }
    }

    if (steps.length > 0) {
      groups.push({ type: 'intermediate', messages: steps });
    }
  }

  get hasPlans(): boolean {
    return this.acpService.plans().size > 0;
  }

  onScroll(): void {
    const element = this.messagesContainer?.nativeElement;
    if (!element) return;

    const threshold = 100;
    this.isNearBottom.set(
      element.scrollHeight - element.scrollTop - element.clientHeight < threshold
    );
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
    this.isNearBottom.set(true);
  }

  /**
   * Scroll the message list by delta Y (pixels).
   * Called by parent panel to enable area-wide scroll.
   */
  scrollByDelta(deltaY: number): void {
    const element = this.messagesContainer?.nativeElement;
    if (!element) return;
    element.scrollTop += deltaY;
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

  resourcePreview(block: EmbeddedResource): string {
    const text = block.resource.text ?? '';
    return text.length > 200 ? text.slice(0, 200) + '…' : text;
  }

  resourceDownloadUrl(block: EmbeddedResource): string {
    const mime = block.resource.mimeType ?? 'application/octet-stream';
    return `data:${mime};base64,${block.resource.blob ?? ''}`;
  }

  getToolStatusLabel(status?: string): string {
    switch (status) {
      case 'pending': return '等待中';
      case 'in_progress': return '进行中';
      case 'completed': return '已完成';
      case 'failed': return '失败';
      default: return '未知';
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
