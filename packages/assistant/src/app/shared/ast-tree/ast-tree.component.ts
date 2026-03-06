import { AfterViewInit, Component, ElementRef, OnChanges, OnInit, SimpleChanges, afterNextRender, effect, input, model, output, viewChild, viewChildren } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AstTreeNode, NoN_SELECTION, TargetTreeNodeType } from '../model';
import { AstMenuComponent } from '../ast-menu/ast-menu.component';
import { HttpClient, HttpEventType } from '@angular/common/http';
import { inject } from '@angular/core';
import { CoreService } from '../../core.service';
import JSZip from 'jszip';

@Component({
  selector: '[ast-tree]',
  templateUrl: './ast-tree.component.html',
  styleUrls: ['./ast-tree.component.css'],
  standalone: true,
  host: {
    '(contextmenu)': 'showContextMenu({evt: $event, item: null})' // 监听组件根元素的右键菜单事件
  },
  imports: [FormsModule, AstMenuComponent]
})
export class AstTreeComponent implements OnInit, OnChanges, AfterViewInit {
  editorItemRefs = viewChildren<ElementRef<HTMLDivElement>>('editorItemRef');
  data = model<Array<AstTreeNode>>([])
  readonly isSearch = input(false);
  readonly dataType = input<string>(); //内部使用，用于区分传入的data是总的数据，还是分数据
  readonly fobiddenContextMenu = input(false)
  // if true, editing actions (new/delete/rename/duplicate) are disabled
  readonly readOnly = input<boolean>(false);
  selectedNodeType = model<string>('') //内部使用，标识当前选中的节点类型  TreeNodeType  暂时闲置未使用

  readonly nodeClick = output();
  readonly showContextMenuClick = output<any>();
  readonly outOfRenameClick = output<any>();
  readonly menuItemAction = output<any>();

  dataBackUp: Array<any> = [];
  searchValue: string = ""

  http = inject(HttpClient);
  coreService = inject(CoreService);

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
    effect(() => {
      const editorItemRefs = this.editorItemRefs()
      if(editorItemRefs) {
        editorItemRefs.forEach((editorItemRef: any) => {
          if(editorItemRef.nativeElement.contentEditable === 'true') {
            editorItemRef.nativeElement.focus();
            this.selectAllText(editorItemRef.nativeElement)
          }
        })

      }
    })
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

      if (this.dataType() != 'subData' && this.isSearch()) {
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
    if(this.dataType() == 'subData') { //如果事件是发生在子树上，则需要递归向上，一直递归到根树上再处理
      this.nodeClick.emit(item)
      return;
    }

    this.selectedNodeType.set(item['nodeType']);
    if(item.nodeType == 'folder') {
      item.isExpanded = !item.isExpanded;
      const activeNode = findActiveNode(this.data(), 'exclude-folder');
      reset(this.data(), ResetType.onlyResetFolder)
      item['isActive'] = true;

      if(activeNode) {
        activeNode['hideActiveStatus'] = true;
      }
    } else if(item.nodeType == 'file') {
      item.isExpanded = !item.isExpanded;
      reset(this.data())
      item['isActive'] = true;
    } else {
      reset(this.data())
    }
    this.nodeClick.emit(item);
  }

  expandCollapseClick(evt: any, item: any) {
    evt.stopPropagation();// 阻止事件冒泡，避免触发父元素的点击事件
    item.isExpanded = !item.isExpanded;
  }


  forbiddenUserselectText() {
    // 点击开始时禁用文本选中
    document.body.style.userSelect = 'none';
  }

  resetUserSelectText() {
    // 鼠标释放后恢复文本选中
    document.body.style.userSelect = '';
  }

  currentContextMenuEvt: {
    currentTargetEvt?: any;
    clientX?: number;
    clientY?: number;
    action?: string;
    item?: any;
    parentItem?: any;
    rawLabel?: string;//在重名名时，保存修改前的原始名称
  } = {};
  menuInitiator: DOMRect | undefined;
  isOpen = false;

