import { AfterViewInit, Component, OnChanges, OnDestroy, OnInit, SimpleChanges, afterNextRender, inject, model, signal, viewChild } from '@angular/core';
import { CoreService } from '../../core.service';
import { AstApiComponent } from '../../shared/ast-api/ast-api.component';
import { AstTabComponent } from '../../shared/ast-tab/ast-tab.component';

import { FormsModule } from '@angular/forms';
import { AstTabGroupComponent } from '../../shared/ast-tab/ast-tab-group/ast-tab-group.component';

import { file, write } from 'opfs-tools';
import { AstTreeComponent, deleteParentItemRef, expandAncestorsIfActive, findActiveNode, findNodeById, reset, ResetType } from '../../shared/ast-tree/ast-tree.component';
import { AddProjectComponent } from '../add-project/add-project.component';
import { AstDraggableComponent } from '../../shared/ast-draggable/ast-draggable.component';
import { ApiInfoModel, AstTreeNode, NoN_SELECTION } from '../../shared/model';
import { ExplorerComponent } from '../../shared/explorer/explorer.component';
import { ShareOnComponent } from '../share-on/share-on.component';
import { MyConfigService } from '../../my-config.service';
import { AutoSaver } from '../../auto-saver';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { NoteBookComponent } from '../../shared/notebook/notebook.component';

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

  /***aside */
  serverList: Array<any> = [];
  dataList= signal<Array<AstTreeNode>>([]);
  /***aside */

  openedList = signal<Array<any>>([]);

  addMarkFile = false;
  newFileName: string = '';
  searchKeyword = ''
  searchResults = ''

  moreButtons = [
    { label: 'more', action: 'hori-more' },
  ];

  private savers: AutoSaver[] = [];
 
  constructor() {
    super();
    afterNextRender(() => {
      // this.initData();
    });
  }

  async ngOnInit() {
    const doc = this.myConfigService.getDoc();
    if(doc  == null || doc === undefined) {
      return;
    }
    if (typeof doc === 'string' || typeof doc === 'object') {
      const ospecFileName = this.removeExtension(this.myConfigService.getFileName() || 'Default') + '.ospec'

      let data: AstTreeNode = this.createNewFile(doc, ospecFileName);
      this.assignDeepLevel([data]);

      this.dataList.set([data]);
      // 启动自动保存
      this.startAutoSave();
    } else if(typeof doc === 'function') {
      const result = doc();
      const res = this.isPromiseLike(result) ? (await result) : result;
      this.dataParse(res);
    }
  }

  private dataParse(result: any) {
    if (typeof result === 'string' && result.length > 0) {
      const ospecFileName = this.removeExtension(this.myConfigService.getFileName() || 'Default') + '.ospec'

      let data: AstTreeNode = this.createNewFile(result, ospecFileName);
      this.assignDeepLevel([data]);

      this.dataList.set([data]);
    } else if (typeof result === 'object') {
      this.dataList.set(result.dataList || []);
      this.openedList.set(result.openedList || []);
    }
    // 启动自动保存
    this.startAutoSave();
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

  listClick(evt: any) {
    if (evt['nodeType'] != 'bookmark' && evt['nodeType'] != 'api'&& evt['nodeType'] != 'file') {
      return;
    }

    const item = evt;
    if (item.nodeType == 'file' && item.label.endsWith('.ospec') && !item.isParsed) {
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

  apiSelected(evt: any) {
    const fileName = evt.fileName;
    const ospecFileName = this.removeExtension(fileName) + '.ospec'

    let data: AstTreeNode = this.createNewFile(evt.content, ospecFileName);
    this.assignDeepLevel([data]);
    this.dataList.update(value => value.concat([data]))
    this.storeApi()
    this.currentDisplayViewId.set(1);
    this.sideOpen.set(true);
  }

  async storeApi() {
    // --------- Create / Write ---------
    // await dir('/test-dir').create(); // create a directory

    await write('/dir/file.txt', JSON.stringify(this.dataList()));
    // await write('/dir/api.txt', this.dataList); // empty file
    // --------- Remove ---------
    // await dir('/test-dir').remove();

    // await file('/dir/file.txt').remove();
  }

  async storeOpenedList() {
    // --------- Create / Write ---------
    // await dir('/test-dir').create(); // create a directory
    await write('/dir/file_openedList.txt', JSON.stringify(this.openedList()));
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

    const openedListText = await file('/dir/file_openedList.txt').text();
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

  saveText(evt: any) {
    // const data: any = {
    //   id: this.uuid(),
    //   label: "New Collection",
    //   children: [evt],
    //   isExpanded: true
    // }
    // this.dataList().push(data)

    this.storeApi()
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
  shareData: ApiInfoModel = {};
  menuItemAction(evt: any) {
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
      this.shareData = {}
      this.shareData.profile = evt.target;
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

  getRandomInt(min: number, max: number) {
    min = Math.ceil(min); // 确保最小值是整数  
    max = Math.floor(max); // 确保最大值是整数  
    return Math.floor(Math.random() * (max - min + 1)) + min; // 生成[min, max]之间的随机整数  
  }
}
