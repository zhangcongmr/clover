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
  topSectionHeight: number = 0;
  bottomSectionHeight: number = 0;

  protected _dragDirection: 'horizontal' | 'vertical' = 'horizontal';

  dragStart(evt: any, currentCursorType: string = 'ew') {
    evt.preventDefault();
    this.maskLayerElement = evt.target.parentElement;
    this.maskLayerElement.style.zIndex = 90;
    document.body.style.cursor = currentCursorType.toLowerCase() + '-resize';
    this.active = true;

    this._dragDirection = currentCursorType === 'ns' ? 'vertical' : 'horizontal';

    if (this._dragDirection === 'vertical') {
      const currentTarget = evt.currentTarget;
      const parentParent = currentTarget.parentElement.parentElement.childNodes;
      this.topSectionHeight = parentParent[1].clientHeight;
      this.bottomSectionHeight = parentParent[2].clientHeight;
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
        const yOffset = evt.clientY - this.initialY;
        this.topPct = (this.topSectionHeight + yOffset) / (this.topSectionHeight + this.bottomSectionHeight);
      } else {
        this.leftPct = (evt.clientX - 32) / (window.innerWidth - 32);
      }
    }
  }
}
