import { Component, HostListener, inject, input, output, signal, computed } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { SettingsService } from "./settings.service";
import { LocalAgentService } from "../../shared/local-agent/local-agent.service";
import { CoreService } from "../../core.service";
import { AcpSseService } from "../../shared/acp/acp-sse.service";
import { ThemeLibraryService, SavedTheme } from "../../theme-library.service";
import { BUILTIN_THEME_PRESETS } from "../../builtin-theme-presets";
import { THEME_CHIP_CATEGORIES } from "../../shared/skill-manager/built-in/theme-chips-library";
import { ThemePreviewSvgComponent, ThemePreviewVariant } from "../../shared/acp/theme-preview-svg.component";
import { NotificationService } from "../../shared/notification/notification.service";
import type { AgentRuntimeStatus, AgentStatusInfo } from "../../shared/acp/acp-sse.service";

/** Theme card entry: a saved library theme, or a built-in Light/Dark preset. */
export interface ThemeLibraryEntry extends SavedTheme {
  /** Set on built-in presets ('default' → Light, 'dark' → Dark); absent on saved themes. */
  builtinKey?: 'default' | 'dark';
  /** Card title shown in the UI (differs from the preset's internal title). */
  displayTitle?: string;
}

/** A rendered row of the Theme Library (built-in group first, then chip categories). */
export interface ThemeGroup {
  id: string;
  label: string;
  themes: ThemeLibraryEntry[];
}

@Component({
  selector: 'app-settings',
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.css'],
  standalone: true,
  imports: [FormsModule, ThemePreviewSvgComponent],
})
export class SettingsComponent {
  private settingsService = inject(SettingsService);
  protected localAgentService = inject(LocalAgentService);
  private coreService = inject(CoreService);
  private sseService = inject(AcpSseService);
  protected themeLibrary = inject(ThemeLibraryService);
  private notification = inject(NotificationService);

  readonly previousViewId = input<number>(1);
  readonly goBack = output<number>();
  /** Emitted when the user starts a custom (AI generated) theme from Appearance. */
  readonly generateCustomTheme = output<void>();

  categories = this.settingsService.categories;
  activeCategoryId = this.settingsService.activeCategoryId;

  folderReadWriteMode = this.settingsService.folderReadWriteMode;
  autoRefreshEnabled = this.settingsService.autoRefreshEnabled;

  currentTheme = this.settingsService.currentTheme;
  terminalFontFamily = this.settingsService.terminalFontFamily;
  terminalFontSize = this.settingsService.terminalFontSize;

  uiFontFamily = this.settingsService.uiFontFamily;
  uiFontSize = this.settingsService.uiFontSize;
  uiLineHeight = this.settingsService.uiLineHeight;

  notificationDuration = this.settingsService.notificationDuration;

  opfsInfo = this.settingsService.opfsInfo;

  selectedModel = this.settingsService.selectedModel;
  pluginsEnabled = this.settingsService.pluginsEnabled;
  useMemoryMode = this.settingsService.useMemoryMode;

  readonly modelOptions = [
    { value: 'deepseek-v4-flash', label: 'DeepSeek v4 Flash' },
    { value: 'deepseek-v3', label: 'DeepSeek v3' },
    { value: 'gpt-4o', label: 'GPT-4o' },
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  ];

  agentStatus = signal<'unknown' | 'connected' | 'disconnected'>('unknown');
  agentTesting = signal(false);

  /** ACP agents reported by the backend AgentRegistry (Settings → Agents). */
  agents = signal<AgentStatusInfo[]>([]);
  agentsLoading = signal(false);
  agentsError = signal<string | null>(null);
  /** Agent id currently running a Check Now, guards double-click. */
  checkingAgentId = signal<string | null>(null);

  opfsClearing = signal(false);

  showSavedToast = signal(false);

  /** Built-in Light/Dark presets, shown as the first Theme Library group. */
  private readonly builtinThemes: ThemeLibraryEntry[] = [
    { ...BUILTIN_THEME_PRESETS['default'], builtinKey: 'default', displayTitle: 'Light' },
    { ...BUILTIN_THEME_PRESETS['dark'], builtinKey: 'dark', displayTitle: 'Dark' },
  ];

