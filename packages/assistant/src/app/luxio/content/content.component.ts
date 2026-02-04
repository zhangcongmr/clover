import { AfterViewInit, Component, OnChanges, OnDestroy, OnInit, SimpleChanges, afterNextRender, inject, model, signal, viewChild } from '@angular/core';
import { CoreService } from '../../core.service';
import { AstApiComponent } from '../../shared/ast-api/ast-api.component';
import { AstTabComponent } from '../../shared/ast-tab/ast-tab.component';
import { MarkdownComponent } from '../../shared/markdown/markdown.component';

import { FormsModule } from '@angular/forms';
import { AstTabGroupComponent } from '../../shared/ast-tab/ast-tab-group/ast-tab-group.component';

import { file, write } from 'opfs-tools';
import { AstTreeComponent } from '../../shared/ast-tree/ast-tree.component';
import { AddProjectComponent } from '../add-project/add-project.component';
import { AstDraggableComponent } from '../../shared/ast-draggable/ast-draggable.component';
import { ApiInfoModel, AstTreeNode, TreeNodeType } from '../../shared/model';
import { ExplorerComponent } from '../../shared/explorer/explorer.component';
import { ShareOnComponent } from '../share-on/share-on.component';
import { MyConfigService } from '../../my-config.service';
import { AutoSaver } from '../../auto-saver';

