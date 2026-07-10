import { AfterViewInit, Component, EventEmitter, OnChanges, OnDestroy, OnInit, Output, SimpleChanges, computed, inject, model, output, resource, signal, viewChild } from '@angular/core';
import { CoreService } from '../../core.service';
import { AstApiComponent } from '../../shared/ast-api/ast-api.component';
import { AstTabComponent } from '../../shared/ast-tab/ast-tab.component';

import { FormsModule } from '@angular/forms';
import { AstTabGroupComponent } from '../../shared/ast-tab/ast-tab-group/ast-tab-group.component';

import { file, write } from 'opfs-tools';
import {
  AstTreeComponent, assignDeepLevel, pickParentObject, expandAncestorsIfActive, 
  findActiveNode, findNodeById, reset, ResetType, getNodeAbsolutePath, generateDirectoryPath, computeFileIcons } from '../../shared/ast-tree/ast-tree.component';
import { AddProjectComponent } from '../add-project/add-project.component';
import { AstDraggableComponent } from '../../shared/ast-draggable/ast-draggable.component';
import { AstTreeNode, NoN_SELECTION } from '../../shared/model';
import { ExplorerComponent } from '../../shared/explorer/explorer.component';
import { MyConfigService } from '../../my-config.service';
import { AutoSaver } from '../../auto-saver';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { NoteBookComponent } from '../../shared/notebook/notebook.component';
import { NodeDef } from '@luxio/common';
import { NotificationService } from '../../shared/notification/notification.service';
import { AstModalComponent } from '../../shared/ast-modal/ast-modal.component';
import { AstMenuComponent } from '../../shared/ast-menu/ast-menu.component';
import { normalizeApiSpec } from "api-render-ui"
import { LocalAgentService } from '../../shared/local-agent/local-agent.service';
import { FilePickerDialogComponent } from '../../shared/file-picker-dialog/file-picker-dialog.component';

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
  imports: [FormsModule, ExplorerComponent, AstTabGroupComponent, AstTabComponent, AstApiComponent, AstTreeComponent, AddProjectComponent, AstModalComponent, AstMenuComponent,
    NoteBookComponent, FilePickerDialogComponent
  ]
})
export class ContentComponent extends AstDraggableComponent implements OnInit, OnChanges, AfterViewInit, OnDestroy {
  readonly sideOpen = model<boolean>(true);
  readonly addProjectComponent = viewChild(AddProjectComponent);
  readonly filePicker = viewChild(FilePickerDialogComponent);
  readonly currentDisplayViewId = model<number>(1);
  public myConfigService = inject(MyConfigService)
  public coreService = inject(CoreService);
  private notificationService = inject(NotificationService);
  private localAgentService = inject(LocalAgentService);

  // 本地项目检测
  isLocalProject = signal(false);

  // lock state for the entire content, which can be set based on user permissions or other factors; when true, all nodes are effectively read-only and UI will reflect this state
  isLocked: boolean = false;

  // 记录正在保存的文件路径，用于忽略保存触发的fileWatch事件
  private savingFilePath: string = '';

  /***aside */
  serverList: Array<any> = [];
  dataList= signal<Array<AstTreeNode>>([]);
  // folder persistence mode
  folderReadWriteMode: 'read' | 'readwrite' = 'read';
  /***aside */

  // 添加位置选择器相关的属性
  showLocationSelector = signal<boolean>(false);
  pendingNodes: Array<AstTreeNode> = [];
  locationSelectionTree = signal<Array<AstTreeNode>>([]);
  selectedParentNodeId: string | null = null;

  nodeDef: NodeDef | null = null;
  /** event emitted when selected node's file type changes */
  @Output() fileTypeChange = new EventEmitter<string>();
  dataListChangeOutput = output<Array<AstTreeNode>>();
  disconnectTerminal = output<void>();

  // 添加自动刷新控制变量
  autoRefreshEnabled = signal<boolean>(true);
  refreshIntervalMs = 10; // 后续如果有必要，从2秒改为10秒，减少性能影响

  openedList = signal<Array<any>>([]);

  welcomeTip = signal<string>('');
  welcomeIconPath = signal<string>('');

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

