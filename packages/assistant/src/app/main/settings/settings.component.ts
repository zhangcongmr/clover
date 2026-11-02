import { Component, HostListener, inject, input, output, signal, computed } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { SettingsService } from "./settings.service";
import { LocalAgentService } from "../../shared/local-agent/local-agent.service";
import { CoreService } from "../../core.service";
import { AcpSseService } from "../../shared/acp/acp-sse.service";
import { AcpService } from "../../shared/acp/acp.service";
import { ThemeLibraryService, SavedTheme } from "../../theme-library.service";
import { BUILTIN_THEME_PRESETS } from "../../builtin-theme-presets";
import { THEME_CHIP_CATEGORIES } from "../../shared/skill-manager/built-in/theme-chips-library";
import { ThemePreviewSvgComponent, ThemePreviewVariant } from "../../shared/acp/theme-preview-svg.component";
import { NotificationService } from "../../shared/notification/notification.service";
import { AstMenuComponent } from "../../shared/ast-menu/ast-menu.component";
import { AcpRegistryDialogComponent, AcpRegistryAgent } from "../../shared/acp/acp-registry-dialog.component";
import {
  AddAgentFromDiskDialogComponent,
  AddDiskAgentRequest,
} from "../../shared/acp/add-agent-from-disk-dialog.component";
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
  imports: [FormsModule, ThemePreviewSvgComponent, AstMenuComponent, AcpRegistryDialogComponent, AddAgentFromDiskDialogComponent],
})
export class SettingsComponent {
  private settingsService = inject(SettingsService);
  protected localAgentService = inject(LocalAgentService);
  private coreService = inject(CoreService);
  private sseService = inject(AcpSseService);
  /** Agent 列表单一数据源（与 agent 选择器共用同一个 installedAgents signal）。 */
  protected acp = inject(AcpService);
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

  /** ACP agents reported by the backend AgentRegistry (Settings → Agents).
   *  Shared single source of truth: AcpService.installedAgents. */
  agentsLoading = signal(false);
  agentsError = signal<string | null>(null);
  /** Agent id currently running a Check Now, guards double-click. */
  checkingAgentId = signal<string | null>(null);
  /** Agent id currently installing, guards double-click. */
  installingAgentId = signal<string | null>(null);
  /** Latest installer output line, shown while an install is running. */
  installStatusLine = signal<string | null>(null);
  /** Agent id currently uninstalling, guards double-click. */
  uninstallingAgentId = signal<string | null>(null);
  /** Ids of agents with a running install (registry dialog button state). */
  installingAgentIds = computed(() => {
    const id = this.installingAgentId();
    return id ? [id] : [];
  });
  /** Ids of agents already installed (registry dialog hides their button). */
  installedAgentIds = computed(() => this.acp.installedAgents().map(a => a.id));

  /** Whether the ACP Registry install dialog is open. */
  registryDialogVisible = false;

