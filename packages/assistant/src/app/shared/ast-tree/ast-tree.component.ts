import { AfterViewInit, Component, OnChanges, OnInit, SimpleChanges, afterNextRender, input, model, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AstTreeNode, TreeNodeType } from '../model';
import { AstMenuComponent } from '../ast-menu/ast-menu.component';



@Component({
  selector: '[ast-tree]',
  templateUrl: './ast-tree.component.html',
  styleUrls: ['./ast-tree.component.css'],
  standalone: true,
  host: {
    '(contextmenu)': 'showContextMenu($event, null)' // 监听组件根元素的右键菜单事件
  },
  imports: [FormsModule, AstMenuComponent]
})
export class AstTreeComponent implements OnInit, OnChanges, AfterViewInit {
  data = model<Array<AstTreeNode>>([])
  readonly filterNode = input(false);
  readonly dataType = input<string>(); //内部使用，用于区分传入的data是总的数据，还是分数据
  readonly fobiddenContextMenu = input(false)
  readonly selectedNodeType = model<string>('') //内部使用，标识当前选中的节点类型  root/parent/leaf
  readonly selectedNodeTypeOutput = output<string>();
  currentSelectedNodeType = "";

  readonly nodeClick = output();
  readonly menuItemAction = output<any>();

  showShareButton = false;

  dataBackUp: Array<any> = [];
  searchValue: string = ""

  constructor() {
    let me = this;
    afterNextRender(() => {
      document.addEventListener('keydown', (event) => {
        const keyName = event.key;

        if (keyName === 'Delete') {
          return;
        }
      }, false);
    });
  }

