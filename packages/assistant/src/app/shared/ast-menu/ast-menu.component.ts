import { Component, ElementRef, EventEmitter, Input, OnDestroy, OnInit, Output, effect, input, model } from '@angular/core';

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
export class AstMenuComponent implements OnInit, OnDestroy {
  isOpen = model<boolean>(false); // 菜单打开状态
  @Input() menuInitiator?: DOMRect; // 菜单触发元素位置信息
  @Output() mouseentermenu = new EventEmitter<MouseEvent>();
  @Output() mouseleavemenu = new EventEmitter<MouseEvent>();

  horizontalOffset = input<number | undefined>(undefined);
  verticalOffset = input<number | undefined>(undefined);

  positionStyle: string = '';
  // 宽336px, 参考 .codigma-right-menu
  // 高36px，参考 .codigma-menu-every-item
  width: number = 240; // 菜单宽度
  display: string | null = null;

  documentClickHandler = (e: any) => {
    if (this.isOpen()) {
      const target = e.target as HTMLElement;
      if (this.elementRef.nativeElement.contains(target)) {
        return;
      }
      const submenus = this.elementRef.nativeElement.querySelectorAll('[ast-submenu]');
      for (const submenu of submenus) {
        if (submenu.contains(target)) {
          return;
        }
      }
      this.closeMenu();
    }
  };

  windowBlurHandler = (e: any) => {
    e.preventDefault();
    if (this.isOpen()) {
      const relatedTarget = e.relatedTarget as HTMLElement;
      if (relatedTarget && this.elementRef.nativeElement.contains(relatedTarget)) {
        return;
      }
      const submenus = this.elementRef.nativeElement.querySelectorAll('[ast-submenu]');
      for (const submenu of submenus) {
        if (submenu.contains(relatedTarget)) {
          return;
        }
      }
      this.closeMenu();
    }
  };

  constructor(private elementRef: ElementRef) {
    effect(() => {
      const open = this.isOpen();
      if (open) {
        const menuInitiator = this.menuInitiator;
        if (!menuInitiator) {
          return;
        }
        // 显示自定义菜单并定位 
        let horizontalComputed = this.getHorizontalComputed(menuInitiator);
        let verticalComputed = this.getVerticalComputed(menuInitiator);
        this.positionStyle = 'position:fixed;' + horizontalComputed + 'px;' + verticalComputed + 'px;';
        this.display = 'block';
      } else {
        this.positionStyle = this.positionStyle.replace(/position:fixed/g, 'position:static').replace(/(block|flex|flex-inline)/g, 'none');
        this.display = 'none';
      }
    });
  }

  ngOnInit() {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }
    // 监听文档点击事件以关闭菜单（如果点击不在菜单上
    document.addEventListener('click', this.documentClickHandler);
    // 浏览器窗口之外点击鼠标，浏览器内部右键菜单响应关闭事件
    window.addEventListener('blur', this.windowBlurHandler);
  }

  closeMenu() {
    this.display = 'none';
    this.isOpen.set(false);
  }

  private getHorizontalComputed(menuInitiator: DOMRect) {
    let offset = this.horizontalOffset() ?? (menuInitiator.left == menuInitiator.right ? 10 : 10);
    return (window.innerWidth - menuInitiator.left) > this.width ? "left:" + (menuInitiator.left + offset) : "right:" + (window.innerWidth - menuInitiator.left - menuInitiator.width);
  }

  private getVerticalComputed(menuInitiator: DOMRect) {
    let offset = this.verticalOffset() ?? (menuInitiator.top == menuInitiator.bottom ? 5 : 30);
    return (window.innerHeight - menuInitiator.top) > 3 * 36 ? "top:" + (menuInitiator.top + offset) : "bottom:" + (window.innerHeight - menuInitiator.top);
  }

  onMouseenterMenu(event: MouseEvent) {
    this.mouseentermenu.emit(event);
  }

  onMouseleaveMenu(event: MouseEvent) {
    this.mouseleavemenu.emit(event);
  }

  ngOnDestroy(): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }
    // 组件销毁时，务必移除事件监听器
    document.removeEventListener('click', this.documentClickHandler);
    window.removeEventListener('blur', this.windowBlurHandler);
  }
}
