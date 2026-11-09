import { Component, HostListener, effect, inject, input, output, signal, computed } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { SettingsService } from "./settings.service";
import { LocalServerService, REMOTE_PROBE_TIMEOUT_MS } from "../../shared/local-server/local-server.service";
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
  protected localServerService = inject(LocalServerService);
  private coreService = inject(CoreService);
  private sseService = inject(AcpSseService);
  /** Single source of truth for the agent list (shared with the agent selector's installedAgents signal). */
  protected acp = inject(AcpService);
  protected themeLibrary = inject(ThemeLibraryService);
  private notification = inject(NotificationService);

  readonly previousViewId = input<number>(1);
  readonly goBack = output<number>();
  /** Emitted when the user starts a custom (AI generated) theme from Appearance. */
  readonly generateCustomTheme = output<void>();

  categories = this.settingsService.categories;
  activeCategoryId = this.settingsService.activeCategoryId;

  autoRefreshEnabled = this.settingsService.autoRefreshEnabled;

  currentTheme = this.settingsService.currentTheme;
  terminalFontFamily = this.settingsService.terminalFontFamily;
  terminalFontSize = this.settingsService.terminalFontSize;

  uiFontFamily = this.settingsService.uiFontFamily;
  uiFontSize = this.settingsService.uiFontSize;
  uiLineHeight = this.settingsService.uiLineHeight;

  notificationDuration = this.settingsService.notificationDuration;

  selectedModel = this.settingsService.selectedModel;

  serverStatus = signal<'unknown' | 'connected' | 'disconnected'>('unknown');
  serverTesting = signal(false);

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

  /** Confirmation message shown under the Server URL input, if any. */
  serverUrlToast = signal<string | null>(null);

  /** Built-in Light/Dark presets, shown as the first Theme Library group. */
  private readonly builtinThemes: ThemeLibraryEntry[] = [
    { ...BUILTIN_THEME_PRESETS['default'], builtinKey: 'default', displayTitle: 'Light' },
    { ...BUILTIN_THEME_PRESETS['dark'], builtinKey: 'dark', displayTitle: 'Dark' },
  ];

  /**
   * Saved themes grouped by chip-library category, preceded by the built-in
   * Light/Dark group. Groups follow `THEME_CHIP_CATEGORIES` order (the
   * library's own "Other" category is last), themes without a valid
   * `categoryId` fall into "Other", and empty saved groups are hidden.
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

  /**
   * Draft value of the Server URL input.
   *
   * The input is deliberately NOT bound to `localServerService.serverUrl`
   * with `[(ngModel)]`: two-way binding would push every keystroke straight
   * into the service, so a half-typed address would immediately repoint the
   * whole app (every request goes through `getBaseUrl()`). The draft is
   * committed to the service only when `connect()` runs.
   *
   * Defaults to {@link defaultServerAddress} — the configured remote server,
   * or the origin serving this page when none is configured. An empty box
   * looked like "not connected" even though the app was talking to the server
   * right next to it.
   */
  serverUrlInput = signal('');

  /** Whether the user has edited the draft (i.e. it is no longer a mirror). */
  private serverUrlDirty = false;

  /**
   * Address the input falls back to when no remote server is configured.
   *
   * `serverUrl === ''` means "the server that hosts this page", so the input
   * has to spell that out: `window.location.origin` is exactly what
   * `getBaseUrl()` resolves to in that case. Guarded for SSR, where the
   * settings view is rendered without a `window`.
   */
  private defaultServerAddress(): string {
    const configured = this.localServerService.serverUrl;
    if (configured) return configured;
    return typeof window !== 'undefined' ? window.location.origin : '';
  }

  /**
   * Maps "this page's own origin" back to `''` — the service's marker for
   * "same origin". Any other address is returned unchanged, so the two spellings
   * of the same target do not end up as different values in `serverUrl`.
   */
  private normalizeServerUrl(url: string): string {
    if (!url || typeof window === 'undefined') return url;
    const stripSlash = (value: string) => value.replace(/\/+$/, '');
    return stripSlash(url) === stripSlash(window.location.origin) ? '' : url;
  }

  /**
   * Whether the app is bound to a remote server.
   *
   * Drives the Connect / Disconnect button: it reads "Disconnect" while a
   * remote server is in use. It is only true when the input still holds that
   * address, so typing a different one turns the button back into Connect —
   * moving to another server stays a single action.
   */
  readonly isServerConnected = computed(() => {
    // `serverUrl` is a plain field, so depend on the epoch to be re-evaluated
    // when the server changes somewhere else (the main view's dialog).
    this.localServerService.serverEpoch();
    const current = this.localServerService.serverUrl;
    return !!current && this.serverUrlInput().trim() === current;
  });

  constructor() {
    // Seed the draft with the address currently in use (defaults to this page's origin).
    this.serverUrlInput.set(this.defaultServerAddress());
    this.checkServerStatus();
    this.loadAgents();

    // The server can also be switched from the main view's remote-server
    // dialog. Re-seed the draft then, so the input never shows a stale
    // address — but only while the user has not edited it, so an
    // in-progress edit is never overwritten.
    effect(() => {
      this.localServerService.serverEpoch();
      if (!this.serverUrlDirty) {
        this.serverUrlInput.set(this.defaultServerAddress());
      }
    });
  }

  /** Keeps track of the draft being edited by the user. */
  onServerUrlInput(value: string): void {
    this.serverUrlDirty = true;
    this.serverUrlInput.set(value);
  }

  setActiveCategory(id: string) {
    this.settingsService.setActiveCategory(id);
    if (id === 'general' && this.acp.installedAgents().length === 0 && !this.agentsLoading()) {
      this.loadAgents();
    }
  }

  /**
   * Commits the Server URL entered in the input box.
   *
   * The input holds a local draft (`serverUrlInput`), not the service value,
   * so nothing changes in the app until this runs: typing a new address
   * leaves the running server untouched.
   *
   * `setServerUrl()` writes the address to the service and persists it to
   * localStorage. Because the app was pointing at a different server, the
   * ACP layer has to be rebound as well — its SSE streams captured the old
   * address when they were opened and would keep talking to it otherwise.
   */
  async connect() {
    // The input is pre-filled with this page's origin when no remote server is
    // configured (see `defaultServerAddress`), and `''` already means "same
    // origin". Normalise it back to `''` so clicking Connect on the default
    // value does not persist the page's own origin as if it were a remote
    // server (or push it into the address history).
    const url = this.normalizeServerUrl(this.serverUrlInput().trim());
    if (url !== this.localServerService.serverUrl) {
      // Tear down the previous server's connections before the address
      // changes, so the ones re-established afterwards are not closed again.
      this.localServerService.disconnect();
      this.localServerService.setServerUrl(url);
      await this.acp.rebindToServer();
      // Remember the address, so it shows up in the remote-server dialog's
      // history like any other server the user connected to.
      this.localServerService.addToHistory(url);
    }
    // The draft now matches the service again: it may follow external changes.
    this.serverUrlDirty = false;
    this.serverUrlInput.set(this.defaultServerAddress());
    this.showToast(url ? `Connected to ${url}` : 'Connected');
    this.checkServerStatus();
  }

  /**
   * The Server URL button's action: connects to the address in the input, or
   * disconnects from the remote server when one is already in use.
   *
   * The button is a single element whose label and behaviour follow the
   * current state, so the two directions never sit side by side.
   */
  onPrimaryAction(): void {
    if (this.isServerConnected()) {
      void this.disconnect();
    } else {
      void this.connect();
    }
  }

  /**
   * Disconnects from the remote server: goes back to the server that hosts
   * this page (same origin).
   *
   * The counterpart of `connect()` — the button shows whichever of the two
   * applies to the current state.
   */
  async disconnect() {
    // Tear down the previous server's connections before the address changes,
    // so the ones re-established afterwards are not closed again.
    this.localServerService.disconnect();
    this.localServerService.setServerUrl('');
    await this.acp.rebindToServer();

    this.serverUrlDirty = false;
    // `serverUrl` is now empty, so this falls back to the page's own origin —
    // the server the app just went back to.
    this.serverUrlInput.set(this.defaultServerAddress());
    this.showToast('Disconnected');
    this.checkServerStatus();
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

  /**
   * Tests the address currently shown in the input box.
   *
   * The input holds a draft, so it is probed explicitly instead of falling
   * back to the configured address — otherwise the button would test the
   * old server while the user looks at a new address.
   */
  async testServerConnection() {
    this.serverTesting.set(true);
    const draft = this.serverUrlInput().trim();
    const ok = await this.localServerService.checkServerAvailable(
      draft || undefined,
      REMOTE_PROBE_TIMEOUT_MS,
    );
    this.serverStatus.set(ok ? 'connected' : 'disconnected');
    this.serverTesting.set(false);
  }

  /**
   * Refreshes the status of the server the app is actually bound to.
   *
   * Unlike `testServerConnection()` this ignores the input draft: it reports
   * the live connection, not the address being typed.
   */
  private async checkServerStatus() {
    const ok = await this.localServerService.checkServerAvailable();
    this.serverStatus.set(ok ? 'connected' : 'disconnected');
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
   * Check Now: re-detect the installation status and try to bring the agent into a "connected" state.
   */
  async checkNow(agentId: string): Promise<void> {
    if (this.checkingAgentId()) return;
    this.checkingAgentId.set(agentId);
    this.agentsError.set(null);
    try {
      const updated = await this.sseService.checkAgent(agentId);
      this.acp.installedAgents.update(list => list.map(a => a.id === updated.id ? updated : a));
    } catch (error) {
      const message = (error as Error).message;
      this.agentsError.set(message);
      // A failed re-check tells us nothing new about the agent, but the row
      // still carries the last *successful* probe result — leaving the badge
      // on "Connected" after the check blew up is a lie. Roll that row to
      // `unavailable` and attach the reason so the badge, the CLI line and
      // the inline error all describe what just happened. The row stays in
      // the list: a transport/check failure is not evidence the agent is gone.
      this.acp.installedAgents.update(list =>
        list.map(a => (a.id === agentId ? { ...a, status: 'unavailable' as const, error: message } : a)),
      );
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
          env: request.env,
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
      env: request.env,
      description: request.description,
      source: 'disk',
      installed: false,
    };
    await this.onAgentInstalled(agentConfig);
  }

  /** Shows a short confirmation under the Server URL input. */
  private showToast(message: string) {
    this.serverUrlToast.set(message);
    setTimeout(() => this.serverUrlToast.set(null), 2000);
  }

  onGoBack() {
    this.goBack.emit(this.previousViewId());
  }
}
