import { AfterViewInit, Component, EventEmitter, OnChanges, OnDestroy, OnInit, Output, SimpleChanges, computed, inject, model, output, resource, signal, viewChild } from '@angular/core';
import { CoreService } from '../../core.service';
import { AstApiComponent } from '../../shared/ast-api/ast-api.component';
import { AstTabComponent } from '../../shared/ast-tab/ast-tab.component';

import { FormsModule } from '@angular/forms';
import { AstTabGroupComponent } from '../../shared/ast-tab/ast-tab-group/ast-tab-group.component';

import { file, write } from 'opfs-tools';
import { AstTreeComponent, pickParentObject, expandAncestorsIfActive, findActiveNode, findNodeById, reset, ResetType, generateDirectoryPath } from '../../shared/ast-tree/ast-tree.component';
import { AddProjectComponent } from '../add-project/add-project.component';
import { AstDraggableComponent } from '../../shared/ast-draggable/ast-draggable.component';
import { AstTreeNode, NoN_SELECTION } from '../../shared/model';
import { ExplorerComponent } from '../../shared/explorer/explorer.component';
import { ShareOnComponent } from '../share-on/share-on.component';
import { MyConfigService } from '../../my-config.service';
import { AutoSaver } from '../../auto-saver';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { NoteBookComponent } from '../../shared/notebook/notebook.component';
import { NodeDef } from '@luxio/common';
import { NotificationService } from '../../shared/notification/notification.service';

interface WebSocketRequest {
  action: string;
  objectKey: string;
  requestId?: string;
}

interface WebSocketResponse {
  type: string;
  success: boolean;
  requestId?: string;
  objectKey?: string;
  fileName?: string;
  contentType?: string;
  size?: number;
  data?: string; // Base64 encoded data
  message?: string;
}

@Component({
  selector: 'div[ast-content]',
  templateUrl: './content.component.html',
  styleUrls: ['./content.component.css'],
  standalone: true,
  imports: [FormsModule,ExplorerComponent, AstTabGroupComponent, AstTabComponent, AstApiComponent, AstTreeComponent, AddProjectComponent, ShareOnComponent,
    NoteBookComponent
  ]
})
export class ContentComponent extends AstDraggableComponent implements OnInit, OnChanges, AfterViewInit, OnDestroy {
  readonly sideOpen = model<boolean>(true);
  readonly addProjectComponent = viewChild(AddProjectComponent);
  readonly currentDisplayViewId = model<number>(1);
  private myConfigService = inject(MyConfigService)
  private coreService = inject(CoreService);
  private notificationService = inject(NotificationService);

  // lock state for the entire content, which can be set based on user permissions or other factors; when true, all nodes are effectively read-only and UI will reflect this state
  isLocked: boolean = false;

  /***aside */
  serverList: Array<any> = [];
  dataList= signal<Array<AstTreeNode>>([]);
  // folder persistence mode
  folderReadWriteMode: 'read' | 'readwrite' = 'read';
  /***aside */

  /** event emitted when selected node's file type changes */
  @Output() fileTypeChange = new EventEmitter<string>();
  dataListChangeOutput = output<Array<AstTreeNode>>();

  // 添加自动刷新控制变量
  autoRefreshEnabled = signal<boolean>(true);
  refreshIntervalMs = 10; // 后续如果有必要，从2秒改为10秒，减少性能影响

  openedList = signal<Array<any>>([]);

  addMarkFile = false;
  newFileName: string = '';
  searchKeyword = ''
  searchResults = ''

  moreButtons = [
    { label: 'more', action: 'hori-more' },
  ];

  private savers: AutoSaver[] = [];
  
  // 添加WebSocket连接管理
  private wsConnection: WebSocket | null = null;
  private pendingRequests = new Map<string, (response: WebSocketResponse) => void>();
  
  // 添加自动刷新定时器
  private refreshIntervalId: any = null;

  userResource = resource({
    // Define a reactive comput`tion.
    // The params value recomputes whenever any read signals change.
    params: () => (this.dataList().length === 0),
    // Define an async loader that retrieves data.
    // The resource calls this function every time the `params` value changes.
    loader: ({ params, previous }) => {
      if(previous.status === 'idle') {
        //When reload page, set the resolved result to undefined, so that the UI will not show the previous data before the new loading is completed.  in a more realistic example, the loader would likely use the params value to fetch different data, and we would want it to run on every params change.  but for this demo, we only want to run it once on initial load, so we check if the previous status is 'idle' before deciding to return the params or undefined.
        // only load on initial call, not on subsequent param changes, since our loader doesn't actually need the params value to do anything.  in a more realistic example, the loader would likely use the params value to fetch different data, and we would want it to run on every params change.
        return Promise.resolve(undefined)
      }
      return Promise.resolve(params)
    },
  });
  // Create a computed signal based on the result of the resource's loader function.
  showButtonPlaceholder = computed(() => {
    if (this.userResource.hasValue() && this.userResource.status() === 'resolved') {
      // `hasValue` serves 2 purposes:
      // - It acts as type guard to strip `false` from the type
      // - If protects against reading a throwing `value` when the resource is in error state
      return this.userResource.value();
    }
    // fallback in case the resource value is `false` or if the resource is in error state
    return false;
  });

