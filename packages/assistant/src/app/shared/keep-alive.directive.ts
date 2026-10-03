import { Directive, Input, TemplateRef, ViewContainerRef, ViewRef, inject } from '@angular/core';

/**
 * 保活结构式指令（替代 @if 的显隐控制）：
 * - 首次条件为 true 时创建视图，等价 @if 的懒创建（从未打开过则不创建，SSR 输出一致）
 * - 条件变 false 时通过 ViewContainerRef.detach() 把 DOM 摘出文档：
 *   DevTools 的 Elements 树中不存在该面板节点，无可篡改的样式；组件实例与
 *   同一批 DOM 节点（滚动位置、input 值、编辑器内容等）保留在内存中
 * - 再次显示时 insert() 插回原位，状态完整保留
 * - 视图只创建一次，之后永不销毁（ngOnDestroy 兜底清理已分离的视图）
 */
@Directive({
  selector: '[appKeepAlive]',
  standalone: true
})
export class KeepAliveDirective {
  private templateRef = inject<TemplateRef<any>>(TemplateRef);
  private viewContainer = inject(ViewContainerRef);

  private view: ViewRef | null = null;
  private attached = false;

  @Input() set appKeepAlive(show: boolean) {
    if (show && !this.attached) {
      // 首次：创建并插入；再次：把缓存的同一视图插回原位
      this.view = this.view
        ? this.viewContainer.insert(this.view)
        : this.viewContainer.createEmbeddedView(this.templateRef);
      this.attached = true;
    } else if (!show && this.attached) {
      // 摘出文档但不销毁：detach() 默认摘除容器中最后一个视图（本指令实例只有自身视图）
      this.viewContainer.detach();
      this.attached = false;
    }
  }

  ngOnDestroy(): void {
    // 已附加的视图随容器销毁；已分离的视图不在容器内，需手动销毁防止泄漏
    if (this.view && !this.attached) {
      this.view.destroy();
    }
    this.view = null;
  }
}