  showContextMenu(evtObj: any) {
    const evt = evtObj.evt;
    const item = evtObj.item;
    if(this.fobiddenContextMenu()) {
      return;
    }
    evt.preventDefault(); // 阻止默认右键菜单
    evt.stopPropagation(); //事件阻止冒泡（stop propagation），阻止事件继续向父级传播，从而避免父元素的 contextmenu 被触发
    if(this.dataType() == 'subData') {  //如果事件是发生在子树上，则需要递归向上，一直递归到根树上再处理
      this.showContextMenuClick.emit(evtObj)
      return;
    }

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
    resetRenameStatus(this.data())
    this.isOpen = true;
    this.currentContextMenuEvt = {
      currentTargetEvt: evt.currentTarget,
      clientX: evt.clientX,
      clientY: evt.clientY
    };
    if(item) {
      if(item['parentItem']) {
        const dataId = item['parentItem']['id'];
        const filterNode = findNodeById(this.data(), dataId);
        if (filterNode) {
          // right click on child item
          this.currentContextMenuEvt['item'] = item;
          this.currentContextMenuEvt['parentItem'] = filterNode;
        }
      } else {
        // right click on parent item
        this.currentContextMenuEvt['item'] = item;
      }
    } else {
      // right click on empty area
      this.currentContextMenuEvt['item'] = NoN_SELECTION;
    }
  }

  menuSelectAction(action: string) {
    this.currentContextMenuEvt['action'] = action;
    let current = this.currentContextMenuEvt;
    
    if (action == 'Upload') {
      // 处理上传功能 - 所有上传都使用ZIP压缩方式
      this.handleZipUpload(current.item);
    } else if (action == 'Delete') {
      if (current.item && current.parentItem) {
        current.parentItem.children = current.parentItem.children.filter((val: any) => val.id != current.item.id)
      }
      if (current.item && !current.parentItem) {
        const tempData = this.data().filter((val: any) => val.id != current.item.id)
        this.data.set(tempData)
      }

      this.menuItemAction.emit({
        action: action,
        target: current
      })
    } else if (action == 'Rename') {
      current.item['rename'] = true;
      current.rawLabel = current.item.label;

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
      let toUpdateNodes = current.parentItem ? current.parentItem.children : this.data()
      const index = toUpdateNodes.findIndex((dataval: any) => dataval.id === current.item.id);
      if (index !== -1) {
        const copyObj = JSON.parse(JSON.stringify(current.item))
        copyObj['id'] = this.uuid()
        toUpdateNodes.splice(index + 1, 0, copyObj);
        current.item['isActive'] = false
      }
      this.menuItemAction.emit({
        action: action,
        target: this.currentContextMenuEvt
      })
    } else if (action == 'NewApi' || action == 'NewFile' || action == 'NewFolder') {
      this.menuItemAction.emit({
        action: action,
        target: current['item']!= NoN_SELECTION ? current['item'] : NoN_SELECTION
      })
    } else if (action == 'Share') {
      this.menuItemAction.emit({
        action: action,
        target: current['item']
      })
    }
    this.closeMenu();
  }

  /**
   * 处理ZIP压缩上传功能 - 统一处理单个文件和文件夹
   */
  async handleZipUpload(item: AstTreeNode) {
    try {
      // 显示上传进度提示
      console.log('开始压缩文件...');

      // 创建一个新的ZIP实例
      const zip = new JSZip();

      if (item.nodeType === 'file') {
        // 单个文件：直接添加文件到ZIP
        await this.addFileToZip(zip, item, '');
      } else if (item.nodeType === 'folder') {
        // 整个文件夹：递归添加所有文件到ZIP
        await this.addFolderToZip(zip, item, item.label);
      }

      // 生成ZIP文件
      const zipBlob = await zip.generateAsync({ type: 'blob' }, (metadata: any) => {
      });

      // 创建ZIP文件对象
      const zipFile = new File([zipBlob], `${item.label}.zip`, { type: 'application/zip' });

      // 上传ZIP文件
      const directoryPath = this.generateDirectoryPath(item);
      await this.uploadFileToServer(zipFile, directoryPath);
      
      console.log(`ZIP文件上传成功: ${item.label}.zip`);
      this.menuItemAction.emit({ type: 'upload-success', message: `成功上传: ${item.label}.zip` });
    } catch (error: any) {
      console.error('ZIP压缩或上传失败:', error);
      this.menuItemAction.emit({ type: 'upload-error', message: `ZIP压缩或上传失败: ${error.message}` });
    }
  }

