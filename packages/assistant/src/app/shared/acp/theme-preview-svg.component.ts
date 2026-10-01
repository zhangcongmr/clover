import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, input } from '@angular/core';

export type ThemePreviewVariant = 'welcome' | 'chat';

/**
 * Static vector mockup of the app shell (welcome and chat states).
 * Every colour is bound to a `--vscode-*` custom property with the base
 * screenshot colour as fallback, so applying the generated theme variables
 * to an ancestor element recolours the preview instantly - no pixel work.
 *
 * The optional `palette` input scopes a theme's variables to this host
 * element only, letting several previews each carry their own colours.
 */
@Component({
  selector: 'app-theme-preview-svg',
  standalone: true,
  templateUrl: './theme-preview-svg.component.html',
  styleUrls: ['./theme-preview-svg.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ThemePreviewSvgComponent {
  variant = input<ThemePreviewVariant>('welcome');
  /** Theme CSS variables to apply to this preview's host element, null for inherited/app defaults. */
  palette = input<Record<string, string> | null>(null);

  private host = inject(ElementRef<HTMLElement>).nativeElement;
  /** Keys written to the host by the palette effect, kept so they can be cleared. */
  private appliedKeys: string[] = [];

  constructor() {
    effect(() => {
      const palette = this.palette();
      for (const key of this.appliedKeys) {
        this.host.style.removeProperty(key);
      }
      this.appliedKeys = [];
      if (palette) {
        for (const [key, value] of Object.entries(palette)) {
          this.host.style.setProperty(key, value);
        }
        this.appliedKeys = Object.keys(palette);
      }
    });
  }
}
