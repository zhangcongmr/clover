import { Component } from "@angular/core";

@Component({
    selector: 'div[ast-draggable]',
    templateUrl: './ast-draggable.component.html',
    styleUrls: ['./ast-draggable.component.css'],
    host: {
        '(mouseup)': 'dragEnd($event)',
        '(mousemove)': 'ewResize($event)'
    },
    standalone: true,
})
export class AstDraggableComponent {

  leftWidth: number = 0.25; // 左侧宽度百分比
  active = false;
  dragStart(evt: any) {
    // initialX = e.clientX - xOffset;  
    // initialY = e.clientY - yOffset;  
    evt.preventDefault()
    this.active = true;
  }

  dragEnd(evt: any) {
    // initialX = currentX;  
    // initialY = currentY;  
    this.active = false;
  }

  ewResize(evt: any) {
    if (this.active) {
      evt.preventDefault()
      const leftWidth = (evt.clientX - 32) / (window.innerWidth - 32);
      this.leftWidth = leftWidth;
    }
  }
}