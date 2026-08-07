import { AfterContentInit, AfterViewInit, Component, ElementRef, Input, OnChanges, OnDestroy, OnInit, SimpleChanges, contentChildren, effect, input, model, output, signal, viewChild } from '@angular/core';
import {CdkDrag, CdkDragDrop, CdkDropList} from '@angular/cdk/drag-drop';
import { AstTabComponent, AstTabType } from '../ast-tab.component';
import { AstMenuComponent } from '../../ast-menu/ast-menu.component';

@Component({
  selector: '[ast-tab-group]',
  templateUrl: './ast-tab-group.component.html',
  styleUrls: ['./ast-tab-group.component.css'],
  standalone: true,
  imports: [AstMenuComponent, CdkDropList, CdkDrag]
})
export class AstTabGroupComponent implements OnInit, OnChanges, AfterViewInit, AfterContentInit, OnDestroy {
  topLevelTabs = contentChildren(AstTabComponent)
  tabUlRef = viewChild<ElementRef<HTMLUListElement>>('tabUlRef');

  readonly addTabEnable = input<boolean>(false);
  readonly closable = input(true);
  readonly tabType = input<AstTabType>({});// tab的大小 如果不填写则默认为2rem；tab样式类型 如果不填写，会默认初始化为 bottom 类型
  readonly addNewTab = output<any>();
  readonly dragDrop = output<any>()

  readonly isDropListDisable = input(true)
  readonly tabGroupResizeObservable = input(false)
  readonly headerOnly = input<boolean>(false); //是否只显示tab栏，不显示内容区，默认为false
  readonly fobiddenContextMenu = input(false)
  readonly moreButtons = model<Array<{ label: string; action: string }>>([]); //右上角更多操作按钮

  private resizeObserver?: ResizeObserver;
  ulStyle: string = "height: 2rem;"

  tabMap: Map<string, boolean> = new Map();
  
  previousTabCount = 0;
  private _layoutChangeSignal = 0;
  @Input()
  set layoutChangeSignal(value: any) {
    // 每次外部传入新值（哪怕相同类型），都视为一次“请重新计算”的请求
    this._layoutChangeSignal = Date.now(); // 或直接用 value，但用时间戳确保变化
    this.scheduleScrollbarRecalculation();
  }

  // 防抖：避免短时间内多次触发
  private recalcDebounceTimer: any = null;

  private scheduleScrollbarRecalculation() {
    if (this.recalcDebounceTimer) {
      clearTimeout(this.recalcDebounceTimer);
    }
    this.recalcDebounceTimer = setTimeout(() => {
      this.recalculateScrollbarNow();
    }, 0);
  }

  private recalculateScrollbarNow() {
    const tabList = this.tabUlRef();
    if (!tabList?.nativeElement) return;
    this.handleUlResize(tabList.nativeElement as HTMLElement);
  }

  constructor() {
    effect(() => {
      this.topLevelTabs().forEach(tab => {
        if (!tab.isOld) {
          tab.tabType.set(this.tabType())
          tab.isOld = true;
        }
      });
      if(this.tabGroupResizeObservable() && this.previousTabCount > 0) {
        if(this.previousTabCount < this.topLevelTabs().length) {
          this.previousTabCount = this.topLevelTabs().length;
          if (this.topLevelTabs().length > 0) {
            const lastTab = this.topLevelTabs()[this.topLevelTabs().length - 1];
            // 如果是新添加的（可通过某种标记判断），自动激活并滚动
            queueMicrotask(() => {
              this.activateAndScrollToTab(lastTab);
            });
            this.scheduleScrollbarRecalculation();
          }
        } else if(this.previousTabCount > this.topLevelTabs().length) {
          this.previousTabCount = this.topLevelTabs().length;
          this.scheduleScrollbarRecalculation();
        }
      }
    });
  }

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
    if (!this.tabGroupResizeObservable()) {
      return;
    }

