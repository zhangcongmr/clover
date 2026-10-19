import { Injectable, WritableSignal, signal, inject } from '@angular/core';
import { file, write } from 'opfs-tools';
import { LocalAgentService } from '../../shared/local-agent/local-agent.service';
import { ThemeService } from '../../theme.service';
import { ThemeLibraryService } from '../../theme-library.service';
import { BUILTIN_THEME_PRESETS } from '../../builtin-theme-presets';
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

/**
 * Typography defaults, kept in sync with the `:root` declarations in
 * `styles.css` so the settings inputs show the value the app actually uses.
 * (`--vscode-terminal-font-size` resolves to `--vscode-code-font-size`.)
 */
const DEFAULT_UI_FONT_FAMILY = "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif";
const DEFAULT_UI_FONT_SIZE = 14;
const DEFAULT_UI_LINE_HEIGHT = 1.5;
const DEFAULT_TERMINAL_FONT_FAMILY = "'Courier New', monospace";
const DEFAULT_TERMINAL_FONT_SIZE = 13;

/** Editable ranges, mirroring the min/max attributes in the settings template. */
const UI_FONT_SIZE_RANGE = { min: 10, max: 24 };
const UI_LINE_HEIGHT_RANGE = { min: 1, max: 3 };
const TERMINAL_FONT_SIZE_RANGE = { min: 8, max: 48 };

/** Clamps a numeric setting to its editable range; non-numbers fall back to `fallback`. */
function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/** Reads a numeric CSS value such as `14px` or `1.55`; null when it is not a number. */
function readNumericCssValue(raw: unknown): number | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const parsed = parseFloat(String(raw));
  return Number.isFinite(parsed) ? parsed : null;
}

