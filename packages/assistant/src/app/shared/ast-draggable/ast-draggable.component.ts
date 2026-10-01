import { Component } from "@angular/core";

@Component({
    selector: 'div[ast-draggable]',
    templateUrl: './ast-draggable.component.html',
    styleUrls: ['./ast-draggable.component.css'],
    host: {
        '(mouseup)': 'dragEnd($event)',
      '(mousemove)': 'whenMouseMove($event)'
    },
    standalone: true,
})
export class AstDraggableComponent {

  /**
   * leftPct: number - Represents the left position of the draggable element as a percentage of the total width of the parent container.
   * It is initialized to a default value and can be updated during drag events.
   */
  leftPct: number;

  /**
   * topPct: number - Represents the top position of the draggable element as a percentage of the total height of the parent container.
   * It is initialized to a default value and can be updated during drag events.
   */
  topPct: number;

  /**
   * active: boolean - Indicates whether the draggable element is currently being dragged.
   * It is set to true when a drag event starts and set to false when the drag event ends.
   */
  active = false;

  constructor() {
    this.leftPct = this.getDefaultLeftPct();
    this.topPct = this.getDefaultTopPct();
  }

  protected getDefaultLeftPct(): number {
    return 0.25;
  }

  protected getDefaultTopPct(): number {
    return 1;
  }

  // 用于存储当前拖动元素的父元素，以便在拖动结束时恢复样式
  maskLayerElement: any;

  initialY: number = 0;
  /**
   * 拖动开始时的容器高度(px)。分割线上限(top/topPct%)与上下分区的高度百分比
   * 都以该容器为基准，因此 topPct 的增量必须以它为分母，才能与鼠标位移 1:1 对齐。
   * 不能用 上下两个分区的高度之和：容器内还有流内兄弟元素(如状态条)不参与该求和，会导致分母偏小、分割线跑在鼠标前面。
   */
  containerHeight: number = 0;
  /** 拖动开始时的 topPct，作为增量计算的基准 */
  initialTopPct: number = 0;
  protected leftSideAreaWidth: number = 42;// 42px是左侧区域的宽度，拖动时需要减去这个宽度来计算leftPct

  protected _dragDirection: 'horizontal' | 'vertical' = 'horizontal';

  dragStart(evt: any, currentCursorType: string = 'ew') {
    evt.preventDefault();
    this.maskLayerElement = evt.target.parentElement;
    this.maskLayerElement.style.zIndex = 90;
    document.body.style.cursor = currentCursorType.toLowerCase() + '-resize';
    this.active = true;

    this._dragDirection = currentCursorType === 'ns' ? 'vertical' : 'horizontal';

    if (this._dragDirection === 'vertical') {
      // currentTarget = 分割线；其上两级为百分比参照容器(如 .ast-middle-panel)
      const container = evt.currentTarget?.parentElement?.parentElement as HTMLElement | null;
      this.containerHeight = container ? container.clientHeight : 0;
      this.initialTopPct = this.topPct;
      this.initialY = evt.clientY;
    }
  }

  dragEnd(evt: any) {
    this.active = false;
    if(this.maskLayerElement) {
      this.maskLayerElement.style.zIndex = "";
    }
    document.body.style.cursor = 'default';
  }

  whenMouseMove(evt: any) {
    if (this.active) {
      evt.preventDefault();
      if (this._dragDirection === 'vertical') {
        if (this.containerHeight <= 0) {
          return;
        }
        // 以拖动起点为基准做增量，分母用容器总高度，保证 topPct 变化量与鼠标位移 1:1
        const yOffset = evt.clientY - this.initialY;
        this.topPct = Math.min(1, Math.max(0, this.initialTopPct + yOffset / this.containerHeight));
      } else {
        this.leftPct = (evt.clientX - this.leftSideAreaWidth) / (window.innerWidth - this.leftSideAreaWidth);
      }
    }
  }
}
