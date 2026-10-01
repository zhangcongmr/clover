/**
 * Style seeds for the Theme-generator skill.
 *
 * Used to pre-fill a complete, ready-to-send prompt when the user clicks
 * "Generate Theme" in Settings → Appearance, and to power the one-click
 * suggestion chips shown while the theme-generation scenario is active in
 * the chat input.
 */
export const THEME_SKILL_NAME = 'Theme-generator';

export interface ThemePromptSeed {
  /** Short label shown on the suggestion chip and quoted in the prompt. */
  label: string;
  /** Full prompt fragment describing the style. */
  prompt: string;
}

export const THEME_PROMPT_SEEDS: readonly ThemePromptSeed[] = [
  {
    label: 'Lavender Sky',
    prompt: 'Create a theme inspired by "Lavender Sky" — soft purple tones, airy surfaces and gentle transitions',
  },
  {
    label: 'Dark Ocean',
    prompt: 'Create a theme inspired by "Dark Ocean" — deep navy blues, subtle wave-like gradients and calm contrast',
  },
  {
    label: 'Cyberpunk Neon',
    prompt: 'Create a theme inspired by "Cyberpunk Neon" — near-black backgrounds, electric magenta and cyan accents, sharp corners',
  },
  {
    label: 'Forest Calm',
    prompt: 'Create a theme inspired by "Forest Calm" — muted greens, warm paper surfaces and organic rounded shapes',
  },
  {
    label: 'Sunset Beach',
    prompt: 'Create a theme inspired by "Sunset Beach" — warm coral and amber highlights over light sandy backgrounds',
  },
  {
    label: 'Nordic Minimal',
    prompt: 'Create a theme inspired by "Nordic Minimal" — clean white surfaces, cool grey text and restrained blue accents',
  },
];

/** Returns a random style seed, avoiding the one most recently picked. */
export function randomThemePromptSeed(previousLabel?: string): ThemePromptSeed {
  const pool = THEME_PROMPT_SEEDS.filter(s => s.label !== previousLabel);
  const list = pool.length > 0 ? pool : [...THEME_PROMPT_SEEDS];
  return list[Math.floor(Math.random() * list.length)];
}

/** Builds the full prompt fragment (without the slash command) for a seed. */
export function buildThemePrompt(seed: ThemePromptSeed): string {
  return seed.prompt;
}