  // 添加更多按钮菜单相关变量
  isMoreMenuOpen = false;
  moreMenuInitiator: DOMRect | undefined;
  blurSwitch = true;

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
      assignDeepLevel([data]);
      this.dataList.set([data]);
    } else if ('dataList' in docObj || 'openedList' in docObj) { //DocModel
      // Restore folderHandles from IndexedDB for both dataList and openedList and set them only once
      const dataListWithHandles = await this.restoreHandles(docObj.dataList || []);
      const openedListWithHandles = await this.restoreHandles(docObj.openedList || []);
      this.dataList.set(dataListWithHandles);
      this.openedList.set(openedListWithHandles);
      this.dataListChangeOutput.emit(this.dataList());
    } else if ('profile' in docObj) { //NodeDef
      if(docObj.profile) {
        const profileObj = JSON.parse(docObj.profile);
        if(docObj.isLocked) {// 可选：标记模型为只读
          profileObj.isLocked = true;
        }
        profileObj.isExpanded = true; // 默认展开根节点以显示内容
        this.dataList.set([profileObj]);
      }
      this.isLocked = docObj.isLocked;
      docObj.profile = undefined; // remove profile from nodeDef since it's now stored in dataList
      this.nodeDef = docObj;

      this.dataListChangeOutput.emit(this.dataList());
    }
    if (Object.keys(docObj).length === 0) {
      this.dataList.set([]);
    }

    // 检测是否为本地项目
    this.checkIsLocalProject();

    this.generateWelcomeContent();

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

    // 断开本地Agent连接
    this.localAgentService.disconnect();
  }

  // 检测是否为本地项目（根节点 isLocal = true）
  private checkIsLocalProject() {
    const list = this.dataList();
    const isLocal = list.length > 0 && list[0].isLocal === true;
    this.isLocalProject.set(isLocal);

    if (isLocal) {
      this.initLocalAgentConnection();
    }
  }

  // Initialize local agent connection
  private async initLocalAgentConnection() {
    try {
      const found = await this.localAgentService.probeAndConnect();
      if (found) {
        console.log('[Content] Connected to local agent at', this.localAgentService.getAgentUrl());
        this.startWatchProjectRoot();
        this.startWatchOpenedFiles();
      } else {
        console.warn('[Content] Local agent not available');
        this.notificationService.showNotification(
          'Local file system access not available. Configure Agent URL in Settings.', 'warning'
        );
      }
    } catch (err) {
      console.error('[Content] Failed to connect to local agent:', err);
    }
  }

  private startWatchOpenedFiles() {
    const openedTabs = this.openedList();
    for (const tab of openedTabs) {
      if (tab.nodeType === 'file') {
        const filePath = getNodeAbsolutePath(this.dataList(), tab);
        this.localAgentService.startFileWatch(filePath, (eventType) => {
          this.onExternalFileChange(tab, eventType);
        });
      }
    }
  }

  private startWatchProjectRoot() {
    const list = this.dataList();
    if (list.length === 0 || !list[0].rootPath) return;

    const rootPath = list[0].rootPath;
    this.localAgentService.startFileWatch(rootPath, (eventType) => {
      if (eventType === 'rename') {
        this.onProjectRootChanged(rootPath, eventType);
      }
    });
  }

  private async onProjectRootChanged(rootPath: string, eventType: string): Promise<void> {
    if (eventType === 'rename') {
      try {
        const data = await this.localAgentService.scanDir(rootPath, 1, [
          'node_modules', '.git', 'dist', 'build', '__pycache__',
          '.angular', '.vscode', '.idea', '.vs', 'target', 'out',
          'coverage', 'logs', 'log', 'tmp', 'temp', 'cache',
          'bin', 'obj', 'vendor', 'third_party', 'jspm_packages'
        ]);
        
        const list = this.dataList();
        if (list.length > 0 && list[0].rootPath === rootPath) {
          const existingChildren = list[0].children || [];
          const newChildren = (data.children || []).map((item: any) => {
            const existing = existingChildren.find((c: any) => c.label === item.name);
            if (existing) {
              return existing;
            }
            return {
              id: this.uuid(),
              label: item.name,
              rootPath: rootPath,
              nodeType: item.kind === 'directory' ? 'folder' : 'file',
              children: [],
              parentItem: pickParentObject(list[0]),
            };
          });

          const removedChildren = existingChildren.filter((c: any) => 
            !newChildren.find((n: any) => n.label === c.label)
          );

          if (removedChildren.length > 0 || newChildren.length !== existingChildren.length) {
            list[0].children = newChildren;
            assignDeepLevel(list[0].children, (list[0].deepLevel || 0) + 1);
            this.dataList.update(value => [...value]);
            this.storeApi();
            this.notificationService.showNotification('Project files updated', 'info');
          }
        }
      } catch (err) {
        console.error('[Content] Failed to refresh project root:', err);
      }
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
        // await this.addProjectComponent()?.setTextContextToNode(result.folderHandle.name, result.folderHandle, result);
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

  private async generateWelcomeContent(): Promise<void> {
    const systemPrompt = `You are a welcome assistant for Luxio, a web-based editor.
Generate a short welcome tip and a matching SVG icon path.
The tip should be 2-10 words, friendly, and related to editing, creativity, or productivity.
The icon should be a simple 24x24 SVG path representing the tip theme.
Always use the welcome_greeting tool.`;

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Generate a welcome greeting for the Luxio editor',
          model: 'deepseek-v4-flash',
          history: [],
          system: systemPrompt,
          autoCreate: true,
          tools: [{
            name: 'welcome_greeting',
            description: 'Generate a welcome tip and matching SVG icon path',
            parameters: {
              $schema: 'https://json-schema.org/draft/2020-12/schema',
              type: 'object',
              properties: {
                tipText: { type: 'string', description: 'Short welcome tip (max 40 chars)' },
                svgPath: { type: 'string', description: 'SVG <path> d attribute for 24x24 icon' },
              },
              required: ['tipText', 'svgPath'],
              additionalProperties: false,
            },
          }],
        }),
        credentials: 'include',
      });

      const reader = response.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let done = false;
      const toolCallsByIndex: Record<string, any> = {};

      while (!done) {
        const { value, done: streamDone } = await reader.read();
        if (streamDone) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(6).trim();
          if (!data || data === '[DONE]') {
            if (data === '[DONE]') done = true;
            continue;
          }
          try {
            const parsed = JSON.parse(data);
            const entries = parsed.toolCalls || parsed.tool_calls || [];
            for (const tc of entries) {
              if (!tc) continue;
              const idx = tc.index !== undefined ? String(tc.index) : undefined;
              if (!idx) continue;
              const existing = toolCallsByIndex[idx] || { index: tc.index };
              if (tc.id) existing.id = tc.id;
              if (tc.name) existing.name = tc.name;
              const fn = tc.function;
              if (fn) {
                if (fn.name) existing.name = fn.name;
                if (fn.arguments !== undefined) {
                  existing.arguments = (existing.arguments ?? '') + (typeof fn.arguments === 'string' ? fn.arguments : '');
                }
              }
              if (tc.arguments !== undefined) {
                existing.arguments = (existing.arguments ?? '') + (typeof tc.arguments === 'string' ? tc.arguments : '');
              }
              toolCallsByIndex[idx] = existing;
            }
          } catch { /* ignore */ }
        }
      }

      for (const tc of Object.values(toolCallsByIndex) as any[]) {
        if (tc.name === 'welcome_greeting' && tc.arguments) {
          try {
            const args = JSON.parse(tc.arguments);
            if (args.svgPath) this.welcomeIconPath.set(args.svgPath);
            if (args.tipText) this.welcomeTip.set(args.tipText);
          } catch { /* ignore */ }
        }
      }
    } catch (err) {
      console.warn('generateWelcomeContent failed', err);
    }
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
        //当newNode的节点类型是folder节点时，把此节点插入到currentSelect.children的首位
        //当newNode的节点类型不是folder节点时，把此节点插入到currentSelect.children的从首到尾遍历的第一个不是folder节点的节点的前面，如果currentSelect.children的所有节点都是folder节点，则把newNode插入到currentSelect.children的末尾
        if (newNode.nodeType === 'folder') {
          currentSelect.children.splice(0, 0, newNode);
        } else {
          let inserted = false;
          for (let i = 0; i < currentSelect.children.length; i++) {
            if (currentSelect.children[i].nodeType !== 'folder') {
              currentSelect.children.splice(i, 0, newNode);
              inserted = true;
              break;
            }
          }
          if (!inserted) {
            currentSelect.children.push(newNode);
          }
        }
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

  private assignDeepParent(evt: AstTreeNode[], parentItem: AstTreeNode | null = null) {
    for (let index = 0; index < evt.length; index++) {
      const dataItem = evt[index];
      if (dataItem) {
        if (parentItem) {
          dataItem.parentItem = pickParentObject(parentItem);
        }

        const parentItemCopy = pickParentObject(dataItem);
        delete dataItem.isNewData; //子节点的父节点不维护是否新添加节点这个状态

        dataItem.children = dataItem.children || [];
        dataItem.children.forEach((child: any) => {
          child['parentItem'] = parentItemCopy;
        });

        this.assignDeepParent(dataItem.children, null);
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

  forkBtn(evt: any) {
    const dataList = this.dataList();
    if (dataList.length >= 0) {
      // 先构建 shareData
      const shareData: NodeDef = this.buildNodeDef(dataList[0]);
      if (shareData && shareData.profile) {
        // 先发送 /user/save
        this.coreService.forking.set(true);
        this.coreService.postData('/user/save', shareData).subscribe({
          next: (saveResponse: any) => {
            if (saveResponse.id !== undefined) {
              // 保存成功后，发送 /user/fork
              fetch(`/user/fork/${this.nodeDef?.name}?sourceUserName=${this.nodeDef?.username}&destUserName=${this.coreService.userData?.username}`, {
                method: 'POST'
              })
                .then(response => response.json())
                .then(forkData => {
                  // Fork 成功
                  this.notificationService.showNotification('Fork successful', 'success');
                  window.open(`/editor/${saveResponse.id}`, '_blank', 'noopener,noreferrer');
                  this.coreService.forking.set(false);
                })
                .catch(error => {
                  this.notificationService.showNotification('Fork failed', 'error');
                  this.coreService.forking.set(false);
                });
            } else {
              this.notificationService.showNotification('Save failed', 'error');
              this.coreService.forking.set(false);
            }
          },
          error: (err) => {
            this.coreService.forking.set(false);
            // 处理保存错误
            if (err.error && err.error.errorCode === 'DUPLICATE_ENTRY') {
              this.existingId = err.error.existingId;
              this.duplicateModalVisible.set(true);
            } else {
              this.notificationService.showNotification('An error occurred while saving.', 'error');
            }
          }
        });
      }
    }
  }

  MoreBtn(evt: any) {
    if (!this.isMoreMenuOpen) {
      this.isMoreMenuOpen = !this.isMoreMenuOpen;
      this.moreMenuInitiator = evt.target.getBoundingClientRect();
    }
  }

  blurMoreBtn(evt: any) {
    if (this.blurSwitch) {
      this.isMoreMenuOpen = false;
    }
  }

  mouseentermenu(evt: any) {
    this.blurSwitch = false;
  }

  mouseleavemenu(evt: any) {
    this.blurSwitch = true;
  }

  deleteProject() {
    if (!this.nodeDef || !this.nodeDef.id) {
      this.notificationService.showNotification('No project to delete', 'error');
      return;
    }

    if (confirm('Are you sure you want to delete this project? This action cannot be undone.')) {
      this.coreService.deleteData(`/user/nodedef/${this.nodeDef.id}`).subscribe({
        next: () => {
          this.notificationService.showNotification('Project deleted successfully', 'success');
          this.isMoreMenuOpen = false;
          
          // Delete the corresponding container after successful deletion of nodedef
          const containerName = `con-${this.coreService.userData?.username}-${this.nodeDef?.name}`;
          fetch('/api/cmn/delete', {
            method: 'POST',
            headers: {
              'x-api-key': 'secret123',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              containerNames: [containerName]
            })
          })
          .then(response => {
            if (!response.ok) {
              console.error('Failed to delete container:', response.status, response.statusText);
              return;
            }
            console.log('Container deleted successfully:', containerName);
          })
          .catch(error => {
            console.error('Error deleting container:', error);
          });

          // 可以在这里添加删除成功后的逻辑，比如跳转到其他页面或刷新列表
          window.location.href = '/home'; // 跳转到首页或其他合适的位置
        },
        error: (err) => {
          this.notificationService.showNotification('Failed to delete project', 'error');
          console.error('Delete project error:', err);
        }
      });
    }
  }

  async openFolderInContent(mode: 'read' | 'readwrite' = 'read') {
    // Open the FilePickerDialog for folder selection
    const picker = this.filePicker();
    if (picker) {
      picker.openFolderPicker('/');
    }
  }

  async openFileInContent() {
    // Open the FilePickerDialog for file selection
    const picker = this.filePicker();
    if (picker) {
      picker.openFilePicker('/');
    }
  }

  // Callback from FilePickerDialog when a folder is selected
  async onFilePickerSelected(result: { path: string; kind: 'folder' | 'file' }) {
    if (result.kind === 'folder') {
      await this.openFolderViaNodeApi(result.path);
    } else {
      await this.openFileViaNodeApi(result.path);
    }
  }

  // Open folder via Node.js API (SSR scan endpoint)
  async openFolderViaNodeApi(path: string) {
    try {
      const data = await this.localAgentService.scanDir(path, 1, [
        'node_modules', '.git', 'dist', 'build', '__pycache__',
        '.angular', '.vscode', '.idea', '.vs', 'target', 'out',
        'coverage', 'logs', 'log', 'tmp', 'temp', 'cache',
        'bin', 'obj', 'vendor', 'third_party', 'jspm_packages'
      ]);
      const rootNode: AstTreeNode = {
        id: this.uuid(),
        label: data.name,
        rootPath: data.absolutePath,
        isLocal: true,
        nodeType: 'folder',
        children: (data.children || []).map((e: any) => ({
          id: this.uuid(),
          label: e.name,
          rootPath: data.absolutePath,
          nodeType: e.kind === 'directory' ? 'folder' : 'file',
          children: e.kind === 'directory' ? [] : undefined,
        })),
        isExpanded: true,
      };
      assignDeepLevel([rootNode]);
      this.assignDeepParent([rootNode]);
      this.dataList.set([rootNode]);
      this.dataListChangeOutput.emit(this.dataList());
      this.checkIsLocalProject();
      try { await this.storeApi(); } catch (e) { console.warn('storeApi failed', e); }
    } catch (err) {
      console.error('[Content] Failed to open folder via Node API:', err);
      this.notificationService.showNotification('Failed to open folder', 'error');
    }
  }

  // Hook: lazy-load children for local project folder nodes
  onFolderBeforeToggle = async (node: AstTreeNode) => {
    if (!this.isLocalProject() || node.children?.length > 0) return;

    const fullPath = getNodeAbsolutePath(this.dataList(), node);
    try {
      const items = await this.localAgentService.listDir(fullPath);
      node.children = items.map((item: any) => ({
        id: this.uuid(),
        label: item.name,
        rootPath: node.rootPath,
        nodeType: item.kind === 'directory' ? 'folder' : 'file',
        children: [],
        parentItem: pickParentObject(node),
      }));
      assignDeepLevel(node.children, (node.deepLevel || 0) + 1);
      computeFileIcons(node.children);
    } catch (err) {
      console.warn('[Content] Failed to list directory:', fullPath, err);
      node.children = [];
    }
  };

  // Open file via Node.js API (SSR readFile endpoint)
  async openFileViaNodeApi(path: string) {
    try {
      const content = await this.localAgentService.readFile(path);
      const fileName = path.split(/[/\\]/).pop() || path;
      const fileNode: AstTreeNode = {
        id: this.uuid(),
        label: fileName,
        rootPath: path,
        isLocal: true,
        nodeType: 'file',
        content: content,
        children: [],
      };
      assignDeepLevel([fileNode]);
      this.dataList.set([fileNode]);
      this.dataListChangeOutput.emit(this.dataList());
      this.checkIsLocalProject();
      try { await this.storeApi(); } catch (e) { console.warn('storeApi failed', e); }
    } catch (err) {
      console.error('[Content] Failed to open file via Node API:', err);
      this.notificationService.showNotification('Failed to open file', 'error');
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
      // parse spec file and display APIs in tree view under the spec file node
      const normalSpec = await normalizeApiSpec(item.content)
      const apiData = this.coreService.parseOpenApiSpec(normalSpec);
      // set parentItem for each api node to enable breadcrumb navigation in API details view
      item.children = apiData;
      item.isExpanded = true;
      item.isParsed = true;
      item.servers = apiData.length > 0 ? (apiData[0]['folderInfo'] != null ? apiData[0]['folderInfo']['servers'] : []) : []
      assignDeepLevel([item], item.deepLevel);
    }

    if (item.folderHandle && Object.keys(item.folderHandle).length > 0 && item.folderHandle.kind === 'file') {
      try {
        await this.coreService.verifyPermission(item.folderHandle, false);
      } catch (error) {
        this.notificationService.showNotification('No read permission for this file. Please grant permission to view the content.', 'error');
        return;
      }
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

      if (this.isLocalProject() && targetTab.nodeType === 'file') {
        const filePath = getNodeAbsolutePath(this.dataList(), targetTab);
        this.localAgentService.startFileWatch(filePath, (eventType) => {
          this.onExternalFileChange(targetTab, eventType);
        });
      }
    }
  }

  /**
   * Refreshes the content of a node in the UI
   * @param targetTab 
   */
  private async refreshNodeContent(targetTab: any) {
    const handle = targetTab.folderHandle;

    // 本地项目：通过 Local Agent 读取文件
    if (this.isLocalProject() && targetTab.nodeType === 'file') {
      try {
        const filePath = getNodeAbsolutePath(this.dataList(), targetTab);
        const content = await this.localAgentService.readFile(filePath);
        targetTab.content = content;
        return;
      } catch (err: any) {
        console.warn('[Content] Failed to read file via local agent:', err.message);
        targetTab.content = '';
        return;
      }
    }

    // File System Access API（Chromium）
    if (targetTab.nodeType === 'file' && handle && handle.kind === 'file') {
      await this.addProjectComponent()?.setTextContextToNode(handle.name, handle, targetTab);

    } else if (targetTab.nodeType === 'file' && (!handle || Object.keys(handle).length === 0)) {
      const filePathUrl = generateDirectoryPath(this.dataList(), targetTab);
      const objectKey = `${this.nodeDef?.username || 'Anonymous'}/${filePathUrl}`;

      try {
        const response = await this.downloadFileViaWebSocket(objectKey);

        if (!this.coreService.isBinaryName(targetTab.label)) {
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
          targetTab.isDeleted = true;
          console.warn('file not found on server for path ', filePathUrl);
        } else {
          console.warn('failed to fetch file content from server via WebSocket for path ', filePathUrl, error);
        }
      }
    }
  }


  async apiSelected(evt: Array<AstTreeNode>) {
    this.pendingNodes = evt;
    this.locationSelectionTree.set(this.createLocationTreeData(this.dataList()));
    this.selectedParentNodeId = null;
    this.showLocationSelector.set(true);
  }

  // 确认位置选择
  async confirmLocation() {
    if (!this.selectedParentNodeId) {
      this.notificationService.showNotification('Please select a folder location to save.', 'error');
      return;
    }

    const selectedParentNode = findNodeById(this.dataList(), this.selectedParentNodeId);
    if (!selectedParentNode) {
      this.notificationService.showNotification('Selected location is no longer available.', 'error');
      return;
    }

    const childStartLevel = (selectedParentNode.deepLevel ?? 0) + 1;
    assignDeepLevel(this.pendingNodes, childStartLevel);
    this.assignDeepParent(this.pendingNodes, selectedParentNode);

    // 将pendingNodes添加到selectedParentNode的children
    selectedParentNode.children = selectedParentNode.children || [];
    selectedParentNode.children.push(...this.pendingNodes);
    selectedParentNode.isExpanded = true; // 展开父节点

    this.storeApi();
    this.currentDisplayViewId.set(1);
    this.sideOpen.set(true);

    // 重置状态
    this.showLocationSelector.set(false);
    this.resetSelection(this.locationSelectionTree());
    this.locationSelectionTree.set([]);
    this.pendingNodes = [];
    this.selectedParentNodeId = null;
  }

  // 取消位置选择
  cancelLocation() {
    this.showLocationSelector.set(false);
    this.resetSelection(this.locationSelectionTree());
    this.locationSelectionTree.set([]);
    this.pendingNodes = [];
    this.selectedParentNodeId = null;
  }

  // 处理位置选择器中的节点点击
  onLocationNodeClick(node: AstTreeNode) {
    // 只允许选择文件夹节点
    if (node.nodeType === 'folder') {
      // 重置之前的选择
      this.resetSelection(this.locationSelectionTree());
      // 设置新选择
      node.isSelected = true;
      this.selectedParentNodeId = node.id;
    } else {
      this.notificationService.showNotification('Please select a folder to save the files.', 'warning');
    }
  }

  // 重置选择状态
  private resetSelection(nodes: AstTreeNode[]) {
    for (const node of nodes) {
      node.isSelected = false;
      if (node.children) {
        this.resetSelection(node.children);
      }
    }
  }

  private createLocationTreeData(nodes: Array<AstTreeNode>): Array<AstTreeNode> {
    const cloneNode = (node: AstTreeNode): AstTreeNode => {
      const cloned: AstTreeNode = {
        id: node.id,
        label: node.label,
        nodeType: node.nodeType,
        isExpanded: node.isExpanded,
        children: [],
      } as AstTreeNode;
      if (node.children && node.children.length > 0) {
        cloned.children = node.children.map(cloneNode);
      }
      return cloned;
    };
    return nodes.map(cloneNode);
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

    // 本地项目：通过 Local Agent 保存文件
    if (this.isLocalProject() && evt.nodeType === 'file') {
      try {
        const filePath = getNodeAbsolutePath(this.dataList(), evt);
        this.savingFilePath = filePath;
        await this.localAgentService.writeFile(filePath, evt.content || '');
        this.notificationService.showNotification('File saved locally', 'success');
      } catch (err: any) {
        console.error('[Content] Failed to save file via local agent:', err);
        this.notificationService.showNotification(`Failed to save: ${err.message}`, 'error');
      } finally {
        this.savingFilePath = '';
      }
      this.storeApi();
      this.storeOpenedList();
      return;
    }

    // File System Access API（Chromium）
    if (evt.folderHandle && evt.folderHandle.kind === 'file' && evt.mode === 'readwrite') {
      try {
        const writable = await evt.folderHandle.createWritable();
        await writable.write(evt.content || '');
        await writable.close();
      } catch (err) {
        console.error('failed to write file', err);
      }
    } else {
      await this.saveFileToServer(evt);
    }

    this.storeApi();
  }

  onContentChanged(tab: any) {
    tab['saved'] = false;
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
      const objectKey = `${this.nodeDef?.username || 'Anonymous'}/${filePathUrl}`;

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

  currentItem: AstTreeNode | null = null;
  shareOnMenuVisible = false;
  duplicateModalVisible = signal(false);
  existingId = '';
  menuItemAction(evt: any) {
    // guard against modifications when in read-only mode
    const modifyingActions = ['Rename','Delete','Duplicate','NewApi','NewFile','NewFolder'];
    if (this.isLocked && modifyingActions.includes(evt.action)) {
      // ignore edits in read-only state
      return;
    }
    
    if (evt.action == 'Delete') {
      const deletedNode = evt.target.item;

      // 本地项目：通过 Local Agent 删除文件/文件夹
      if (this.isLocalProject() && deletedNode) {
        const filePath = evt.deletedPath || getNodeAbsolutePath(this.dataList(), deletedNode);
        this.localAgentService.deleteFile(filePath).then(() => {
          this.notificationService.showNotification('Deleted: ' + deletedNode.label, 'success');
        }).catch(err => {
          console.error('[Content] Failed to delete file/folder:', err);
          this.notificationService.showNotification('Failed to delete: ' + err.message, 'error');
        });

        // 停止被删除节点及其后代的文件监听
        this.stopFileWatchForNodeAndDescendants(deletedNode);
      }

      // 删除节点及其后代在IndexedDB中的handle
      this.deleteHandlesForNodeAndDescendants(deletedNode).then(() => {
        console.log('Handles deleted for node and descendants');
      }).catch(error => {
        console.error('Error deleting handles for node and descendants:', error);
      });
      
      // 检查是否删除的是根目录
      if (deletedNode && !deletedNode.parentItem) {
        // 删除的是根目录，断开终端连接
        this.disconnectTerminal.emit();
        // 通知父组件dataList已变更
        this.dataListChangeOutput.emit(this.dataList());
      }
    }
    
    if(evt == 'Rename') {
      this.storeApi()
    }
    if (evt.action == 'Delete' || evt.action == 'Duplicate') {
      this.storeApi()
    }
    if (evt.action == 'NewFile:confirm' || evt.action == 'NewFolder:confirm') {
      if (this.isLocalProject() && evt.target) {
        const filePath = getNodeAbsolutePath(this.dataList(), evt.target);
        const op = evt.action === 'NewFile:confirm'
          ? this.localAgentService.createFile(filePath)
          : this.localAgentService.createDir(filePath);
        op.then(() => {
          this.notificationService.showNotification('Created: ' + evt.target.label, 'success');
        }).catch(err => {
          console.error('[Content] Failed to create file/folder:', err);
          this.notificationService.showNotification('Failed to create: ' + err.message, 'error');
        });
      }
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
      this.currentItem = evt.target;
      this.shareOnMenuVisible = true;
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
          
          if (this.isLocalProject() && evt.nodeType === 'file') {
            const filePath = getNodeAbsolutePath(this.dataList(), evt);
            this.localAgentService.stopFileWatch(filePath);
          }
          
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

  private async onExternalFileChange(tab: any, eventType: string): Promise<void> {
    // 忽略保存触发的事件
    const filePath = getNodeAbsolutePath(this.dataList(), tab);
    if (this.savingFilePath === filePath) {
      return;
    }

    try {
      const newContent = await this.localAgentService.readFile(filePath);
      
      if (tab.content !== newContent) {
        tab.content = newContent;
        
        const openeds = this.openedList();
        const index = openeds.findIndex((t: any) => t.id === tab.id);
        if (index !== -1) {
          openeds[index] = { ...openeds[index], content: newContent };
          this.openedList.update(value => [...value]);
        }
        
        this.notificationService.showNotification(
          'File changed externally. Content updated.', 'info'
        );
        this.storeOpenedList();
      }
    } catch (err) {
      console.error('[Content] Failed to read updated file:', err);
    }
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

  confirmShare(): void {
    if (!this.currentItem) {
      this.shareOnMenuVisible = false;
      return;
    }

    let me = this;
    const shareData: NodeDef = this.buildNodeDef(this.currentItem);
    if (shareData && shareData.profile) {
      this.coreService.saving.set(true);
      this.coreService.postData('/user/save', shareData).subscribe({
        next: config => {
          this.coreService.saving.set(false);
          // 处理上传功能 - 所有上传都使用ZIP压缩方式
          me.coreService.handleZipUpload(me.currentItem!);
        },
        error: err => {
          this.coreService.saving.set(false);
          if (err.error && err.error.errorCode === 'DUPLICATE_ENTRY') {
            this.existingId = err.error.existingId;
            this.duplicateModalVisible.set(true);
          } else {
            this.notificationService.showNotification('An error occurred while saving.', 'error');
          }
        }
      });
    }
    this.shareOnMenuVisible = false;
  }

  confirmDuplicate(): void {
    window.open(`/editor/${this.existingId}`, '_blank', 'noopener,noreferrer');
    this.duplicateModalVisible.set(false);
  }

  cancelDuplicate(): void {
    this.duplicateModalVisible.set(false);
  }

  private buildNodeDef(currentItem: AstTreeNode): NodeDef {
    const shareData: NodeDef = {};
    shareData.name = currentItem.label || "Untitled API";
    shareData.username = this.coreService.userData?.username || "Anonymous";

    const copyOfTarget = JSON.parse(JSON.stringify(currentItem));
    delete copyOfTarget.isLocked
    // recursively remove the children of any file nodes in the tree that end with '.ospec', since we only want to share the original file content for those files, not the parsed tree
    const traverse = (node: any) => {
      if (node.nodeType === 'file' && node.label.endsWith('.ospec')) {
        node.children = [];
        node.isParsed = false;
      } else if (node.nodeType === 'folder') {
        node.children?.forEach((child: any) => traverse(child));
      }
      if (node.nodeType === 'file') {
        delete node.content; // remove file content from shared data to avoid bloating the payload, since the content can be fetched separately by the recipient using the object storage
      }
      delete node.isLocal;
    };
    traverse(copyOfTarget);
    shareData.profile = JSON.stringify(copyOfTarget) || "";
    return shareData;
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

  async closeFolder() {
    this.localAgentService.disconnect();
    this.disconnectTerminal.emit();
    this.nodeDef = null;
    this.isLocalProject.set(false);
    this.dataList.set([]);
    this.openedList.set([]);
    await this.storeApi();
    await this.storeOpenedList();
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

  // 停止节点及其所有后代节点的文件监听
  private stopFileWatchForNodeAndDescendants(node: any) {
    if (node.nodeType === 'file') {
      const filePath = getNodeAbsolutePath(this.dataList(), node);
      this.localAgentService.stopFileWatch(filePath);
    }
    if (node.children) {
      for (const child of node.children) {
        this.stopFileWatchForNodeAndDescendants(child);
      }
    }
  }
}