  /**
   * Saved themes grouped by chip-library category, preceded by the built-in
   * Light/Dark group. Groups follow `THEME_CHIP_CATEGORIES` order (the
   * library's own "其他" category is last), themes without a valid
   * `categoryId` fall into "其他", and empty saved groups are hidden.
   */
  readonly themeGroups = computed<ThemeGroup[]>(() => {
    const builtinGroup: ThemeGroup = {
      id: 'builtin',
      label: 'Built-in',
      themes: this.builtinThemes,
    };
    const groups: ThemeGroup[] = THEME_CHIP_CATEGORIES.map(c => ({ id: c.id, label: c.label, themes: [] }));
    const otherGroup = groups.find(g => g.id === 'other') ?? groups[groups.length - 1];
    for (const theme of this.themeLibrary.themes()) {
      const group = groups.find(g => g.id === theme.categoryId) ?? otherGroup;
      group.themes.push(theme);
    }
    return [builtinGroup, ...groups.filter(g => g.themes.length > 0)];
  });

  /** Name of the theme currently applied to the app (Light / Dark / saved title). */
  readonly currentThemeTitle = computed<string>(() => {
    const current = this.currentTheme();
    if (current === 'default') return 'Light';
    if (current === 'dark') return 'Dark';
    const active = this.themeLibrary.themes().find(t => t.id === this.themeLibrary.activeId());
    return active?.title ?? 'Custom Theme';
  });

  constructor() {
    this.checkAgentStatus();
    this.loadAgents();
  }

  setActiveCategory(id: string) {
    this.settingsService.setActiveCategory(id);
    if (id === 'data') {
      this.settingsService.refreshOpfsInfo();
    }
    if (id === 'general' && this.agents().length === 0 && !this.agentsLoading()) {
      this.loadAgents();
    }
  }

  saveAgentUrl() {
    this.showToast();
    this.checkAgentStatus();
  }

  onFolderReadWriteModeChange(mode: 'read' | 'readwrite') {
    this.settingsService.setFolderReadWriteMode(mode);
  }

  onAutoRefreshChange(event: Event) {
    const enabled = (event.target as HTMLInputElement).checked;
    this.settingsService.setAutoRefreshEnabled(enabled);
  }

  toggleTheme() {
    this.settingsService.toggleTheme();
  }

  setTheme(theme: string) {
    this.settingsService.setTheme(theme);
  }

  onGenerateCustomTheme() {
    this.generateCustomTheme.emit();
  }

  // ==========================================================================
  // Theme library preview overlay (Settings → Appearance)
  // ==========================================================================

  /** Theme shown in the maximised preview overlay, null when closed. */
  previewTheme = signal<ThemeLibraryEntry | null>(null);
  /** Which mockup variant the overlay shows. */
  previewVariant = signal<ThemePreviewVariant>('welcome');

  /** Card/overlay title: built-in presets show Light/Dark instead of the preset title. */
  themeCardTitle(theme: ThemeLibraryEntry): string {
    return theme.displayTitle ?? theme.title;
  }

  /** Whether the card is the theme currently applied to the app. */
  isThemeCardActive(theme: ThemeLibraryEntry): boolean {
    if (theme.builtinKey) {
      return this.currentTheme() === theme.builtinKey;
    }
    return this.currentTheme() === 'custom' && this.themeLibrary.activeId() === theme.id;
  }

  openPreview(theme: ThemeLibraryEntry) {
    this.previewTheme.set(theme);
    this.previewVariant.set('welcome');
  }

  closePreview() {
    this.previewTheme.set(null);
  }

  /** Cycles the overlay through the built-in and saved themes, wrapping at either end. */
  stepPreview(delta: number, event?: Event) {
    event?.stopPropagation();
    const themes = this.themeGroups().flatMap(group => group.themes);
    const current = this.previewTheme();
    if (!current || themes.length === 0) return;
    const index = themes.findIndex(t => t.id === current.id);
    const next = (index + delta + themes.length) % themes.length;
    this.previewTheme.set(themes[next]);
  }

  applyLibraryTheme(theme: ThemeLibraryEntry) {
    if (theme.builtinKey) {
      this.setTheme(theme.builtinKey);
      this.notification.showNotification(`"${this.themeCardTitle(theme)}" applied`, 'success');
      this.closePreview();
      return;
    }
    if (this.themeLibrary.apply(theme.id)) {
      this.settingsService.currentTheme.set('custom');
      this.notification.showNotification(`"${theme.title}" applied`, 'success');
      this.closePreview();
    }
  }

