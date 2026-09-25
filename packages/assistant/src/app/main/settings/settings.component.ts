import { Component, inject, input, output, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { SettingsService } from "./settings.service";
import { LocalAgentService } from "../../shared/local-agent/local-agent.service";
import { CoreService } from "../../core.service";
import { AcpSseService } from "../../shared/acp/acp-sse.service";
import type { AgentRuntimeStatus, AgentStatusInfo } from "../../shared/acp/acp-sse.service";

@Component({
  selector: 'app-settings',
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.css'],
  standalone: true,
  imports: [FormsModule],
})
export class SettingsComponent {
  private settingsService = inject(SettingsService);
  protected localAgentService = inject(LocalAgentService);
  private coreService = inject(CoreService);
  private sseService = inject(AcpSseService);

  readonly previousViewId = input<number>(1);
  readonly goBack = output<number>();

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