/** Reads a font stack, ignoring blank values so the CSS variable never becomes empty. */
function readFontFamily(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  return value ? value : null;
}

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private localAgentService = inject(LocalAgentService);
  private themeService = inject(ThemeService);
  private themeLibrary = inject(ThemeLibraryService);
  private notificationService = inject(NotificationService);

  readonly categories: SettingsCategory[] = [
    { id: 'general', label: 'General', icon: '#icon-settings' },
    { id: 'appearance', label: 'Appearance', icon: '#icon-appearance' },
    { id: 'data', label: 'Data', icon: '#icon-data' },
    { id: 'advanced', label: 'Advanced', icon: '#icon-advanced' },
  ];

  activeCategoryId = signal<string>('general');

  folderReadWriteMode: WritableSignal<'read' | 'readwrite'> = signal<'read' | 'readwrite'>('readwrite');
  autoRefreshEnabled = signal<boolean>(true);

  currentTheme = signal<string>('default');
  terminalFontFamily = signal<string>(DEFAULT_TERMINAL_FONT_FAMILY);
  terminalFontSize = signal<number>(DEFAULT_TERMINAL_FONT_SIZE);

  uiFontFamily = signal<string>(DEFAULT_UI_FONT_FAMILY);
  uiFontSize = signal<number>(DEFAULT_UI_FONT_SIZE);
  uiLineHeight = signal<number>(DEFAULT_UI_LINE_HEIGHT);

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
          // Theme vars store CSS lengths (`14px`), which Number() would turn into NaN.
          const terminalFamily = readFontFamily(parsed['--vscode-terminal-font-family']);
          if (terminalFamily) {
            this.terminalFontFamily.set(terminalFamily);
          }
          const terminalSize = readNumericCssValue(parsed['--vscode-terminal-font-size']);
          if (terminalSize !== null) {
            this.terminalFontSize.set(clampNumber(terminalSize, TERMINAL_FONT_SIZE_RANGE.min, TERMINAL_FONT_SIZE_RANGE.max, DEFAULT_TERMINAL_FONT_SIZE));
          }
          const uiFamily = readFontFamily(parsed['--vscode-font-family']);
          if (uiFamily) {
            this.uiFontFamily.set(uiFamily);
          }
          const uiSize = readNumericCssValue(parsed['--vscode-font-size']);
          if (uiSize !== null) {
            this.uiFontSize.set(clampNumber(uiSize, UI_FONT_SIZE_RANGE.min, UI_FONT_SIZE_RANGE.max, DEFAULT_UI_FONT_SIZE));
          }
          const lineHeight = readNumericCssValue(parsed['--vscode-line-height']);
          if (lineHeight !== null) {
            this.uiLineHeight.set(clampNumber(lineHeight, UI_LINE_HEIGHT_RANGE.min, UI_LINE_HEIGHT_RANGE.max, DEFAULT_UI_LINE_HEIGHT));
          }
        } catch { }
      }
    }

    if (typeof localStorage !== 'undefined') {
      const model = localStorage.getItem('clover_selected_model');
      if (model) {
        this.selectedModel.set(model);
      }
      const plugins = localStorage.getItem('clover_plugins_enabled');
      if (plugins === 'true') {
        this.pluginsEnabled.set(true);
      }
      const useMemory = localStorage.getItem('clover_use_memory_mode');
      if (useMemory === 'false') {
        this.useMemoryMode.set(false);
      }
      const dur = localStorage.getItem('clover_notification_duration');
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
    this.setTheme(this.themeService.getCurrentTheme() === 'dark' ? 'default' : 'dark');
  }

  setTheme(theme: string) {
    this.themeService.setTheme(theme);

    const preset = BUILTIN_THEME_PRESETS[theme];
    if (preset) {
      // Fully replace inline vars so a previously applied AI/custom theme
      // cannot leak keys into the built-in Light/Dark preset.
      this.themeService.replaceThemeVariables(preset.vars);
      this.themeService.removeGoogleFonts();
      if (preset.googleFonts.length > 0) {
        this.themeService.loadGoogleFonts(preset.googleFonts);
      }
      // Drop the Theme Library highlight: a built-in preset is now active.
      this.themeLibrary.clearActive();
    }

    this.currentTheme.set(theme);
  }

  /** Applies the terminal font stack; blank input falls back to the app default. */
  setTerminalFontFamily(family: string): string {
    const value = readFontFamily(family) ?? DEFAULT_TERMINAL_FONT_FAMILY;
    this.terminalFontFamily.set(value);
    this.themeService.setSettingsFontVars({ '--vscode-terminal-font-family': value });
    return value;
  }

  /** Applies the terminal font size clamped to its editable range; returns the applied value. */
  setTerminalFontSize(size: number): number {
    const value = clampNumber(size, TERMINAL_FONT_SIZE_RANGE.min, TERMINAL_FONT_SIZE_RANGE.max, this.terminalFontSize());
    this.terminalFontSize.set(value);
    this.themeService.setSettingsFontVars({ '--vscode-terminal-font-size': String(value) });
    return value;
  }

  /** Applies the UI font stack; blank input falls back to the app default. */
  setUiFontFamily(family: string): string {
    const value = readFontFamily(family) ?? DEFAULT_UI_FONT_FAMILY;
    this.uiFontFamily.set(value);
    this.themeService.setSettingsFontVars({ '--vscode-font-family': value });
    return value;
  }

  /** Applies the UI font size clamped to its editable range; returns the applied value. */
  setUiFontSize(size: number): number {
    const value = clampNumber(size, UI_FONT_SIZE_RANGE.min, UI_FONT_SIZE_RANGE.max, this.uiFontSize());
    this.uiFontSize.set(value);
    this.themeService.setSettingsFontVars({ '--vscode-font-size': String(value) });
    return value;
  }

  /** Applies the UI line height clamped to its editable range; returns the applied value. */
  setUiLineHeight(height: number): number {
    const value = clampNumber(height, UI_LINE_HEIGHT_RANGE.min, UI_LINE_HEIGHT_RANGE.max, this.uiLineHeight());
    this.uiLineHeight.set(value);
    this.themeService.setSettingsFontVars({ '--vscode-line-height': String(value) });
    return value;
  }

  /** Restores the UI typography defaults (Settings → Appearance → Editor). */
  resetUiTypography() {
    this.setUiFontFamily(DEFAULT_UI_FONT_FAMILY);
    this.setUiFontSize(DEFAULT_UI_FONT_SIZE);
    this.setUiLineHeight(DEFAULT_UI_LINE_HEIGHT);
  }

  /** Restores the terminal typography defaults (Settings → Appearance → Terminal). */
  resetTerminalTypography() {
    this.setTerminalFontFamily(DEFAULT_TERMINAL_FONT_FAMILY);
    this.setTerminalFontSize(DEFAULT_TERMINAL_FONT_SIZE);
  }

  setNotificationDuration(seconds: number) {
    this.notificationDuration.set(seconds);
    this.notificationService.autoCloseDuration = seconds * 1000;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('clover_notification_duration', String(seconds));
    }
  }

  setSelectedModel(model: string) {
    this.selectedModel.set(model);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('clover_selected_model', model);
    }
  }

  setPluginsEnabled(enabled: boolean) {
    this.pluginsEnabled.set(enabled);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('clover_plugins_enabled', String(enabled));
    }
  }

  setUseMemoryMode(enabled: boolean) {
    this.useMemoryMode.set(enabled);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('clover_use_memory_mode', String(enabled));
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
