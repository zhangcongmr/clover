import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type ThemePreviewVariant = 'welcome' | 'chat';

/**
 * Static vector mockup of the app shell (welcome and chat states).
 * Every colour is bound to a `--vscode-*` custom property with the base
 * screenshot colour as fallback, so applying the generated theme variables
 * to an ancestor element recolours the preview instantly - no pixel work.
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
}
