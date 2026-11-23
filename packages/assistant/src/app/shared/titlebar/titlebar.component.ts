import { Component, Input } from '@angular/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

/**
 * 自定义标题栏（无边框 Tauri 窗口）。
 *
 * 采用两段拼接：贴左侧面板主区顶部的一段只显示标题，贴右侧面板顶部的一段显示窗口控制按钮。
 * 两段同高同色，相邻接缝处视觉上连成一条横栏。是否显示由 body 上的 `.tauri-frameless`
 * 类通过 :host-context 控制：有原生标题栏时整段 display:none，不占布局高度。
 */
@Component({
  selector: 'app-titlebar',
  templateUrl: './titlebar.component.html',
  styleUrls: ['./titlebar.component.css'],
  standalone: true,
})
export class TitlebarComponent {
  /** 是否显示窗口控制按钮（仅“最右侧”那一段为 true）。 */
  @Input() showControls = false;

  protected async onMinimize(): Promise<void> {
    try {
      await getCurrentWindow().minimize();
    } catch (error) {
      console.error('Failed to minimize window:', error);
    }
  }

  protected async onToggleMaximize(): Promise<void> {
    try {
      await getCurrentWindow().toggleMaximize();
    } catch (error) {
      console.error('Failed to toggle maximize:', error);
    }
  }

  protected async onClose(): Promise<void> {
    try {
      await getCurrentWindow().close();
    } catch (error) {
      console.error('Failed to close window:', error);
    }
  }
}