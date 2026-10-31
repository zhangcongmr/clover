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
import { AstMenuComponent } from "../../shared/ast-menu/ast-menu.component";
import { AcpRegistryDialogComponent, AcpRegistryAgent } from "../../shared/acp/acp-registry-dialog.component";
import type { AgentRuntimeStatus, AgentStatusInfo } from "../../shared/acp/acp-sse.service";
import type { AgentConfig } from "../../shared/acp/acp-agent.types";

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

/** Reads a numeric input; an empty field yields NaN so the service keeps the current value. */
function readNumber(raw: string): number {
  const trimmed = raw.trim();
  return trimmed === '' ? NaN : Number(trimmed);
}

@Component({
  selector: 'app-settings',
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.css'],
  standalone: true,
  imports: [FormsModule, ThemePreviewSvgComponent, AstMenuComponent, AcpRegistryDialogComponent],
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

  selectedModel = this.settingsService.selectedModel;
  pluginsEnabled = this.settingsService.pluginsEnabled;
  useMemoryMode = this.settingsService.useMemoryMode;

  agentStatus = signal<'unknown' | 'connected' | 'disconnected'>('unknown');
  agentTesting = signal(false);

  /** ACP agents reported by the backend AgentRegistry (Settings → Agents). */
  agents = signal<AgentStatusInfo[]>([]);
  agentsLoading = signal(false);
  agentsError = signal<string | null>(null);
  /** Agent id currently running a Check Now, guards double-click. */
  checkingAgentId = signal<string | null>(null);
  /** Agent id currently installing, guards double-click. */
  installingAgentId = signal<string | null>(null);
  /** Latest installer output line, shown while an install is running. */
  installStatusLine = signal<string | null>(null);

  /** Whether the ACP Registry install dialog is open. */
  registryDialogVisible = false;

  /** Whether the "Add Agent" dropdown menu is open. */
  agentMenuOpen = false;
  /** Bounding rect of the menu trigger button, used to position the dropdown. */
  agentMenuInitiator: DOMRect | undefined;

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

  /** Theme cards expose `role="button"`, so mirror click on Enter / Space. */
  onThemeCardKeydown(event: KeyboardEvent, theme: ThemeLibraryEntry) {
    // Ignore keys coming from the nested delete button, which handles its own activation.
    if (event.target !== event.currentTarget) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    this.openPreview(theme);
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
    const input = event.target as HTMLInputElement;
    input.value = this.settingsService.setTerminalFontFamily(input.value);
  }

  onTerminalFontSizeChange(event: Event) {
    const input = event.target as HTMLInputElement;
    input.value = String(this.settingsService.setTerminalFontSize(readNumber(input.value)));
  }

  onUiFontFamilyChange(event: Event) {
    const input = event.target as HTMLInputElement;
    input.value = this.settingsService.setUiFontFamily(input.value);
  }

  onUiFontSizeChange(event: Event) {
    const input = event.target as HTMLInputElement;
    input.value = String(this.settingsService.setUiFontSize(readNumber(input.value)));
  }

  onUiLineHeightChange(event: Event) {
    const input = event.target as HTMLInputElement;
    input.value = String(this.settingsService.setUiLineHeight(readNumber(input.value)));
  }

  /** Restores the Editor (UI typography) group to the app defaults. */
  resetUiTextDefaults() {
    this.settingsService.resetUiTypography();
    this.notification.showNotification('Editor text settings restored to defaults', 'info');
  }

  /** Restores the Terminal group to the app defaults. */
  resetTerminalTextDefaults() {
    this.settingsService.resetTerminalTypography();
    this.notification.showNotification('Terminal text settings restored to defaults', 'info');
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

  /**
   * Install the missing piece for an agent (global CLI or project adapter).
   * Runs on the backend, polls the job until it finishes, then re-probes.
   */
  async installAgent(agentId: string): Promise<void> {
    if (this.installingAgentId()) return;

    this.installingAgentId.set(agentId);
    this.agentsError.set(null);
    this.installStatusLine.set(null);

    try {
      let job = await this.sseService.startAgentInstall(agentId);
      this.installStatusLine.set(job.command);

      while (job.status === 'running') {
        await new Promise(resolve => setTimeout(resolve, 1500));
        job = await this.sseService.getAgentInstallJob(job.id);
        const runningStep = job.steps.find(step => step.status === 'running') ?? job.steps[job.steps.length - 1];
        const lastLine = runningStep?.output[runningStep.output.length - 1];
        this.installStatusLine.set(lastLine ?? job.command);
      }

      if (job.status !== 'succeeded') {
        this.agentsError.set(job.error ?? `Install failed for ${agentId}`);
      }

      // Re-probe either way: a partial install may still leave the agent usable.
      await this.checkNow(agentId);
    } catch (error) {
      this.agentsError.set((error as Error).message);
    } finally {
      this.installingAgentId.set(null);
      this.installStatusLine.set(null);
    }
  }

  /**
   * Compact a filesystem path for the agent rows: keep both ends readable so
   * long pnpm store paths still show the package and the entry file.
   */
  shortenPath(path: string, maxLength = 72): string {
    if (path.length <= maxLength) return path;
    const headLength = Math.ceil((maxLength - 1) * 0.45);
    const tailLength = maxLength - 1 - headLength;
    return `${path.slice(0, headLength)}…${path.slice(-tailLength)}`;
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

  /** Open / close the "Add Agent" dropdown menu next to the trigger button. */
  toggleAgentMenu(evt: MouseEvent): void {
    this.agentMenuOpen = !this.agentMenuOpen;
    if (this.agentMenuOpen) {
      this.agentMenuInitiator = (evt.currentTarget as HTMLElement).getBoundingClientRect();
    }
  }

  /** Open the "Install From ACP Registry" dialog. */
  openRegistryDialog(): void {
    this.agentMenuOpen = false;
    this.agentMenuInitiator = undefined;
    this.registryDialogVisible = true;
  }

  /** Close the ACP Registry dialog. */
  onRegistryDialogClose(): void {
    this.registryDialogVisible = false;
  }

  /** OK button on the ACP Registry dialog. */
  onRegistryDialogOk(): void {
    this.registryDialogVisible = false;
  }

  /** Apply button on the ACP Registry dialog. */
  onRegistryDialogApply(): void {
    this.registryDialogVisible = false;
  }

  /** Install the selected agent from the ACP registry. */
  async onAgentInstall(agent: AcpRegistryAgent): Promise<void> {
    this.registryDialogVisible = false;

    // Map registry agent to AgentConfig for persistence.
    // Do NOT map npx distribution to command: 'npx' — npx itself is already
    // installed and the backend would wrongly skip installation. Keep the
    // agent id as the command so the backend can probe and install it.
    const dist = (agent as any).distribution;
    let args: string[] = [];
    let env: Record<string, string> | undefined;
    if (dist?.npx) {
      args = [dist.npx.package, ...(dist.npx.args ?? [])];
      env = dist.npx.env;
    } else if (dist?.uvx) {
      args = [dist.uvx.package, ...(dist.uvx.args ?? [])];
      env = dist.uvx.env;
    }

    const agentConfig: AgentConfig = {
      id: agent.id,
      name: agent.name,
      command: agent.id,
      args,
      env,
      description: agent.description,
      source: 'registry',
      version: agent.version,
      installed: false,
      installedAt: new Date().toISOString(),
    };

    await this.onAgentInstalled(agentConfig);
  }

  /** Unified handler: persist installed agent config to ~/.clover/acp.json,
   *  register it in the backend AgentRegistry, then kick off installation. */
  async onAgentInstalled(agentConfig: AgentConfig): Promise<void> {
    try {
      // 2. Start installation (polls job until done)
      this.installingAgentId.set(agentConfig.id);
      this.agentsError.set(null);
      this.installStatusLine.set(null);

      let job = await this.sseService.startAgentInstall(agentConfig.id);
      this.installStatusLine.set(job.command);

      while (job.status === 'running') {
        await new Promise(resolve => setTimeout(resolve, 1500));
        job = await this.sseService.getAgentInstallJob(job.id);
        const runningStep = job.steps.find(step => step.status === 'running') ?? job.steps[job.steps.length - 1];
        const lastLine = runningStep?.output[runningStep.output.length - 1];
        this.installStatusLine.set(lastLine ?? job.command);
      }

      if (job.status !== 'succeeded') {
        this.agentsError.set(job.error ?? `Install failed for ${agentConfig.name}`);
      }

      // 3. Re-probe and refresh list
      await this.checkNow(agentConfig.id);
      await this.loadAgents();

      if (job.status === 'succeeded') {
        this.notification.showNotification(`"${agentConfig.name}" installed`, 'success');
      }
    } catch (error) {
      this.agentsError.set((error as Error).message);
      this.notification.showNotification(`Install failed: ${(error as Error).message}`, 'error');
    } finally {
      this.installingAgentId.set(null);
      this.installStatusLine.set(null);
    }
  }

  /** Add a local agent from the filesystem. */
  async onAddAgentFromDisk(): Promise<void> {
    this.agentMenuOpen = false;
    this.agentMenuInitiator = undefined;

    // Use the existing file picker dialog to select an agent executable.
    // For now, prompt for a path via a simple input; a dedicated disk-picker
    // dialog can be added later.
    const command = prompt('Enter the agent command or path to executable:');
    if (!command) return;

    const name = prompt('Enter a display name for this agent:', command);
    if (!name) return;

    const agentConfig: AgentConfig = {
      id: command.replace(/[^a-z0-9]/gi, '-').toLowerCase(),
      name,
      command,
      args: [],
      description: 'Agent added from disk',
      source: 'disk',
      installed: false,
      installedAt: new Date().toISOString(),
    };

    await this.onAgentInstalled(agentConfig);
  }

  private showToast() {
    this.showSavedToast.set(true);
    setTimeout(() => this.showSavedToast.set(false), 2000);
  }

  onGoBack() {
    this.goBack.emit(this.previousViewId());
  }
}
