import { Directive, ElementRef, Input, OnChanges, SimpleChanges, inject } from '@angular/core';

@Directive({
    selector: '[elementIndex]',
    standalone: true
})
export class ElementIndexDirective implements OnChanges {
  private el = inject(ElementRef);

  @Input() elementIndex = '';
  
  ngOnChanges(changes: SimpleChanges): void {
    this.el.nativeElement.tabIndex = this.elementIndex;
  }
}
