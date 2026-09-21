import { Injectable } from '@angular/core';
import { A2UI_THEME_CSS_MAP, A2uiThemeFields, extractGoogleFonts } from './a2ui-theme-mapping';

/**
 * A2UI Theme 桥接服务
 *
 * 职责：将 createSurface.theme 中的自定义字段映射为 A2UI CSS 变量
 * 返回 CSS 变量对象，由调用方决定应用到哪个 DOM 元素
 */
@Injectable({ providedIn: 'root' })
export class A2uiThemeBridgeService {

  /**
   * 从 createSurface.theme 提取并映射为 CSS 变量
   *
   * @param theme createSurface.theme 对象
   * @returns CSS 变量键值对，可直接应用到 DOM 元素的 style
   */
  mapThemeToCssVars(theme: Record<string, any>): Record<string, string> {
    if (!theme || typeof theme !== 'object') {
      return {};
    }

    const cssVars: Record<string, string> = {};
    const themeFields = theme as A2uiThemeFields;

    for (const [field, cssVarsList] of Object.entries(A2UI_THEME_CSS_MAP)) {
      const value = themeFields[field as keyof A2uiThemeFields];
      if (value && typeof value === 'string' && cssVarsList.length > 0) {
        for (const cssVar of cssVarsList) {
          cssVars[cssVar] = value;
        }
      }
    }

    return cssVars;
  }

  /**
   * 从 createSurface.theme 提取 Google Fonts 列表
   *
   * @param theme createSurface.theme 对象
   * @returns 需要加载的 Google Font 名称列表
   */
  extractGoogleFonts(theme: Record<string, any>): string[] {
    if (!theme || typeof theme !== 'object') {
      return [];
    }
    return extractGoogleFonts(theme as A2uiThemeFields);
  }

  /**
   * 将 CSS 变量应用到指定 DOM 元素
   *
   * @param element 目标 DOM 元素
   * @param cssVars CSS 变量键值对
   */
  applyVarsToElement(element: HTMLElement, cssVars: Record<string, string>): void {
    for (const [varName, value] of Object.entries(cssVars)) {
      element.style.setProperty(varName, value);
    }
  }

  /**
   * 清除指定 DOM 元素上的 A2UI CSS 变量
   *
   * @param element 目标 DOM 元素
   */
  clearVarsFromElement(element: HTMLElement): void {
    const a2uiVars = Object.values(A2UI_THEME_CSS_MAP).flat();
    for (const varName of a2uiVars) {
      element.style.removeProperty(varName);
    }
  }
}
