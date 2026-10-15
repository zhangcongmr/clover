import { Injectable, computed, signal } from '@angular/core';

/**
 * Dock 布局模式，只有两种：
 * - agent-first：Agent 在左，Content 在右；Content 面板的展开/收起入口在 Agent 面板右上角
 * - content-first：Content 在左，Agent 在右；Agent 面板的展开/收起入口在 Content 组件右上角
 * 两种模式的展开态互不影响，各自记录在自己的参数集里。
 */
export type DockMode = 'agent-first' | 'content-first';

@Injectable({ providedIn: 'root' })
export class LayoutService {
  /** 当前 dock 布局模式，唯一真源 */
  readonly dockMode = signal<DockMode>('content-first');

  /** 中间面板（编辑器）是否展开 */
  readonly astContentPanelOpen = signal(false);

  /** Agent 面板是否展开（原为 AppComponent 上的普通布尔字段，移入 service 供 content 组件读写） */
  readonly agentPanelOpen = signal(true);

  /** Overview 面板是否展开。仅 content-first 模式下可达（入口图标在 Agent 面板右上角） */
  readonly overviewOpen = signal(false);

  /**
   * 停靠侧，由 dockMode 单向派生。
   * 模板/CSS/拖拽换算（.dock-left class、ast-content [leftOffset]、getHorizontalPct）继续消费该值。
   */
  readonly dockPosition = computed<'left' | 'right'>(() =>
    this.dockMode() === 'agent-first' ? 'left' : 'right');

  toggleAstContentPanel(value?: boolean): void {
    // Toggle the state of the AST content panel. If a value is provided, set it to that value; otherwise, toggle the current state.
    this.astContentPanelOpen.update(v => value !== undefined ? value : !v);
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