  /** Whether the Add/Edit Agent From Disk dialog is open. */
  diskDialogVisible = false;
  /** Disk agent currently being edited (null = add mode). */
  editingDiskAgent: AgentStatusInfo | null = null;

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
    if (id === 'general' && this.acp.installedAgents().length === 0 && !this.agentsLoading()) {
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
      this.acp.installedAgents.set(await this.sseService.listAgents());
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
      this.acp.installedAgents.update(list => list.map(a => a.id === updated.id ? updated : a));
    } catch (error) {
      this.agentsError.set((error as Error).message);
    } finally {
      this.checkingAgentId.set(null);
    }
  }

  /**
   * Uninstall an agent (Settings → Uninstall): removes on-disk artifacts and
   * the ~/.clover/acp.json entry on the backend, then refreshes the list.
   */
  async uninstallAgent(agent: AgentStatusInfo): Promise<void> {
    if (this.uninstallingAgentId()) return;
    if (!confirm(`Uninstall "${agent.name}"? Its configuration will be removed from ~/.clover/acp.json.`)) return;

    this.uninstallingAgentId.set(agent.id);
    this.agentsError.set(null);
    try {
      await this.sseService.uninstallAgent(agent.id);
      this.acp.installedAgents.update(list => list.filter(a => a.id !== agent.id));
      this.notification.showNotification(`"${agent.name}" uninstalled`, 'success');
    } catch (error) {
      this.agentsError.set((error as Error).message);
      this.notification.showNotification(`Uninstall failed: ${(error as Error).message}`, 'error');
    } finally {
      this.uninstallingAgentId.set(null);
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

  /** Full run command for the agent row: resolved CLI path + launch args,
   *  e.g. `C:\...\npx.cmd @augmentcode/auggie@0.36.0 --acp`. */
  agentRunCommand(agent: AgentStatusInfo): string {
    const cli = agent.cliPath;
    if (!cli) return '';
    return [cli, ...(agent.args ?? [])].join(' ');
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

  /** Install the selected agent from the ACP registry.
   *  The dialog stays open: the agent's button switches to "Installing..."
   *  while the backend job runs, and disappears once the agent shows up in
   *  the installed list. */
  async onAgentInstall(agent: AcpRegistryAgent): Promise<void> {
    // Send the full agent config plus the registry distribution block; the
    // backend derives the launch command (npx / uvx / binary path) from the
    // distribution and persists it to ~/.clover/acp.json after a successful
    // install.
    const agentConfig: AgentConfig & { distribution?: any } = {
      id: agent.id,
      name: agent.name,
      command: agent.id,
      description: agent.description,
      source: 'registry',
      version: agent.version,
      installed: false,
      distribution: (agent as any).distribution,
    };

    await this.onAgentInstalled(agentConfig);
  }

  /** Unified handler: start the backend install job for a full agent config,
   *  poll it until done, then refresh the list. On success the backend has
   *  already persisted the config to ~/.clover/acp.json and registered it. */
  async onAgentInstalled(agentConfig: AgentConfig & { distribution?: any }): Promise<void> {
    try {
      this.installingAgentId.set(agentConfig.id);
      this.agentsError.set(null);
      this.installStatusLine.set(null);

      let job = await this.sseService.startAgentInstall(agentConfig);
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
      } else {
        this.notification.showNotification(`"${agentConfig.name}" installed`, 'success');
      }

      // Refresh the list either way; on success the agent is registered
      // server-side, on failure nothing was persisted.
      await this.loadAgents();
    } catch (error) {
      this.agentsError.set((error as Error).message);
      this.notification.showNotification(`Install failed: ${(error as Error).message}`, 'error');
    } finally {
      this.installingAgentId.set(null);
      this.installStatusLine.set(null);
    }
  }

  /**
   * Delete button in the disk dialog (edit mode): uninstall the agent — the
   * backend drops the ~/.clover/acp.json entry and any install artifacts — then
   * close the dialog and refresh the list.
   */
  async onDiskAgentRemoved(agentId: string): Promise<void> {
    if (this.uninstallingAgentId()) return;
    const name = this.editingDiskAgent?.name
      ?? this.acp.installedAgents().find(a => a.id === agentId)?.name
      ?? agentId;
    if (!confirm(`Delete "${name}"? Its configuration will be removed from ~/.clover/acp.json.`)) return;

    this.uninstallingAgentId.set(agentId);
    this.agentsError.set(null);
    try {
      await this.sseService.uninstallAgent(agentId);
      this.acp.installedAgents.update(list => list.filter(a => a.id !== agentId));
      this.notification.showNotification(`"${name}" deleted`, 'success');
      this.diskDialogVisible = false;
      this.editingDiskAgent = null;
      await this.loadAgents();
    } catch (error) {
      this.agentsError.set((error as Error).message);
      this.notification.showNotification(`Delete failed: ${(error as Error).message}`, 'error');
    } finally {
      this.uninstallingAgentId.set(null);
    }
  }

  /** Add a local agent from the filesystem: opens the disk dialog (add mode). */
  onAddAgentFromDisk(): void {
    this.agentMenuOpen = false;
    this.agentMenuInitiator = undefined;
    this.editingDiskAgent = null;
    this.diskDialogVisible = true;
  }

  /** Open the disk dialog in edit mode for a disk-source agent. */
  onEditDiskAgent(agent: AgentStatusInfo): void {
    this.editingDiskAgent = agent;
    this.diskDialogVisible = true;
  }

  onDiskDialogClose(): void {
    this.diskDialogVisible = false;
    this.editingDiskAgent = null;
  }

  /** Handle the disk dialog's confirm: add (install flow) or edit (update). */
  async onDiskAgentConfirmed(request: AddDiskAgentRequest): Promise<void> {
    this.diskDialogVisible = false;

    if (request.editing) {
      try {
        await this.sseService.updateDiskAgent(request.id, {
          name: request.name,
          command: request.command,
          args: request.args,
          description: request.description,
        });
        this.notification.showNotification(`"${request.name}" updated`, 'success');
        await this.loadAgents();
      } catch (error) {
        this.agentsError.set((error as Error).message);
        this.notification.showNotification(`Update failed: ${(error as Error).message}`, 'error');
      }
      return;
    }

    const agentConfig: AgentConfig & { distribution?: any } = {
      id: request.id,
      name: request.name,
      command: request.command,
      args: request.args,
      description: request.description,
      source: 'disk',
      installed: false,
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
