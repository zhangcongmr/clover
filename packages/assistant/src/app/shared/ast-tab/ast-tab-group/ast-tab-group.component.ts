import { AfterContentInit, AfterViewInit, Component, ContentChildren, ElementRef, OnChanges, OnInit, QueryList, SimpleChanges, input, model, output, signal, viewChild } from '@angular/core';
import { AstTabComponent } from '../ast-tab.component';
import { Subscription, merge } from 'rxjs';
import { AstMenuComponent } from '../../ast-menu/ast-menu.component';

@Component({
  selector: '[ast-tab-group]',
  templateUrl: './ast-tab-group.component.html',
  styleUrls: ['./ast-tab-group.component.css'],
  standalone: true,
  imports: [AstMenuComponent]
})
export class AstTabGroupComponent implements OnInit, OnChanges, AfterViewInit, AfterContentInit {
  @ContentChildren(AstTabComponent) topLevelTabs!: QueryList<AstTabComponent>;
  tabListInst = viewChild<ElementRef<HTMLButtonElement>>('tabListInst');

  readonly showAddTab = input<boolean>(false);
  readonly closable = input(true);
  readonly tabType = input<{
    size?: 'large' | 'normal' | 'small';
    height?: string;
    type?: 'bilateral' | 'bottom' | 'borderless';
    backgroundColor?: string;
  }>({});// tab的大小 如果不填写则默认为2rem；tab样式类型 如果不填写，会默认初始化为 bottom 类型
  readonly addNewTab = output<any>();

  readonly tabGroupResizeObservable = input(false)
  readonly tabsOnlyMode = input<boolean>(false); //是否只显示tab栏，不显示内容区，默认为false
  readonly fobiddenContextMenu = input(false)
  readonly moreButtons = model<Array<{ label: string; action: string }>>([]); //右上角更多操作按钮

  ulStyle: string = "height: 2rem;"

  tabMap: Map<string, boolean> = new Map();
  private _subscription = new Subscription();

