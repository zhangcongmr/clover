import { Component, computed, effect, ElementRef, inject, input, OnInit, OnDestroy, output, signal, untracked, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AcpService } from './acp.service';
import { AcpChatComponent } from './acp-chat.component';
import { AcpChatInputComponent } from './acp-chat-input.component';
import { AcpPermissionDialogComponent } from './acp-permission-dialog.component';
import { WELCOME_TABS, type WelcomeAction, type WelcomeTabId } from './welcome-presets';
import { buildThemePrompt, randomThemePromptSeed, THEME_SKILL_NAME } from '../skill-manager/built-in/theme-prompt-seeds';
import { LayoutService } from '../../main/layout.service';
import { formatRelativeTime, toTimestamp } from './relative-time.util';
import {
  RECENT_SESSION_LIMIT,
  readRecentOpenedSessions,
  type RecentSessionEntry,
} from './recent-sessions.util';


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
    '[class.dock-left]': "layoutService.dockPosition() === 'left'",
    '(wheel)': 'onWheel($event)'
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
  /** Emitted when the editor (AST content panel) toggle button is clicked. Only in agent-first mode. */
  editorToggle = output<void>();
  /** Emitted when the overview toggle button is clicked. Only in content-first mode. */
  overviewToggle = output<void>();
  /** Whether the left sidebar is collapsed; keeps header space free for the floating toggle. */
  sidebarCollapsed = input<boolean>(false);
  protected acpService = inject(AcpService);
  showSettings = signal<boolean>(false);
  /** Emitted when a recent task/session entry is clicked; the host opens it. */
  recentSessionOpen = output<RecentSessionEntry>();
  /** Welcome screen data: category tabs, each with its own quick-action tags. */
  protected readonly welcomeTabs = WELCOME_TABS;
  protected readonly activeWelcomeTabId = signal<WelcomeTabId>('working');
  protected readonly activeWelcomeActions = computed(() =>
    WELCOME_TABS.find(tab => tab.id === this.activeWelcomeTabId())?.actions ?? []
  );
  protected hostWidth = signal<number>(0);
  protected isPanelWide = computed(() => this.hostWidth() >= AcpPanelComponent.PANEL_WIDE_THRESHOLD);
  protected hasSession = computed(() => this.acpService.sessionState().sessionId !== null);
  /** Welcome screen shows only when the session has no messages and is not switching. */
  protected showWelcomeScreen = computed(() => !this.hasSession() && !this.acpService.isSwitchingSession());

  /** Session id → last opened timestamp (localStorage mirror, see `recordRecentOpenedSession`). */
  private readonly recentOpenedAt = signal<Record<string, number>>(readRecentOpenedSessions());

  /**
   * Most recently used tasks/sessions, newest first.
   *
   * Derived from the already-loaded project/task records plus the local
   * "last opened" map: opening a session does not refresh its persisted
   * `updatedAt`, so the local timestamp drives the ordering, falling back to
   * the record timestamp for sessions that were never opened here. Task
   * records persist their sessions without an `updatedAt` of their own, so the
   * task's `createdAt` is used as the fallback.
   */
  protected readonly recentSessions = computed<RecentSessionEntry[]>(() => {
    const openedAt = this.recentOpenedAt();
    const entries = new Map<string, RecentSessionEntry>();

    const add = (entry: RecentSessionEntry): void => {
      const existing = entries.get(entry.sessionId);
      // A task stands in for its session in the sidebar, so a task record wins
      // over a project record holding the same session id.
      if (!existing || (existing.kind === 'project' && entry.kind === 'task')) {
        entries.set(entry.sessionId, entry);
      }
    };

    for (const task of this.acpService.tasks()) {
      const taskTime = toTimestamp(task.createdAt);
      for (const session of task.sessions ?? []) {
        if (!session.sessionId) continue;
        add({
          sessionId: session.sessionId,
          title: session.title?.trim() || task.name || 'Untitled Session',
          kind: 'task',
          containerName: task.name,
          cwd: task.path,
          agentId: session.agentId,
          taskId: task.id,
          openedAt: openedAt[session.sessionId] ?? 0,
          updatedAt: Math.max(toTimestamp(session.updatedAt), taskTime),
        });
      }
    }

    for (const project of this.acpService.projects()) {
      if (project.type !== 'project') continue;
      for (const session of project.sessions ?? []) {
        if (!session.sessionId) continue;
        add({
          sessionId: session.sessionId,
          title: session.title?.trim() || `Session ${session.sessionId.slice(0, 8)}`,
          kind: 'project',
          containerName: project.name,
          cwd: project.path,
          agentId: session.agentId,
          openedAt: openedAt[session.sessionId] ?? 0,
          updatedAt: toTimestamp(session.updatedAt),
        });
      }
    }

    return [...entries.values()]
      .map(entry => ({ entry, sortKey: Math.max(entry.openedAt, entry.updatedAt) }))
      .sort((a, b) => b.sortKey - a.sortKey)
      .slice(0, RECENT_SESSION_LIMIT)
      .map(({ entry }) => entry);
  });

  /** Meta line of a recent row: owning task/project name plus relative time. */
  protected recentMeta(entry: RecentSessionEntry): string {
    const time = formatRelativeTime(entry.openedAt || entry.updatedAt);
    return time ? `${entry.containerName} · ${time}` : entry.containerName;
  }

  private refreshingRecentSessions = false;
  private hostRef = inject(ElementRef<HTMLElement>);
  private resizeObserver?: ResizeObserver;
  /** Label of the last random theme seed, so consecutive picks differ. */
  private lastThemeSeedLabel?: string;

  constructor() {
    // The recent list only exists on the welcome screen: re-read the local
    // "last opened" map and refresh the persisted records every time that
    // screen becomes visible (page load, New Task, closing a session).
    effect(() => {
      if (!this.showWelcomeScreen()) return;
      untracked(() => void this.refreshRecentSessions());
    });
  }

  ngOnInit(): void {
    this.resizeObserver = new ResizeObserver(entries => {
      this.hostWidth.set(entries[0].contentRect.width);
    });
    this.resizeObserver.observe(this.hostRef.nativeElement);
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
  }

  /**
   * Syncs the recent list: the local open history first (cheap, so the list
   * reorders immediately), then the persisted project/task records. The fetch
   * is skipped while one is already in flight.
   */
  private async refreshRecentSessions(): Promise<void> {
    this.recentOpenedAt.set(readRecentOpenedSessions());
    if (this.refreshingRecentSessions) return;

    this.refreshingRecentSessions = true;
    try {
      await this.acpService.listAll();
    } finally {
      this.refreshingRecentSessions = false;
    }
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
    const scrollableParent = target.closest('.welcome-recent-list, app-acp-chat-input, pre, .tool-call-diff, textarea');
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
