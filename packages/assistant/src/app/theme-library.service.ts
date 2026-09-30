import { Injectable, Inject, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ThemeService } from './theme.service';

/** A theme saved into the local library by the user. */
export interface SavedTheme {
  /** Stable id: title slug + creation timestamp. */
  id: string;
  /** Theme title from the generated data model (e.g. "Lavender Sky Theme"). */
  title: string;
  createdAt: number;
  /** Normalised CSS custom properties ready for `ThemeService.setThemeVariables`. */
  vars: Record<string, string>;
  /** Google Fonts the theme depends on. */
  googleFonts: string[];
}

const LIBRARY_KEY = 'clover-theme-library';
const ACTIVE_THEME_ID_KEY = 'clover-active-theme-id';

/**
 * Local library of user-saved generated themes.
 *
 * Themes are only added when the user clicks "Add to Theme Library" in the
 * theme-generator preview, never automatically. Persisted in localStorage as
 * one JSON array (~1-3KB per theme).
 */
@Injectable({ providedIn: 'root' })
export class ThemeLibraryService {
  private readonly themeService = inject(ThemeService);

  /** Saved themes, newest first. */
  readonly themes = signal<SavedTheme[]>([]);
  /** Id of the currently applied library theme, null when a built-in theme is active. */
  readonly activeId = signal<string | null>(null);

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {
    if (isPlatformBrowser(this.platformId)) {
      this.themes.set(this.loadThemes());
      this.activeId.set(this.loadActiveId());
    }
  }

  /**
   * Saves a generated theme data model into the library.
   * A theme with the same title is replaced in place (regenerating a theme
   * updates the stored entry instead of duplicating it).
   *
   * @returns the stored entry, or null when the payload carries no colours.
   */
  addFromThemeData(raw: Record<string, any>): SavedTheme | null {
    const vars = this.themeService.themeDataToCssVars(raw);
    if (Object.keys(vars).length === 0) {
      return null;
    }

    const title = String(raw?.['title'] || '').trim() || 'Untitled Theme';
    const rawFonts = raw?.['googleFonts'];
    const googleFonts = Array.isArray(rawFonts)
      ? rawFonts.filter((n: any): n is string => typeof n === 'string' && !!n.trim())
      : [];

    const list = this.themes();
    const existingIndex = list.findIndex(t => t.title === title);
    const entry: SavedTheme = {
      id: existingIndex >= 0 ? list[existingIndex].id : this.slugify(title) + '-' + Date.now(),
      title,
      createdAt: existingIndex >= 0 ? list[existingIndex].createdAt : Date.now(),
      vars,
      googleFonts,
    };

    const next = existingIndex >= 0
      ? list.map((t, i) => (i === existingIndex ? entry : t))
      : [entry, ...list];

    this.themes.set(next);
    this.persist(next);
    return entry;
  }

  /** Removes a theme. Clears `activeId` when the removed theme was applied. */
  remove(id: string): void {
    const next = this.themes().filter(t => t.id !== id);
    this.themes.set(next);
    this.persist(next);
    if (this.activeId() === id) {
      this.setActiveId(null);
    }
  }

  /**
   * Applies a saved theme to the whole app. Mirrors the "Apply to UI" flow
   * in app.component: switch to the custom theme, write the variables and
   * load the Google Fonts.
   */
  apply(id: string): boolean {
    const theme = this.themes().find(t => t.id === id);
    if (!theme) {
      return false;
    }
    this.themeService.setTheme('custom');
    this.themeService.setThemeVariables(theme.vars);
    if (theme.googleFonts.length > 0) {
      this.themeService.loadGoogleFonts(theme.googleFonts);
    }
    this.setActiveId(id);
    return true;
  }

  /** Marks the library theme with this title as active (used when a theme is applied from chat). */
  setActiveByTitle(title: string): void {
    const match = this.themes().find(t => t.title === title);
    this.setActiveId(match ? match.id : null);
  }

  private setActiveId(id: string | null): void {
    this.activeId.set(id);
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    if (id) {
      localStorage.setItem(ACTIVE_THEME_ID_KEY, id);
    } else {
      localStorage.removeItem(ACTIVE_THEME_ID_KEY);
    }
  }

  private loadThemes(): SavedTheme[] {
    try {
      const raw = localStorage.getItem(LIBRARY_KEY);
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed.filter((t: any) =>
        t && typeof t.id === 'string' && typeof t.title === 'string' &&
        t.vars && typeof t.vars === 'object'
      );
    } catch {
      return [];
    }
  }

  private loadActiveId(): string | null {
    return localStorage.getItem(ACTIVE_THEME_ID_KEY);
  }

  private persist(themes: SavedTheme[]): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    try {
      localStorage.setItem(LIBRARY_KEY, JSON.stringify(themes));
    } catch {
      /* Storage full or unavailable: keep the in-memory list working. */
    }
  }

  private slugify(title: string): string {
    return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'theme';
  }
}
