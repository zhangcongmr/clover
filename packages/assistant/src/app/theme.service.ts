import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

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
      this.applyThemeVariables();
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

  setThemeVariables(vars: Record<string, string>): void {
    if (isPlatformBrowser(this.platformId)) {
      this.generatedVariables = {
        ...this.generatedVariables,
        ...vars,
      };
      this.applyTheme();
      this.applyThemeVariables();
      this.saveThemeVariables();
    }
  }

  clearThemeVariables(): void {
    if (isPlatformBrowser(this.platformId)) {
      const root = document.documentElement;
      for (const key of Object.keys(this.generatedVariables)) {
        root.style.removeProperty(key);
      }
      this.generatedVariables = {};
      this.removeGoogleFonts();
    }
  }

  private applyThemeVariables(): void {
    if (isPlatformBrowser(this.platformId)) {
      const root = document.documentElement;
      for (const [key, value] of Object.entries(this.generatedVariables)) {
        root.style.setProperty(key, value);
      }
    }
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