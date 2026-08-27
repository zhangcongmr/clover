import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class LayoutService {
  /** 中间面板（编辑器）是否展开 */
  readonly astContentPanelOpen = signal(false);

  toggleAstContentPanel(): void {
    this.astContentPanelOpen.update(v => !v);
  }

  /** 左侧会话侧边栏是否收起 */
  readonly sidebarCollapsed = signal(false);

  collapseSidebar(): void {
    this.sidebarCollapsed.set(true);
  }

  expandSidebar(): void {
    this.sidebarCollapsed.set(false);
  }
}