  /**
   * 将单个文件添加到ZIP中
   */
  async addFileToZip(zip: JSZip, fileNode: AstTreeNode, folderPath: string): Promise<void> {
    if (!fileNode.folderHandle) {
      console.error('No folderHandle for file node');
      return;
    }

    try {
      const fileHandle = fileNode.folderHandle as unknown as FileSystemFileHandle;
      const file = await fileHandle.getFile();
      const content = await file.arrayBuffer();
      
      // 构造文件在ZIP中的路径
      const filePath = folderPath ? `${folderPath}/${fileNode.label}` : fileNode.label;
      zip.file(filePath, content);
    } catch (error) {
      console.error('Error adding file to zip:', error);
      throw error;
    }
  }

  /**
   * 将整个文件夹递归添加到ZIP中
   */
  async addFolderToZip(zip: JSZip, folderNode: AstTreeNode, folderPath: string): Promise<void> {
    if (folderNode.children) {
      for (const child of folderNode.children) {
        if (child.nodeType === 'file') {
          // 文件节点：直接添加到ZIP
          await this.addFileToZip(zip, child, folderPath);
        } else if (child.nodeType === 'folder') {
          // 文件夹节点：递归处理
          const childFolderPath = `${folderPath}/${child.label}`;
          await this.addFolderToZip(zip, child, childFolderPath);
        }
      }
    }
  }

  /**
   * 生成目录路径
   */
  generateDirectoryPath(node: AstTreeNode): string {
    // 从根节点开始查找节点的完整路径
    const pathSegments: string[] = [];
    
    // 查找节点的完整路径
    const found = this.findNodePath(this.data(), node.id, pathSegments);
    
    if (found && pathSegments.length > 0) {
      // 移除最后一个元素（即当前文件名），只保留目录路径
      pathSegments.pop();
      return pathSegments.join('/');
    }
    
    return '';
  }

  /**
   * 查找节点路径
   */
  private findNodePath(nodes: AstTreeNode[], targetId: string, pathSegments: string[]): boolean {
    for (const node of nodes) {
      if (node.id === targetId) {
        pathSegments.push(node.label);
        return true;
      }
      
      if (node.children && node.children.length > 0) {
        // 先将当前节点加入路径
        const currentPathLength = pathSegments.length;
        pathSegments.push(node.label);
        
        // 在子节点中查找
        if (this.findNodePath(node.children, targetId, pathSegments)) {
          return true;
        }
        
        // 如果没找到，回退路径
        pathSegments.splice(currentPathLength);
      }
    }
    
    return false;
  }

