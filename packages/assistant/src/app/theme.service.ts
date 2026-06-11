import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  private readonly THEME_KEY = 'vscode-theme';
  private currentTheme: string;
  private generatedVariables: Record<string, string> = {};

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {
    this.currentTheme = this.loadTheme();
    this.applyTheme();
  }

  toggleTheme(): void {
    this.currentTheme = this.currentTheme === 'dark' ? 'default' : 'dark';
    this.applyTheme();
    this.saveTheme();
  }

  setTheme(theme: 'default' | 'dark'): void {
    this.currentTheme = theme;
    this.applyTheme();
    this.saveTheme();
  }

  getCurrentTheme(): 'default' | 'dark' {
    return this.currentTheme as 'default' | 'dark';
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

  setThemeVariables(vars: Record<string, string>): void {
    if (isPlatformBrowser(this.platformId)) {
      this.generatedVariables = {
        ...this.generatedVariables,
        ...vars,
      };
      this.applyTheme();
      this.applyThemeVariables();
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
      // 默认使用light主题，如果未保存过主题设置
      return savedTheme || 'default';
    } else {
      // 在服务器端渲染时返回默认主题
      return 'default';
    }
  }
}