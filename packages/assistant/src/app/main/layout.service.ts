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

  /** Tasks 区域是否折叠 */
  readonly tasksSectionCollapsed = signal(false);

  toggleTasksSection(): void {
    this.tasksSectionCollapsed.update(v => !v);
  }

  /** Projects 区域是否折叠 */
  readonly projectsSectionCollapsed = signal(false);

  toggleProjectsSection(): void {
    this.projectsSectionCollapsed.update(v => !v);
  }
}
