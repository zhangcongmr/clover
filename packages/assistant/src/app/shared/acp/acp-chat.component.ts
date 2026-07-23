import { Component, inject, signal, ViewChild, ElementRef, AfterViewChecked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AcpService, AcpMessage } from './acp.service';
import { AcpToolCallsComponent } from './acp-tool-calls.component';

@Component({
  selector: 'app-acp-chat',
  standalone: true,
  imports: [CommonModule, FormsModule, AcpToolCallsComponent],
  templateUrl: './acp-chat.component.html',
  styleUrls: ['./acp-chat.component.css']
})
export class AcpChatComponent implements AfterViewChecked {
  @ViewChild('messagesContainer') private messagesContainer!: ElementRef;
  @ViewChild('messageInput') private messageInput!: ElementRef;

  protected acpService = inject(AcpService);
  
  inputValue = signal<string>('');
  private shouldScroll = false;

  ngAfterViewChecked(): void {
    if (this.shouldScroll) {
      this.scrollToBottom();
      this.shouldScroll = false;
    }
  }

  async sendMessage(): Promise<void> {
    const text = this.inputValue().trim();
    if (!text || this.acpService.isProcessing()) {
      return;
    }

    this.inputValue.set('');
    this.shouldScroll = true;

    try {
      await this.acpService.sendPrompt(text);
    } catch (error) {
      console.error('[ACP Chat] Failed to send message:', error);
    }
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
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
}