  /**
   * 将文件上传到服务器
   */
  async uploadFileToServer(file: File, directoryPath: string): Promise<void> {
    const chunkSize = 1024 * 1024 * 10; // 10MB per chunk
    const totalChunks = Math.ceil(file.size / chunkSize);
    const fileId = this.generateUUID();
    const userId = this.coreService.userData?.username || '';

    // 先获取文件的完整字节数组
    const fileBytes = new Uint8Array(await file.arrayBuffer());

    // 准备表单数据并分块上传
    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      const chunk = fileBytes.slice(start, end);

      // 创建Blob对象来模拟文件片段
      const chunkBlob = new Blob([chunk]);
      
      const formData = new FormData();
      formData.append('chunk', chunkBlob, `${file.name}.part${i}`);
      formData.append('fileId', fileId);
      formData.append('chunkIndex', i.toString());
      formData.append('totalChunks', totalChunks.toString());
      formData.append('fileName', file.name);
      formData.append('fileSize', file.size.toString());
      formData.append('userId', userId);
      formData.append('directoryPath', directoryPath);

      try {
        const response = await this.http.post('/user/api/chunk/upload', formData, {
          reportProgress: true,
          observe: 'events'
        }).toPromise();

        // 可以在这里添加进度提示
        
      } catch (error) {
        console.error(`Error uploading chunk ${i+1} of file ${file.name}:`, error);
        throw error;
      }
    }
  }

  /**
   * 生成UUID
   */
  private generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c == 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  closeMenu() {
    this.isOpen = false;
  }

  // 实时监听内容变化（可选）
  onContentChange(evt: any) {
    const editable = evt.currentTarget;
    const newContent = editable.innerText;
    // 注意：此时不要直接赋值给 item.label，否则会触发变更检测导致光标跳动
  }

  // 编辑结束（blur 时保存）
  outOfRename(evtObj: any) {
    if(this.dataType() == 'subData') {  //如果事件是发生在子树上，则需要递归向上，一直递归到根树上再处理
      this.outOfRenameClick.emit({
        evt: evtObj.evt,
        item: evtObj.item
      })
      return;
    }
    if (evtObj.item.rename) {
      const editable = evtObj.evt.currentTarget;
      const newLabel = editable.innerText.trim();
      // 防止空值或仅空白
      if (newLabel) {
        evtObj.item.label = newLabel;
      }
      evtObj.item['saved'] = true;
      evtObj.item.rename = false; // 退出编辑模式
      window.getSelection()?.removeAllRanges();

      if(newLabel == '' || newLabel == null) {
        if(this.currentContextMenuEvt['action'] && this.currentContextMenuEvt['action'].includes('New')) {
          if (this.currentContextMenuEvt['item'] == NoN_SELECTION) {
            this.data().splice(0, 1)
          } else {
            const parentItem = evtObj.item.parentItem;
            const target = findNodeById(this.data(), parentItem.id);
            if(target) {
              target.children.splice(0, 1)
            }
          }
        } else if(this.currentContextMenuEvt['action'] === 'Rename'){
           editable.innerText = this.currentContextMenuEvt.rawLabel;
          //  evtObj.item.label = this.currentContextMenuEvt.rawLabel;  //恢复原始名称
        }
      }
      this.menuItemAction.emit("Rename")
    }
  }

  selectAllText(el: HTMLElement) {
    const range = document.createRange();
    const selection = window.getSelection();

    // 选择整个元素的内容
    range.selectNodeContents(el);
    
    // 清除现有选区并添加新选区
    selection?.removeAllRanges();
    selection?.addRange(range);

    // 确保元素获得焦点（有些浏览器需要）
    el.focus();
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

export enum ResetType {
  brother,
  deepIn, 
  onlyResetFolder
}

export function reset(data: Array<AstTreeNode>, resetType?: ResetType): void {
  for (let index = 0; index < data.length; index++) {
    const dataItem = data[index];

    delete dataItem.hideActiveStatus;
    if(dataItem.children?.length) {
      resetHideActiveStatus(dataItem.children);
    }

    // 根据 resetType 决定是否重置当前节点的 isActive
    if (resetType === ResetType.onlyResetFolder) {
      if (dataItem.nodeType === 'folder') {
        dataItem.isActive = false;
      }
    } else {
      // brother 或 deepIn 或 undefined：都重置当前节点
      dataItem.isActive = false;
    }

    // 决定是否递归子节点
    if (
      (resetType == null || resetType === ResetType.deepIn) &&
      dataItem.children?.length
    ) {
      reset(dataItem.children, resetType);
    } else if (
      resetType === ResetType.onlyResetFolder &&
      dataItem.children?.length
    ) {
      // onlyFolder 也需要递归，以便找到深层的 folder 节点
      reset(dataItem.children, resetType);
    }
    // 注意：ResetType.brother 不递归（当前层级处理完就结束）
  }
}

function resetHideActiveStatus(data: Array<AstTreeNode>) {
  for (let index = 0; index < data.length; index++) {
    const dataItem = data[index];

    delete dataItem.hideActiveStatus;
    if(dataItem.children?.length) {
      resetHideActiveStatus(dataItem.children);
    }
  }
}

function resetRenameStatus(data: Array<AstTreeNode>) {
  for (let index = 0; index < data.length; index++) {
    const dataItem = data[index];

    delete dataItem.rename;
    if(dataItem.children?.length) {
      resetRenameStatus(dataItem.children);
    }
  }
}

export function findNodeById(nodes: AstTreeNode[], targetId: string, deepIn: boolean = true): AstTreeNode | undefined {
  for (const node of nodes) {
    if (node.id === targetId) {
      return node;
    }
    if(deepIn) {
      if (node.children && node.children.length > 0) {
        const found = findNodeById(node.children, targetId);
        if (found) {
          return found;
        }
      }
    }
  }
  return undefined;
}

export function findActiveNode(nodes: AstTreeNode[], targetNodeType?: TargetTreeNodeType, defaultNode?: AstTreeNode): AstTreeNode | undefined {
  for (const node of nodes) {
    if(targetNodeType == null || targetNodeType != 'exclude-folder') {
      if (node.isActive) {
        return node;
      }
      if (node.children && node.children.length > 0) {
        const found = findActiveNode(node.children, targetNodeType);
        if (found) {
          return found;
        }
      }
    } else {
      if (node.isActive && node.nodeType != 'folder') {
        return node;
      }
      if (node.children && node.children.length > 0) {
        const found = findActiveNode(node.children, targetNodeType);
        if (found) {
          return found;
        }
      }
    }

  }
  return defaultNode  //如果未找到，则返回指定的默认节点
}

export function deleteParentItemRef(parentItemCopy: any) {
  ['children', //子节点的父节点引用不包含子节点数据，避免循环引用导致数据无法序列化
    'isExpanded',
    'isNewData',
    'content',
    'isActive',
    'hideActiveStatus'
  ]
  .forEach(k => delete parentItemCopy[k]);
}

/**
 * 构建 id 到节点对象的映射（深度优先）
 */
function buildIdToNodeMap(nodes: AstTreeNode[], map = new Map()) {
  for (const node of nodes) {
    map.set(node.id, node);
    if (Array.isArray(node.children)) {
      buildIdToNodeMap(node.children, map);
    }
  }
  return map;
}

/**
 * 根据 item，在 datas 中向上展开所有祖先节点（设置 isExpanded = true）
 * @param {Object} item - 当前项（需包含 parentItem 链）
 * @param {Array} datas - 完整的树形数据（会被原地修改）
 */
export function expandAncestorsIfActive(item: AstTreeNode, datas: AstTreeNode[]) {
  //如果父节点不存在，则直接退出
  if(!item.parentItem) {
    return;
  }
  // 如果 item 不活跃，直接返回
  if (!item?.isActive) {
    return;
  }

  // 构建 id -> node 映射
  const idMap = buildIdToNodeMap(datas);

  // 从 item 的直接父节点开始向上遍历
  let currentParentId = item.parentItem?.id;

  while (currentParentId) {
    const node = idMap.get(currentParentId);
    if (!node) break; // 父节点不存在（理论上不应发生）

    // 展开当前祖先节点
    node.isExpanded = true;

    // 继续向上找父节点
    currentParentId = node.parentItem?.id;
  }
}


  /**
   * 提取对象的父级属性
   * @param obj 
   * @returns 
   */
export function pickParentObject(obj: any) {
  const keys = ['deepLevel', 'id', 'label', 'nodeType']
  return pick(obj, keys);
}

  /**
   * 提取对象的指定属性
   * @param obj 
   * @param keys 
   * @returns 
   */
export function pick(obj: any, keys: string[]) {
  const result: any = {};
  for (const key of keys) {
    if (obj.hasOwnProperty(key)) {
      result[key] = obj[key];
    }
  }
}