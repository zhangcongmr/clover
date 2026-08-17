import { AfterViewInit, Component, EventEmitter, HostBinding, Input, OnChanges, OnInit, Output, SimpleChanges, input, output } from '@angular/core';

@Component({
    selector: '[ast-tab]',
    templateUrl: './ast-tab.component.html',
    styleUrls: ['./ast-tab.component.css'],
    host: {
        "[style.display]": "isActivated?'flex':'none'"
    },
    standalone: true
})
export class AstTabComponent implements OnInit, OnChanges, AfterViewInit {
  readonly label = input("");
  @Input() id = "";
  @Input() isActivated = false;
  @Input() minWidth = ''
  readonly saved = input(false);
  readonly onCloseTab = output<any>();
  readonly onClickTab = output<any>();
  // 输出事件，通知外部 isActivated 发生了变化
  @Output() isActivatedChange = new EventEmitter<boolean>();

  closable?: boolean;
  dotOrClose?:boolean;//When the tab is not saved, true: dot, false: close button

  activeClass = "bottom-border-tab";//default class is bottom-border-tab

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
        this.ariaHidden = !this.isActivated;
        this.isActivatedChange.emit(this.isActivated);
      }
    }
  }

  ngOnInit() {
    if(this.id == "" || this.id == null) {
      // If tab id is not specified, add a random uuid.
      this.id = this.uuid();
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