    this.resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        this.handleUlResize(entry.target as HTMLElement);
      }
    });

    const tabList = this.tabUlRef();
    if (tabList) {
      this.resizeObserver.observe(tabList.nativeElement);
      // 保存 observer 以便 ngOnDestroy 中 disconnect（可选）
    }
  }
  // 抽离 ResizeObserver 的核心逻辑为可复用方法
  private handleUlResize(ulElement: HTMLElement): void {
    const totalUlWidth = parseFloat(window.getComputedStyle(ulElement).width);
    const totalLiWidth = this.getTotalLiWidth(ulElement);

    if (totalLiWidth <= totalUlWidth) {
      // 无溢出
      this.computedScrollBarLengthNum = 0;
      this.computedScrollBarLength = '0px';
      this.leftScroll = 0;
      this.scrollBarLeft = 0;
      this.scrollToLeftEnable = false;
      this.scrollToRightEnable = false;
      ulElement.scrollTo({ left: 0, behavior: 'instant' });

      if (this.showButtonAdded) {
        this.moreButtons.update(v => v.filter((_, i) => i !== 0));
        this.showButtonAdded = false;
      }
      return;
    }

    // 有溢出
    const maxScrollLeft = totalLiWidth - totalUlWidth;
    const sliderWidth = (totalUlWidth * totalUlWidth) / totalLiWidth;
    const maxSliderLeft = totalUlWidth - sliderWidth;

    this.computedScrollBarLengthNum = sliderWidth;
    this.computedScrollBarLength = sliderWidth + 'px';

    // 校正 scroll 位置
    if (this.leftScroll > maxScrollLeft) this.leftScroll = maxScrollLeft;
    if (this.leftScroll < 0) this.leftScroll = 0;

    // 重新计算滑动条位置（horizontal mode）
    if (this.mode === 'horizontal') {
      const ratio = maxScrollLeft > 0 ? this.leftScroll / maxScrollLeft : 0;
      this.scrollBarLeft = ratio * maxSliderLeft;
    }

    ulElement.scrollTo({ left: this.leftScroll, behavior: 'instant' });

    this.scrollToLeftEnable = this.leftScroll > 0;
    this.scrollToRightEnable = this.leftScroll < maxScrollLeft;

    if (!this.showButtonAdded) {
      this.moreButtons.update(v => [{ label: 'show all opened', action: 'down' }, ...v]);
      this.showButtonAdded = true;
    }
  }
  
  ngAfterContentInit() {
    this.previousTabCount = this.topLevelTabs().length;
    // 初始设置
    // this.initTabActiveStatus();//注释掉，不在默认设置tab初始状态
  }

  ngOnDestroy(): void {
    // 组件销毁时，断开 ResizeObserver 的连接
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = undefined; // 清空引用
    }
  }

  private initTabActiveStatus() {
    // 首次调用时，确保至少有一个 tab 被激活
    const hasActivatedTab = this.topLevelTabs().some(tab => tab.isActivated());
    if (!hasActivatedTab && this.topLevelTabs().length > 0) {
      this.topLevelTabs().forEach((tab, index) => {
        if(index == 0) {
          tab.isActivated.set(true)
        } else {
          tab.isActivated.set(false)
        }
      })
    }
  }

  iconCloseClick(evt: any, tab: AstTabComponent) {
    evt.stopPropagation(); // 阻止事件冒泡
    if (this.topLevelTabs().length > 0) {
      const tabs: any = this.topLevelTabs();
      let isFirst = tabs[0].id == tab.id;
      let isLast = tabs[tabs.length - 1].id == tab.id;

      const toClosedTab = {
        label: tab.label,
        id: tab.id,
        isActivated: tab.isActivated(),
        isFirst: isFirst,
        isLast: isLast
      };

      tab.onCloseTab.emit(toClosedTab);
    }
  }

  clickTab(targetTab: AstTabComponent) {
    // this.scrollByTab(evt, targetTab);
    this.ensureTabVisible(targetTab); // 滚动到可见（前面已实现）
    if (targetTab.isActivated()) {
      //If the tab is already actived ,then return;
      return;
    }

    const toActivateTab = {
      label: targetTab.label,
      id: targetTab.id,
      isActivated: true
    };

    this.topLevelTabs().forEach(tab => {
      if (tab.id == targetTab.id) {
        tab.isActivated.set(true);
        tab.onClickTab.emit(toActivateTab);
      } else {
        tab.isActivated.set(false);
      }
    })
  }

  public activateAndScrollToTab(targetTab: AstTabComponent): void {
    // 1. 激活 tab（复用 clickTab 中的逻辑）
    this.topLevelTabs().forEach(tab => {
      tab.isActivated.set(tab.id === targetTab.id);
      if (tab.id === targetTab.id) {
        const toActivateTab = { label: tab.label(), id: tab.id, isActivated: true };
        tab.onClickTab.emit(toActivateTab);
      }
    });

    // 2. 确保可见（延迟到 DOM 更新后）
    setTimeout(() => {
      this.ensureTabVisible(targetTab);
    }, 0);
  }

  public ensureTabVisible(targetTab: AstTabComponent): void {
    const tabList = this.tabUlRef();
    if (!tabList || !tabList.nativeElement) return;

    const ulElement = tabList.nativeElement as HTMLElement;
    const liElement = Array.from(ulElement.children).find(
      child => child instanceof HTMLElement &&
        child.dataset['tabType'] === 'tab_header' &&
        (child as any).__ngContext__?.some((ctx: any) =>
          ctx?.constructor === AstTabComponent && ctx.id === targetTab.id
        )
    ) as HTMLElement | undefined;

    // 更可靠的方式：通过 id 或 label 匹配（建议给 li 加 data-id）
    // 临时方案：假设顺序一致，用 index
    const tabIndex = this.topLevelTabs().findIndex(t => t.id === targetTab.id);
    if (tabIndex === -1) return;

    const li = ulElement.children[tabIndex] as HTMLElement | undefined;
    if (!li) return;

    const ulRect = ulElement.getBoundingClientRect();
    const liRect = li.getBoundingClientRect();

    // 如果 tab 完全在可视区内，无需滚动
    if (liRect.left >= ulRect.left && liRect.right <= ulRect.right) {
      return;
    }

    // 否则，滚动使 tab 右对齐（或左对齐，根据需求）
    // 这里采用“让 tab 尽量靠右显示”的策略
    const ulScrollLeft = ulElement.scrollLeft;
    const ulWidth = ulElement.clientWidth;
    const liOffsetLeft = li.offsetLeft;
    const liWidth = li.offsetWidth;

    // 目标：让 li 的右侧与 ul 右侧对齐（但不超过内容总宽）
    let newScrollLeft = liOffsetLeft + liWidth - ulWidth;

    // 边界保护
    const totalLiWidth = this.getTotalLiWidth(ulElement);
    const maxScrollLeft = Math.max(0, totalLiWidth - ulWidth);
    newScrollLeft = Math.min(newScrollLeft, maxScrollLeft);
    newScrollLeft = Math.max(0, newScrollLeft);

    // 应用滚动
    ulElement.scrollTo({ left: newScrollLeft, behavior: 'instant' });

    // 同步更新内部状态（scrollBarLeft 等）
    this.leftScroll = newScrollLeft;
    if (this.mode === 'horizontal') {
      const ratio = maxScrollLeft > 0 ? newScrollLeft / maxScrollLeft : 0;
      const sliderMaxLeft = ulWidth - this.computedScrollBarLengthNum;
      this.scrollBarLeft = ratio * sliderMaxLeft;
      this.scrollToLeftEnable = newScrollLeft > 0;
      this.scrollToRightEnable = newScrollLeft < maxScrollLeft;
    }
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

      // 校正滑动条位置（防止因外部 resize 导致越界）
      const maxSliderLeft = Number(totalUlWidth) - this.computedScrollBarLengthNum;
      if (this.scrollBarLeft > maxSliderLeft) {
        this.scrollBarLeft = maxSliderLeft;
      }
      if (this.scrollBarLeft < 0) {
        this.scrollBarLeft = 0;
      }
    } else {
      this.computedScrollBarLengthNum = 0;
      this.computedScrollBarLength = "0px";
      tab_presentation.style.display = "none";
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

    const ulElement = evt.currentTarget as HTMLElement;
    const totalUlWidth = parseFloat(window.getComputedStyle(ulElement).width);
    const totalLiWidth = this.getTotalLiWidth(ulElement);

    if (totalLiWidth <= totalUlWidth) {
      return;
    }

    const delta = evt.deltaY; // 你用 deltaY 模拟水平滚动，保持不变
    const maxScrollLeft = totalLiWidth - totalUlWidth;

    if (this.mode === 'horizontal') {
      if (delta > 0) {
        // 向右滚动
        if (!this.scrollToRightEnable) return;

        let newLeftScroll = this.leftScroll + delta;
        newLeftScroll = Math.min(newLeftScroll, maxScrollLeft);

        this.leftScroll = newLeftScroll;

        // 重新计算滑动条位置
        const maxSliderLeft = totalUlWidth - this.computedScrollBarLengthNum;
        const ratio = maxScrollLeft > 0 ? this.leftScroll / maxScrollLeft : 0;
        this.scrollBarLeft = ratio * maxSliderLeft;

        this.scrollToLeftEnable = true;
        this.scrollToRightEnable = this.leftScroll < maxScrollLeft;
      } else {
        // 向左滚动
        if (!this.scrollToLeftEnable) return;

        let newLeftScroll = this.leftScroll + delta; // delta 为负
        newLeftScroll = Math.max(newLeftScroll, 0);

        this.leftScroll = newLeftScroll;

        const maxSliderLeft = totalUlWidth - this.computedScrollBarLengthNum;
        const ratio = maxScrollLeft > 0 ? this.leftScroll / maxScrollLeft : 0;
        this.scrollBarLeft = ratio * maxSliderLeft;

        this.scrollToRightEnable = true;
        this.scrollToLeftEnable = this.leftScroll > 0;
      }

      ulElement.scrollTo({ left: this.leftScroll, behavior: 'instant' });
    } else {
      // vertical 模式（预留）
      // 可类似处理 topScroll / scrollBarTop
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
    const tabs: any = this.topLevelTabs();
    let isFirst = tabs[0].id == tab.id;
    let isLast = tabs[tabs.length - 1].id == tab.id;

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

  addTab() {
    const size = this.topLevelTabs().length;
    this.topLevelTabs().forEach(tab => tab.isActivated.set(false));
    const newTabHeader = {
      label: 'Untitled',
      index: size + 1,
      isActivated: true
    }

    this.addNewTab.emit(newTabHeader);
  }

  dblclickAddTab() {
    if(!this.addTabEnable()) {
      return;
    }
    this.addTab()
  }

  blurSwitch = true;
  downMenuInitiator: DOMRect | undefined;
  downMenuOpen = false;
  hiddenTabs = signal<AstTabComponent[]>([])
  onDownButtonClick(evt: any, action: string) {
    if (!this.downMenuOpen) {
      this.downMenuOpen = !this.downMenuOpen;
      this.downMenuInitiator = { // 模拟一个 DOMRect 对象
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
    }
    this.currentContextMenuEvt = {
      clientX: evt.clientX,
      clientY: evt.clientY
    };
    this.calculateHiddenTabs();
  }

  blurDownBtn(evt: any) {
    let me = this;
    if (me.blurSwitch) {
      me.downMenuOpen = false;
    }
  }

  mouseentermenu(evt: any) {
    this.blurSwitch = false;
  }

  mouseleavemenu(evt: any) {
    this.blurSwitch = true;
  }


  clickOpenedTab(tab: AstTabComponent) {
    this.clickTab(tab); // 复用已有激活逻辑
    this.downMenuOpen = false
  }

  onMoreButtonClick(action: string) {
  }

  drop(event: CdkDragDrop<string[]>) {
    this.dragDrop.emit(event)
  }

  private calculateHiddenTabs(): void {
    const tabList = this.tabUlRef();
    if (!tabList?.nativeElement) {
      this.hiddenTabs.set([]);
      return;
    }

    const ul = tabList.nativeElement as HTMLElement;
    const ulRect = ul.getBoundingClientRect();
    const scrollLeft = ul.scrollLeft;

    const visibleTabs: AstTabComponent[] = [];
    const hiddenTabs: AstTabComponent[] = [];

    const tabs = this.topLevelTabs(); // 假设 topLevelTabs 是 Signal
    const liElements = Array.from(ul.children).filter(child => child.tagName === 'LI');

    for (let i = 0; i < tabs.length; i++) {
      const tab = tabs[i];
      const li = liElements[i] as HTMLElement | undefined;
      if (!li) continue;

      const liRect = li.getBoundingClientRect();
      const isVisible = (
        liRect.right >= ulRect.left &&
        liRect.left <= ulRect.right
      );

      if (isVisible) {
        visibleTabs.push(tab);
      } else {
        hiddenTabs.push(tab);
      }
    }

    this.hiddenTabs.set(hiddenTabs);
  }

}
