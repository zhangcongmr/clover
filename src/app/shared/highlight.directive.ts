import { Directive, ElementRef, inject } from '@angular/core';

@Directive({
    selector: '[appHighlight]',
    standalone: true
})
export class HighlightDirective {
  private el = inject(ElementRef);


  constructor() {
    this.el.nativeElement.style.backgroundColor = 'yellow';
  }

}
