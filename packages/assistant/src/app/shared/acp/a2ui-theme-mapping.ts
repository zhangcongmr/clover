/**
 * A2UI Theme 字段到 CSS 变量的映射定义
 *
 * 变量名来源：@a2ui/web_core/src/v0_9/basic_catalog/styles/default.js
 *
 * 层级说明：
 * - 设计 Token (--a2ui-color-*)：基础值，组件自动继承
 * - 组件级 (--a2ui-*-xxx)：组件特定样式，有默认值回退到 Token
 */

export interface A2uiThemeFields {
  // 颜色
  backgroundColor?: string;// 组件背景色
  surfaceColor?: string;// 组件表面色（卡片、按钮等）
  primaryColor?: string;// 组件主色（按钮、链接等）
  accentColor?: string;// 组件强调色（次要按钮、强调文本等）
  textColor?: string;// 组件文本色
  borderColor?: string;// 组件边框色

  // 排版
  fontFamily?: string;
  fontSize?: string;
  fontWeight?: string;
  lineHeight?: string;
  monoFont?: string;

  // 圆角
  radiusSmall?: string;
  radiusMedium?: string;
  radiusLarge?: string;

  // 阴影
  shadowSmall?: string;
  shadowMedium?: string;
  shadowLarge?: string;

  // 动效
  transitionDuration?: string;
  transitionEasing?: string;

  // Google Fonts
  googleFonts?: string[];
}

/**
 * theme 字段到 A2UI CSS 变量的映射表
 *
 * 键：createSurface.theme 中的字段名
 * 值：要设置的 CSS 变量名数组
 */
export const A2UI_THEME_CSS_MAP: Record<string, string[]> = {
  // === 颜色映射 ===
  // --a2ui-color-background: light-dark(#eee, #111)
  backgroundColor: ['--a2ui-color-background'],

  // --a2ui-color-surface: light-dark(color-mix(...))
  surfaceColor: ['--a2ui-color-surface'],

  // --a2ui-color-primary: #17e
  // 注意：primaryColor 同时被 BasicCatalogComponent 的 @HostBinding 处理
  // HostBinding 设置在每个组件的 host 元素上，不会级联到子元素
  // 所以这里仍需设置到 :root 以确保全局生效
  primaryColor: ['--a2ui-color-primary'],

  // --a2ui-color-secondary: light-dark(#ddd, #333)
  accentColor: ['--a2ui-color-secondary'],

  // --a2ui-color-on-background: light-dark(#333, #eee)
  textColor: ['--a2ui-color-on-background'],

  // --a2ui-color-border: light-dark(#ccc, #444)
  borderColor: ['--a2ui-color-border'],

  // === 排版映射 ===
  // --a2ui-font-family-title: inherit
  fontFamily: ['--a2ui-font-family-title'],

  // --a2ui-font-size-m: var(--a2ui-font-size)
  fontSize: ['--a2ui-font-size-m'],

  // A2UI 没有全局 fontWeight 变量
  fontWeight: [],

  // --a2ui-line-height-body: 1.5
  lineHeight: ['--a2ui-line-height-body'],

  // --a2ui-font-family-monospace: monospace
  monoFont: ['--a2ui-font-family-monospace'],

  // === 圆角映射 ===
  // --a2ui-border-radius: 0.25rem (全局默认)
  radiusSmall: ['--a2ui-border-radius'],

  // 组件级圆角
  radiusMedium: ['--a2ui-card-border-radius', '--a2ui-button-border-radius'],
  radiusLarge: ['--a2ui-modal-border-radius'],

  // === 阴影映射 ===
  // 组件级阴影（无全局 token）
  shadowSmall: ['--a2ui-button-box-shadow'],
  shadowMedium: ['--a2ui-card-box-shadow'],
  shadowLarge: ['--a2ui-modal-box-shadow'],

  // === 动效映射 ===
  // A2UI 没有官方动效变量，使用自定义变量
  transitionDuration: ['--a2ui-transition-duration'],
  transitionEasing: ['--a2ui-transition-easing'],
};

/**
 * 从 theme 对象中提取 Google Fonts 列表
 */
export function extractGoogleFonts(theme: A2uiThemeFields): string[] {
  if (Array.isArray(theme.googleFonts)) {
    return theme.googleFonts;
  }
  return [];
}
