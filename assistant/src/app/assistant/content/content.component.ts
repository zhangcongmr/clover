import { AfterViewInit, Component, NgZone, OnChanges, OnInit, SimpleChanges, afterNextRender, inject, input, model, viewChild } from '@angular/core';
import { AppEventType, CoreService, EventItem } from '../../core.service';
import { AstApiComponent } from '../../shared/ast-api/ast-api.component';
import { AstTabComponent } from '../../shared/ast-tab/ast-tab.component';
import { MarkdownComponent } from '../../shared/markdown/markdown.component';

import { FormsModule } from '@angular/forms';
import { AstTabGroupComponent } from '../../shared/ast-tab/ast-tab-group/ast-tab-group.component';

import { file, write } from 'opfs-tools';
import { AstTreeComponent } from '../../shared/ast-tree/ast-tree.component';
import { AddProjectComponent } from '../add-project/add-project.component';
import { AstDraggableComponent } from '../../shared/ast-draggable/ast-draggable.component';
import { ApiInfoModel, ApiTreeNodeType } from '../../shared/model';
import { ExplorerComponent } from '../../shared/explorer/explorer.component';
import { ShareOnComponent } from '../share-on/share-on.component';

@Component({
  selector: 'div[ast-content]',
  templateUrl: './content.component.html',
  styleUrls: ['./content.component.css'],
  standalone: true,
  imports: [FormsModule,ExplorerComponent, AstTabGroupComponent, AstTabComponent, AstApiComponent, MarkdownComponent, AstTreeComponent, AddProjectComponent, ShareOnComponent]
})
export class ContentComponent extends AstDraggableComponent implements OnInit, OnChanges, AfterViewInit {
  private coreService = inject(CoreService);
  readonly sideOpen = model<boolean>(true);
private ngZone = inject(NgZone);

  readonly addProjectComponent = viewChild(AddProjectComponent);
  readonly currentDisplayViewId = model<number>(1);

  /***aside */
  serverList: Array<any> = [];
  dataList: Array<ApiTreeNodeType> = [];
  /***aside */

  openedList: Array<any> = [];
  currentSelect: any;

  addMarkFile = false;
  newFileName: string = '';
  searchKeyword = ''
  searchResults = ''

  constructor() {
    super();
    afterNextRender(() => {
      this.ngZone.run(() => {
        this.initData();
      });
    });
  }

  ngOnInit() {
    this.coreService.apiViewLoadedSubject.subscribe((data: any) => {
      const tab = document.getElementById('tab_' + data.id);
      const panel = document.getElementById('article_' + data.id);

      // this.coreService.setTabHandler(tab, panel);
    });

    this.coreService.tabChangeSubject.subscribe((data: EventItem) => {
      if (data.eventType == AppEventType.USER_CONTENT_TAB) {
        const tabId = data.data.tab.id;
        for (const item of this.openedList) {
          delete item["isActive"];
        }
        const result: any = this.openedList.filter(val => val.id == tabId.replace("tab_", ""));
        if (result.length > 0) {
          result[0]["isActive"] = true
        }
      }
    })
  }

  ngOnChanges(changes: SimpleChanges): void {
  }



  FileaddBtn(evt: any) {
    if (this.currentSelect) {
      if (this.currentSelect.nodeType == 'root') {
        this.currentSelect.isExpanded = true
        const parentItemCopy = JSON.parse(JSON.stringify(this.currentSelect))
        delete parentItemCopy["children"] //子节点的父节点引用不包含子节点数据，避免循环引用导致数据无法序列化
        delete parentItemCopy.isExpanded;//子节点的父节点引用不维护是否节点展开这个状态
        delete parentItemCopy.isNewData;//子节点的父节点引用不维护是否新添加节点这个状态

        const newApi = this.createNewApi();
        newApi['rename'] = true;
        newApi['parentItem'] = parentItemCopy;
        if (!newApi['nodeType']) {
          newApi['nodeType'] = 'leaf';
        }
        this.currentSelect.children.splice(0, 0, newApi);
      } else if (this.currentSelect.nodeType == 'leaf') {
        const dataId = this.currentSelect['parentItem']['id'];
        const currentIndex = this.dataList.findIndex(dataval => dataval.id == dataId);
        if (currentIndex > -1) {
          const newApi = this.createNewApi();
          newApi['rename'] = true;
          newApi['parentItem'] = this.currentSelect['parentItem'];
          if (!newApi['nodeType']) {
            newApi['nodeType'] = 'leaf';
          }
          this.dataList[currentIndex].children?.splice(0, 0, newApi);

        }
      }
    }
  }
  FolderaddBtn(evt: any) {
    const folder: ApiTreeNodeType = {
      id: this.uuid(),
      isActive: false,
      isExpanded:false,
      label: "New Folder",
      nodeType: "root",
      children: []
    }
    this.dataList = this.dataList.concat([folder])
  }
  importBtn(evt: any) {
    this.openAddDlg();
  }
  LocationBtn(evt: any) {

  }
  ExpandBtn(evt: any) {
    
  }
  CollapseBtn(evt: any) {
    this.dataList.forEach(ele => ele.isExpanded = false);
  }
  MoreBtn(evt: any) {

  }

