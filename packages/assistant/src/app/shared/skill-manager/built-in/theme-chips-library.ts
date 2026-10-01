import type { ThemePromptSeed } from './theme-prompt-seeds';

/**
 * Full chips library for the Theme-generator scenario in the chat input.
 *
 * Categories merge the two reference styles: "look/mood" categories
 * (glamour, cartoon, gufeng, …) and "subject" categories (animal, car,
 * game, …). Chips display a Chinese label but inject an English prompt so
 * the skill receives the same language as the built-in style seeds.
 *
 * `ThemeChip` is structurally identical to `ThemePromptSeed`
 * (`{ label, prompt }`), so `acp-chat-input.applyThemeSeed()` accepts both.
 */
export type ThemeChip = ThemePromptSeed;

export interface ThemeChipCategory {
  /** Stable id used for selection state. */
  id: string;
  /** Chinese category label shown in the panel sidebar. */
  label: string;
  chips: ThemeChip[];
}

export const THEME_CHIP_CATEGORIES: readonly ThemeChipCategory[] = [
  // ── 风格类 ────────────────────────────────────────────────
  {
    id: 'glamour',
    label: '性感女人',
    chips: [
      { label: '魅惑酒红', prompt: 'Create a theme inspired by "魅惑酒红" — deep wine red surfaces, gold accents, elegant serif typography and luxe satin shadows' },
      { label: '玫瑰粉黛', prompt: 'Create a theme inspired by "玫瑰粉黛" — soft rose pink and cream tones, delicate borders and glamorous glossy highlights' },
    ],
  },
  {
    id: 'cartoon',
    label: '卡通动漫',
    chips: [
      { label: '超级卡通', prompt: 'Create a theme inspired by "超级卡通" — bold primary colors, thick outlines, chunky rounded corners and playful sticker-like shadows' },
    ],
  },
  {
    id: 'anime',
    label: '动漫卡通',
    chips: [
      { label: '元气动漫', prompt: 'Create a theme inspired by "元气动漫" — vivid pastel pop colors, sakura pink and sky blue pairing, bouncy motion and cheerful rounded shapes' },
    ],
  },
  {
    id: 'dominant',
    label: '霸气',
    chips: [
      { label: '王者黑金', prompt: 'Create a theme inspired by "王者黑金" — near-black backgrounds, brushed gold accents, sharp corners and commanding high-contrast typography' },
    ],
  },
  {
    id: 'anime-2d',
    label: '二次元',
    chips: [
      { label: '二次元萌系', prompt: 'Create a theme inspired by "二次元萌系" — bright candy colors, lavender and mint accents, oversized rounded cards and animated micro-interactions' },
    ],
  },
  {
    id: 'solid',
    label: '纯色',
    chips: [
      { label: '极简纯色', prompt: 'Create a theme inspired by "极简纯色" — one flat solid background color, almost no gradients, subtle single-tone borders and restrained accent usage' },
    ],
  },
  {
    id: 'guofeng',
    label: '古风',
    chips: [
      { label: '水墨古风', prompt: 'Create a theme inspired by "水墨古风" — ink-wash greys on rice-paper white, vermilion seal-red accents, elegant serif headings and flowing slow motion' },
      { label: '宫廷朱砂', prompt: 'Create a theme inspired by "宫廷朱砂" — imperial red and jade green on warm ivory, ornate gold hairlines and stately typography' },
    ],
  },
  {
    id: 'clear',
    label: '清楚',
    chips: [
      { label: '通透蓝白', prompt: 'Create a theme inspired by "通透蓝白" — crisp blue on pure white, glass-like translucency, hairline borders and maximum readability' },
    ],
  },
  {
    id: 'aesthetic',
    label: '唯美',
    chips: [
      { label: '梦幻唯美', prompt: 'Create a theme inspired by "梦幻唯美" — dreamy pastel gradients, ethereal glow highlights, airy spacing and gentle fade transitions' },
    ],
  },
  {
    id: 'inspiring',
    label: '励志',
    chips: [
      { label: '燃志橙', prompt: 'Create a theme inspired by "燃志橙" — energetic orange over deep navy, dynamic diagonal accents, bold weight typography and snappy motion' },
    ],
  },
  {
    id: 'individual',
    label: '个性',
    chips: [
      { label: '酷黑个性', prompt: 'Create a theme inspired by "酷黑个性" — avant-garde brutalist layout feel, charcoal surfaces, one neon accent color and intentionally sharp geometry' },
    ],
  },
  {
    id: 'scenery',
    label: '风景',
    chips: [
      { label: '山水画卷', prompt: 'Create a theme inspired by "山水画卷" — earthy greens and sky blues, layered soft shadows like distant hills and calm slow transitions' },
    ],
  },
  {
    id: 'fresh',
    label: '清新',
    chips: [
      { label: '淡绿清风', prompt: 'Create a theme inspired by "淡绿清风" — light mint green and white, dewy translucent surfaces, generous whitespace and breezy motion' },
    ],
  },

  // ── 主题类 ────────────────────────────────────────────────
  {
    id: 'animal',
    label: '动物',
    chips: [
      { label: '丛林动物', prompt: 'Create a theme inspired by "丛林动物" — lush jungle greens with tawny fur tones, organic shapes and wild texture-like shadows' },
      { label: '萌宠伴侣', prompt: 'Create a theme inspired by "萌宠伴侣" — playful warm pastels, paw-friendly rounded cards and bouncy friendly motion' },
    ],
  },
  {
    id: 'art',
    label: '艺术与设计',
    chips: [
      { label: '包豪斯', prompt: 'Create a theme inspired by "包豪斯" — primary red yellow blue blocks on neutral grey, strict grid, flat surfaces and zero decoration' },
      { label: '蒙德里安', prompt: 'Create a theme inspired by "蒙德里安" — white canvas split by black grid lines with primary color cells, crisp rectangular everything' },
    ],
  },
  {
    id: 'car',
    label: '汽车',
    chips: [
      { label: '跑车金属', prompt: 'Create a theme inspired by "跑车金属" — carbon dark grey with racing red highlights, chrome-like gradients, aerodynamic sharp corners' },
    ],
  },
  {
    id: 'color',
    label: '颜色',
    chips: [
      { label: '彩虹渐变', prompt: 'Create a theme inspired by "彩虹渐变" — full-spectrum gradient accents over clean white, vivid multicolor highlights and joyful motion' },
      { label: '莫兰迪灰调', prompt: 'Create a theme inspired by "莫兰迪灰调" — muted dusty morandi tones, low-saturation harmony, soft matte surfaces and quiet transitions' },
    ],
  },
  {
    id: 'entertainment',
    label: '娱乐',
    chips: [
      { label: '综艺霓虹', prompt: 'Create a theme inspired by "综艺霓虹" — hot pink and cyan neon over deep purple, stage-light glows and showtime energy' },
    ],
  },
  {
    id: 'game',
    label: '游戏',
    chips: [
      { label: '电竞 RGB', prompt: 'Create a theme inspired by "电竞 RGB" — dark carbon surfaces with purple green RGB glow, angular panels, HUD-like borders and fast motion' },
      { label: '像素怀旧', prompt: 'Create a theme inspired by "像素怀旧" — retro pixel palette, 8-bit chipped corners, scanline feel and crisp no-antialias colors' },
    ],
  },
  {
    id: 'nature',
    label: '自然与风景',
    chips: [
      { label: '晨雾森林', prompt: 'Create a theme inspired by "晨雾森林" — misty forest greens fading into soft grey fog, layered depth shadows and calm easing motion' },
      { label: '落日海岸', prompt: 'Create a theme inspired by "落日海岸" — sunset coral and amber over ocean teal, warm horizon gradients and relaxed pacing' },
    ],
  },
  {
    id: 'other',
    label: '其他',
    chips: [
      { label: '复古胶片', prompt: 'Create a theme inspired by "复古胶片" — warm sepia tones, faded film grain feel, nostalgic serif type and gentle vignette shadows' },
      { label: '未来科技', prompt: 'Create a theme inspired by "未来科技" — deep space navy with holographic cyan, thin glowing borders, technical mono typography and crisp motion' },
    ],
  },
];

/** All chips flattened, for the "全部" pseudo-category. */
export const FLAT_THEME_CHIPS: readonly ThemeChip[] = THEME_CHIP_CATEGORIES.flatMap(c => c.chips);

/**
 * Normalises a chip category value echoed by the LLM (or missing) to a known
 * category id. Accepts an id or a Chinese label; anything unknown → 'other'.
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
