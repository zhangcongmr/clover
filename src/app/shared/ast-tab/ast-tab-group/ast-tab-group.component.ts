import { AfterContentInit, AfterViewInit, Component, ContentChildren, OnChanges, OnInit, QueryList, SimpleChanges, input, output } from '@angular/core';
import { AstTabComponent } from '../ast-tab.component';
import { Subscription, merge } from 'rxjs';

@Component({
  selector: '[ast-tab-group]',
  templateUrl: './ast-tab-group.component.html',
  styleUrls: ['./ast-tab-group.component.css'],
  standalone: true,
  imports: []
})
export class AstTabGroupComponent implements OnInit, OnChanges, AfterViewInit, AfterContentInit {
  @ContentChildren(AstTabComponent) topLevelTabs!: QueryList<AstTabComponent>;
  readonly showAddTab = input<boolean>(false);
  readonly closable = input(true);
  readonly tabType = input<any>({ 'size': 'large', 'tabType': 'bilateral' });//size: large | normal | small
  readonly addNewTab = output<any>();

  ulStyle: string = "height: 2rem;"
  liStyle: string = "height: 2rem;line-height: 2rem;"

  tabMap: Map<string, boolean> = new Map();
  private _subscription = new Subscription();

  constructor() { }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes["tabType"]) {
      this.ulStyle = this.tabType()['size'] == 'large' ? 'height: 3rem' : 'height: 2rem';
      this.liStyle = this.tabType()['size'] == 'large' ? 'height: 3rem;line-height: 3rem;' : 'height: 2rem;line-height: 2rem;';
    }
  }

  ngOnInit() {
  }

  ngAfterViewInit(): void {
    document.addEventListener('keydown', (event) => {
      const keyName = event.key;

      if (keyName === 'Control') {
        return;
      }
    }, false);
  }

  ngAfterContentInit() {
    //topLevelTabs.changes 不会在初始化时触发，只在内容后续发生变化时发出事件。因此首次处理应在这ngAfterContentInit 中进行
    // 初始设置
    this.updateTabsClass();

    // 监听投影内容变化（如 tab 被添加/移除）
    this._subscription.add(
      this.topLevelTabs.changes.subscribe(() => {
        this.listenToTabEvents(); // 重新绑定事件监听
        this.updateTabsClass();
      })
    );

    // 首次绑定所有 tab 的事件
    this.listenToTabEvents();
  }

  
  private tabEventsSubscription: Subscription = Subscription.EMPTY;

  // 为每个 tab 绑定 isActivatedChange 事件
  private listenToTabEvents() {
    // 先清空旧的监听
    this._subscription.remove(this.tabEventsSubscription);
    this.tabEventsSubscription?.unsubscribe();

    // 创建新的事件合并流
    const tabEvents$ = merge(
      ...this.topLevelTabs.map(tab => tab.isActivatedChange)
    );

    const sub = tabEvents$.subscribe(() => {
      console.log('某个 tab 的 isActivated 发生变化');
      this.updateTabsClass();
    });

    this.tabEventsSubscription = sub;
    this._subscription.add(sub);
  }


  private updateTabsClass() {
    this.topLevelTabs.forEach(tab => {
      tab.activeClass = this.computeTabClass(tab, this.tabType());
    });
  }

  iconCloseClick(evt: any, iconName: any) {
    if (this.topLevelTabs.length > 0) {
      const tabs: any = this.topLevelTabs;
      let isFirst = tabs.get(0).id == evt.id;
      let isLast = tabs.get(tabs.length - 1).id == evt.id;

      const toClosedTab = {
        label: evt.label,
        id: evt.id,
        isActivated: evt.isActivated,
        isFirst: isFirst,
        isLast: isLast
      };

      evt.onCloseTab.emit(toClosedTab);
    }
  }

  selectTab(e: any, targetTab: any) {
    if (targetTab.isActivated) {
      //If the tab is already actived ,then return;
      return;
    }

    const toActivateTab = {
      label: targetTab.label,
      id: targetTab.id,
      isActivated: true
    };

    this.topLevelTabs.forEach(tab => {
      if (tab.id == targetTab.id) {
        tab.isActivated = true;
        tab.onClickTab.emit(toActivateTab);
      } else {
        tab.isActivated = false;
      }
      tab.activeClass = this.computeTabClass(tab, this.tabType());
    })
  }

  computeTabClass(tab: AstTabComponent, tabType: any) {
    if (tabType['tabType'] == 'bilateral') {
      return tab['isActivated'] ? 'bilateral-border-tab' : 'bottom-border-tab';
    } else if (tabType['tabType'] == 'bottom') {
      return tab['isActivated'] ? 'bottom-border-tab' : 'borderless-tab';
    } else {
      return tab['isActivated'] ? 'bottom-border-tab' : 'borderless-tab';
    }
  }

  addTab() {
    const size = this.topLevelTabs.length;
    this.topLevelTabs.forEach(tab => tab.isActivated = false);
    const newTabHeader = {
      label: 'Untitled',
      index: size + 1,
      isActivated: true
    }

    this.addNewTab.emit(newTabHeader);
  }

  computedScrollBarLength = "0px";
  computedScrollBarLengthNum = 0;
  whenMouseEnterTabContainer(evt: any) {
    const ulElement = evt.currentTarget.children[0];
    const totalUlWidth = window.getComputedStyle(ulElement).width.replace("px", "");

    const tab_presentation = evt.currentTarget.lastChild;
    const childs = ulElement.children;

    let totalLiWidth = 0;
    for (let index = 0; index < childs.length; index++) {
      const element = childs[index];
      if (element.localName == 'li') {
        let width = window.getComputedStyle(element).width.replace("px", "");
        totalLiWidth = totalLiWidth + Number(width)
      }
    }

    if (totalLiWidth > Number(totalUlWidth)) {
      tab_presentation.style.display = "block";
      this.computedScrollBarLengthNum = Number(totalUlWidth) * Number(totalUlWidth) / totalLiWidth;
      this.computedScrollBarLength = this.computedScrollBarLengthNum + "px";
    } else {
      this.computedScrollBarLengthNum = 0;
      this.computedScrollBarLength = "0px";
    }
  }

  whenMouseLeaveTabContainer(evt: any) {
    const tab_presentation = evt.currentTarget.lastChild;
    tab_presentation.style.display = "none";
  }

  topScroll = 0;
  leftScroll = 0;
  scrollBarTop = 0;
  scrollBarLeft = 0;
  mode = "horizontal";
  scrollToRightEnable = true;
  scrollToLeftEnable = false;
  onTabWheel(evt: any) {
    // 阻止默认滚动行为（不推荐，除非你有特殊需求）  
    evt.preventDefault();
    // event.deltaY 表示垂直滚动的距离  
    // 正值表示向下滚动，负值表示向上滚动  
    // event.deltaX 表示水平滚动的距离  
    // 正值表示向右滚动，负值表示向左滚动  


    const totalUlWidth = window.getComputedStyle(evt.currentTarget).width.replace("px", "");
    let totalLiWidth = 0;
    const childs = evt.currentTarget.children;
    for (let index = 0; index < childs.length; index++) {
      const element = childs[index];
      let width = window.getComputedStyle(element).width.replace("px", "");
      totalLiWidth = totalLiWidth + Number(width)
    }

    if (totalLiWidth > Number(totalUlWidth)) {
      if (evt.deltaY > 0) {
        const scrollBardeltaY = (Number(totalUlWidth) - this.computedScrollBarLengthNum) / (totalLiWidth - Number(totalUlWidth)) * evt.deltaY
        if (!this.scrollToRightEnable) {
          return;
        }
        this.topScroll = this.mode == 'horizontal' ? 0 : (this.topScroll + evt.deltaY);
        this.leftScroll = this.mode == 'horizontal' ? (this.leftScroll + evt.deltaY) : 0;

        let tempScrollBarTop = this.mode == 'horizontal' ? 0 : (this.scrollBarTop + scrollBardeltaY);
        let tempScrollBarLeft = this.mode == 'horizontal' ? (this.scrollBarLeft + scrollBardeltaY) : 0;

        this.scrollBarTop = tempScrollBarTop;//TODO
        if (tempScrollBarLeft + this.computedScrollBarLengthNum > Number(totalUlWidth)) {
          tempScrollBarLeft = Number(totalUlWidth) - this.computedScrollBarLengthNum;
        }
        this.scrollBarLeft = tempScrollBarLeft;

        evt.currentTarget.scrollTo({
          top: this.topScroll,
          left: this.leftScroll,
          behavior: 'instant'
        })
        this.scrollToLeftEnable = true;
        if (this.leftScroll + Number(totalUlWidth) >= totalLiWidth) {
          this.scrollToRightEnable = false;
        }
      } else {
        const scrollBardeltaY = (Number(totalUlWidth) - this.computedScrollBarLengthNum) / (totalLiWidth - Number(totalUlWidth)) * evt.deltaY
        if (!this.scrollToLeftEnable) {
          return;
        }
        this.topScroll = this.topScroll + evt.deltaY;
        this.leftScroll = this.leftScroll + evt.deltaY;
        let tempScrollBarTop = this.mode == 'horizontal' ? 0 : (this.scrollBarTop + scrollBardeltaY);
        let tempScrollBarLeft = this.mode == 'horizontal' ? (this.scrollBarLeft + scrollBardeltaY) : 0;

        this.scrollBarTop = tempScrollBarTop;//TODO
        if (tempScrollBarLeft < 0) {
          tempScrollBarLeft = 0;
        }
        this.scrollBarLeft = tempScrollBarLeft;
        evt.currentTarget.scrollTo({
          top: this.topScroll,
          left: this.leftScroll,
          behavior: 'instant'
        })
        this.scrollToRightEnable = true;
        if (this.leftScroll <= 0) {
          this.scrollToLeftEnable = false;
        }
      }
    }
  }

  whenMouseEnterTabCloseCnr(tab: AstTabComponent) {
    tab.dotOrClose = false;
  }
  whenMouseLeaveTabCloseCnr(tab: AstTabComponent) {
    tab.dotOrClose = true;
  }
}
