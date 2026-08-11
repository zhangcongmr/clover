import { Injectable, WritableSignal, signal, inject } from '@angular/core';
import { file, write } from 'opfs-tools';
import { LocalAgentService } from '../../shared/local-agent/local-agent.service';
import { ThemeService } from '../../theme.service';
import { NotificationService } from '../../shared/notification/notification.service';

export interface SettingsCategory {
  id: string;
  label: string;
  icon?: string;
}

export interface OpfsStorageInfo {
  files: { name: string; exists: boolean }[];
  totalSize: string;
}

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private localAgentService = inject(LocalAgentService);
  private themeService = inject(ThemeService);
  private notificationService = inject(NotificationService);

  readonly categories: SettingsCategory[] = [
    { id: 'general', label: 'General', icon: '#icon-settings' },
    { id: 'appearance', label: 'Appearance', icon: '#icon-appearance' },
    { id: 'editor', label: 'Editor', icon: '#icon-editor' },
    { id: 'data', label: 'Data', icon: '#icon-data' },
    { id: 'advanced', label: 'Advanced', icon: '#icon-advanced' },
  ];

  activeCategoryId = signal<string>('general');

  folderReadWriteMode: WritableSignal<'read' | 'readwrite'> = signal<'read' | 'readwrite'>('readwrite');
  autoRefreshEnabled = signal<boolean>(true);

  currentTheme = signal<string>('default');
  terminalFontFamily = signal<string>('');
  terminalFontSize = signal<number>(14);

  uiFontFamily = signal<string>('');
  uiFontSize = signal<number>(13);
  uiLineHeight = signal<number>(1.6);

  notificationDuration = signal<number>(5);

  opfsInfo = signal<OpfsStorageInfo | null>(null);

  private readonly OPFS_FILES = ['/dir/file.txt', '/dir/openedList.txt', '/dir/serverList.txt', '/dir/microserviceDataList.txt', '/dir/microserviceDataStatusFlag.txt'];

  selectedModel = signal<string>('deepseek-v4-flash');
  pluginsEnabled = signal<boolean>(false);
  useMemoryMode = signal<boolean>(true);

  constructor() {
    this.currentTheme.set(this.themeService.getCurrentTheme());

    if (typeof localStorage !== 'undefined') {
      const vars = localStorage.getItem('vscode-theme-vars');
      if (vars) {
        try {
          const parsed = JSON.parse(vars);
          if (parsed['--vscode-terminal-font-family']) {
            this.terminalFontFamily.set(parsed['--vscode-terminal-font-family']);
          }
          if (parsed['--vscode-terminal-font-size']) {
            this.terminalFontSize.set(Number(parsed['--vscode-terminal-font-size']));
          }
          if (parsed['--vscode-font-family']) {
            this.uiFontFamily.set(parsed['--vscode-font-family']);
          }
          if (parsed['--vscode-font-size']) {
            this.uiFontSize.set(Number(parsed['--vscode-font-size']));
          }
          if (parsed['--vscode-line-height']) {
            this.uiLineHeight.set(Number(parsed['--vscode-line-height']));
          }
        } catch { }
      }
    }

    if (typeof localStorage !== 'undefined') {
      const model = localStorage.getItem('luxio_selected_model');
      if (model) {
        this.selectedModel.set(model);
      }
      const plugins = localStorage.getItem('luxio_plugins_enabled');
      if (plugins === 'true') {
        this.pluginsEnabled.set(true);
      }
      const useMemory = localStorage.getItem('luxio_use_memory_mode');
      if (useMemory === 'false') {
        this.useMemoryMode.set(false);
      }
      const dur = localStorage.getItem('luxio_notification_duration');
      if (dur) {
        const num = Number(dur);
        if (!isNaN(num) && num >= 0) {
          this.notificationDuration.set(num);
          this.notificationService.autoCloseDuration = num * 1000;
        }
      }
    }
  }

  setActiveCategory(id: string) {
    this.activeCategoryId.set(id);
  }

  setFolderReadWriteMode(mode: 'read' | 'readwrite') {
    this.folderReadWriteMode.set(mode);
  }

  setAutoRefreshEnabled(enabled: boolean) {
    this.autoRefreshEnabled.set(enabled);
  }

  toggleTheme() {
    this.themeService.toggleTheme();
    this.currentTheme.set(this.themeService.getCurrentTheme());
  }

  setTheme(theme: string) {
    this.themeService.setTheme(theme);
    this.currentTheme.set(theme);
  }

  setTerminalFontFamily(family: string) {
    this.terminalFontFamily.set(family);
    this.themeService.setThemeVariables({ '--vscode-terminal-font-family': family });
  }

  setTerminalFontSize(size: number) {
    this.terminalFontSize.set(size);
    this.themeService.setThemeVariables({ '--vscode-terminal-font-size': String(size) });
  }

  setUiFontFamily(family: string) {
    this.uiFontFamily.set(family);
    this.themeService.setThemeVariables({ '--vscode-font-family': family });
  }

  setUiFontSize(size: number) {
    this.uiFontSize.set(size);
    this.themeService.setThemeVariables({ '--vscode-font-size': String(size) });
  }

  setUiLineHeight(height: number) {
    this.uiLineHeight.set(height);
    this.themeService.setThemeVariables({ '--vscode-line-height': String(height) });
  }

  setNotificationDuration(seconds: number) {
    this.notificationDuration.set(seconds);
    this.notificationService.autoCloseDuration = seconds * 1000;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('luxio_notification_duration', String(seconds));
    }
  }

  setSelectedModel(model: string) {
    this.selectedModel.set(model);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('luxio_selected_model', model);
    }
  }

  setPluginsEnabled(enabled: boolean) {
    this.pluginsEnabled.set(enabled);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('luxio_plugins_enabled', String(enabled));
    }
  }

  setUseMemoryMode(enabled: boolean) {
    this.useMemoryMode.set(enabled);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('luxio_use_memory_mode', String(enabled));
    }
  }

  async refreshOpfsInfo() {
    const results: { name: string; exists: boolean }[] = [];
    for (const path of this.OPFS_FILES) {
      try {
        const content = await file(path).text();
        results.push({ name: path.replace('/dir/', ''), exists: content != null });
      } catch {
        results.push({ name: path.replace('/dir/', ''), exists: false });
      }
    }
    let totalSize = '0 B';
    try {
      const storage = await navigator.storage?.estimate();
      if (storage) {
        const used = storage.usage ?? 0;
        totalSize = used < 1024 ? `${used} B` : used < 1048576 ? `${(used / 1024).toFixed(1)} KB` : `${(used / 1048576).toFixed(1)} MB`;
      }
    } catch { }
    this.opfsInfo.set({ files: results, totalSize });
  }

  async clearAllOpfsData() {
    for (const path of this.OPFS_FILES) {
      try {
        await write(path, '');
      } catch { }
    }
    await this.refreshOpfsInfo();
  }
}