  async ngOnInit() {
    const doc = this.myConfigService.getDoc();
    if (doc == null || doc === undefined) {
      setTimeout(() => {
        this.dataList.set([]);
      }, 0); // simulate async loading delay
      return;
    }
    let docObj: any = doc;
    if (typeof doc === 'string') {
      docObj = JSON.parse(doc);
    } else if (typeof doc === 'object') {
      docObj = doc;
    } else if (typeof doc === 'function') {
      const result = doc();
      docObj = this.isPromiseLike(result) ? (await result) : result;
    }

    if ('openapi' in docObj && 'paths' in docObj) { //OpenApiV3Document
      const ospecFileName = this.coreService.removeExtension(this.myConfigService.getFileName() || 'Default') + '.ospec'
      let data: AstTreeNode = this.createNewFile(docObj, ospecFileName);
      this.assignDeepLevel([data]);
      this.dataList.set([data]);
    } else if ('dataList' in docObj || 'openedList' in docObj) { //DocModel
      // Restore folderHandles from IndexedDB for both dataList and openedList and set them only once
      const dataListWithHandles = await this.restoreHandles(docObj.dataList || []);
      const openedListWithHandles = await this.restoreHandles(docObj.openedList || []);
      this.dataList.set(dataListWithHandles);
      this.openedList.set(openedListWithHandles);
    } else if ('profile' in docObj) { //NodeDef
      this.dataList.set(docObj.profile ? [JSON.parse(docObj.profile)] : []);
      this.isLocked = docObj.isLocked;
      if (docObj.isLocked) {
        // 可选：标记模型为只读
        this.dataList().forEach(node => node.isLocked = true);
      }

      this.dataListChangeOutput.emit(this.dataList());
    }
    if (Object.keys(docObj).length === 0) {
      this.dataList.set([]);
    }

    // 启动自动刷新功能
    // this.startAutoRefresh();
    
    // 启动自动保存
    // this.startAutoSave();
  }

  // 确保组件销毁时清理定时器
  ngOnDestroy(): void {
    // 停止自动刷新
    // this.stopAutoRefresh();
    
    // 一次性停止所有自动保存
    // this.savers.forEach(saver => saver.stop());
    this.savers = [];
    
    // 关闭WebSocket连接
    if (this.wsConnection) {
      this.wsConnection.close();
      this.wsConnection = null;
    }
  }

