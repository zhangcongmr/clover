import { AfterViewInit, Component, HostBinding, Input, OnChanges, OnInit, Signal, SimpleChanges, computed, input, model, output } from '@angular/core';

export interface AstTabType {
    size?: 'large' | 'normal' | 'small';
    height?: string;
    /**
     * bilateral: 容器元素的顶部边框
     * bottom: 普通容器元素的边框的底框
     * textbottom: 文字容器上添加底部边框， 使底部的宽度与文字宽度一致
     * borderless: 无边框
     * lightcolorselection: 元素容器的浅色填充
     * 
     */
    type?: 'bilateral' | 'bottom' | 'textbottom' | 'borderless' | 'lightcolorselection';
    backgroundColor?: string;
}

@Component({
    selector: '[ast-tab]',
    templateUrl: './ast-tab.component.html',
    styleUrls: ['./ast-tab.component.css'],
    host: {
        "[style.display]": "isActivated()?'flex':'none'"
    },
    standalone: true
})
export class AstTabComponent implements OnInit, OnChanges, AfterViewInit {
  readonly label = input("");
  @Input() id = "";
  @Input() minWidth = ''
  @Input() closable?: boolean;
  readonly saved = input<boolean | undefined>();
  readonly onCloseTab = output<any>();
  readonly onClickTab = output<any>();

  dotOrClose?:boolean;//When the tab is not saved, true: dot, false: close button
  
  isOld = false;//目前专门用来判断是否tabType被已经处理过， 从而避免重复触发信号计算
  isActivated = model(false);
  tabType = model<AstTabType>({});
  activeClass: Signal<string> = computed(() => this.computeTabClass(this.isActivated(), this.tabType()));

  previousEle: any;

  // spec: any;
  queryApibtnText = "刷新";

  showWidget = false;
  targetPageNumber = '';

  @HostBinding('attr.aria-hidden')
  ariaHidden: boolean = false;

  constructor() {
  }

  ngOnChanges(changes: SimpleChanges): void {
    // AstTabComponent.astTabLoadedSubject.next(changes["label"]["currentValue"])
    if(changes["isActivated"]) {
      if(changes["isActivated"].currentValue != changes["isActivated"].previousValue) {
        this.ariaHidden = !this.isActivated();
        // this.isActivatedChange.emit(this.isActivated);
      }
    }
  }

  ngOnInit() {
    if(this.id == "" || this.id == null) {
      // If tab id is not specified, add a random uuid.
      this.id = this.uuid();
    }
  }

  computeTabClass(isActivated: boolean, tabType: AstTabType) {
    if (tabType == null || tabType['type'] == null) {
      return isActivated ? 'active-tab bottom-border-tab' : 'borderless-tab';
    }
    if (tabType['type'] == 'bilateral') {
      return isActivated ? 'active-tab bilateral-border-tab' : 'bottom-border-tab';
    } else if (tabType['type'] == 'bottom') {
      return isActivated ? 'active-tab bottom-border-tab' : 'borderless-tab';
    } else if (tabType['type'] == 'textbottom') {
      return isActivated ? 'active-tab textbottom-border-tab' : 'borderless-tab';
    } else if (tabType['type'] == 'lightcolorselection') {
      return isActivated ? 'active-tab lightcolorselection-tab' : 'bottom-border-tab';
    } else {
      return isActivated ? 'active-tab bottom-border-tab' : 'borderless-tab';
    }
  }


  refreshData() {
    // if (this.explorerAsideComponent) {
    //   this.explorerAsideComponent.loadUI();
    // }
  }

  ngAfterViewInit(): void {
    // let astTab = document.querySelectorAll('ast-tab');
    // if(astTab.length > 0) {
    //   let ul = this.createElement('ul', 'role', 'tablist');
    //   let li = this.createElement('li', 'role', 'tab');
    //   ul.appendChild(li);
    //   const articleEle = astTab[0].getElementsByTagName('article');
      
    //   // astTab[0].appendChild(ul)
    //   console.log()
    // }

  }

  private createElement(tagName:string, attr: string, attrVal: string) {
    let li = document.createElement(tagName);
    li.setAttribute(attr, attrVal);
    return li;
  }

  private uuid(): string {
    let s: Array<any> = [];
    const hexDigits = "0123456789abcdef";
    for (let i = 0; i < 28; i++) {
      const start = Math.floor(Math.random() * 0x10);
      s[i] = hexDigits.substring(start, start + 1);
    }
    s[14] = "4"; // bits 12-15 of the time_hi_and_version field to 0010
    const start1 = (s[19] & 0x3) | 0x8;
    s[19] = hexDigits.substring(start1, start1 + 1); // bits 6-7 of the clock_seq_hi_and_reserved to 01
    s[8] = s[13] = s[18] = s[23] = "-";
    s[0] = "a";

    var uuid = s.join("");
    return uuid;
  }
}
