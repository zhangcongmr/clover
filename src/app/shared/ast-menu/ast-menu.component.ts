import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';

@Component({
  selector: 'div[ast-menu]',
  templateUrl: './ast-menu.component.html',
  styleUrls: ['./ast-menu.component.css'],
  host: {
    '[style.display]': 'display',
    '[style]': 'showMenuStyle',
    '(mouseenter)': 'onMouseenterMenu($event)',
    '(mouseleave)': 'onMouseleaveMenu($event)'
  },
})
export class AstMenuComponent implements OnChanges{
  @Input() display: string | null = null;
  @Input() menuInitiator: any; // 菜单触发元素位置信息
  @Output() mouseentermenu = new EventEmitter<MouseEvent>();
  @Output() mouseleavemenu = new EventEmitter<MouseEvent>();

  showMenuStyle: string = '';

  ngOnChanges(changes: SimpleChanges): void {
    if(changes["display"]) {
      if(changes["display"].currentValue != changes["display"].previousValue) {
        if(changes["display"].currentValue == 'none') {
          this.showMenuStyle = "display:none;";
          return;
        }
        let menuInitiator = this.menuInitiator;
        if(!menuInitiator) {
          return;
        }
        // 显示自定义菜单并定位 336px 宽, 参考 .codigma-right-menu，36px 高， 参考 .codigma-menu-every-item
        let horizontalComputed = (window.innerWidth - menuInitiator.left) > 336 ? "left:" + (menuInitiator.left + 10) : "right:" + (window.innerWidth - menuInitiator.left - menuInitiator.width);
        let verticalComputed = (window.innerHeight - menuInitiator.top) > 3*36 ? "top:" + (menuInitiator.top + 30) : "bottom:" + (window.innerHeight - menuInitiator.top);
        this.showMenuStyle = horizontalComputed + 'px;' + verticalComputed + 'px;' + "display:block;"

      }
    }
  }
  onMouseenterMenu(event: MouseEvent) {
    this.mouseentermenu.emit(event);
  }

  onMouseleaveMenu(event: MouseEvent) {
    this.mouseleavemenu.emit(event);
  }
}