  // 初始化WebSocket连接
  private initWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.wsConnection && this.wsConnection.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      // 创建WebSocket连接
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/api/storage/ws`;
      this.wsConnection = new WebSocket(wsUrl);

      this.wsConnection.onopen = () => {
        console.log('Connected to storage WebSocket');
        resolve();
      };

      this.wsConnection.onclose = (event) => {
        console.log('Disconnected from storage WebSocket:', event);
        // 清空所有待处理的请求
        this.pendingRequests.clear();
      };

      this.wsConnection.onerror = (error) => {
        console.error('WebSocket error:', error);
        reject(error);
      };

      this.wsConnection.onmessage = (event) => {
        try {
          const response: WebSocketResponse = JSON.parse(event.data);
          if (response.requestId && this.pendingRequests.has(response.requestId)) {
            const callback = this.pendingRequests.get(response.requestId)!;
            callback(response);
            this.pendingRequests.delete(response.requestId);
          }
        } catch (e) {
          console.error('Error parsing WebSocket response:', e);
        }
      };
    });
  }

  // 通过WebSocket发送下载请求
  private async downloadFileViaWebSocket(objectKey: string): Promise<WebSocketResponse> {
    // 确保WebSocket已连接
    if (!this.wsConnection || this.wsConnection.readyState !== WebSocket.OPEN) {
      await this.initWebSocket();
    }

    return new Promise((resolve, reject) => {
      // 生成唯一请求ID
      const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // 创建请求对象
      const request: WebSocketRequest = {
        action: 'download',
        objectKey,
        requestId
      };

      // 存储回调函数
      this.pendingRequests.set(requestId, (response: WebSocketResponse) => {
        if (response.success) {
          resolve(response);
        } else {
          reject(response);
        }
      });

      // 发送请求
      this.wsConnection!.send(JSON.stringify(request));
    });
  }

  // 启动自动刷新
  private startAutoRefresh() {
    if (!this.autoRefreshEnabled()) {
      return; // 如果禁用则不启动
    }
    
    if (this.refreshIntervalId) {
      clearInterval(this.refreshIntervalId);
    }
    
    this.refreshIntervalId = setInterval(async () => {
      if (this.autoRefreshEnabled()) {
        // 只刷新 openedList 中的文件，因为这些是当前打开的文件
        const updatedOpenedList = await this.updateFileContent(this.openedList());
        this.openedList.set(updatedOpenedList);
      }
    }, this.refreshIntervalMs); // 使用可配置的时间间隔
  }

  // 停止自动刷新
  private stopAutoRefresh() {
    if (this.refreshIntervalId) {
      clearInterval(this.refreshIntervalId);
      this.refreshIntervalId = null;
    }
  }

  // 更新节点列表中文件节点的内容
  private async updateFileContent(nodes: any[]): Promise<any[]> {
    const updateNodes = async (node: any): Promise<any> => {
      const result: any = { ...node };
      
      // 如果是文件节点且有 folderHandle，则更新内容
      if (result.nodeType === 'file' && result.folderHandle && result.folderHandle.kind === 'file') {
        await this.addProjectComponent()?.setTextContextToNode(result.folderHandle.name, result.folderHandle, result);
      }
      
      // 递归处理子节点
      if (result.children) {
        result.children = await Promise.all(result.children.map(updateNodes));
      }
      
      return result;
    };
    
    return await Promise.all(nodes.map(updateNodes));
  }

  // Restore folderHandles from IndexedDB
  private async restoreHandles(nodes: any[]): Promise<any[]> {
    const restoreHandles = async (node: any): Promise<any> => {
      const result: any = { ...node };
      
      // Restore folderHandle if there's a key reference
      if (node.folderHandleKey) {
        try {
          const handle: any = await this.coreService.idbGet(node.folderHandleKey);
          if (handle) {
            result.folderHandle = handle;
            
            // If this is a file node, refresh its content from the file system
            if (result.nodeType === 'file' && handle.kind === 'file') {
              await this.addProjectComponent()?.setTextContextToNode(handle.name, handle, result);
            }
          }
          // Remove the temporary key reference
          // delete result.folderHandleKey;
        } catch (error) {
          console.warn(`Could not restore handle for key: ${node.folderHandleKey}`, error);
        }
      }
      
      // Process children recursively
      if (result.children) {
        result.children = await Promise.all(result.children.map(restoreHandles));
      }
      
      return result;
    };
    
    return await Promise.all(nodes.map(restoreHandles));
  }

  ngOnChanges(changes: SimpleChanges): void {
  }

  private startAutoSave() {
    const dataSaver = new AutoSaver(
      '/dir/file.txt',
      () => JSON.stringify(this.dataList()),
      5000
    );
    dataSaver.start();
    this.savers.push(dataSaver);

    const openListSaver = new AutoSaver(
      '/dir/openedList.txt',
      () => JSON.stringify(this.openedList()),
      5000
    );
    openListSaver.start();
    this.savers.push(openListSaver);
  }

  isPromiseLike(obj: any): boolean {
    return (
      obj !== null &&
      obj !== undefined &&
      typeof obj.then === 'function' &&
      typeof obj.catch === 'function' // 可选，用于区分标准 Promise
    );
  }

  newNodeAction(currentSelect: any, action: string) {
    if (this.isLocked) {
      // ignore attempts to modify when in read-only mode
      console.warn('read-only mode: action', action, 'blocked');
      return;
    }
    let newNode;
    if (currentSelect) {
      delete currentSelect.isNewData;//子节点的父节点不维护是否新添加节点这个状态
      currentSelect.isExpanded = true
      const parentItemCopy = pickParentObject(currentSelect);

      if (action == 'NewApi') {
        newNode = this.createNewApi();
      } else if (action == 'NewFile') {
        newNode = this.createNewFile();
      } else if (action == 'NewFolder') {
        newNode = this.createNewFolder();
      }
      if(newNode) {
        newNode['deepLevel'] = currentSelect.deepLevel + 1;
        newNode['rename'] = true;
        newNode['parentItem'] = parentItemCopy;
        currentSelect.children.splice(0, 0, newNode);
      }
    } else {
      if(action == 'NewFolder') {
        newNode = this.createNewFolder();
        newNode['rename'] = true;
        const newDatas = [
          newNode,
          ...this.dataList(),
        ]
        this.dataList.set(newDatas);
      }
    }

    //set node active
    const activeNode = findActiveNode(this.dataList(), 'exclude-folder');
    if(newNode && action == 'NewFolder') {
      reset(this.dataList(), ResetType.onlyResetFolder)
      newNode['isActive'] = true;
      if (activeNode) {
        activeNode['hideActiveStatus'] = true;
      }
    } else {
      reset(this.dataList())
      if(newNode) {
        newNode['isActive'] = true;
      }
    }
  }

  assignDeepLevel(nodes: AstTreeNode[], level: number = 0): void {
    for (const node of nodes) {
      if(!node.deepLevel) {
        node.deepLevel = level; // 设置当前层级
      }
      if (node.children && node.children.length > 0) {
        this.assignDeepLevel(node.children, node.deepLevel + 1); // 递归处理子节点，层级+1
      }
    }
  }

  private assignDeepParent(evt: AstTreeNode[]) {
    for (let index = 0; index < evt.length; index++) {
      const dataItem = evt[index];
      if (dataItem) {
        const parentItemCopy = pickParentObject(dataItem);
        delete dataItem.isNewData; //子节点的父节点不维护是否新添加节点这个状态

        dataItem.children = dataItem.children || [];
        dataItem.children.forEach((child: any) => {
          child['parentItem'] = parentItemCopy;
        });

        this.assignDeepParent(dataItem.children);
      }
    }
  }

  importBtn(evt: any) {
    this.openAddDlg();
  }
  LocationBtn(evt: any) {

  }
  ExpandBtn(evt: any) {
    
  }
  CollapseBtn(evt: any) {
    const datas = this.dataList();
    datas.forEach(ele => ele.isExpanded = false);
    this.dataList.update(value => [...datas])
  }
  MoreBtn(evt: any) {

  }

  async openFolderInContent(mode: 'read' | 'readwrite' = 'read') {
    // Delegate folder selection and tree building to the AddProjectComponent
    const addProject = this.addProjectComponent();
    if (!addProject) {
      console.warn('AddProjectComponent not available');
      return;
    }

    // ensure environment supports picker
    if (!('showDirectoryPicker' in window)) {
      this.notificationService.showNotification('The File System Access API is not supported in this browser.', 'error');
      return;
    }

    try {
      // Reuse AddProjectComponent.openFolder which populates its folderHandle
      // and directoryTreeData using its own buildTreeFromDirectory implementation.
      await addProject.openFolder(mode as any);
      // grab the results from the child component
      const rootNode: Array<AstTreeNode> = (addProject as any).directoryTreeData || [];

      this.assignDeepLevel(rootNode);
      this.assignDeepParent(rootNode);
      this.dataList.set(rootNode);
      try { await this.storeApi(); } catch (e) { console.warn('storeApi failed', e); }
    } catch (err) {
      console.error('openFolderInContent error', err);
    }
  }

  async openFileInContent() {
    const addProject = this.addProjectComponent();
    if (!addProject) {
      console.warn('AddProjectComponent not available');
      return;
    }
    // Try native file picker first
    try {
      if ('showOpenFilePicker' in window) {
        await addProject.openFileInContent();
        const rootNode: Array<AstTreeNode> = (addProject as any).directoryTreeData || [];

        this.assignDeepLevel(rootNode);
        this.assignDeepParent(rootNode);
        this.dataList.set(rootNode);
        try { await this.storeApi(); } catch (e) { console.warn('storeApi failed', e); }
        return;
      }
    } catch (err) {
      console.warn('showOpenFilePicker failed or unsupported', err);
    }

    // Fallback: use hidden input element
    try {
      const input: HTMLInputElement = document.createElement('input');
      input.type = 'file';
      input.accept = '*/*';
      input.onchange = async (ev: any) => {
        const file = ev.target.files && ev.target.files[0];
        if (!file) return;
        const name = file.name;
        const isBinary = /\.(exe|dll|bin|dat|jpg|jpeg|png|gif|zip|7z|rar|tar|gz|iso)$/i.test(name);
        let content = '';
        if (!isBinary) {
          try { content = await file.text(); } catch (e) { console.warn('fallback read failed', e); }
        }
        const node: AstTreeNode = {
          id: this.uuid(),
          label: name,
          nodeType: 'file',
          content: content,
          children: [],
          mode: 'read'
        } as any;
        this.assignDeepLevel([node]);
        this.dataList.set([node]);
        try { await this.storeApi(); } catch (e) { console.warn('storeApi failed', e); }
      };
      // trigger
      input.click();
    } catch (err) {
      console.error('openFileInContent fallback error', err);
    }
  }

  async listClick(evt: any) {
    if (evt['nodeType'] != 'bookmark' && evt['nodeType'] != 'api'&& evt['nodeType'] != 'file') {
      return;
    }

    const item = evt;

    // determine and emit file type for display
    let type = '';
    if (item.nodeType === 'file') {
      const idx = item.label.lastIndexOf('.');
      type = idx >= 0 ? item.label.substring(idx + 1) : '';
    } else {
      type = item.nodeType || '';
    }
    this.fileTypeChange.emit(type);

    if (item.nodeType == 'file' && item.label.endsWith('.ospec')) {
      const apiData = this.coreService.parseOpenApiSpec(JSON.parse(item.content || ''));
      item.children = apiData;
      item.isExpanded = true;
      item.isParsed = true;
      item.servers = apiData.length > 0 ? (apiData[0]['folderInfo'] != null ? apiData[0]['folderInfo']['servers'] : []) : []
      this.assignDeepLevel([item])
    }

    this.openTab(item);
  }

  public async openTab(targetTab: any) {
    let oldTab = false;
    const openeds = this.openedList()
    reset(openeds);

    const findNode = findNodeById(this.openedList(), targetTab.id, false);
    const originNode = findNodeById(this.dataList(), targetTab.id);
    if (findNode) {
      findNode['isActive'] = true;
      oldTab = true;
    }
    if(originNode) {
      originNode!['isActive'] = true;
    }

    if (!oldTab) {
      targetTab["isActive"] = true;

      await this.refreshNodeContent(targetTab);
      openeds.push(targetTab);
      this.openedList.update(value => [...openeds]);
    }
  }

  /**
   * Refreshes the content of a node in the UI
   * @param targetTab 
   */
  private async refreshNodeContent(targetTab: any) {
    const handle = targetTab.folderHandle;
    if (targetTab.nodeType === 'file' && handle && handle.kind === 'file') {
      // If this is a file node, refresh its content from the file system
      await this.addProjectComponent()?.setTextContextToNode(handle.name, handle, targetTab);

    } else if (targetTab.nodeType === 'file' && (!handle || Object.keys(handle).length === 0)) {
      // this can happen for files that were created in-app and haven't been saved to disk yet; they won't have a handle until they're saved, so we can just initialize their content to an empty string
      //Fetch from server if it's a shared tree and the file content is missing, since in that case the file was likely created by another user and won't have a handle in this user's browser until it's saved back to disk at least once
      const filePathUrl = generateDirectoryPath(this.dataList(), targetTab);
      const objectKey = `${this.coreService.userData?.username || 'Anonymous'}/${filePathUrl}`;

      try {
        // 使用WebSocket下载文件
        const response = await this.downloadFileViaWebSocket(objectKey);

        if (!this.coreService.isBinaryName(targetTab.label)) {
          // 解码Base64数据
          const binaryData = atob(response.data!);
          const bytes = new Uint8Array(binaryData.length);
          for (let i = 0; i < binaryData.length; i++) {
            bytes[i] = binaryData.charCodeAt(i);
          }
          const blob = new Blob([bytes], { type: response.contentType });
          const textContent = await blob.text();
          targetTab.content = textContent;
        } else {
          targetTab.content = 'Binary file - content not loaded';
        }
      } catch (error: any) {
        if (error.success === false && error.message == 'File not found') {
          targetTab.isDeleted = true; // mark as deleted in UI so user knows it's missing, but keep it visible in case they want to try saving it again which would recreate it on the server
          console.warn('file not found on server for path ', filePathUrl);
        } else {
          console.warn('failed to fetch file content from server via WebSocket for path ', filePathUrl, error);
        }
      }
    }
  }

  async apiSelected(evt: Array<AstTreeNode>) {
    this.assignDeepLevel(evt);
    this.assignDeepParent(evt);
    this.dataList.update(value => value.concat(evt));
    // persist snapshot to OPFS for later restoration
    // try {
    //   const snapshot = { name: evt.folderHandle?.name || rootName, mode: evt.mode, tree: evt.tree || [] };
    //   await this.saveFolderSnapshotToOPFS(snapshot);
    // } catch (err) {
    //   console.warn('failed to persist folder snapshot to OPFS', err);
    // }

    this.storeApi();
    this.currentDisplayViewId.set(1);
    this.sideOpen.set(true);
  }

  async storeApi() {
    if (this.isLocked) {
      return; // don't persist in read-only mode since the data may be shared across multiple users and we don't want one user's edits to overwrite another's; we can consider implementing a separate "Save As" flow for read-only/shared trees if there's demand for it
    }
    
    // Extract and store folderHandles in IndexedDB, replacing them with identifiers in the serialized data
    const extractHandles = async (node: any): Promise<any> => {
      const result: any = { ...node };
      
      // Store folderHandle if it exists
      if (node.folderHandle) {
        // Generate a unique key for the handle
        const handleKey = `handle_${node.id}`;
        await this.coreService.idbPut(handleKey, node.folderHandle);
        // Replace the handle with its key reference
        node.folderHandleKey = handleKey;

        result.folderHandleKey = handleKey;
        delete result.folderHandle;
      }
      
      // Process children recursively
      if (result.children) {
        result.children = await Promise.all(result.children.map(extractHandles));
      }
      
      return result;
    };

    const processedDataList = await Promise.all(this.dataList().map(extractHandles));

    // write to OPFS
    await write('/dir/file.txt', JSON.stringify(processedDataList));
  }

  async storeOpenedList() {
    if(this.isLocked) {
      return; // don't persist opened list in read-only mode since it may be shared across multiple users and we don't want one user's tab actions to affect others
    }
    // --------- Create / Write ---------
    // await dir('/test-dir').create(); // create a directory
    await write('/dir/openedList.txt', JSON.stringify(this.openedList()));
    // await write('/dir/api.txt', this.dataList); // empty file
    // --------- Remove ---------
    // await dir('/test-dir').remove();

    // await file('/dir/file.txt').remove();
  }

  saveApi(evt: any) {
    const data: any = {
      id: this.uuid(),
      label: "New Collection",
      children: [evt],
      isExpanded: true
    }
    this.dataList().push(data)

    this.storeApi()
  }

  async saveText(evt: any) {
    if (this.isLocked) {
      console.warn('read-only mode: cannot save text');
      return;
    }
    // if the tab corresponds to a file from an imported folder and has a handle,
    // attempt to write the updated content back to disk when in write mode
    if (evt.folderHandle && evt.folderHandle.kind === 'file' && evt.mode === 'readwrite') {
      try {
        const writable = await evt.folderHandle.createWritable();
        await writable.write(evt.content || '');
        await writable.close();
      } catch (err) {
        console.error('failed to write file', err);
      }
    } else {
      // 如果没有folderHandle，则通过WebSocket发送editFile请求到服务端
      await this.saveFileToServer(evt);
    }

    this.storeApi();
  }

  // 通过WebSocket保存文件到服务器
  private async saveFileToServer(evt: any) {
    // 确保WebSocket已连接
    if (!this.wsConnection || this.wsConnection.readyState !== WebSocket.OPEN) {
      await this.initWebSocket();
    }

    return new Promise((resolve, reject) => {
      // 生成唯一请求ID
      const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // 计算文件路径
      const filePathUrl = generateDirectoryPath(this.dataList(), evt);
      const objectKey = `${this.coreService.userData?.username || 'Anonymous'}/${filePathUrl}`;

      // 创建请求对象
      const request = {
        action: 'editFile',
        objectKey,
        content: evt.content || '',
        requestId
      };

      // 存储回调函数
      this.pendingRequests.set(requestId, (response: WebSocketResponse) => {
        if (response.success) {
          console.log('File saved to server successfully:', response);
          this.notificationService.showNotification('File saved to server successfully', 'success');
          resolve(response);
        } else {
          console.error('Failed to save file to server:', response.message);
          this.notificationService.showNotification(`Failed to save file: ${response.message}`, 'error');
          reject(new Error(response.message || 'Save failed'));
        }
      });

      // 发送请求
      this.wsConnection!.send(JSON.stringify(request));
    });
  }

  onViewOut(evt: any) {
    this.dataList().push(...evt);
    this.storeApi()
    this.currentDisplayViewId.set(1);
  }

  openAddDlg() {
    const addProjectComponent = this.addProjectComponent();
    if (addProjectComponent) {
      addProjectComponent.openAddDlg();
    }
  }

  public afterClickTab(val: any) {
  }

  public afterCloseTab(val: any) {
  }

  shareOnMenuVisible = false;
  shareData: NodeDef = {};
  menuItemAction(evt: any) {
    // Check if this is an upload success or error notification
    if (evt && evt.type) {
      if (evt.type === 'upload-success') {
        this.notificationService.showNotification(evt.message, 'success');
      } else if (evt.type === 'upload-error') {
        this.notificationService.showNotification(evt.message, 'error');
      }
      return; // Exit early if it's an upload notification
    }

    // guard against modifications when in read-only mode
    const modifyingActions = ['Rename','Delete','Duplicate','NewApi','NewFile','NewFolder'];
    if (this.isLocked && modifyingActions.includes(evt.action)) {
      // ignore edits in read-only state
      return;
    }
    
    if (evt.action == 'Delete') {
      // 删除节点及其后代在IndexedDB中的handle
      this.deleteHandlesForNodeAndDescendants(evt.target.item).then(() => {
        console.log('Handles deleted for node and descendants');
      }).catch(error => {
        console.error('Error deleting handles for node and descendants:', error);
      });
    }
    
    if(evt == 'Rename') {
      this.storeApi()
    }
    if (evt.action == 'Delete' || evt.action == 'Duplicate') {
      this.storeApi()
    }
    if (evt.action == 'NewApi' || evt.action == 'NewFile' || evt.action == 'NewFolder') {
      if (evt.target != NoN_SELECTION) {
        this.newNodeAction(evt.target, evt.action)
      } else {
        this.newNodeAction(null, 'NewFolder')
      }
    }
    if (evt.action == 'Share') {
      this.shareOnMenuVisible = true;
      this.shareData = {};
      this.shareData.name = evt.target.label || "Untitled API"
      this.shareData.username = this.coreService.userData?.username || "Anonymous";

      const copyOfTarget = JSON.parse(JSON.stringify(evt.target))
      // recursively remove the children of any file nodes in the tree that end with '.ospec', since we only want to share the original file content for those files, not the parsed tree
      const traverse = (node: any) => {
        if (node.nodeType === 'file' && node.label.endsWith('.ospec')) {
          node.children = []
          node.isParsed = false;
        } else if (node.nodeType === 'folder') {
          node.children?.forEach((child: any) => traverse(child));
        }
        if (node.nodeType === 'file') {
          delete node.content; // remove file content from shared data to avoid bloating the payload, since the content can be fetched separately by the recipient using the object storage
        }
        delete node.isLocal
      }
      traverse(copyOfTarget);
      this.shareData.profile = JSON.stringify(copyOfTarget) || "";
    }
  }

  ngAfterViewInit(): void {
  }

  addApi(node: string) {
    this.openAddDlg();
  }

  addMarked(node: string) {
    this.addMarkFile = true;
  }

  dragDrop(event: CdkDragDrop<string[]>) {
    moveItemInArray(this.openedList(), event.previousIndex, event.currentIndex);
    this.storeOpenedList()
  }

  onCloseTab(evt: any) {
    let currentIndex = 0;
    let currentActived = evt.isActivated;
    const datas = this.openedList()

    if(evt.closeAction && evt.closeAction == 'close-all') {
      datas.splice(0, datas.length);
    } else if(evt.closeAction && evt.closeAction == 'close-others') {
      for (let index = datas.length -1; index >=0 ; index--) {
        if (datas[index].id != evt.id) {
          datas.splice(index, 1);
        }
      }
    } else {
      for (let index = 0; index < datas.length; index++) {
        if (datas[index].id == evt.id) {
          currentIndex = index;
          datas[currentIndex]["isActive"] = false;//先把要关闭的tab设为非激活状态，因为这个对象在关闭后还会被项目的树形列表使用到
          datas.splice(index, 1);
          break;
        }
      }
      if(currentActived) { //关闭的tab是激活状态，则需要激活其他tab
        if (evt.isFirst) {
          if (datas.length >= 1) {
            datas[0]["isActive"] = true;
          }
        } else if (evt.isLast) {
          if (datas.length >= 1) {
            datas[datas.length - 1]["isActive"] = true;
          }
        } else {
          datas[currentIndex]["isActive"] = true;//close的不是第一个也不是最后一个，则激活后一个， 即中间的某一个
        }
      }
    }

    this.storeOpenedList()
  }

  onClickTab(evt: any) {
    reset(this.dataList())
    const datas = this.openedList()
    for (let index = 0; index < datas.length; index++) {
      if (datas[index].id == evt.id) {
        datas[index]["isActive"] = true
      } else {
        datas[index]["isActive"] = false
      }
    }
    this.storeOpenedList()

    const filterNode = findNodeById(this.dataList(), evt.id)
    if (filterNode) {
      filterNode["isActive"] = true
      // 调用函数
      expandAncestorsIfActive(filterNode, this.dataList());
    }
  }

  onAddNewTab(evt: any) {
    const openedList = this.openedList()
    openedList.forEach(ele => ele.isActive = false);
    const newNode: any = this.createNewFile("", "Untitled")
    newNode['saved'] = false
    newNode.isActive = true;
    openedList.push(newNode)
    this.storeOpenedList()
  }

  private createNewFolder(): AstTreeNode {
    return {
      id: this.uuid(),
      isActive: false,
      isExpanded: false,
      label: "",
      deepLevel: 0,
      nodeType: 'folder',
      rename: true,
      children: []
    };
  }

  private createNewFile(fileContent?: any, defaultName?: string): AstTreeNode {
    if(typeof fileContent === 'object') {
      fileContent = JSON.stringify(fileContent)
    }

    const apiInfo: AstTreeNode = {
      id: this.uuid(),
      label: "",
      nodeType: 'file',
      content: fileContent,
      children: [],
      auth: {}
    }
    if(defaultName) {
      apiInfo.label = defaultName
    }

    return apiInfo;
  }

  private createNewApi(): AstTreeNode {
    const apiInfo: AstTreeNode = {
      id: this.uuid(),
      serviceName: "",
      method: "get",
      symbol: "GET",
      path: "",
      url: "",
      label: "",
      server: "",
      symbolColor: "green",
      nodeType: 'api',
      rawApiInfo: {},
      customQueryparameters: [
        {
          name: '',
          value: ''
        }
      ],
      customHeaderparameters: [
        {
          name: '',
          value: ''
        }
      ],
      requestBody: "",
      response: {},
      children: [],
      auth: {}
    }

    return apiInfo;
  }


  newFileKeyUp(evt: any, newFileName: string) {
    if (evt.keyCode == 13) {
      evt.preventDefault();
      const markedTextInfo: any = {
        id: this.uuid(),
        symbol: "Mark",
        label: newFileName,
        type: 'marked',
        value: "111222333",
        symbolColor: "green",
        isActive: true,
      }
      const datas = this.openedList()
      datas.forEach(ele => ele.isActive = false);
      datas.push(markedTextInfo)
      this.addMarkFile = false;
    }
  }

  searchText() {
    const results = CoreService.fullTextSearch(JSON.stringify(this.createNewApi(), null, 4), this.searchKeyword)
    let rest = []
    for (let index = 0; index < results.length; index++) {
      const element = results[index];
      rest.push(JSON.stringify(element))
    }
    this.searchResults = JSON.stringify(rest)

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

  private isBinaryName(name: string): boolean {
    return /\.(exe|dll|bin|dat|jpg|jpeg|png|gif|zip|7z|rar|tar|gz|iso)$/i.test(name);
  }

  // Folder/file tree building is delegated to AddProjectComponent.
  // See AddProjectComponent.buildTreeFromDirectory for the implementation.

  // snapshot persistence helpers have been removed.
  // Storing a JSON snapshot of FileSystem handles is forbidden; we now
  // simply serialize the tree (including `content`) via `/dir/file.txt`
  // and read handles on the fly when the user re‑selects a folder.


  // Previously we offered the ability to restore a folder snapshot on
  // startup by deserializing the JSON stored under `/dir/folder-snapshot.json`.
  // That mechanism has been removed: we no longer persist handles, and the
  // snapshot file itself is forbidden. All folder data now comes from
  // explicit user actions (e.g. selecting a folder via the picker), and
  // `dataList` is saved only via `storeApi()`.

  getRandomInt(min: number, max: number) {
    min = Math.ceil(min); // 确保最小值是整数  
    max = Math.floor(max); // 确保最大值是整数  
    return Math.floor(Math.random() * (max - min + 1)) + min; // 生成[min, max]之间的随机整数  
  }

  // 切换自动刷新状态
  toggleAutoRefresh() {
    const newState = !this.autoRefreshEnabled();
    this.autoRefreshEnabled.set(newState);
    
    if (newState) {
      this.startAutoRefresh();
    } else {
      this.stopAutoRefresh();
    }
  }

  // 删除节点及其所有后代节点在IndexedDB中的handle
  private async deleteHandlesForNodeAndDescendants(node: any) {
    // 如果节点有folderHandleKey，删除它
    if (node.folderHandleKey) {
      try {
        await this.coreService.idbDelete(node.folderHandleKey);
      } catch (error) {
        console.warn(`Could not delete handle for key: ${node.folderHandleKey}`, error);
      }
    }
    
    // 递归删除子节点的handles
    if (node.children) {
      for (const child of node.children) {
        await this.deleteHandlesForNodeAndDescendants(child);
      }
    }
  }
}