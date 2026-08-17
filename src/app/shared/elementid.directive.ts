import { Directive, ElementRef, Input, OnChanges, SimpleChanges, inject } from '@angular/core';

@Directive({
    selector: '[elementId]',
    standalone: true
})
export class ElementIdDirective implements OnChanges {
  private el = inject(ElementRef);

  @Input() elementId = '';
  
  ngOnChanges(changes: SimpleChanges): void {
    this.el.nativeElement.id = this.elementId;
  }
}