@Component({
  selector: 'div[ast-content]',
  templateUrl: './content.component.html',
  styleUrls: ['./content.component.css'],
  standalone: true,
  imports: [FormsModule,ExplorerComponent, AstTabGroupComponent, AstTabComponent, AstApiComponent, MarkdownComponent, AstTreeComponent, AddProjectComponent, ShareOnComponent]
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
  currentSelect: any;

  addMarkFile = false;
  newFileName: string = '';
  searchKeyword = ''
  searchResults = ''

  moreButtons = [
    { label: 'more', action: 'more' },
  ];

  private savers: AutoSaver[] = [];
 
  constructor() {
    super();
    afterNextRender(() => {
      // this.initData();
    });
  }

  ngOnInit() {
    const doc = this.myConfigService.getDoc();
    if(doc  == null || doc === undefined) {
      return;
    }
    if(typeof doc === 'string' && doc.length > 0) {
      const json = JSON.parse(doc);
      let datas: Array<any> = this.addRoot(this.coreService.parseOpenApiSpec(json), doc, this.myConfigService.getFileName());
      this.dataList.set(datas);
      this.currentSelect = this.findActiveNode(datas);
      // 启动自动保存
      this.startAutoSave();
    } else if(typeof doc === 'object') {
      let datas: Array<any> = this.addRoot(this.coreService.parseOpenApiSpec(doc), JSON.stringify(doc), this.myConfigService.getFileName());
      this.dataList.set(datas);
      this.currentSelect = this.findActiveNode(datas);
      // 启动自动保存
      this.startAutoSave();
    } else if(typeof doc === 'function') {
      const result = doc();
      if(this.isPromiseLike(result)) {
        (result as Promise<string | any>).then((res: string | any) => {
          if(typeof res === 'string' && res.length > 0) {
            const json = JSON.parse(res);
            const datas = this.coreService.parseOpenApiSpec(json);
            this.dataList.set(datas);
            this.currentSelect = this.findActiveNode(datas);
          } else if(typeof res === 'object') {
            this.dataList.set(res.dataList || []);
            this.openedList.set(res.openedList || []);
            this.currentSelect = this.findActiveNode(res.dataList || []);
          }
          // 启动自动保存
          this.startAutoSave();
        });
      } else {
        if(typeof result === 'string' && result.length > 0) {
          const json = JSON.parse(result);
          const datas = this.coreService.parseOpenApiSpec(json);
          this.dataList.set(datas);
          this.currentSelect = this.findActiveNode(datas);
        } else if(typeof result === 'object') {
          this.dataList.set(result.dataList || []);
          this.openedList.set(result.openedList || []);
          this.currentSelect = this.findActiveNode(result.dataList || []);
        }
        // 启动自动保存
        this.startAutoSave();
      }
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

  FileaddBtn(evt: any) {
    if (this.currentSelect) {
      if (this.currentSelect.nodeType == TreeNodeType.Folder) {
        this.currentSelect.isExpanded = true
        const parentItemCopy = JSON.parse(JSON.stringify(this.currentSelect))
        delete parentItemCopy["children"] //子节点的父节点引用不包含子节点数据，避免循环引用导致数据无法序列化
        delete parentItemCopy.isExpanded;//子节点的父节点引用不维护是否节点展开这个状态
        delete parentItemCopy.isNewData;//子节点的父节点引用不维护是否新添加节点这个状态
        delete parentItemCopy.sourceCodeText;

        const newApi = this.createNewFile();
        newApi['deepLevel'] = parentItemCopy.deepLevel + 1;
        newApi['rename'] = true;
        newApi['parentItem'] = parentItemCopy;
        this.currentSelect.children.splice(0, 0, newApi);
      } else if (this.currentSelect.nodeType == TreeNodeType.File) {
          const newApi = this.createNewApi();

          const parentItemCopy = JSON.parse(JSON.stringify(this.currentSelect))
          delete parentItemCopy["children"] //子节点的父节点引用不包含子节点数据，避免循环引用导致数据无法序列化
          delete parentItemCopy.isExpanded;//子节点的父节点引用不维护是否节点展开这个状态
          delete parentItemCopy.isNewData;//子节点的父节点引用不维护是否新添加节点这个状态
          delete this.currentSelect.isNewData;//子节点的父节点不维护是否新添加节点这个状态
          delete parentItemCopy.sourceCodeText;
          
          newApi['deepLevel'] = parentItemCopy.deepLevel + 1;
          newApi['rename'] = true;
          newApi['parentItem'] = parentItemCopy;
          this.currentSelect.children?.splice(0, 0, newApi);
      } else {
        //TODO
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

  FolderaddBtn(evt: any) {
    const folder: AstTreeNode = {
      id: this.uuid(),
      isActive: false,
      isExpanded:false,
      label: "New Folder",
      deepLevel: 0,
      nodeType: TreeNodeType.Folder,
      children: []
    }
    const newDatas = [
      ...this.dataList(),
      folder
    ]
    this.dataList.set(newDatas);
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
    this.currentSelect = evt;
    if (evt['nodeType'] != TreeNodeType.Bookmark && evt['nodeType'] != TreeNodeType.Api) {
      return;
    }
    this.reset(this.dataList())
    this.openTab(evt);
  }

  public openTab(targetTab: any) {
    let oldTab = false;
    const openeds = this.openedList()
    this.reset(openeds);

    const findNode = this.findNodeById(this.openedList(), targetTab.id);
    const originNode = this.findNodeById(this.dataList(), targetTab.id);
    originNode!['isActive'] = true;
    if (findNode) {
      findNode['isActive'] = true;
      oldTab = true;
    }

    if (!oldTab) {
      targetTab["isActive"] = true;
      openeds.push(targetTab);
    }
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

  findNodeById(nodes: AstTreeNode[], targetId: string): AstTreeNode | undefined {
    for (const node of nodes) {
      if (node.id === targetId) {
        return node;
      }
      if (node.children && node.children.length > 0) {
        const found = this.findNodeById(node.children, targetId);
        if (found) {
          return found;
        }
      }
    }
    return undefined;
  }

  findActiveNode(nodes: AstTreeNode[]): AstTreeNode | undefined {
    for (const node of nodes) {
      if (node.isActive) {
        return node;
      }
      if (node.children && node.children.length > 0) {
        const found = this.findActiveNode(node.children);
        if (found) {
          return found;
        }
      }
    }
    return nodes[0];//默认返回第一个节点
  }

  apiSelected(evt: any) {
    const fileName = evt.fileName;
    const apiData = evt.apiData;
    let datas: Array<any> = this.addRoot(apiData, evt.sourceCodeText, fileName);
    this.assignDeepLevel(datas);
    this.dataList.update(value => value.concat(datas))
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

  private addRoot(apiData: any, sourceCodeText: string, fileName: string = "Default.json") {
    apiData.map((val: any) => val['saved'] = true);
    let datas: Array<any> = [];
    const data: AstTreeNode = {
      id: this.uuid(),
      label: fileName,
      children: apiData,
      isExpanded: apiData.length > 0,
      nodeType: TreeNodeType.File,
      servers: apiData.length > 0 ? (apiData[0]['folderInfo'] != null ? apiData[0]['folderInfo']['servers'] : []) : [],
      sourceCodeText: sourceCodeText,
      isNewData: true
    };
    datas.push(data);
    return datas;
  }

  groupBy(dataList: Array<any>, key: string) {
    return dataList.reduce((result, currentValue) => {
      const value = currentValue[key];
      // 如果 key 值不存在于 result 中，则添加一个新数组  
      if (!result[value]) {
        result[value] = [];
      }

      // 将当前对象推送到相应 key 的数组中
      result[value].push(currentValue);
      // 返回更新后的 result  
      return result;
    }, {});
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
    const data: any = {
      id: this.uuid(),
      label: "New Collection",
      children: [evt],
      isExpanded: true
    }
    this.dataList().push(data)

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
    if (evt.action == 'New') {
      if (evt.target != 'non-element-select') {
        this.currentSelect = evt.target
        this.FileaddBtn(null)
      } else {
        this.FolderaddBtn(null)
      }
    }
    if (evt.action == 'Share') {
      this.shareOnMenuVisible = true;
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
    const datas = this.openedList()
    for (let index = 0; index < datas.length; index++) {
      if (datas[index].id == evt.id) {
        datas[index]["isActive"] = true
      } else {
        datas[index]["isActive"] = false
      }
    }
    this.storeOpenedList()
  }

  onAddNewTab(evt: any) {
    const datas = this.openedList()
    datas.forEach(ele => ele.isActive = false);
    datas.push(this.createNewApi())
    this.storeOpenedList()
  }

  createNewFile() {
    const apiInfo: AstTreeNode = {
      id: this.uuid(),
      summary: "",
      label: "Untitle.json",
      tabLabel: "Untitle.json",
      nodeType: TreeNodeType.File,
      children: [],
      auth: {}
    }

    return apiInfo;
  }

  createNewApi() {
    const apiInfo: AstTreeNode = {
      id: this.uuid(),
      serviceName: "",
      method: "get",
      symbol: "GET",
      path: "",
      url: "",
      summary: "",
      label: "Untitle",
      tabLabel: "Untitle",
      server: "",
      symbolColor: "green",
      nodeType: TreeNodeType.Api,
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
        tabLabel: newFileName,
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
