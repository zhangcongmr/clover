import { Component, ElementRef, Input, OnDestroy, effect, model } from '@angular/core';

@Component({
  selector: 'div[ast-submenu]',
  templateUrl: './ast-submenu.component.html',
  styleUrls: ['./ast-submenu.component.css'],
  host: {
    '[style.display]': 'display',
    '[style]': 'positionStyle',
  },
})
export class AstSubmenuComponent implements OnDestroy {
  isOpen = model<boolean>(false);
  @Input() parentItem?: HTMLElement;
  @Input() submenuWidth: number = 200;

  positionStyle: string = '';
  display: string = 'none';

  constructor(private elementRef: ElementRef) {
    effect(() => {
      const open = this.isOpen();
      if (open) {
        this.computePosition();
        this.display = 'block';
        this.positionStyle = this.positionStyle.replace(/position:static/g, 'position:fixed');
      } else {
        this.positionStyle = this.positionStyle.replace(/position:fixed/g, 'position:static');
        this.display = 'none';
      }
    });
  }

  onParentHover(): void {
    this.isOpen.set(true);
  }

  onParentLeave(): void {
    this.isOpen.set(false);
  }

  onMouseEnter(): void {}

  onMouseLeave(): void {
    this.isOpen.set(false);
  }

  resetState(): void {
    this.isOpen.set(false);
  }

  private computePosition(): void {
    if (!this.parentItem) return;

    const rect = this.parentItem.getBoundingClientRect();
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const submenuHeight = this.elementRef.nativeElement?.offsetHeight || 200;

    let left: number;
    if (rect.right + this.submenuWidth <= viewport.width) {
      left = rect.right;
    } else {
      left = rect.left - this.submenuWidth;
    }

    let top = rect.top;
    if (top + submenuHeight > viewport.height) {
      top = viewport.height - submenuHeight - 8;
    }
    if (top < 0) {
      top = 8;
    }

    this.positionStyle = `position:fixed;left:${left}px;top:${top}px;`;
  }

  get nativeElement(): HTMLElement {
    return this.elementRef.nativeElement;
  }

  ngOnDestroy(): void {}
}
