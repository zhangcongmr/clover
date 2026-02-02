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
  @Input() menuInitiator?: DOMRect; // 菜单触发元素位置信息
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
        let horizontalComputed = this.getHorizontalComputed(menuInitiator);
        let verticalComputed = this.getVerticalComputed(menuInitiator);
        this.showMenuStyle = horizontalComputed + 'px;' + verticalComputed + 'px;' + "display:block;"

      }
    }
  }

  private getHorizontalComputed(menuInitiator: DOMRect) {
    let offset = menuInitiator.left == menuInitiator.right ? 10 : 10;
    return (window.innerWidth - menuInitiator.left) > 336 ? "left:" + (menuInitiator.left + offset) : "right:" + (window.innerWidth - menuInitiator.left - menuInitiator.width);
  }

  private getVerticalComputed(menuInitiator: DOMRect) {
    let offset = menuInitiator.top == menuInitiator.bottom ? 5 : 30;
    return (window.innerHeight - menuInitiator.top) > 3 * 36 ? "top:" + (menuInitiator.top + offset) : "bottom:" + (window.innerHeight - menuInitiator.top);
  }

  onMouseenterMenu(event: MouseEvent) {
    this.mouseentermenu.emit(event);
  }

  onMouseleaveMenu(event: MouseEvent) {
    this.mouseleavemenu.emit(event);
  }
}
