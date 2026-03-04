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

  dragStart(evt: any, currentCursorType: string = 'ew') {
    // initialX = e.clientX - xOffset;  
    // initialY = e.clientY - yOffset;  
    evt.preventDefault()
    evt.target.parentElement.style.zIndex = 90;
    document.body.style.cursor = currentCursorType.toLowerCase() + '-resize'; // 更改光标样式
    this.active = true;
  }

  dragEnd(evt: any) {
    // initialX = currentX;  
    // initialY = currentY;  
    this.active = false;
    evt.target.style.zIndex = "";
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