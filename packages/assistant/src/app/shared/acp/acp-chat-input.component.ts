import { Component, inject, signal, computed, ViewChild, ElementRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AcpService } from './acp.service';
import { AVAILABLE_AGENTS } from './acp-agent.types';
import type { AgentConfig } from './acp-agent.types';

@Component({
  selector: 'app-acp-chat-input',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="acp-chat-input-container">
      <div class="acp-chat-input-box">
        @if (showSlashMenu()) {
          <div class="slash-command-menu">
            @for (cmd of filteredCommands(); track cmd.name; let i = $index) {
              <button class="slash-command-item" [class.active]="i === selectedIndex()"
                (mousedown)="selectCommand(cmd)" (mouseenter)="selectedIndex.set(i)">
                <span class="slash-command-name">/{{ cmd.name }}</span>
                <span class="slash-command-desc">{{ cmd.description }}</span>
              </button>
            } @empty {
              <div class="slash-command-empty">No matching commands</div>
            }
          </div>
        }
        <textarea #messageInput [ngModel]="inputValue()" (ngModelChange)="inputValue.set($event)"
          (input)="onInput()" (keydown)="onKeydown($event)" placeholder="Describe what to build"
          [disabled]="!acpService.sessionState().isConnected || acpService.isProcessing()" rows="1"
          class="message-textarea custom-scroll"></textarea>
        <div class="acp-chat-toolbar">
          <div class="acp-chat-toolbar-left">
            <button class="toolbar-icon-btn" title="Attach">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
            </button>
            <div class="agent-selector">
              <button class="toolbar-tag-btn" (click)="toggleAgentDropdown($event)" title="Agent">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10"/>
                  <circle cx="12" cy="12" r="4"/>
                  <line x1="21.17" y1="8" x2="12" y2="8"/>
                  <line x1="3.95" y1="6.06" x2="8.54" y2="14"/>
                  <line x1="10.88" y1="21.94" x2="15.46" y2="14"/>
                </svg>
                <span>{{ acpService.selectedAgent()?.name || 'Agent' }}</span>
              </button>
              @if (showAgentDropdown()) {
                <div class="agent-dropdown">
                  @for (agent of agents; track agent.id; let i = $index) {
                    <button class="agent-option" (mousedown)="selectAgent(agent)"
                      (mouseenter)="agentSelectedIndex.set(i)"
                      [class.active]="i === agentSelectedIndex()">
                      <span class="agent-name">{{ agent.name }}</span>
                      @if (agent.description) {
                        <span class="agent-desc">{{ agent.description }}</span>
                      }
                    </button>
                  }
                </div>
              }
            </div>
            <button class="toolbar-tag-btn" title="Auto">
              <span>Auto</span>
            </button>
          </div>
          <div class="acp-chat-toolbar-right">
            <button class="toolbar-icon-btn" title="Settings">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="4" y1="21" x2="4" y2="14"></line>
                <line x1="4" y1="10" x2="4" y2="3"></line>
                <line x1="12" y1="21" x2="12" y2="12"></line>
                <line x1="12" y1="8" x2="12" y2="3"></line>
                <line x1="20" y1="21" x2="20" y2="16"></line>
                <line x1="20" y1="12" x2="20" y2="3"></line>
                <line x1="1" y1="14" x2="7" y2="14"></line>
                <line x1="9" y1="8" x2="15" y2="8"></line>
                <line x1="17" y1="16" x2="23" y2="16"></line>
              </svg>
            </button>
            <button class="send-button" (click)="sendMessage()"
              [disabled]="!inputValue().trim() || !acpService.sessionState().isConnected || acpService.isProcessing()">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="19" x2="12" y2="5"></line>
                <polyline points="5 12 12 5 19 12"></polyline>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      flex-shrink: 0;
    }
    .acp-chat-input-container {
      padding: 8px 12px 12px;
    }
    .acp-chat-input-box {
      position: relative;
      border: 1px solid var(--vscode-input-border, #3c3c3c);
      border-radius: 12px;
      background-color: var(--vscode-input-background, #1e1e1e);
      overflow: visible;
      transition: border-color var(--vscode-motion-duration) var(--vscode-motion-easing);
    }
    .acp-chat-input-box:focus-within {
      border-color: var(--vscode-focusBorder, #007acc);
    }
    .message-textarea {
      display: block;
      width: 100%;
      resize: none;
      border: none;
      padding: 12px 14px 4px;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: transparent;
      outline: none;
      min-height: 32px;
      max-height: 120px;
      line-height: 1.5;
      overflow-y: hidden;
    }
    .message-textarea:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .message-textarea::placeholder {
      color: var(--vscode-foreground);
      opacity: 0.4;
    }
    .acp-chat-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 4px 6px 6px;
    }
    .acp-chat-toolbar-left,
    .acp-chat-toolbar-right {
      display: flex;
      align-items: center;
      gap: 2px;
    }
    .toolbar-icon-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border: none;
      border-radius: 6px;
      background: transparent;
      color: var(--vscode-foreground);
      cursor: pointer;
      opacity: 0.6;
      transition: opacity 0.15s, background-color 0.15s;
    }
    .toolbar-icon-btn:hover {
      opacity: 1;
      background-color: var(--vscode-toolbar-hoverBackground, rgba(255, 255, 255, 0.1));
    }
    .toolbar-tag-btn {
      display: flex;
      align-items: center;
      gap: 4px;
      height: 26px;
      padding: 0 8px;
      border: 1px solid var(--vscode-input-border, #3c3c3c);
      border-radius: 6px;
      background: transparent;
      color: var(--vscode-foreground);
      cursor: pointer;
      font-size: 12px;
      opacity: 0.7;
      transition: opacity 0.15s, background-color 0.15s;
    }
    .toolbar-tag-btn:hover {
      opacity: 1;
      background-color: var(--vscode-toolbar-hoverBackground, rgba(255, 255, 255, 0.1));
    }
    .send-button {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border: none;
      border-radius: 6px;
      background-color: var(--vscode-button-background, #0e639c);
      color: var(--vscode-button-foreground, #ffffff);
      cursor: pointer;
      transition: opacity 0.15s;
    }
    .send-button:hover:not(:disabled) {
      opacity: 0.9;
    }
    .send-button:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .agent-selector {
      position: relative;
    }
    .agent-dropdown {
      position: absolute;
      bottom: 100%;
      left: 0;
      margin-bottom: 4px;
      min-width: 200px;
      background-color: var(--vscode-dropdown-background, #ffffff);
      border: 1px solid var(--vscode-dropdown-border, #e0e0e0);
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      z-index: 1000;
      overflow: hidden;
    }
    .agent-option {
      display: flex;
      flex-direction: column;
      width: 100%;
      padding: 10px 14px;
      border: none;
      background: transparent;
      color: var(--vscode-foreground, #333333);
      cursor: pointer;
      text-align: left;
      transition: background-color 0.15s;
    }
    .agent-option:hover {
      background-color: var(--vscode-list-hoverBackground, #f0f0f0);
    }
    .agent-option.active {
      background-color: var(--vscode-list-activeSelectionBackground, #e8f4fc);
    }
    .agent-name {
      font-size: 13px;
      font-weight: 500;
      color: var(--vscode-foreground, #333333);
    }
    .agent-desc {
      font-size: 11px;
      opacity: 0.6;
      margin-top: 2px;
      color: var(--vscode-descriptionForeground, #666666);
    }
    .slash-command-menu {
      position: absolute;
      bottom: 100%;
      left: 0;
      right: 0;
      margin-bottom: 4px;
      max-height: 400px;
      overflow-y: auto;
      background-color: var(--vscode-dropdown-background, #ffffff);
      border: 1px solid var(--vscode-dropdown-border, #e0e0e0);
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      z-index: 1000;
    }
    .slash-command-item {
      display: flex;
      flex-direction: column;
      width: 100%;
      padding: 8px 12px;
      border: none;
      background: transparent;
      color: var(--vscode-foreground);
      cursor: pointer;
      text-align: left;
      transition: background-color 0.1s;
    }
    .slash-command-item:hover {
      background-color: var(--vscode-list-hoverBackground, rgba(255, 255, 255, 0.08));
    }
    .slash-command-item.active {
      background-color: var(--vscode-list-activeSelectionBackground, rgba(255, 255, 255, 0.12));
    }
    .slash-command-item.active .slash-command-name {
      color: var(--vscode-list-activeSelectionForeground, #ffffff);
    }
    .slash-command-item.active .slash-command-desc {
      color: var(--vscode-list-activeSelectionForeground, #ffffff);
      opacity: 0.7;
    }
    .slash-command-name {
      font-size: 13px;
      font-weight: 500;
      color: var(--vscode-textLink-foreground);
    }
    .slash-command-desc {
      font-size: 11px;
      opacity: 0.6;
      margin-top: 2px;
      color: var(--vscode-descriptionForeground);
    }
    .slash-command-empty {
      padding: 8px 12px;
      font-size: 12px;
      opacity: 0.5;
      color: var(--vscode-descriptionForeground);
    }
  `]
})
export class AcpChatInputComponent {
  protected acpService = inject(AcpService);

  @ViewChild('messageInput') private messageInput!: ElementRef;

  inputValue = signal<string>('');
  showAgentDropdown = signal<boolean>(false);
  selectedIndex = signal<number>(0);
  agentSelectedIndex = signal<number>(0);
  protected agents = AVAILABLE_AGENTS;

  readonly filteredCommands = computed(() => {
    const text = this.inputValue();
    if (!text.startsWith('/')) return [];
    const query = text.slice(1).toLowerCase();
    return this.acpService.availableCommands().filter(cmd =>
      cmd.name.toLowerCase().includes(query)
    );
  });

  readonly showSlashMenu = computed(() => {
    return this.inputValue().startsWith('/') && this.filteredCommands().length > 0;
  });

  constructor() {
    // Set ACP config on init with the default agent
    const agent = this.acpService.selectedAgent();
    if (agent) {
      this.acpService.setAcpConfig({ command: agent.command, args: agent.args }).catch(() => {});
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('.agent-selector')) {
      this.showAgentDropdown.set(false);
    }
  }

  toggleAgentDropdown(event: MouseEvent): void {
    event.stopPropagation();
    const opening = !this.showAgentDropdown();
    this.showAgentDropdown.set(opening);
    if (opening) {
      const idx = this.agents.findIndex(a => a.id === this.acpService.selectedAgent()?.id);
      this.agentSelectedIndex.set(idx >= 0 ? idx : 0);
    }
  }

  selectAgent(agent: AgentConfig): void {
    this.acpService.selectedAgent.set(agent);
    this.showAgentDropdown.set(false);
    this.acpService.setAcpConfig({ command: agent.command, args: agent.args }).catch(() => {});
    this.messageInput?.nativeElement?.focus();
  }

  async sendMessage(): Promise<void> {
    const text = this.inputValue().trim();
    if (!text || this.acpService.isProcessing()) {
      return;
    }

    this.inputValue.set('');

    const textarea = this.messageInput?.nativeElement;
    if (textarea) {
      textarea.style.height = 'auto';
    }

    try {
      if (!this.acpService.hasOpenedSession()) {
        this.acpService.clearMessages();
        await this.acpService.createSession(this.acpService.workingDirHint() || undefined);
        this.acpService.hasOpenedSession.set(true);
        this.acpService.showSessionHistory.set(false);
      }
      await this.acpService.sendPrompt(text);
    } catch (error) {
      console.error('[ACP Chat] Failed to send message:', error);
    }
  }

  onInput(): void {
    const textarea = this.messageInput?.nativeElement;
    if (textarea) {
      // Only reset selectedIndex when the value actually changed (not on arrow key navigation)
      if (textarea.value !== this.inputValue()) {
        this.selectedIndex.set(0);
      }
      textarea.style.height = 'auto';
      const maxHeight = 120;
      const newHeight = Math.min(textarea.scrollHeight, maxHeight);
      textarea.style.height = newHeight + 'px';
      textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
    }
  }

  onKeydown(event: KeyboardEvent): void {
    const commands = this.filteredCommands();
    const slashMenuVisible = this.inputValue().startsWith('/') && commands.length > 0;
    const agentMenuVisible = this.showAgentDropdown();

    if (slashMenuVisible) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        const next = (this.selectedIndex() + 1) % commands.length;
        this.selectedIndex.set(next);
        this.scrollToActive(next, '.slash-command-menu', '.slash-command-item');
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        const prev = (this.selectedIndex() - 1 + commands.length) % commands.length;
        this.selectedIndex.set(prev);
        this.scrollToActive(prev, '.slash-command-menu', '.slash-command-item');
        return;
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        this.selectCommand(commands[this.selectedIndex()]);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        this.inputValue.set('');
        return;
      }
    }

    if (agentMenuVisible) {
      const agentCount = this.agents.length;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        const next = (this.agentSelectedIndex() + 1) % agentCount;
        this.agentSelectedIndex.set(next);
        this.scrollToActive(next, '.agent-dropdown', '.agent-option');
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        const prev = (this.agentSelectedIndex() - 1 + agentCount) % agentCount;
        this.agentSelectedIndex.set(prev);
        this.scrollToActive(prev, '.agent-dropdown', '.agent-option');
        return;
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        this.selectAgent(this.agents[this.agentSelectedIndex()]);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        this.showAgentDropdown.set(false);
        return;
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  selectCommand(cmd: { name: string; description: string }): void {
    this.inputValue.set(`/${cmd.name} `);
    this.selectedIndex.set(0);
    this.messageInput?.nativeElement?.focus();
  }

  private scrollToActive(index: number, menuSelector: string, itemSelector: string): void {
    const box = this.messageInput?.nativeElement?.closest('.acp-chat-input-box');
    const menu = box?.querySelector(menuSelector);
    if (!menu) return;
    const items = menu.querySelectorAll(itemSelector);
    items[index]?.scrollIntoView({ block: 'nearest' });
  }
}
