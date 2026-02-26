import { AfterViewInit, Component, EventEmitter, OnChanges, OnDestroy, OnInit, Output, SimpleChanges, afterNextRender, computed, inject, model, resource, signal, viewChild } from '@angular/core';
import { CoreService } from '../../core.service';
import { AstApiComponent } from '../../shared/ast-api/ast-api.component';
import { AstTabComponent } from '../../shared/ast-tab/ast-tab.component';

import { FormsModule } from '@angular/forms';
import { AstTabGroupComponent } from '../../shared/ast-tab/ast-tab-group/ast-tab-group.component';

import { file, write } from 'opfs-tools';
import { AstTreeComponent, deleteParentItemRef, expandAncestorsIfActive, findActiveNode, findNodeById, reset, ResetType } from '../../shared/ast-tree/ast-tree.component';
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

  // permission for the currently loaded tree; shared trees may set this to 'read'
  permission: 'read' | 'readwrite' = 'readwrite';
  @Output() permissionChange = new EventEmitter<'read' | 'readwrite'>();
  get isReadOnly() {
    return this.permission === 'read';
  }

  /***aside */
  serverList: Array<any> = [];
  dataList= signal<Array<AstTreeNode>>([]);
  // folder persistence mode
  folderReadWriteMode: 'read' | 'readwrite' = 'read';
  /***aside */

  /** event emitted when selected node's file type changes */
  @Output() fileTypeChange = new EventEmitter<string>();


  openedList = signal<Array<any>>([]);

  addMarkFile = false;
  newFileName: string = '';
  searchKeyword = ''
  searchResults = ''

  moreButtons = [
    { label: 'more', action: 'hori-more' },
  ];

  private savers: AutoSaver[] = [];

  userResource = resource({
    // Define a reactive comput`ation.
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

  constructor() {
    super();
    afterNextRender(() => {
      // this.initData();
    });
  }

  async ngOnInit() {
    const doc = this.myConfigService.getDoc();
    if (doc == null || doc === undefined) {
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
      const ospecFileName = this.removeExtension(this.myConfigService.getFileName() || 'Default') + '.ospec'
      let data: AstTreeNode = this.createNewFile(docObj, ospecFileName);
      this.assignDeepLevel([data]);
      this.dataList.set([data]);
    } else if ('dataList' in docObj || 'openedList' in docObj) { //DocModel
      this.dataList.set(docObj.dataList || []);
      this.openedList.set(docObj.openedList || []);
    } else { //NodeDef
      this.dataList.set([docObj.profile ? JSON.parse(docObj.profile) : {}]);
      // if the provided object carries permission info, apply it
      this.modifyPermission(docObj);
    }
    // 启动自动保存
    this.startAutoSave();
  }

  private modifyPermission(docObj: any) {
    // if the shared payload carries a username, determine ownership
    if (docObj && docObj.username) {
      const fetchProfile = async () => {
        try {
          const response = await fetch(`/api/auth/profile`, {
            credentials: 'include', // 携带 Cookie
          });
          this.coreService.userData = await response.json();
          this.coreService.isAuthenticated.set(true);


          const currentUser = this.coreService.userData?.username;
          if (currentUser && docObj.username === currentUser) {
            // owner always gets full rights
            this.permission = 'readwrite';
          } else {
            // non-owner falls back to provided permission or default read
            this.permission = docObj.permission || 'read';
          }
          this.permissionChange.emit(this.permission);

        } catch (err) {
          this.coreService.isAuthenticated.set(false);
          console.error('获取用户信息失败:', err);
          // // 可跳转到登录页
          // window.location.href = '/signin';
        }
      };

      fetchProfile();
    } else if (docObj && docObj.permission) {
      // not a shared payload, but explicit permission
      this.permission = docObj.permission;
      this.permissionChange.emit(this.permission);
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
  }
  // 确保组件销毁时清理定时器
  ngOnDestroy(): void {
    // 一次性停止所有自动保存
    this.savers.forEach(saver => saver.stop());
    this.savers = [];
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
    if (this.isReadOnly) {
      // ignore attempts to modify when in read-only mode
      console.warn('read-only mode: action', action, 'blocked');
      return;
    }
    let newNode;
    if (currentSelect) {
      delete currentSelect.isNewData;//子节点的父节点不维护是否新添加节点这个状态
      currentSelect.isExpanded = true
      const parentItemCopy = JSON.parse(JSON.stringify(currentSelect))
      deleteParentItemRef(parentItemCopy)

      if (action == 'NewApi') {
        newNode = this.createNewApi();
      } else if (action == 'NewFile') {
        newNode = this.createNewFile();
      } else if (action == 'NewFolder') {
        newNode = this.createNewFolder();
      }
      if(newNode) {
        newNode['deepLevel'] = parentItemCopy.deepLevel + 1;
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
      alert('The File System Access API is not supported in this browser.');
      return;
    }

    try {
      // Reuse AddProjectComponent.openFolder which populates its folderHandle
      // and directoryTreeData using its own buildTreeFromDirectory implementation.
      await addProject.openFolder(mode as any);

      // grab the results from the child component
      const folderHandle = (addProject as any).folderHandle;
      if (folderHandle == null) {
        console.warn('No folder selected');
        return;
      }
      const treeData: Array<AstTreeNode> = (addProject as any).directoryTreeData || [];

      const rootName = folderHandle?.name || 'folder';
      const rootNode: AstTreeNode = {
        id: this.uuid(),
        label: rootName,
        children: treeData,
        nodeType: 'folder',
        isExpanded: true,
        custom: true,
        folderInfo: { servers: [] },
        mode: mode
      } as any;

      this.assignDeepLevel([rootNode]);
      this.dataList.set([rootNode]);
      try { await this.storeApi(); } catch (e) { console.warn('storeApi failed', e); }
    } catch (err) {
      console.error('openFolderInContent error', err);
    }
  }

  async openFileInContent() {
    // Try native file picker first
    try {
      if ('showOpenFilePicker' in window) {
        const handles: any = await (window as any).showOpenFilePicker({ multiple: false });
        if (!handles || handles.length === 0) return;
        const fileHandle = handles[0];
        const f: any = await fileHandle.getFile();
        const name = fileHandle.name || f.name || 'file';
        const isBinary = /\.(exe|dll|bin|dat|jpg|jpeg|png|gif|zip|7z|rar|tar|gz|iso)$/i.test(name);
        let content = '';
        if (!isBinary) {
          try { content = await f.text(); } catch (e) { console.warn('openFileInContent: read failed', e); }
        }

        const node: AstTreeNode = {
          id: this.uuid(),
          label: name,
          nodeType: 'file',
          content: content,
          children: [],
          custom: true,
          folderHandle: fileHandle,
          mode: 'read'
        } as any;

        this.assignDeepLevel([node]);
        this.dataList.set([node]);
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
          custom: true,
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

  public openTab(targetTab: any) {
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
      openeds.push(targetTab);
    }
  }

  async apiSelected(evt: any) {
    // handle different import payloads
    if (evt.folderHandle) {
      // folder import
      const rootName = evt.folderHandle.name || 'folder';
      const rootNode: AstTreeNode = {
        id: this.uuid(),
        label: rootName,
        children: evt.tree || [],
        nodeType: 'folder',
        isExpanded: true,
        // store handle for later operations
        custom: true,
        folderInfo: {
          servers: []
        },
        mode: evt.mode // read or readwrite
      } as any;
      this.assignDeepLevel([rootNode]);
      this.dataList.update(value => value.concat([rootNode]));
      // persist snapshot to OPFS for later restoration
      // try {
      //   const snapshot = { name: evt.folderHandle?.name || rootName, mode: evt.mode, tree: evt.tree || [] };
      //   await this.saveFolderSnapshotToOPFS(snapshot);
      // } catch (err) {
      //   console.warn('failed to persist folder snapshot to OPFS', err);
      // }
    } else if (evt.fileName) {
      const fileName = evt.fileName;
      const ospecFileName = this.removeExtension(fileName) + '.ospec';

      let data: AstTreeNode = this.createNewFile(evt.content, ospecFileName);
      this.assignDeepLevel([data]);
      this.dataList.update(value => value.concat([data]));
    } else if (evt.apiData) {
      // from ecosystem
      const data: AstTreeNode = {
        id: this.uuid(),
        label: evt.apiData.name || 'api',
        children: [],
        nodeType: 'api',
        rawApiInfo: evt.apiData
      } as any;
      this.assignDeepLevel([data]);
      this.dataList.update(value => value.concat([data]));
    }

    this.storeApi();
    this.currentDisplayViewId.set(1);
    this.sideOpen.set(true);
  }

  async storeApi() {
    // before persisting, strip out any non‑serializable handles.  we still
    // keep `content` on file nodes so OPFS will hold the file text.
    const strip = (node: any): any => {
      const { folderHandle, ...rest } = node;
      if (rest.children) {
        rest.children = rest.children.map(strip);
      }
      return rest;
    };

    const toSave = this.dataList().map(strip);

    // write to OPFS
    await write('/dir/file.txt', JSON.stringify(toSave));
  }

  async storeOpenedList() {
    // --------- Create / Write ---------
    // await dir('/test-dir').create(); // create a directory
    await write('/dir/openedList.txt', JSON.stringify(this.openedList()));
    // await write('/dir/api.txt', this.dataList); // empty file
    // --------- Remove ---------
    // await dir('/test-dir').remove();

    // await file('/dir/file.txt').remove();
  }

  async initData() {
    const readDataListText = await file('/dir/file.txt').text();
    // console.log("readDataListText: " + readDataListText)
    if (readDataListText) {
      this.dataList.set(JSON.parse(readDataListText));
    }

    const openedListText = await file('/dir/openedList.txt').text();
    if (openedListText) {
      this.openedList.set(JSON.parse(openedListText));
    }
  }

  removeExtension(filename: string) {
    const lastDotIndex = filename.lastIndexOf('.');
    if (lastDotIndex === -1) {
      return filename; // 没有扩展名
    }
    return filename.substring(0, lastDotIndex);
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
    if (this.isReadOnly) {
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
    }

    this.storeApi();
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
  shareData: NodeDef = { permission: 'read' };
  menuItemAction(evt: any) {
    // guard against modifications when in read-only mode
    const modifyingActions = ['Rename','Delete','Duplicate','NewApi','NewFile','NewFolder'];
    if (this.isReadOnly && modifyingActions.includes(evt.action)) {
      // ignore edits in read-only state
      return;
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
      this.shareData = { permission: 'read' };
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
      }
      traverse(copyOfTarget);
      this.shareData.profile = JSON.stringify(copyOfTarget) || "";
      // owners always have full rights when editing their own tree
      if (!this.shareData.permission) {
        this.shareData.permission = 'read';
      }
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
      custom: true,
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
        custom: true,
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

  private async checkPermission(handle: any, mode: 'read' | 'readwrite' = 'readwrite'): Promise<string> {
    try {
      const status = await handle.queryPermission({ mode });
      return status;
    } catch {
      return 'prompt';
    }
  }

  private async requestPermission(handle: any, mode: 'read' | 'readwrite' = 'readwrite'): Promise<string> {
    try {
      const status = await handle.requestPermission({ mode });
      return status;
    } catch {
      return 'denied';
    }
  }


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
}