  deleteTheme(theme: ThemeLibraryEntry, event?: Event) {
    event?.stopPropagation();
    if (theme.builtinKey) return;
    if (!confirm(`Delete "${theme.title}" from the theme library?`)) return;
    void this.themeLibrary.remove(theme.id);
    if (this.previewTheme()?.id === theme.id) {
      this.closePreview();
    }
    this.notification.showNotification(`"${theme.title}" deleted`, 'info');
  }

  @HostListener('document:keydown.escape')
  onEscapeKeydown() {
    this.closePreview();
  }

  @HostListener('document:keydown.arrowleft')
  onArrowLeftKeydown() {
    if (this.previewTheme()) this.stepPreview(-1);
  }

  @HostListener('document:keydown.arrowright')
  onArrowRightKeydown() {
    if (this.previewTheme()) this.stepPreview(1);
  }

  onTerminalFontFamilyChange(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.settingsService.setTerminalFontFamily(value);
  }

  onTerminalFontSizeChange(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    const num = Number(value);
    if (!isNaN(num) && num > 0) {
      this.settingsService.setTerminalFontSize(num);
    }
  }

  onUiFontFamilyChange(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.settingsService.setUiFontFamily(value);
  }

  onUiFontSizeChange(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    const num = Number(value);
    if (!isNaN(num) && num > 0) {
      this.settingsService.setUiFontSize(num);
    }
  }

  onUiLineHeightChange(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    const num = Number(value);
    if (!isNaN(num) && num > 0) {
      this.settingsService.setUiLineHeight(num);
    }
  }

  onNotificationDurationChange(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    const num = Number(value);
    if (!isNaN(num)) {
      this.settingsService.setNotificationDuration(num);
    }
  }

  onModelChange(event: Event) {
    const value = (event.target as HTMLSelectElement).value;
    this.settingsService.setSelectedModel(value);
  }

  onPluginsEnabledChange(event: Event) {
    const enabled = (event.target as HTMLInputElement).checked;
    this.settingsService.setPluginsEnabled(enabled);
  }

  onUseMemoryModeChange(event: Event) {
    const enabled = (event.target as HTMLInputElement).checked;
    this.settingsService.setUseMemoryMode(enabled);
  }

  async clearAllOpfsData() {
    this.opfsClearing.set(true);
    await this.settingsService.clearAllOpfsData();
    this.opfsClearing.set(false);
  }

  async testAgentConnection() {
    this.agentTesting.set(true);
    const ok = await this.localAgentService.checkAgentAvailable();
    this.agentStatus.set(ok ? 'connected' : 'disconnected');
    this.agentTesting.set(false);
  }

  private async checkAgentStatus() {
    const ok = await this.localAgentService.checkAgentAvailable();
    this.agentStatus.set(ok ? 'connected' : 'disconnected');
  }

  // ==========================================================================
  // Agents management (Settings → General → Agents)
  // ==========================================================================

  async loadAgents(): Promise<void> {
    if (this.agentsLoading()) return;
    this.agentsLoading.set(true);
    this.agentsError.set(null);
    try {
      this.agents.set(await this.sseService.listAgents());
    } catch (error) {
      this.agentsError.set((error as Error).message);
    } finally {
      this.agentsLoading.set(false);
    }
  }

  /**
   * Check Now：重新检测安装状态，并尝试把 Agent 拉到“连接”状态。
   */
  async checkNow(agentId: string): Promise<void> {
    if (this.checkingAgentId()) return;
    this.checkingAgentId.set(agentId);
    this.agentsError.set(null);
    try {
      const updated = await this.sseService.checkAgent(agentId);
      this.agents.update(list => list.map(a => a.id === updated.id ? updated : a));
    } catch (error) {
      this.agentsError.set((error as Error).message);
    } finally {
      this.checkingAgentId.set(null);
    }
  }

  agentStatusLabel(status: AgentRuntimeStatus): string {
    switch (status) {
      case 'connected': return 'Connected';
      case 'unavailable': return 'Unavailable';
      case 'offline': return 'Offline';
      case 'available': return 'Available';
      default: return 'Checking...';
    }
  }

  private showToast() {
    this.showSavedToast.set(true);
    setTimeout(() => this.showSavedToast.set(false), 2000);
  }

  onGoBack() {
    this.goBack.emit(this.previousViewId());
  }
}
