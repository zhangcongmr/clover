import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class LayoutService {
  readonly AST_CONTENT_PANEL_OPEN_KEY = 'clover_ast_content_panel_open';

  /** 中间面板（编辑器）是否展开 */
  readonly astContentPanelOpen = signal(false);
  readonly dockPosition = signal<'left' | 'right'>('right');

  toggleAstContentPanel(value?: boolean): void {
    // Toggle the state of the AST content panel. If a value is provided, set it to that value; otherwise, toggle the current state.
    this.astContentPanelOpen.update(v => value !== undefined ? value : !v);
    localStorage.setItem(this.AST_CONTENT_PANEL_OPEN_KEY, String(this.astContentPanelOpen()));
  }

  /** 左侧会话侧边栏是否收起 */
  readonly sidebarCollapsed = signal(false);

  collapseSidebar(): void {
    this.sidebarCollapsed.set(true);
  }

  expandSidebar(): void {
    this.sidebarCollapsed.set(false);
  }

  setSidebarCollapsed(collapsed: boolean): void {
    this.sidebarCollapsed.set(collapsed);
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
