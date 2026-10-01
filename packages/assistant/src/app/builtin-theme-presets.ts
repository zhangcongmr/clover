import type { SavedTheme } from './theme-library.service';

/**
 * Built-in presets backing the Light / Dark theme cards in
 * Settings → Appearance. They are intentionally NOT stored in the
 * user-editable Theme Library (`clover-theme-library`), so they can
 * never be deleted or duplicated there.
 *
 * Selecting a card fully replaces the inline theme variables with the
 * preset's `vars` and loads its `googleFonts`.
 */
export const BUILTIN_THEME_PRESETS: Record<string, SavedTheme> = {
  default: {
    id: 'light-clarity-theme-1790777962231',
    title: 'Light Clarity Theme',
    createdAt: 1790777962231,
    vars: {
      '--vscode-background': '#f7f8fa',
      '--vscode-primary-background': '#2563eb',
      '--vscode-secondary-background': '#64748b',
      '--vscode-foreground': '#1f2937',
      '--vscode-surface-background': '#ffffff',
      '--vscode-accent-color': '#f59e0b',
      '--vscode-editor-selectionBackground': '#bfdbfe',
      '--vscode-editor-selectionForeground': '#111827',
      '--vscode-border-color': '#e3e8ef',
      '--vscode-primary-foreground': '#ffffff',
      '--vscode-accent-foreground': '#422006',
      '--vscode-hover-background': 'rgba(37, 99, 235, 0.08)',
      '--vscode-item-active-background': 'rgba(37, 99, 235, 0.16)',
      '--vscode-font-family': "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      '--vscode-font-size': '14px',
      '--vscode-font-weight': '400',
      '--vscode-line-height': '1.55',
      '--vscode-font-mono': "'JetBrains Mono', 'Fira Code', Consolas, monospace",
      '--vscode-terminal-font-family': "'JetBrains Mono', 'Fira Code', Consolas, monospace",
      '--vscode-radius-sm': '4px',
      '--vscode-radius-md': '8px',
      '--vscode-radius-lg': '14px',
      '--vscode-shadow-sm': '0 1px 3px rgba(15, 23, 42, 0.06)',
      '--vscode-shadow-md': '0 6px 20px rgba(15, 23, 42, 0.08)',
      '--vscode-shadow-lg': '0 16px 44px rgba(15, 23, 42, 0.12)',
      '--vscode-motion-duration': '0.18s',
      '--vscode-motion-easing': 'cubic-bezier(0.4, 0, 0.2, 1)',
      '--vscode-bg-gradient': 'linear-gradient(160deg, rgba(37,99,235,0.07) 0%, transparent 45%, rgba(245,158,11,0.05) 100%)',
      '--vscode-editor-bg-gradient': 'linear-gradient(180deg, rgba(37,99,235,0.045) 0%, transparent 55%)',
    },
    googleFonts: ['Inter', 'JetBrains Mono'],
  },
  dark: {
    id: 'noir-graphite-theme-1790777798192',
    title: 'Noir Graphite Theme',
    createdAt: 1790777798192,
    vars: {
      '--vscode-background': '#0d0f12',
      '--vscode-primary-background': '#7c5cff',
      '--vscode-secondary-background': '#4a5170',
      '--vscode-foreground': '#e4e7ec',
      '--vscode-surface-background': '#16191f',
      '--vscode-accent-color': '#00d3a7',
      '--vscode-editor-selectionBackground': 'rgba(124, 92, 255, 0.30)',
      '--vscode-editor-selectionForeground': '#ffffff',
      '--vscode-border-color': '#262b35',
      '--vscode-primary-foreground': '#ffffff',
      '--vscode-accent-foreground': '#05221c',
      '--vscode-hover-background': 'rgba(124, 92, 255, 0.10)',
      '--vscode-item-active-background': 'rgba(0, 211, 167, 0.16)',
      '--vscode-font-family': "'Space Grotesk', 'Segoe UI', 'Helvetica Neue', sans-serif",
      '--vscode-font-size': '14px',
      '--vscode-font-weight': '400',
      '--vscode-line-height': '1.55',
      '--vscode-font-mono': "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
      '--vscode-terminal-font-family': "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
      '--vscode-radius-sm': '2px',
      '--vscode-radius-md': '4px',
      '--vscode-radius-lg': '8px',
      '--vscode-shadow-sm': '0 1px 3px rgba(0, 0, 0, 0.50)',
      '--vscode-shadow-md': '0 8px 24px rgba(0, 0, 0, 0.55)',
      '--vscode-shadow-lg': '0 20px 56px rgba(0, 0, 0, 0.65)',
      '--vscode-motion-duration': '0.15s',
      '--vscode-motion-easing': 'cubic-bezier(0.4, 0, 0.2, 1)',
      '--vscode-bg-gradient': 'linear-gradient(160deg, rgba(124, 92, 255, 0.12) 0%, transparent 45%, rgba(0, 211, 167, 0.07) 100%)',
      '--vscode-editor-bg-gradient': 'linear-gradient(180deg, rgba(124, 92, 255, 0.06) 0%, transparent 55%)',
    },
    googleFonts: ['Space Grotesk', 'JetBrains Mono'],
  },
};