  constructor() { }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes["tabType"]) {
      if (this.tabType == null) {
        this.ulStyle = 'height: 2rem';
        return;
      } else {
        const tabType = this.tabType();
        if (tabType && tabType['size'] == 'large') {
          this.ulStyle = 'height: 3rem';
        } else {
          this.ulStyle = 'height: 2rem';
        }
        if (tabType && tabType['height']) {
          this.ulStyle = 'height: ' + tabType['height'];
        }
        if (tabType && tabType['backgroundColor']) {
          this.ulStyle += '; background-color: ' + tabType['backgroundColor'];
        }
      }
    }
  }

  ngOnInit() {
  }

  showButtonAdded = false;
  ngAfterViewInit(): void {
    if(!this.tabGroupResizeObservable()) {
      return;
    }
    const resizeObserver = new ResizeObserver(entries => {
      for (let entry of entries) {
        // 在这里处理宽度变化的逻辑
        const ulElement = entry.target;
        const totalUlWidth = window.getComputedStyle(ulElement).width.replace("px", "");
        let totalLiWidth = this.getTotalLiWidth(ulElement);
        if (!this.showButtonAdded) {
          if (totalLiWidth > Number(totalUlWidth)) {
            const downButtonIcon = {
              label: 'show all opened',
              action: 'down'
            }
            this.moreButtons.update(value => {
              value.unshift(downButtonIcon);
              return value;
            })
            this.showButtonAdded = true;
          }
        } else {
          if (totalLiWidth < Number(totalUlWidth)) {
            this.moreButtons.update(value => {
              value.splice(0, 1);
              return value;
            })
            this.showButtonAdded = false;
          }
        }
      }
    });

    const tabList = this.tabListInst()
    if (tabList) {
      resizeObserver.observe(tabList.nativeElement);
    }
  }

  ngAfterContentInit() {
    //topLevelTabs.changes 不会在初始化时触发，只在内容后续发生变化时发出事件。因此首次处理应在这ngAfterContentInit 中进行
    // 初始设置
    this.updateTabsClass(true);

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
      this.updateTabsClass();
    });

    this.tabEventsSubscription = sub;
    this._subscription.add(sub);
  }


  private updateTabsClass(firstTime?: boolean) {
    if (firstTime) {
      // 首次调用时，确保至少有一个 tab 被激活
      const hasActivatedTab = this.topLevelTabs.some(tab => tab.isActivated);
      if (!hasActivatedTab && this.topLevelTabs.length > 0) {
        this.topLevelTabs.first.isActivated = true;
      }
    }

    this.topLevelTabs.forEach(tab => {
      tab.activeClass = this.computeTabClass(tab, this.tabType());
    });
  }

  iconCloseClick(evt: any, tab: AstTabComponent) {
    evt.stopPropagation(); // 阻止事件冒泡
    if (this.topLevelTabs.length > 0) {
      const tabs: any = this.topLevelTabs;
      let isFirst = tabs.get(0).id == tab.id;
      let isLast = tabs.get(tabs.length - 1).id == tab.id;

      const toClosedTab = {
        label: tab.label,
        id: tab.id,
        isActivated: tab.isActivated,
        isFirst: isFirst,
        isLast: isLast
      };

      tab.onCloseTab.emit(toClosedTab);
    }
  }

  clickTab(evt: any, targetTab: any) {
    this.scrollByTab(evt, targetTab);

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

  private scrollByTab(evt: any, targetTab: any) {
    const ulElement = evt.currentTarget.parentElement;
    const totalUlWidth = window.getComputedStyle(ulElement).width.replace("px", "");
    let totalLiWidth = this.getTotalLiWidth(ulElement);

    const tabs: any = this.topLevelTabs;
    let isFirst = tabs.get(0).id == targetTab.id;
    let isLast = tabs.get(tabs.length - 1).id == targetTab.id;
    if (isFirst) {
      ulElement.scrollTo({
        top: 0,
        left: 0,
        behavior: 'instant'
      });
      this.scrollBarLeft = 0;
      this.scrollToLeftEnable = false;
      this.scrollToRightEnable = true;
    } else if (isLast) {
      ulElement.scrollTo({
        top: 0,
        left: totalLiWidth,
        behavior: 'instant'
      });
      this.scrollBarLeft = Number(totalUlWidth) - this.computedScrollBarLengthNum;
      this.scrollToLeftEnable = true;
      this.scrollToRightEnable = false;
    }
  }

  computeTabClass(tab: AstTabComponent, tabType: any) {
    if (tabType == null || tabType['type'] == null) {
      return tab['isActivated'] ? 'bottom-border-tab' : 'borderless-tab';
    }
    if (tabType['type'] == 'bilateral') {
      return tab['isActivated'] ? 'bilateral-border-tab' : 'bottom-border-tab';
    } else if (tabType['type'] == 'bottom') {
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
    let totalLiWidth = this.getTotalLiWidth(ulElement);

    const tab_presentation = evt.currentTarget.lastChild;

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

  topScroll = 0; // Element.scrollTo()  指定的坐标位置的垂直坐标，是绝对位置， 滚动对象为元素ul
  leftScroll = 0; // Element.scrollTo() 指定的坐标位置的水平坐标，是绝对位置， 滚动对象为元素ul
  scrollBarTop = 0; //滚动条的位置top
  scrollBarLeft = 0; //滚动条的位置left
  mode = "horizontal";
  scrollToRightEnable = true; //表示滚动条是否还可以向右移动 
  scrollToLeftEnable = false; //表示滚动条是否还可以向左移动 
  onTabWheel(evt: any) {
    // 阻止默认滚动行为（不推荐，除非你有特殊需求）  
    evt.preventDefault();
    // event.deltaY 表示垂直滚动的距离  
    // 正值表示向下滚动，负值表示向上滚动  
    // event.deltaX 表示水平滚动的距离  
    // 正值表示向右滚动，负值表示向左滚动  

    const ulElement = evt.currentTarget
    const totalUlWidth = window.getComputedStyle(ulElement).width.replace("px", "");
    let totalLiWidth = this.getTotalLiWidth(ulElement);

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

  private getTotalLiWidth(ulElement: any) {
    const childs = ulElement.children;
    let totalLiWidth = 0;
    for (let index = 0; index < childs.length; index++) {
      const element = childs[index];
      if (element.localName == 'li') {
        let width = window.getComputedStyle(element).width.replace("px", "");
        totalLiWidth = totalLiWidth + Number(width);
      }
    }
    return totalLiWidth;
  }

  currentContextMenuEvt: any;
  menuInitiator: DOMRect | undefined;
  isOpen = false;
  showContextMenu(evt: any, tab: AstTabComponent) {
    if (this.fobiddenContextMenu()) {
      return;
    }
    evt.preventDefault(); // 阻止默认右键菜单
    evt.stopPropagation(); //事件阻止冒泡（stop propagation），阻止事件继续向父级传播，从而避免父元素的 contextmenu 被触发

    this.menuInitiator = { // 模拟一个 DOMRect 对象
      x: evt.clientX,
      y: evt.clientY,
      left: evt.clientX,
      top: evt.clientY,
      bottom: evt.clientY,
      right: evt.clientX,
      width: 0,
      height: 0,
      toJSON: () => { }
    };
    this.isOpen = true;
    this.currentContextMenuEvt = {
      tab: tab,
      clientX: evt.clientX,
      clientY: evt.clientY
    };

  }

  closeTabs(action: string) {
    const evt = this.currentContextMenuEvt;
    const tab = evt.tab;
    const tabs: any = this.topLevelTabs;
    let isFirst = tabs.get(0).id == tab.id;
    let isLast = tabs.get(tabs.length - 1).id == tab.id;

    const toClosedTab = {
      label: tab.label,
      id: tab.id,
      isActivated: tab.isActivated,
      isFirst: isFirst,
      isLast: isLast,
      closeAction: action
    };

    tab.onCloseTab.emit(toClosedTab)
    this.isOpen = false;
  }

  onMoreButtonClick(action: string) {
  }

}
