import { afterNextRender, Component, ElementRef, EventEmitter, Input, model, OnChanges, Output, SimpleChanges } from '@angular/core';

@Component({
  selector: 'div[ast-menu]',
  templateUrl: './ast-menu.component.html',
  styleUrls: ['./ast-menu.component.css'],
  host: {
    '[style.display]': 'display',
    '[style]': 'positionStyle',
    '[style.width.px]': 'width',
    '(mouseenter)': 'onMouseenterMenu($event)',
    '(mouseleave)': 'onMouseleaveMenu($event)'
  },
})
export class AstMenuComponent implements OnChanges{
  isOpen = model<boolean>(false); // 菜单打开状态
  @Input() menuInitiator?: DOMRect; // 菜单触发元素位置信息
  @Output() mouseentermenu = new EventEmitter<MouseEvent>();
  @Output() mouseleavemenu = new EventEmitter<MouseEvent>();

  positionStyle: string = '';
  width: number = 200; // 菜单宽度
  display: string | null = null;

  constructor(private elementRef: ElementRef) {
    let me = this;
    afterNextRender(() => {
      // 监听文档点击事件以关闭菜单（如果点击不在菜单上
      document.addEventListener('click', function (e: any) {
        if(me.isOpen()) {
          if (e.target !== me.elementRef.nativeElement && !me.elementRef.nativeElement.contains(e.target)) {
            me.closeMenu();
          }
        }
      });
      // 浏览器窗口之外点击鼠标，浏览器内部右键菜单响应关闭事件  
      window.addEventListener('blur', function (e) {
        e.preventDefault()
        if(me.isOpen()) {
          me.closeMenu();
        }
      });
      document.addEventListener('keydown', (event) => {
        const keyName = event.key;

        if (keyName === 'Delete') {
          return;
        }
      }, false);
    });
  }

  closeMenu() {
    this.display = 'none';
    this.isOpen.set(false);
  }


  ngOnChanges(changes: SimpleChanges): void {
    if(changes["isOpen"]) {
      if(changes["isOpen"].currentValue != changes["isOpen"].previousValue) {
        if(changes["isOpen"].currentValue == false) {
          this.positionStyle = this.positionStyle.replace(/(block|flex|flex-inline)/g, 'none');
          this.display = 'none';
          return;
        }
        let menuInitiator = this.menuInitiator;
        if(!menuInitiator) {
          return;
        }
        // 显示自定义菜单并定位 336px 宽, 参考 .codigma-right-menu，36px 高， 参考 .codigma-menu-every-item
        let horizontalComputed = this.getHorizontalComputed(menuInitiator);
        let verticalComputed = this.getVerticalComputed(menuInitiator);
        this.positionStyle = horizontalComputed + 'px;' + verticalComputed + 'px;'
        this.display = 'block';

      }
    }
  }

  private getHorizontalComputed(menuInitiator: DOMRect) {
    let offset = menuInitiator.left == menuInitiator.right ? 10 : 10;
    return (window.innerWidth - menuInitiator.left) > this.width ? "left:" + (menuInitiator.left + offset) : "right:" + (window.innerWidth - menuInitiator.left - menuInitiator.width);
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
