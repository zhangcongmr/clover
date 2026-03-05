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

  leftWidth: number = 0.25; // 左侧宽度百分比
  active = false;

  // 用于存储当前拖动元素的父元素，以便在拖动结束时恢复样式
  maskLayerElement: any;

  dragStart(evt: any, currentCursorType: string = 'ew') {
    // initialX = e.clientX - xOffset;  
    // initialY = e.clientY - yOffset;  
    evt.preventDefault()
    this.maskLayerElement = evt.target.parentElement; // 获取父元素作为遮罩层
    evt.target.parentElement.style.zIndex = 90;
    document.body.style.cursor = currentCursorType.toLowerCase() + '-resize'; // 更改光标样式
    this.active = true;
  }

  dragEnd(evt: any) {
    // initialX = currentX;  
    // initialY = currentY;  
    this.active = false;
    if(this.maskLayerElement) {
      this.maskLayerElement.style.zIndex = "";
    }
    document.body.style.cursor = 'default'; // 恢复默认光标
  }

  whenMouseMove(evt: any) {
    if (this.active) {
      evt.preventDefault()
      const leftWidth = (evt.clientX - 32) / (window.innerWidth - 32);
      this.leftWidth = leftWidth;
    }
  }
}