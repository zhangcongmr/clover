import { Directive, ElementRef, Input, SimpleChanges, TemplateRef, ViewContainerRef, inject } from '@angular/core';

@Directive({
    selector: '[viewscroll]',
    standalone: true
})
export class ViewscrollDirective {
  private el = inject(ElementRef);

  @Input() viewscroll: any;

  previousEle: any;
  
  ngOnChanges(changes: SimpleChanges): void {
    if(!this.viewscroll) {
      return;
    }
    const elementId =  this.el.nativeElement.id;
    const event1 = new MouseEvent('click', {
      'view': window,
      'bubbles': true,
      'cancelable': true
    });

    if (this.previousEle) {
      if (this.previousEle["ariaExpanded"] == 'true') {
        this.previousEle?.dispatchEvent(event1);
      }
    }

    const targetNodeList = document.querySelectorAll("#" + elementId + "  " + "#" + this.viewscroll);
    if(targetNodeList.length == 0) {
      return;
    }
    const targetEle: any = targetNodeList[0];

    const toExpandTarget: any = targetEle.children[0].children[0];
    if (toExpandTarget["ariaExpanded"] == 'false') {
      toExpandTarget.dispatchEvent(event1);
    }

    const swaggerUiId = document.getElementById(elementId);

    let scrollWaitTimer = setInterval(() => {
      //使用一个定时器
      // console.log("scrollWaitTimer executed....")
      const opblockLoadingAnimation = document.getElementsByClassName("opblock-loading-animation");
      if (opblockLoadingAnimation && opblockLoadingAnimation[0]) {
        //接口展开详细页面尚未加载完毕，如果没有加载完，则返回等待
        return;
      }
      if (swaggerUiId) {
        swaggerUiId.scrollTo({
          top: targetEle.offsetTop,
          behavior: "smooth"
        });
      }

      if (scrollWaitTimer) {
        clearInterval(scrollWaitTimer);
      }
    }, 100);
    // const event2 = new MouseEvent('click', {
    //   'view': window,
    //   'bubbles': true,
    //   'cancelable': true
    // });
    // targetEle.dispatchEvent(event2);

    // targetEle?.scrollIntoView();

    this.previousEle = toExpandTarget;
  }
}
