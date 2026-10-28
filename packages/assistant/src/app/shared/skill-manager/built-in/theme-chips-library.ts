import type { ThemePromptSeed } from './theme-prompt-seeds';

/**
 * Full chips library for the Theme-generator scenario in the chat input.
 *
 * Categories merge the two reference styles: "look/mood" categories
 * (glamour, cartoon, gufeng, …) and "subject" categories (animal, car,
 * game, …). Chips display an English label and inject an English prompt so
 * the skill receives the same language as the built-in style seeds.
 *
 * `ThemeChip` is structurally identical to `ThemePromptSeed`
 * (`{ label, prompt }`), so `acp-chat-input.applyThemeSeed()` accepts both.
 */
export type ThemeChip = ThemePromptSeed;

export interface ThemeChipCategory {
  /** Stable id used for selection state. */
  id: string;
  /** Category label shown in the panel sidebar. */
  label: string;
  chips: ThemeChip[];
}

export const THEME_CHIP_CATEGORIES: readonly ThemeChipCategory[] = [
  // ── Style categories ─────────────────────────────────────
  {
    id: 'cartoon',
    label: 'Cartoon',
    chips: [
      { label: 'Super Cartoon', prompt: 'Create a theme inspired by "Super Cartoon" — bold primary colors, thick outlines, chunky rounded corners and playful sticker-like shadows' },
    ],
  },
  {
    id: 'anime',
    label: 'Anime',
    chips: [
      { label: 'Energetic Anime', prompt: 'Create a theme inspired by "Energetic Anime" — vivid pastel pop colors, sakura pink and sky blue pairing, bouncy motion and cheerful rounded shapes' },
    ],
  },
  {
    id: 'dominant',
    label: 'Bold',
    chips: [
      { label: 'Royal Black Gold', prompt: 'Create a theme inspired by "Royal Black Gold" — near-black backgrounds, brushed gold accents, sharp corners and commanding high-contrast typography' },
    ],
  },
  {
    id: 'anime-2d',
    label: 'Anime 2D',
    chips: [
      { label: 'Kawaii Anime', prompt: 'Create a theme inspired by "Kawaii Anime" — bright candy colors, lavender and mint accents, oversized rounded cards and animated micro-interactions' },
    ],
  },
  {
    id: 'solid',
    label: 'Solid',
    chips: [
      { label: 'Minimal Solid', prompt: 'Create a theme inspired by "Minimal Solid" — one flat solid background color, almost no gradients, subtle single-tone borders and restrained accent usage' },
    ],
  },
  {
    id: 'guofeng',
    label: 'Classical Chinese',
    chips: [
      { label: 'Ink Wash Classic', prompt: 'Create a theme inspired by "Ink Wash Classic" — ink-wash greys on rice-paper white, vermilion seal-red accents, elegant serif headings and flowing slow motion' },
      { label: 'Imperial Cinnabar', prompt: 'Create a theme inspired by "Imperial Cinnabar" — imperial red and jade green on warm ivory, ornate gold hairlines and stately typography' },
    ],
  },
  {
    id: 'clear',
    label: 'Crisp',
    chips: [
      { label: 'Translucent Blue-White', prompt: 'Create a theme inspired by "Translucent Blue-White" — crisp blue on pure white, glass-like translucency, hairline borders and maximum readability' },
    ],
  },
  {
    id: 'aesthetic',
    label: 'Aesthetic',
    chips: [
      { label: 'Dreamy Aesthetic', prompt: 'Create a theme inspired by "Dreamy Aesthetic" — dreamy pastel gradients, ethereal glow highlights, airy spacing and gentle fade transitions' },
    ],
  },
  {
    id: 'inspiring',
    label: 'Motivational',
    chips: [
      { label: 'Motivation Orange', prompt: 'Create a theme inspired by "Motivation Orange" — energetic orange over deep navy, dynamic diagonal accents, bold weight typography and snappy motion' },
    ],
  },
  {
    id: 'individual',
    label: 'Edgy',
    chips: [
      { label: 'Edgy Black', prompt: 'Create a theme inspired by "Edgy Black" — avant-garde brutalist layout feel, charcoal surfaces, one neon accent color and intentionally sharp geometry' },
    ],
  },
  {
    id: 'scenery',
    label: 'Scenery',
    chips: [
      { label: 'Landscape Scroll', prompt: 'Create a theme inspired by "Landscape Scroll" — earthy greens and sky blues, layered soft shadows like distant hills and calm slow transitions' },
    ],
  },
  {
    id: 'fresh',
    label: 'Fresh',
    chips: [
      { label: 'Mint Breeze', prompt: 'Create a theme inspired by "Mint Breeze" — light mint green and white, dewy translucent surfaces, generous whitespace and breezy motion' },
    ],
  },

  // ── Subject categories ───────────────────────────────────
  {
    id: 'animal',
    label: 'Animals',
    chips: [
      { label: 'Jungle Animals', prompt: 'Create a theme inspired by "Jungle Animals" — lush jungle greens with tawny fur tones, organic shapes and wild texture-like shadows' },
      { label: 'Pet Companions', prompt: 'Create a theme inspired by "Pet Companions" — playful warm pastels, paw-friendly rounded cards and bouncy friendly motion' },
    ],
  },
  {
    id: 'art',
    label: 'Art & Design',
    chips: [
      { label: 'Bauhaus', prompt: 'Create a theme inspired by "Bauhaus" — primary red yellow blue blocks on neutral grey, strict grid, flat surfaces and zero decoration' },
      { label: 'Mondrian', prompt: 'Create a theme inspired by "Mondrian" — white canvas split by black grid lines with primary color cells, crisp rectangular everything' },
    ],
  },
  {
    id: 'car',
    label: 'Cars',
    chips: [
      { label: 'Sports Car Metal', prompt: 'Create a theme inspired by "Sports Car Metal" — carbon dark grey with racing red highlights, chrome-like gradients, aerodynamic sharp corners' },
    ],
  },
  {
    id: 'color',
    label: 'Colors',
    chips: [
      { label: 'Rainbow Gradient', prompt: 'Create a theme inspired by "Rainbow Gradient" — full-spectrum gradient accents over clean white, vivid multicolor highlights and joyful motion' },
      { label: 'Morandi Grey', prompt: 'Create a theme inspired by "Morandi Grey" — muted dusty morandi tones, low-saturation harmony, soft matte surfaces and quiet transitions' },
    ],
  },
  {
    id: 'entertainment',
    label: 'Entertainment',
    chips: [
      { label: 'Showtime Neon', prompt: 'Create a theme inspired by "Showtime Neon" — hot pink and cyan neon over deep purple, stage-light glows and showtime energy' },
    ],
  },
  {
    id: 'game',
    label: 'Games',
    chips: [
      { label: 'Esports RGB', prompt: 'Create a theme inspired by "Esports RGB" — dark carbon surfaces with purple green RGB glow, angular panels, HUD-like borders and fast motion' },
      { label: 'Pixel Retro', prompt: 'Create a theme inspired by "Pixel Retro" — retro pixel palette, 8-bit chipped corners, scanline feel and crisp no-antialias colors' },
    ],
  },
  {
    id: 'nature',
    label: 'Nature & Scenery',
    chips: [
      { label: 'Misty Forest', prompt: 'Create a theme inspired by "Misty Forest" — misty forest greens fading into soft grey fog, layered depth shadows and calm easing motion' },
      { label: 'Sunset Coast', prompt: 'Create a theme inspired by "Sunset Coast" — sunset coral and amber over ocean teal, warm horizon gradients and relaxed pacing' },
    ],
  },
  {
    id: 'other',
    label: 'Other',
    chips: [
      { label: 'Vintage Film', prompt: 'Create a theme inspired by "Vintage Film" — warm sepia tones, faded film grain feel, nostalgic serif type and gentle vignette shadows' },
      { label: 'Future Tech', prompt: 'Create a theme inspired by "Future Tech" — deep space navy with holographic cyan, thin glowing borders, technical mono typography and crisp motion' },
    ],
  },
];

/** All chips flattened, for the "All" pseudo-category. */
export const FLAT_THEME_CHIPS: readonly ThemeChip[] = THEME_CHIP_CATEGORIES.flatMap(c => c.chips);

/**
 * Normalises a chip category value echoed by the LLM (or missing) to a known
 * category id. Accepts an id or a label; anything unknown → 'other'.
 */
export function resolveChipCategoryId(value?: string | null): string {
  const v = (value ?? '').trim();
  if (!v) return 'other';
  if (THEME_CHIP_CATEGORIES.some(c => c.id === v)) return v;
  const byLabel = THEME_CHIP_CATEGORIES.find(c => c.label === v);
  return byLabel ? byLabel.id : 'other';
}

/** Category id owning the chip with this label (fallback: 'other'). */
export function findChipCategoryIdByLabel(label: string): string {
  const category = THEME_CHIP_CATEGORIES.find(c => c.chips.some(chip => chip.label === label));
  return category ? category.id : 'other';
}
