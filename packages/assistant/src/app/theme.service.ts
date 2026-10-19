import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/**
 * Typography variables owned by Settings → Appearance.
 *
 * A theme describes colour, shape and motion only: applying one must never
 * overwrite the user's UI/terminal font choices, and editing a font must never
 * mutate the applied theme. Everything outside this list (mono/code font,
 * heading scale, label/button sizes) stays theme-owned, because no Settings
 * control drives it and dozens of components consume `--vscode-font-mono`.
 */
export const SETTINGS_OWNED_FONT_VARS: readonly string[] = [
  '--vscode-font-family',
  '--vscode-font-size',
  '--vscode-line-height',
  '--vscode-terminal-font-family',
  '--vscode-terminal-font-size',
];

const SETTINGS_OWNED_FONT_VAR_SET = new Set(SETTINGS_OWNED_FONT_VARS);

@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  private readonly THEME_KEY = 'vscode-theme';
  private readonly THEME_VARS_KEY = 'vscode-theme-vars';
  private readonly FONT_LINK_KEY = 'vscode-google-fonts';
  private readonly FONT_LINK_ATTR = 'data-vscode-font';
  private currentTheme: string;
  private generatedVariables: Record<string, string> = {};
  private currentGoogleFonts: string[] = [];

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {
    this.currentTheme = this.loadTheme();
    this.generatedVariables = this.loadThemeVariables();
    this.applyTheme();
    // Restore Google Fonts if previously persisted
    this.restoreGoogleFonts();
  }

  toggleTheme(): void {
    if (this.currentTheme === 'dark') {
      this.currentTheme = 'default';
    } else {
      this.currentTheme = 'dark';
    }
    this.applyTheme();
    this.saveTheme();
  }

  setTheme(theme: string): void {
    this.currentTheme = theme;
    this.applyTheme();
    this.saveTheme();
  }

  getCurrentTheme(): string {
    return this.currentTheme;
  }

  private applyTheme(): void {
    if (isPlatformBrowser(this.platformId)) {
      document.documentElement.setAttribute('data-theme', this.currentTheme);
      this.applyThemeVariablesTo(document.documentElement, this.generatedVariables);
    }
  }

  private saveTheme(): void {
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem(this.THEME_KEY, this.currentTheme);
    }
  }

  private saveThemeVariables(): void {
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem(this.THEME_VARS_KEY, JSON.stringify(this.generatedVariables));
    }
  }

  /**
   * Merges theme variables into the applied theme. Settings-owned font
   * variables in `vars` are ignored (see `SETTINGS_OWNED_FONT_VARS`); the
   * user's current font variables are left untouched.
   */
  setThemeVariables(vars: Record<string, string>): void {
    if (isPlatformBrowser(this.platformId)) {
      this.generatedVariables = {
        ...this.generatedVariables,
        ...this.stripSettingsOwnedVars(vars),
      };
      this.applyTheme();
      this.saveThemeVariables();
    }
  }

  /**
   * Applies Settings → Appearance font variables. They share the persisted
   * theme-variable bag (so they survive a reload) but are exempt from the theme
   * ownership filter, and theme switches preserve them.
   */
  setSettingsFontVars(vars: Record<string, string>): void {
    if (isPlatformBrowser(this.platformId)) {
      this.generatedVariables = {
        ...this.generatedVariables,
        ...vars,
      };
      this.applyTheme();
      this.saveThemeVariables();
    }
  }

  /**
   * 全量替换内联主题变量：先移除旧变量的内联样式，再写入新变量。
   * 用于 Light/Dark 内置预设切换，避免残留 AI 自定义主题的键。
   * 用户字体变量（Settings → Appearance）不参与替换，始终保留。
   */
  replaceThemeVariables(vars: Record<string, string>): void {
    if (isPlatformBrowser(this.platformId)) {
      const root = document.documentElement;
      const next = {
        ...this.stripSettingsOwnedVars(vars),
        ...this.settingsOwnedVarsFrom(this.generatedVariables),
      };
      for (const key of Object.keys(this.generatedVariables)) {
        if (!(key in next)) {
          root.style.removeProperty(key);
        }
      }
      this.generatedVariables = next;
      this.applyTheme();
      this.saveThemeVariables();
    }
  }

  /** Clears the applied theme variables, keeping the user's font variables. */
  clearThemeVariables(): void {
    if (isPlatformBrowser(this.platformId)) {
      const root = document.documentElement;
      const preserved = this.settingsOwnedVarsFrom(this.generatedVariables);
      for (const key of Object.keys(this.generatedVariables)) {
        if (!(key in preserved)) {
          root.style.removeProperty(key);
        }
      }
      this.generatedVariables = preserved;
      this.removeGoogleFonts();
    }
  }

  /**
   * 将主题 CSS 变量应用到指定节点，
   * root 可以是 document.documentElement 或其克隆节点。
   */
  applyThemeVariablesTo(root: HTMLElement, vars: Record<string, string>): void {
    for (const [key, value] of Object.entries(vars)) {
      root.style.setProperty(key, value);
    }
  }

  /** Drops Settings-owned font variables from a theme-provided variable map. */
  private stripSettingsOwnedVars(vars: Record<string, string>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(vars)) {
      if (!SETTINGS_OWNED_FONT_VAR_SET.has(key)) {
        result[key] = value;
      }
    }
    return result;
  }

  /** The Settings-owned font variables currently applied, kept across theme switches. */
  private settingsOwnedVarsFrom(vars: Record<string, string>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const key of SETTINGS_OWNED_FONT_VARS) {
      if (key in vars) {
        result[key] = vars[key];
      }
    }
    return result;
  }

  /**
   * 解析统一主题对象（colors/typography/radius/shadow/motion/渐变），
   * 返回尚未做 key 归一化的原始 CSS 变量键值对。
   * 无 colors 时返回空对象。
   */
  parseThemeCssVars(theme: Record<string, any>): Record<string, string> {
    const cssVars: Record<string, string> = {};
    if (!theme || typeof theme !== 'object') {
      return cssVars;
    }

    const colors = theme['colors'];
    if (!colors || typeof colors !== 'object') {
      return cssVars;
    }

    for (const [key, value] of Object.entries(colors)) {
      if (typeof value === 'string' && value.trim()) {
        cssVars[key.trim()] = value.trim();
      }
    }

    const typography = theme['typography'];
    if (typography && typeof typography === 'object') {
      Object.assign(cssVars, this.mapTypographyToCss(typography));
    }

    const radius = theme['radius'];
    if (radius && typeof radius === 'object') {
      Object.assign(cssVars, this.mapRadiusToCss(radius));
    }

    const shadow = theme['shadow'];
    if (shadow && typeof shadow === 'object') {
      Object.assign(cssVars, this.mapShadowToCss(shadow));
    }

    const motion = theme['motion'];
    if (motion && typeof motion === 'object') {
      Object.assign(cssVars, this.mapMotionToCss(motion));
    }

    const bgGradient = theme['bgGradient'];
    if (typeof bgGradient === 'string' && bgGradient.trim()) {
      Object.assign(cssVars, this.mapBgGradientToCss(bgGradient.trim()));
    }

    const editorBgGradient = theme['editorBgGradient'];
    if (typeof editorBgGradient === 'string' && editorBgGradient.trim()) {
      Object.assign(cssVars, this.mapEditorBgGradientToCss(editorBgGradient.trim()));
    }

    return cssVars;
  }

  /**
   * 将生成的主题属性整体转换为可直接应用到节点的 CSS 变量。
   */
  themeDataToCssVars(theme: Record<string, any>): Record<string, string> {
    return this.mapThemeKeysToCss(this.parseThemeCssVars(theme));
  }

  mapThemeKeysToCss(themeVars: Record<string, string>): Record<string, string> {
    const keyMap: Record<string, string[]> = {
      background: [// 组件背景色
        '--vscode-background'
      ],
      surface: [// 组件表面色
        '--vscode-surface-background'
      ],
      primary: [// 组件主色
        '--vscode-primary-background'
      ],
      secondary: [// 组件次要色
        '--vscode-secondary-background'
      ],
      text: [// 组件文字色
        '--vscode-foreground'
      ],
      accent: [// 组件强调色
        '--vscode-accent-color'
      ],
      border: [// 组件边框色
        '--vscode-border-color'
      ],
      selectionBackground: ['--vscode-editor-selectionBackground'],
      selectionForeground: ['--vscode-editor-selectionForeground'],
      primaryForeground: ['--vscode-primary-foreground'],
      accentForeground: ['--vscode-accent-foreground'],
      hoverBackground: ['--vscode-hover-background'],
      itemActiveBackground: ['--vscode-item-active-background'],
    };

    const cssVars: Record<string, string> = {};

    for (const [key, value] of Object.entries(themeVars)) {
      // Keys already prefixed with --vscode- (typography, radius, shadow, motion, gradients)
      // pass through directly without remapping
      if (key.startsWith('--vscode-')) {
        cssVars[key] = value;
        continue;
      }

      const normalizedKey = key.toLowerCase().replace(/[\s_-]/g, '');
      let canonical = '';

      if (['uibackground', 'background'].includes(normalizedKey)) canonical = 'background';
      else if (['uiprimarycolor', 'primarycolor', 'primary'].includes(normalizedKey)) canonical = 'primary';
      else if (['uisecondarycolor', 'secondarycolor', 'secondary'].includes(normalizedKey)) canonical = 'secondary';
      else if (['uitextcolor', 'textcolor', 'text'].includes(normalizedKey)) canonical = 'text';
      else if (['uisurface', 'surface'].includes(normalizedKey)) canonical = 'surface';
      else if (['uiaccent', 'accent'].includes(normalizedKey)) canonical = 'accent';
      else if (['uiborder', 'border'].includes(normalizedKey)) canonical = 'border';
      else if (['uiselectionbackground', 'selectionbackground', 'selection'].includes(normalizedKey)) canonical = 'selectionBackground';
      else if (['uiselectionforeground', 'selectionforeground'].includes(normalizedKey)) canonical = 'selectionForeground';
      else if (['uiprimaryforeground', 'primaryforeground'].includes(normalizedKey)) canonical = 'primaryForeground';
      else if (['uiaccentforeground', 'accentforeground'].includes(normalizedKey)) canonical = 'accentForeground';
      else if (['uihoverbackground', 'hoverbackground'].includes(normalizedKey)) canonical = 'hoverBackground';
      else if (['uiitemactivebackground', 'itemactivebackground'].includes(normalizedKey)) canonical = 'itemActiveBackground';

      if (canonical && keyMap[canonical]) {
        for (const cssVar of keyMap[canonical]) {
          cssVars[cssVar] = value;
        }
      }
    }

    return cssVars;
  }

  private mapTypographyToCss(typography: Record<string, string>): Record<string, string> {
    const keyMap: Record<string, string[]> = {
      fontFamily: ['--vscode-font-family'],
      fontSize: ['--vscode-font-size'],
      fontWeight: ['--vscode-font-weight'],
      lineHeight: ['--vscode-line-height'],
      monoFont: ['--vscode-font-mono', '--vscode-terminal-font-family'],
      codeFontSize: ['--vscode-code-font-size', '--vscode-terminal-font-size'],
      headingFont: ['--vscode-heading-font-family'],
      headingWeight: ['--vscode-heading-font-weight'],
      labelSize: ['--vscode-label-font-size'],
      labelWeight: ['--vscode-label-font-weight'],
      inputSize: ['--vscode-input-font-size'],
      buttonSize: ['--vscode-button-font-size'],
      buttonWeight: ['--vscode-button-font-weight'],
      menuSize: ['--vscode-menu-font-size'],
      tabSize: ['--vscode-tab-font-size'],
      treeSize: ['--vscode-tree-font-size'],
      badgeSize: ['--vscode-badge-font-size'],
      smallSize: ['--vscode-small-font-size'],
    };

    const cssVars: Record<string, string> = {};
    for (const [key, value] of Object.entries(typography)) {
      if (typeof value !== 'string' || !value.trim()) continue;
      const normalizedKey = key.replace(/[\s_-]/g, '');
      const targets = keyMap[normalizedKey];
      if (targets) {
        for (const cssVar of targets) {
          cssVars[cssVar] = value;
        }
      }
    }
    // Settings → Appearance owns the base UI/terminal typography: a theme may
    // not write those variables, so saved themes and previews stay in sync with
    // the values the settings panel shows.
    return this.stripSettingsOwnedVars(cssVars);
  }

  private mapShadowToCss(shadow: Record<string, string>): Record<string, string> {
    const keyMap: Record<string, string[]> = {
      sm: ['--vscode-shadow-sm'],
      md: ['--vscode-shadow-md'],
      lg: ['--vscode-shadow-lg'],
    };

    const cssVars: Record<string, string> = {};
    for (const [key, value] of Object.entries(shadow)) {
      if (typeof value !== 'string' || !value.trim()) continue;
      const targets = keyMap[key];
      if (targets) {
        for (const cssVar of targets) {
          cssVars[cssVar] = value;
        }
      }
    }
    return cssVars;
  }

  private mapRadiusToCss(radius: Record<string, string>): Record<string, string> {
    const keyMap: Record<string, string[]> = {
      sm: ['--vscode-radius-sm'],
      md: ['--vscode-radius-md'],
      lg: ['--vscode-radius-lg'],
      pill: ['--vscode-radius-pill'],
    };

    const cssVars: Record<string, string> = {};
    for (const [key, value] of Object.entries(radius)) {
      if (typeof value !== 'string' || !value.trim()) continue;
      const targets = keyMap[key];
      if (targets) {
        for (const cssVar of targets) {
          cssVars[cssVar] = value;
        }
      }
    }
    return cssVars;
  }

  private mapMotionToCss(motion: Record<string, string>): Record<string, string> {
    const keyMap: Record<string, string[]> = {
      duration: ['--vscode-motion-duration'],
      easing: ['--vscode-motion-easing'],
    };

    const cssVars: Record<string, string> = {};
    for (const [key, value] of Object.entries(motion)) {
      if (typeof value !== 'string' || !value.trim()) continue;
      const targets = keyMap[key];
      if (targets) {
        for (const cssVar of targets) {
          cssVars[cssVar] = value;
        }
      }
    }
    return cssVars;
  }

  private mapBgGradientToCss(bgGradient: string): Record<string, string> {
    return {
      '--vscode-bg-gradient': bgGradient,
    };
  }

  private mapEditorBgGradientToCss(editorBgGradient: string): Record<string, string> {
    return {
      '--vscode-editor-bg-gradient': editorBgGradient,
    };
  }

  private loadTheme(): string {
    if (isPlatformBrowser(this.platformId)) {
      const savedTheme = localStorage.getItem(this.THEME_KEY);
      // default to light theme if no saved theme exists
      return savedTheme || 'default';
    } else {
      // return default theme during server-side rendering
      return 'default';
    }
  }

  private loadThemeVariables(): Record<string, string> {
    if (isPlatformBrowser(this.platformId)) {
      const saved = localStorage.getItem(this.THEME_VARS_KEY);
      if (!saved) {
        return {};
      }
      try {
        return JSON.parse(saved) as Record<string, string>;
      } catch {
        return {};
      }
    }
    return {};
  }

  getGoogleFonts(): string[] {
    return [...this.currentGoogleFonts];
  }

  loadGoogleFonts(fontNames: string[]): void {
    if (!isPlatformBrowser(this.platformId) || !fontNames || fontNames.length === 0) {
      return;
    }
    this.currentGoogleFonts = [...fontNames];
    for (const name of fontNames) {
      const encoded = encodeURIComponent(name);
      const href = `https://fonts.googleapis.com/css2?family=${encoded}:wght@400;500;600;700&display=swap`;
      if (document.querySelector(`link[href="${href}"]`)) {
        continue;
      }
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.setAttribute(this.FONT_LINK_ATTR, 'true');
      document.head.appendChild(link);
    }
    this.saveGoogleFonts();
  }

  removeGoogleFonts(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    const links = document.querySelectorAll(`link[${this.FONT_LINK_ATTR}]`);
    for (const link of Array.from(links)) {
      link.remove();
    }
    this.currentGoogleFonts = [];
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(this.FONT_LINK_KEY);
    }
  }

  private saveGoogleFonts(): void {
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem(this.FONT_LINK_KEY, JSON.stringify(this.currentGoogleFonts));
    }
  }

  private restoreGoogleFonts(): void {
    if (isPlatformBrowser(this.platformId)) {
      const saved = localStorage.getItem(this.FONT_LINK_KEY);
      if (!saved) return;
      try {
        const names = JSON.parse(saved);
        if (Array.isArray(names) && names.length > 0) {
          this.loadGoogleFonts(names);
        }
      } catch {
        /* ignore */
      }
    }
  }
}