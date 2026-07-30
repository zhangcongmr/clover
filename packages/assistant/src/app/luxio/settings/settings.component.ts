import { Component, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { SettingsService } from "./settings.service";
import { LocalAgentService } from "../../shared/local-agent/local-agent.service";
import { CoreService } from "../../core.service";

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

  readonly modelOptions = [
    { value: 'deepseek-v4-flash', label: 'DeepSeek v4 Flash' },
    { value: 'deepseek-v3', label: 'DeepSeek v3' },
    { value: 'gpt-4o', label: 'GPT-4o' },
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  ];

  agentStatus = signal<'unknown' | 'connected' | 'disconnected'>('unknown');
  agentTesting = signal(false);

  opfsClearing = signal(false);

  showSavedToast = signal(false);

  constructor() {
    this.checkAgentStatus();
  }

  setActiveCategory(id: string) {
    this.settingsService.setActiveCategory(id);
    if (id === 'data') {
      this.settingsService.refreshOpfsInfo();
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

  private showToast() {
    this.showSavedToast.set(true);
    setTimeout(() => this.showSavedToast.set(false), 2000);
  }
}
