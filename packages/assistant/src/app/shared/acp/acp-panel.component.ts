import { Component, computed, ElementRef, inject, input, OnInit, OnDestroy, output, signal, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AcpService } from './acp.service';
import { AcpChatComponent } from './acp-chat.component';
import { AcpChatInputComponent } from './acp-chat-input.component';
import { AcpPermissionDialogComponent } from './acp-permission-dialog.component';
import { WELCOME_TABS, type WelcomeAction, type WelcomeTabId } from './welcome-presets';
import { buildThemePrompt, randomThemePromptSeed, THEME_SKILL_NAME } from '../skill-manager/built-in/theme-prompt-seeds';


@Component({
  selector: 'app-acp-panel',
  standalone: true,
  imports: [
    CommonModule,
    AcpChatComponent,
    AcpChatInputComponent,
    AcpPermissionDialogComponent
  ],
  templateUrl: './acp-panel.component.html',
  host: {
    '[class.dock-left]': "dockPosition() === 'left'",
    '(document:click)': 'onDocumentClick()'
  },
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      overflow: auto;
      position: relative;
      z-index: 10;
      background-color: var(--vscode-background);
      margin: 5px 5px 5px 0;
    }
    :host(.dock-left) {
      margin: 5px 0 5px 5px;
    }
    .card-base {
      background-color: var(--vscode-background);
      border-radius: 0;
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      container-type: inline-size;
    }
    .acp-panel-container {
      display: flex;
      flex: 1;
      min-height: 0;
      align-self: center;
      width: 100%;
    }
    @container (min-width: 800px) {
      .acp-panel-container {
        width: 70%;
      }
    }

    .acp-panel-container .acp-chat-container {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
    }

    .acp-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-left: 5px;
    }

    .acp-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 600;
      color: var(--vscode-foreground);
    }

    .acp-icon {
      width: 16px;
      height: 16px;
      color: var(--vscode-accent-color);
    }

    .acp-actions {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .acp-dock-wrapper {
      position: relative;
    }

    .acp-dock-menu {
      position: absolute;
      top: 100%;
      right: 0;
      z-index: 1000;
      min-width: 160px;
      background: var(--vscode-background);
      border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.2));
      border-radius: 6px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      padding: 8px;
    }

    .acp-dock-menu-title {
      font-size: 12px;
      font-weight: 600;
      color: var(--vscode-foreground);
      padding: 4px 8px;
      margin-bottom: 4px;
    }

    .acp-dock-menu-items {
      display: flex;
      gap: 4px;
      margin-bottom: 8px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.2));
    }

    .acp-dock-menu .acp-panel-close {
      width: 100%;
      height: 28px;
      justify-content: center;
      color: var(--vscode-errorForeground);
    }

    .acp-dock-item {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      padding: 0;
      border: 1px solid transparent;
      border-radius: 4px;
      background: transparent;
      cursor: pointer;
      color: var(--vscode-foreground);
      transition: background-color 0.15s, border-color 0.15s;
    }

    .acp-dock-item:hover {
      background: var(--vscode-hover-background);
    }

    .acp-dock-item.active {
      border-color: var(--vscode-accent-color);
      background: var(--vscode-primary-background);
      color: var(--vscode-primary-foreground);
    }

    .acp-dock-item svg {
      width: 20px;
      height: 20px;
    }

    .acp-panel-close {
      width: 28px;
      height: 28px;
      border: none;
      border-radius: var(--vscode-radius-sm);
      background: transparent;
      color: var(--vscode-foreground);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0.7;
      transition: opacity 0.15s, background-color 0.15s;
    }

    .acp-panel-close:hover {
      opacity: 1;
      background-color: var(--vscode-hover-background);
    }

    .acp-panel-close svg {
      width: 16px;
      height: 16px;
    }

    .acp-icon-button {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      padding: 0;
      border: none;
      background: transparent;
      border-radius: 4px;
      cursor: pointer;
      color: var(--vscode-foreground);
    }

    .acp-icon-button:hover {
      background: var(--vscode-hover-background);
    }

    .acp-icon-button svg {
      width: 16px;
      height: 16px;
    }

    .editor-toggle-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      padding: 0;
      border: none;
      background: transparent;
      border-radius: 4px;
      cursor: pointer;
      color: var(--vscode-foreground);
      opacity: 0.6;
      transition: opacity 0.15s, background-color 0.15s;
      flex-shrink: 0;
    }

    .editor-toggle-btn:hover {
      opacity: 1;
      background: var(--vscode-hover-background);
    }

    .editor-toggle-btn.active {
      opacity: 1;
      color: var(--borderless-accent);
      background: var(--vscode-toolbar-activeBackground, rgba(128, 128, 128, 0.3));
    }

    .editor-toggle-btn svg {
      width: 16px;
      height: 16px;
    }

    .sidebar-toggle-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      padding: 0;
      border: none;
      background: transparent;
      border-radius: 4px;
      cursor: pointer;
      color: var(--vscode-foreground);
      opacity: 0.6;
      transition: opacity 0.15s, background-color 0.15s;
      flex-shrink: 0;
      transform: rotate(180deg);
    }

    .sidebar-toggle-btn:hover {
      opacity: 1;
      background: var(--vscode-hover-background);
    }

    .sidebar-toggle-btn svg {
      width: 16px;
      height: 16px;
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .status-dot.connected {
      background: #4caf50;
      box-shadow: 0 0 4px #4caf50;
    }

    .status-dot.connecting {
      background: #ff9800;
      animation: pulse 1s ease-in-out infinite;
    }

    .status-dot.disconnected {
      background: #9e9e9e;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }

    /* ===== Welcome Screen ===== */
    .acp-welcome-screen {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px 16px;
      min-height: 0;
    }

    .welcome-content {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 20px;
      margin-bottom: 32px;
    }

    .welcome-title {
      font-size: 22px;
      font-weight: 600;
      color: var(--vscode-foreground);
      text-align: center;
      margin: 0;
      line-height: 1.3;
    }

    .welcome-category-tabs {
      display: flex;
      gap: 8px;
    }

    .welcome-tab {
      padding: 6px 16px;
      border-radius: 20px;
      border: 1px solid var(--vscode-border-color);
      background: transparent;
      color: var(--vscode-foreground);
      font-size: 13px;
      cursor: pointer;
      transition: background-color 0.15s, border-color 0.15s;
    }

    .welcome-tab:hover {
      background-color: var(--vscode-hover-background);
    }

    .welcome-tab.active {
      background-color: var(--vscode-item-active-background);
      color: var(--vscode-foreground);
      border-color: transparent;
    }

    .welcome-quick-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: center;
    }

    .quick-action-tag {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      border-radius: 8px;
      border: 1px solid var(--vscode-border-color);
      background: transparent;
      color: var(--vscode-foreground);
      font-size: 12px;
      cursor: pointer;
      transition: background-color 0.15s;
    }

    .quick-action-tag:hover {
      background-color: var(--vscode-hover-background);
    }

    .quick-action-tag svg {
      width: 14px;
      height: 14px;
      opacity: 0.7;
    }

    .welcome-chat-wrapper {
      width: 100%;
      max-width: 640px;
    }
  `]
})
export class AcpPanelComponent implements OnInit, OnDestroy {
  themeApply = output<Record<string, any>>();
  private static readonly PANEL_WIDE_THRESHOLD = 600;
  closePanel = output<void>();
  maximizePanel = output<void>();
  restorePanel = output<void>();
  dockPositionChange = output<'left' | 'right'>();
  /** Emitted when the editor (AST content panel) toggle button is clicked. */
  editorToggle = output<void>();
  /** Emitted when the sidebar expand button is clicked. */
  sidebarExpand = output<void>();
  isMaximized = input<boolean>(false);
  dockPosition = input<'left' | 'right'>('right');
  /** Whether the editor (AST content panel) is open; drives the toggle button state. */
  editorToggleActive = input<boolean>(false);
  /** Whether the left sidebar is collapsed; controls visibility of the expand button. */
  sidebarCollapsed = input<boolean>(false);
  protected acpService = inject(AcpService);
  showDockMenu = signal<boolean>(false);
  showSettings = signal<boolean>(false);
  /** Welcome screen data: category tabs, each with its own quick-action tags. */
  protected readonly welcomeTabs = WELCOME_TABS;
  protected readonly activeWelcomeTabId = signal<WelcomeTabId>('working');
  protected readonly activeWelcomeActions = computed(() =>
    WELCOME_TABS.find(tab => tab.id === this.activeWelcomeTabId())?.actions ?? []
  );
  protected hostWidth = signal<number>(0);
  protected isPanelWide = computed(() => this.hostWidth() >= AcpPanelComponent.PANEL_WIDE_THRESHOLD);
  protected hasMessages = computed(() => this.acpService.messages().length > 0);
  private hostRef = inject(ElementRef<HTMLElement>);
  private resizeObserver?: ResizeObserver;
  @ViewChild(AcpChatComponent) private acpChat?: AcpChatComponent;
  @ViewChild(AcpChatInputComponent) private chatInput?: AcpChatInputComponent;
  /** Label of the last random theme seed, so consecutive picks differ. */
  private lastThemeSeedLabel?: string;

  ngOnInit(): void {
    this.resizeObserver = new ResizeObserver(entries => {
      this.hostWidth.set(entries[0].contentRect.width);
    });
    this.resizeObserver.observe(this.hostRef.nativeElement);
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
  }

  toggleSettings(): void {
    this.showSettings.update(v => !v);
  }

  toggleDockMenu(): void {
    this.showDockMenu.update(v => !v);
  }

  setDockPosition(position: 'left' | 'right'): void {
    this.dockPositionChange.emit(position);
    this.showDockMenu.set(false);
  }

  /** Switches the welcome screen's category tab (swaps the quick-action tags). */
  selectWelcomeTab(id: WelcomeTabId): void {
    this.activeWelcomeTabId.set(id);
  }

  /**
   * Prefills the welcome screen's chat input with the tag's prompt template.
   * The `themeGenerator` entry mirrors Settings → "+ Generate themes using
   * AI": load the Theme-generator skill prefilled with a random style seed
   * (deduplicated against the previous pick).
   */
  applyWelcomeAction(action: WelcomeAction): void {
    if (action.themeGenerator) {
      const seed = randomThemePromptSeed(this.lastThemeSeedLabel);
      this.lastThemeSeedLabel = seed.label;
      this.chatInput?.prefillPrompt(`/${THEME_SKILL_NAME} ${buildThemePrompt(seed)}`);
      return;
    }
    if (action.prompt) {
      this.chatInput?.prefillPrompt(action.prompt);
    }
  }

  onSettingsChange(value: boolean): void {
    this.showSettings.set(value);
  }

  onDocumentClick(): void {
    if (this.showDockMenu()) {
      this.showDockMenu.set(false);
    }
  }

  /**
   * Handle wheel events on the panel area.
   * Forward scroll to the chat message list when not over scrollable inner elements.
   */
  onWheel(event: WheelEvent): void {
    const target = event.target as HTMLElement;

    // Check if the event target is inside a scrollable inner element
    const scrollableParent = target.closest('.custom-scroll, pre, .tool-call-diff, textarea');
    if (scrollableParent) {
      return;
    }

    // Forward scroll to the message list
    if (this.acpChat) {
      event.preventDefault();
      this.acpChat.scrollByDelta(event.deltaY);
    }
  }
}
