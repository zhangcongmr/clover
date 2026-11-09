import { Component } from '@angular/core';

/**
 * Eight-spoke spinner shown on a sidebar row's title line while its session is
 * running.
 *
 * The spokes live in a single `<g>` with a graduated opacity tail and the whole
 * group is ticked around in 45° steps, so every frame lands a spoke where the
 * previous one was — the same read as a browser tab's loading spinner.
 *
 * Coloured with `--vscode-primary-background` (the theme's deep brand colour)
 * so it stays legible in both the light and dark presets.
 */
@Component({
  selector: 'app-processing-indicator',
  standalone: true,
  template: `
    <svg class="proc-spinner" viewBox="0 0 16 16" role="img" aria-label="Agent is working">
      <g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
        <line x1="8" y1="1.8" x2="8" y2="5" />
        <line x1="8" y1="1.8" x2="8" y2="5" opacity="0.93" transform="rotate(45 8 8)" />
        <line x1="8" y1="1.8" x2="8" y2="5" opacity="0.86" transform="rotate(90 8 8)" />
        <line x1="8" y1="1.8" x2="8" y2="5" opacity="0.79" transform="rotate(135 8 8)" />
        <line x1="8" y1="1.8" x2="8" y2="5" opacity="0.72" transform="rotate(180 8 8)" />
        <line x1="8" y1="1.8" x2="8" y2="5" opacity="0.65" transform="rotate(225 8 8)" />
        <line x1="8" y1="1.8" x2="8" y2="5" opacity="0.58" transform="rotate(270 8 8)" />
        <line x1="8" y1="1.8" x2="8" y2="5" opacity="0.51" transform="rotate(315 8 8)" />
      </g>
    </svg>
  `,
  styles: [`
    :host {
      display: inline-flex;
      align-items: center;
      /* Sits on the row's title line: never squeezed by a long title, and
         never pushes the row's own action buttons out of place. */
      flex: 0 0 auto;
      /* Deliberately NOT --vscode-accent-color: that variable is the theme's
         *highlight* colour and is intentionally light (#f59e0b amber on the
         Light preset, #00d3a7 teal on Dark) — as a 16px glyph it washes out
         to near-invisible. The brand colour is the deep one, so the spinner
         reads clearly in both themes without changing any theme values. */
      color: var(--vscode-primary-background, var(--vscode-foreground, #2563eb));
    }

    .proc-spinner {
      /* A block box, not the default inline one: transform is unreliable on
         inline-level boxes, and this is the element that gets rotated. */
      display: block;
      width: 16px;
      height: 16px;
      /* Rotate around the middle of the 16x16 viewBox. Without transform-box
         an SVG element anchors the origin at its own (0,0), which would swing
         the glyph around the top-left corner instead of spinning in place. */
      transform-box: view-box;
      transform-origin: 50% 50%;
      animation: proc-tick 0.8s steps(8, end) infinite;
    }

    @keyframes proc-tick {
      to {
        transform: rotate(360deg);
      }
    }

    /* No prefers-reduced-motion override on purpose. This is functional
       progress feedback, not decoration: a parked spoke ring is
       indistinguishable from the idle state, so opting out of the animation
       would leave the row reading as "stuck" while the agent is working. The
       spin is a fixed 0.8s in every environment; same reasoning as the
       progress indicators in VS Code. */
  `],
})
export class ProcessingIndicatorComponent {}
