import { Component, inject, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AcpService, AcpMessage } from './acp.service';

@Component({
  selector: 'app-acp-chat',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './acp-chat.component.html',
  styleUrls: ['./acp-chat.component.css']
})
export class AcpChatComponent {
  @ViewChild('messagesContainer') private messagesContainer!: ElementRef;

  protected acpService = inject(AcpService);

  private lastMessageCount = 0;

  ngAfterViewChecked(): void {
    const count = this.acpService.messages().length;
    if (count > this.lastMessageCount) {
      this.scrollToBottom();
    }
    this.lastMessageCount = count;
  }

  formatMessage(content: string): string {
    // Basic markdown-like formatting
    return content
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br>');
  }

  formatTime(date: Date): string {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  private scrollToBottom(): void {
    if (this.messagesContainer) {
      const element = this.messagesContainer.nativeElement;
      element.scrollTop = element.scrollHeight;
    }
  }

  trackByMessageId(index: number, message: AcpMessage): string {
    return message.id;
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
