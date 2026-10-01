import { Injectable, Inject, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ThemeService } from './theme.service';
import { resolveChipCategoryId } from './shared/skill-manager/built-in/theme-chips-library';

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
  /**
   * Chip-library category the theme was generated from (id from
   * `THEME_CHIP_CATEGORIES`, normalised to 'other' when unknown/missing).
   * Echoed by the skill in the data model when the prompt carried a
   * "Chip category:" line.
   */
  categoryId?: string;
}

/** Id of the applied library theme — a small scalar, kept in localStorage. */
const ACTIVE_THEME_ID_KEY = 'clover-active-theme-id';

const DB_NAME = 'clover-theme-library';
const DB_VERSION = 1;
const THEMES_STORE = 'themes';

/**
 * Local library of user-saved generated themes.
 *
 * Themes are only added when the user clicks "Add to Theme Library" in the
 * theme-generator preview, never automatically. Persisted in IndexedDB
 * (database `clover-theme-library`, one record per theme keyed by `id`);
 * the active theme id remains in localStorage. When IndexedDB is
 * unavailable the library degrades to in-memory only (a single warning is
 * logged).
 */
@Injectable({ providedIn: 'root' })
export class ThemeLibraryService {
  private readonly themeService = inject(ThemeService);

  /** Saved themes, newest first. */
  readonly themes = signal<SavedTheme[]>([]);
  /** Id of the currently applied library theme, null when a built-in theme is active. */
  readonly activeId = signal<string | null>(null);

  /** Resolves once the initial IndexedDB load finished. */
  private readonly ready: Promise<void>;
  private db: IDBDatabase | null = null;

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {
    if (isPlatformBrowser(this.platformId)) {
      this.ready = this.initStorage();
      this.activeId.set(this.loadActiveId());
    } else {
      // Server rendering: no storage; keep the public API awaitable.
      this.ready = Promise.resolve();
    }
  }

  /**
   * Saves a generated theme data model into the library.
   * A theme with the same title is replaced in place (regenerating a theme
   * updates the stored entry instead of duplicating it).
   *
   * Awaits the initial IndexedDB load so a write can never overwrite stored
   * themes with a not-yet-loaded in-memory list.
   *
   * @returns the stored entry, or null when the payload carries no colours.
   */
  async addFromThemeData(raw: Record<string, any>): Promise<SavedTheme | null> {
    await this.ready;
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
      // Chip category echoed by the skill in the data model; unknown/absent → 'other'.
      categoryId: resolveChipCategoryId(raw?.['chipCategory']),
    };

    const next = existingIndex >= 0
      ? list.map((t, i) => (i === existingIndex ? entry : t))
      : [entry, ...list];

    this.themes.set(next);
    await this.persistUpsert(entry);
    return entry;
  }

  /** Removes a theme. Clears `activeId` when the removed theme was applied. */
  async remove(id: string): Promise<void> {
    await this.ready;
    const next = this.themes().filter(t => t.id !== id);
    this.themes.set(next);
    if (this.activeId() === id) {
      this.setActiveId(null);
    }
    await this.persistDelete(id);
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

  /** Clears the active highlight (e.g. when a built-in Light/Dark preset is selected). */
  clearActive(): void {
    this.setActiveId(null);
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

  private loadActiveId(): string | null {
    return localStorage.getItem(ACTIVE_THEME_ID_KEY);
  }

  /** Opens the database and loads the stored themes. */
  private async initStorage(): Promise<void> {
    try {
      this.db = await this.openDb();
      const stored = await this.idbGetAll();
      this.themes.set(stored.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)));
    } catch (err) {
      this.db = null;
      console.warn('[ThemeLibrary] IndexedDB unavailable — the theme library will not persist.', err);
    }
  }

  private persistUpsert(entry: SavedTheme): Promise<void> {
    if (!this.db) {
      return Promise.resolve();
    }
    return this.idbPutMany([entry]).catch(err =>
      console.warn('[ThemeLibrary] Failed to persist theme.', err)
    );
  }

  private persistDelete(id: string): Promise<void> {
    if (!this.db) {
      return Promise.resolve();
    }
    return new Promise(resolve => {
      const tx = this.db!.transaction(THEMES_STORE, 'readwrite');
      tx.objectStore(THEMES_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => {
        console.warn('[ThemeLibrary] Failed to delete theme record.', tx.error);
        resolve();
      };
    });
  }

  private openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(THEMES_STORE)) {
          db.createObjectStore(THEMES_STORE, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('IndexedDB open blocked'));
    });
  }

  private idbGetAll(): Promise<SavedTheme[]> {
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(THEMES_STORE, 'readonly');
      const request = tx.objectStore(THEMES_STORE).getAll();
      request.onsuccess = () => resolve((request.result as SavedTheme[]) ?? []);
      request.onerror = () => reject(request.error);
    });
  }

  /** Upserts all entries in a single readwrite transaction. */
  private idbPutMany(entries: SavedTheme[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(THEMES_STORE, 'readwrite');
      const store = tx.objectStore(THEMES_STORE);
      for (const entry of entries) {
        store.put(entry);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  }

  private slugify(title: string): string {
    return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'theme';
  }
}
