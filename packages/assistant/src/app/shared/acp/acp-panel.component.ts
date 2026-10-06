import { Component, computed, ElementRef, inject, input, OnInit, OnDestroy, output, signal, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AcpService } from './acp.service';
import { AcpChatComponent } from './acp-chat.component';
import { AcpChatInputComponent } from './acp-chat-input.component';
import { AcpPermissionDialogComponent } from './acp-permission-dialog.component';
import { WELCOME_TABS, type WelcomeAction, type WelcomeTabId } from './welcome-presets';
import { buildThemePrompt, randomThemePromptSeed, THEME_SKILL_NAME } from '../skill-manager/built-in/theme-prompt-seeds';
import { LayoutService } from '../../main/layout.service';


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
    '[class.dock-left]': "layoutService.dockPosition() === 'left'"
  },
  styleUrls: ['./acp-panel.component.css'],
})
export class AcpPanelComponent implements OnInit, OnDestroy {
  @ViewChild(AcpChatComponent) private acpChat?: AcpChatComponent;
  @ViewChild(AcpChatInputComponent) private chatInput?: AcpChatInputComponent;

  protected readonly layoutService = inject(LayoutService);

  themeApply = output<Record<string, any>>();
  private static readonly PANEL_WIDE_THRESHOLD = 600;
  closePanel = output<void>();
  /** Emitted when the editor (AST content panel) toggle button is clicked. */
  editorToggle = output<void>();
  /** Emitted when the sidebar expand button is clicked. */
  sidebarExpand = output<void>();
  /** Whether the left sidebar is collapsed; controls visibility of the expand button. */
  sidebarCollapsed = input<boolean>(false);
  protected acpService = inject(AcpService);
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

  /**
   * Handle wheel events on the panel area.
   * Forward scroll to the chat message list when not over scrollable inner elements.
   */
  onWheel(event: WheelEvent): void {
    const target = event.target as HTMLElement;

    // Check if the event target is inside a scrollable inner element
    const scrollableParent = target.closest('app-acp-chat-input, pre, .tool-call-diff, textarea');
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
