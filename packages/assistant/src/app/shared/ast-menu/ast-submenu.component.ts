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

  private openDelayTimer: any = null;
  private closeDelayTimer: any = null;
  private readonly OPEN_DELAY = 200;
  private readonly CLOSE_DELAY = 300;

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
    this.clearTimers();
    this.openDelayTimer = setTimeout(() => {
      this.isOpen.set(true);
    }, this.OPEN_DELAY);
  }

  onParentLeave(): void {
    this.clearTimers();
    this.closeDelayTimer = setTimeout(() => {
      this.isOpen.set(false);
    }, this.CLOSE_DELAY);
  }

  onMouseEnter(): void {
    this.clearTimers();
  }

  onMouseLeave(): void {
    this.clearTimers();
    this.closeDelayTimer = setTimeout(() => {
      this.isOpen.set(false);
    }, this.CLOSE_DELAY);
  }

  private clearTimers(): void {
    if (this.openDelayTimer) {
      clearTimeout(this.openDelayTimer);
      this.openDelayTimer = null;
    }
    if (this.closeDelayTimer) {
      clearTimeout(this.closeDelayTimer);
      this.closeDelayTimer = null;
    }
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

  ngOnDestroy(): void {
    this.clearTimers();
  }
}
