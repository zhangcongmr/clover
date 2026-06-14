import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  private readonly THEME_KEY = 'vscode-theme';
  private readonly THEME_VARS_KEY = 'vscode-theme-vars';
  private currentTheme: string;
  private generatedVariables: Record<string, string> = {};

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {
    this.currentTheme = this.loadTheme();
    this.generatedVariables = this.loadThemeVariables();
    this.applyTheme();
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
}