  listClick(evt: any) {
    this.currentSelect = evt;
    if (evt['nodeType'] != 'leaf') {
      return;
    }

    let oldTab = false;
    for (const item of this.openedList) {
      delete item["isActive"];
      if (item.id == evt.id) {
        item["isActive"] = true;
        oldTab = true;
      }
    }
    if (!oldTab) {
      evt["isActive"] = true
      this.openedList.push(evt);
    }
    this.storeApi()
    this.storeOpenedList()
  }

  apiSelected(evt: any) {
    evt.map((val: any) => val['saved'] = true);
    const result = this.groupBy(evt, "folder");
    let datas: Array<any> = []
    for (const key in result) {
      if (Object.prototype.hasOwnProperty.call(result, key)) {
        const element: Array<ApiTreeNodeType> = result[key];
        const data: ApiTreeNodeType = {
          id: this.uuid(),
          label: key,
          children: element,
          isExpanded: element.length > 0,
          nodeType: 'root',
          servers: element.length > 0 ? (element[0]['folderInfo'] != null ? element[0]['folderInfo']['servers'] : []) : [],
          isNewData: true
        }
        datas.push(data)
      }
    }
    this.dataList = this.dataList.concat(datas);

    this.storeApi()
    this.currentDisplayViewId.set(1);
    this.sideOpen.set(true);
  }

  async storeApi() {
    // --------- Create / Write ---------
    // await dir('/test-dir').create(); // create a directory

    await write('/dir/file.txt', JSON.stringify(this.dataList));
    // await write('/dir/api.txt', this.dataList); // empty file
    // --------- Remove ---------
    // await dir('/test-dir').remove();

    // await file('/dir/file.txt').remove();
  }

  async storeOpenedList() {
    // --------- Create / Write ---------
    // await dir('/test-dir').create(); // create a directory
    await write('/dir/file_openedList.txt', JSON.stringify(this.openedList));
    // await write('/dir/api.txt', this.dataList); // empty file
    // --------- Remove ---------
    // await dir('/test-dir').remove();

    // await file('/dir/file.txt').remove();
  }

  async initData() {
    const readDataListText = await file('/dir/file.txt').text();
    // console.log("readDataListText: " + readDataListText)
    if (readDataListText) {
      this.dataList = JSON.parse(readDataListText);
    }

    const openedListText = await file('/dir/file_openedList.txt').text();
    if (openedListText) {
      this.openedList = JSON.parse(openedListText);
    }
  }

  groupBy(dataList: Array<any>, key: string) {
    let me = this;
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
    this.dataList.push(data)

    this.storeApi()
  }

  saveText(evt: any) {
    const data: any = {
      id: this.uuid(),
      label: "New Collection",
      children: [evt],
      isExpanded: true
    }
    this.dataList.push(data)

    this.storeApi()
  }

  onViewOut(evt: any) {
    this.dataList.push(...evt);
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
      if (evt.target != 'empty') {
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
    for (let index = 0; index < this.openedList.length; index++) {
      if (this.openedList[index].id == evt.id) {
        currentIndex = index;
        this.openedList[currentIndex]["isActive"] = false;//先把要关闭的tab设为非激活状态，因为这个对象在关闭后还会被项目的树形列表使用到
        this.openedList.splice(index, 1);
        break;
      }
    }
    if(currentActived) { //关闭的tab是激活状态，则需要激活其他tab
      if (evt.isFirst) {
        if (this.openedList.length >= 1) {
          this.openedList[0]["isActive"] = true;
        }
      } else if (evt.isLast) {
        if (this.openedList.length >= 1) {
          this.openedList[this.openedList.length - 1]["isActive"] = true;
        }
      } else {
        this.openedList[currentIndex]["isActive"] = true;//close的不是第一个也不是最后一个，则激活后一个， 即中间的某一个
      }
    }

    this.storeOpenedList()
  }

  onClickTab(evt: any) {
    for (let index = 0; index < this.openedList.length; index++) {
      if (this.openedList[index].id == evt.id) {
        this.openedList[index]["isActive"] = true
      } else {
        this.openedList[index]["isActive"] = false
      }
    }
    this.storeOpenedList()
  }

  onAddNewTab(evt: any) {
    this.openedList.forEach(ele => ele.isActive = false);
    this.openedList.push(this.createNewApi())
    this.storeOpenedList()
  }

  createNewApi() {
    const apiInfo: ApiTreeNodeType = {
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
      this.openedList.forEach(ele => ele.isActive = false);
      this.openedList.push(markedTextInfo)
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
