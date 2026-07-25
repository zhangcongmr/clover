import { Component, inject, ViewChild, ElementRef, AfterViewInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AcpService, AcpMessage } from './acp.service';

const INITIAL_LOAD = 30;
const LOAD_MORE = 20;

@Component({
  selector: 'app-acp-chat',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './acp-chat.component.html',
  styleUrls: ['./acp-chat.component.css']
})
export class AcpChatComponent implements AfterViewInit, OnDestroy {
  @ViewChild('messagesContainer') private messagesContainer!: ElementRef;

  protected acpService = inject(AcpService);

  private lastMessageCount = 0;
  private scrollTimeout: ReturnType<typeof setTimeout> | null = null;
  private isLoadingMore = false;

  visibleCount = INITIAL_LOAD;

  get visibleMessages(): AcpMessage[] {
    const all = this.acpService.messages();
    return all.slice(-this.visibleCount);
  }

  get hasMoreMessages(): boolean {
    return this.acpService.messages().length > this.visibleCount;
  }

  ngAfterViewInit(): void {
    setTimeout(() => this.scrollToBottom(), 100);
  }

  ngAfterViewChecked(): void {
    const count = this.acpService.messages().length;
    if (count > this.lastMessageCount) {
      this.scheduleScrollToBottom();
    }
    this.lastMessageCount = count;
  }

  ngOnDestroy(): void {
    if (this.scrollTimeout) {
      clearTimeout(this.scrollTimeout);
    }
  }

  onScroll(): void {
    if (this.isLoadingMore || !this.hasMoreMessages) return;

    const element = this.messagesContainer?.nativeElement;
    if (!element) return;

    if (element.scrollTop < 50) {
      this.isLoadingMore = true;
      const prevHeight = element.scrollHeight;
      this.visibleCount = Math.min(this.visibleCount + LOAD_MORE, this.acpService.messages().length);
      setTimeout(() => {
        element.scrollTop = element.scrollHeight - prevHeight;
        this.isLoadingMore = false;
      }, 0);
    }
  }

  private scheduleScrollToBottom(): void {
    if (this.scrollTimeout) {
      clearTimeout(this.scrollTimeout);
    }
    this.scrollTimeout = setTimeout(() => {
      this.scrollToBottom();
      this.scrollTimeout = null;
    }, 50);
  }

  scrollToBottom(): void {
    if (this.messagesContainer) {
      const element = this.messagesContainer.nativeElement;
      element.scrollTop = element.scrollHeight;
    }
  }

  trackByMessageId(index: number, message: AcpMessage): string {
    return message.id;
  }

  formatMessage(content: string): string {
    return content
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br>');
  }

  formatTime(date: Date): string {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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

  goBackToSessionList(): void {
    this.acpService.showSessionHistory.set(true);
    this.acpService.hasOpenedSession.set(false);
  }
}