  ngOnInit() {
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes["data"] && this.data()) {
      if(this.dataType() != 'subData') {
        const newDatas = this.data();
        this.assignDeepLevel(newDatas);
        this.data.set(newDatas);
      }
      for (let index = 0; index < this.data().length; index++) {
        const dataItem = this.data()[index];
        if (!dataItem.isNewData) {
          continue;
        }
        if (dataItem) {
          const parentItemCopy = JSON.parse(JSON.stringify(dataItem))
          delete parentItemCopy["children"] //子节点的父节点引用不包含子节点数据，避免循环引用导致数据无法序列化
          delete parentItemCopy.isExpanded;//子节点的父节点引用不维护是否节点展开这个状态
          delete parentItemCopy.isNewData;//子节点的父节点引用不维护是否新添加节点这个状态
          delete dataItem.isNewData;//子节点的父节点不维护是否新添加节点这个状态
          delete parentItemCopy.sourceCodeText;

          dataItem.children = dataItem.children || [];
          dataItem.children.forEach((child: any) => {
            child['parentItem'] = parentItemCopy;
          });
        }

      }

      if (this.filterNode()) {
        this.dataBackUp = JSON.parse(JSON.stringify(this.data()));
      }
    }
  }

  
  assignDeepLevel(nodes: AstTreeNode[], level: number = 0): void {
    for (const node of nodes) {
      node.deepLevel = level; // 设置当前层级
      if (node.children && node.children.length > 0) {
        this.assignDeepLevel(node.children, level + 1); // 递归处理子节点，层级+1
      }
    }
  }


  elementClick(item: any) {
    if (item['rename']) {
      return;
    }

    this.currentSelectedNodeType = item['nodeType'];
    if (this.dataType() == 'subData') {
      this.selectedNodeTypeOutput.emit(this.currentSelectedNodeType);
    } else {
      this.selectedNodeType.set(item['nodeType']);
    }

    if (item['nodeType'] != TreeNodeType.Bookmark && item['nodeType'] != TreeNodeType.Api) {
      item.isExpanded = !item.isExpanded;
      this.reset(this.data()) //false -- 只重置同级节点的选中状态

      item['isActive'] = true;
      this.nodeClick.emit(item);
      return;
    }
    this.reset(this.data())
    this.nodeClick.emit(item);
  }

  expandCollapseClick(evt: any, item: any) {
    evt.stopPropagation();// 阻止事件冒泡，避免触发父元素的点击事件
    item.isExpanded = !item.isExpanded;
  }

  reset(data: Array<any>, deepIn?: boolean) {
    for (let index = 0; index < data.length; index++) {
      const dataItem = data[index];
      dataItem['isActive'] = false
      if (deepIn == null || deepIn) { //递归重置子节点
        if (dataItem.children && dataItem.children.length) {
          this.reset(dataItem.children)
        }
      }
    }
  }

  recurListClick(evt: any) {
    this.nodeClick.emit(evt);
  }

  selectedNodeTypeOutputChange(nodeType: string) {
    this.currentSelectedNodeType = nodeType;
  }

  forbiddenUserselectText() {
    // 点击开始时禁用文本选中
    document.body.style.userSelect = 'none';
  }

  resetUserSelectText() {
    // 鼠标释放后恢复文本选中
    document.body.style.userSelect = '';
  }

  currentContextMenuEvt: any;
  menuInitiator: DOMRect | undefined;
  isOpen = false;
  showContextMenu(evt: any, item: any) {
    if(this.fobiddenContextMenu()) {
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
      currentTargetEvt: evt.currentTarget,
      clientX: evt.clientX,
      clientY: evt.clientY
    };
    if(item) {
      if (item['nodeType'] == TreeNodeType.Bookmark || item['nodeType'] == TreeNodeType.Api) {
        this.showShareButton = false;
        const dataId = item['parentItem']['id'];
        const filterData = this.data().filter(dataval => dataval.id == dataId);
        if (filterData.length > 0) {
          // right click on child item
          this.currentContextMenuEvt['item'] = filterData[0];
          this.currentContextMenuEvt['childItem'] = item;
        }
      } else {
        // right click on parent item
        this.showShareButton = true;
        this.currentContextMenuEvt['item'] = item;
      }
    } else {
      // right click on empty area
      this.showShareButton = false;
      this.currentContextMenuEvt['non-element-select'] = true;
    }
  }

  menuSelectAction(action: string) {
    let current = this.currentContextMenuEvt;
    if (action == 'Delete') {
      if (current.item && current.childItem) {
        current.item.children = current.item.children.filter((val: any) => val.id != current.childItem.id)
      }
      if (current.item && !current.childItem) {
        const tempData = this.data().filter((val: any) => val.id != current.item.id)
        this.data.set(tempData)
      }

      this.menuItemAction.emit({
        action: action,
        target: current
      })
    } else if (action == 'Rename') {
      if (current.item && current.childItem) {
        current.childItem['rename'] = true;
      }
      if (current.item && !current.childItem) {
        current.item['rename'] = true;
      }

      setTimeout(() => {
        // 聚焦并全选文本（可选体验优化
        const el = this.currentContextMenuEvt.currentTargetEvt;
        const editable = el.querySelector('[contenteditable="true"]');
        editable.focus();
        const range = document.createRange();
        range.selectNodeContents(editable);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      });

    } else if (action == 'Duplicate') {
      if (current.item && current.childItem) {
        const index = current.item.children.findIndex((dataval: any) => dataval.id === current.childItem.id);
        if (index !== -1) {
          const copyObj = JSON.parse(JSON.stringify(current.childItem))
          copyObj['id'] = this.uuid()
          current.item.children.splice(index + 1, 0, copyObj);
          current.childItem['isActive'] = false
        }
      }
      if (current.item && !current.childItem) {
        const index = this.data().findIndex((dataval: any) => dataval.id === current.item.id);
        if (index !== -1) {
          const copyObj = JSON.parse(JSON.stringify(current.item))
          copyObj['id'] = this.uuid()
          this.data().splice(index + 1, 0, copyObj);
          current.item['isActive'] = false;
        }
      }
      this.menuItemAction.emit({
        action: action,
        target: this.currentContextMenuEvt
      })
    } else if (action == 'New') {
      if (!current['non-element-select']) {
        if (current.item && current.childItem) {
          this.menuItemAction.emit({
            action: action,
            target: current.childItem
          })
        }
        if (current.item && !current.childItem) {
          this.menuItemAction.emit({
            action: action,
            target: current.item
          })
        }
      } else {
          this.menuItemAction.emit({
            action: action,
            target: 'non-element-select'
          })
      }
    } else if (action == 'Share') {
      if (current.item && !current.childItem) {
        this.menuItemAction.emit({
          action: action,
          target: current.item
        })
      }
    }
    this.closeMenu();
  }

  closeMenu() {
    this.isOpen = false;
  }

  // 实时监听内容变化（可选）
  onContentChange(evt: any) {
    const editable = evt.currentTarget;
    const newContent = editable.innerText;
    console.log('正在编辑:', newContent);
    // 注意：此时不要直接赋值给 item.label，否则会触发变更检测导致光标跳动
  }

  // 编辑结束（blur 时保存）
  outOfRename(evt: any, item: any) {
    if (item.rename) {
      const editable = evt.currentTarget;
      const newLabel = editable.innerText.trim();
      // 防止空值或仅空白
      if (newLabel) {
        item.label = newLabel;
        item.tabLabel = newLabel;
      }
      item['saved'] = true;
      item.rename = false; // 退出编辑模式
      this.menuItemAction.emit("Rename")
    }
  }

  ngAfterViewInit(): void {
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

  /***************************文本搜索********************************/
  lastInput: any;
  keyUpSearch(searchValue: any, evt: any) {
    this.search(searchValue);
  }

  pasteSearch(searchValue: any, evt: any) {
    this.search(searchValue);
  }

  cutSearch(searchValue: any, evt: any) {
    this.search(searchValue);
  }

  private search(searchValue: any) {
    clearTimeout(this.lastInput);
    this.lastInput = setTimeout(() => {
      console.log("searchValue is: " + searchValue);
      if (searchValue.length > 0) {
        for (let index = 0; index < this.data().length; index++) {
          const item = this.data()[index];
          const children = item['children'] || [];

          let searchResults: any[] = [];
          for (let index = 0; index < children.length; index++) {
            const element = children[index];
            if (element["label"].toLocaleLowerCase().includes(searchValue.toLocaleLowerCase())) {
              searchResults.push(element);
            }
          }
          item['children'] = searchResults;
        }
      } else {
        this.data.set(this.dataBackUp);
      }
    }, 200);
  }
  /***************************文本搜索********************************/
}
