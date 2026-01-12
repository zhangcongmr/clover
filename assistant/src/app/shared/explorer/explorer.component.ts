import { AfterViewChecked, AfterViewInit, CUSTOM_ELEMENTS_SCHEMA, Component, ElementRef, OnInit, inject, input, output, viewChild } from '@angular/core';
import { ServerTreeComponent } from '../server-tree/server.tree.component';
import { AstTableComponent } from '../ast-table/ast-table.component';
import { PrivacyErrorDialogComponent } from '../privacy-error-dialog/privacy-error-dialog.component';
import { CoreService } from '../../core.service';
import { basicSetup, EditorView } from 'codemirror';
import { json } from '@codemirror/lang-json';

@Component({
  selector: 'app-api-explorer',
  templateUrl: './explorer.component.html',
  styleUrls: ['./explorer.component.css'],
  standalone: true,
   schemas: [CUSTOM_ELEMENTS_SCHEMA],
  imports: [ServerTreeComponent, AstTableComponent, PrivacyErrorDialogComponent]
})
export class ExplorerComponent implements OnInit, AfterViewChecked, AfterViewInit {
  coreService = inject(CoreService);
  readonly importOut = output<Array<any>>();
  readonly viewOut = output<any>();
  readonly currentSidebarTab = input<number>(1);
  apiSourceCodeContainerView = viewChild<ElementRef<HTMLButtonElement>>('apiSourceCodeContainer');

  columns = [
    { key: "method", title: "Method" },
    { key: "path", title: "Path" },
    { key: "summary", title: "Summary" },
    { key: "serviceName", title: "ServiceName" }
  ];

  data: any = [];
  rawSpecDef: any;
  rawSpecBriefDefs = []

  dragSideWidth: string = "25%";
  dragSideRigthWidth: string = "75%"

  labels = ['用户管理'];
  label = "";

  previousEle: any;

  // spec: any;
  queryApibtnText = "刷新";

  showWidget = false;
  targetPageNumber = '';
  condition = false;

  useNew = true;
  currentUi = "Switch to old interface"
  apiSourceView!: EditorView;
  baseHref = ''

  constructor() {
  }

  ngOnInit() {
    this.baseHref = document.querySelector('base')?.getAttribute('href') || '/';
    let me = this;
    // this.coreService.fetchApiFromServer("https://127.0.0.1:8980/user/allBriefs", false).subscribe(
    //   (rawData: any) => {
    //     me.coreService.choosingApiLoading = false;
    //     if (!rawData) {
    //       return;
    //     }
    //     me.rawSpecBriefDefs = rawData;
    //     // me.data = this.coreService.parseOpenApiSpec(rawData);
    //   },
    //   (reason: any) => {
    //   });
  }

  ngAfterViewChecked(): void {
    // const bodyParamTextArea: any = document.getElementsByClassName("body-param__text");
    // if (bodyParamTextArea && bodyParamTextArea[0]) {
    //   if (bodyParamTextArea[0]["spellcheck"]) {
    //     bodyParamTextArea[0]["spellcheck"] = false;
    //   }
    // }
  }

  useNewUi() {
    this.useNew = !this.useNew
    this.currentUi = this.useNew ? "Switch to old interface" : "Switch to new interface"
  }



  ngAfterViewInit(): void {

  }

  serviceApis(evt: any) {
    this.data = evt;
  }

  apiCheckedFun(evt: any) {
    // this.selectedApiInfos = evt;
  }

  onWidgetAction(event: Event) {
    if ('detail' in event) {
      const customEvent = event as CustomEvent<{ message: string }>;
      console.log(customEvent.detail);
    }
  }

  importFromApiDef(rawSpecBrief: any) {
    let me = this;
    this.coreService.fetchApiFromServer("https://127.0.0.1:8980/user/apiInfoModel/" + rawSpecBrief.id, false).subscribe(
      (rawData: any) => {
        me.coreService.choosingApiLoading = false;
        if (!rawData) {
          return;
        }
        me.rawSpecDef = JSON.parse(rawData.profile);
        if(me.rawSpecDef['dataType'] == 'projectType') {
          me.data = me.rawSpecDef['children'] || [];
        } else {
          me.data = me.coreService.parseOpenApiSpec(me.rawSpecDef);
        }
        me.importOut.emit(me.data);
      },
      (reason: any) => {
      });
  }


  view(rawSpecBrief: any) {
    let me = this;
    this.coreService.fetchApiFromServer("https://127.0.0.1:8980/user/apiInfoModel/" + rawSpecBrief.id, false).subscribe(
      (rawData: any) => {
        me.coreService.choosingApiLoading = false;
        if (!rawData) {
          return;
        }
        me.rawSpecDef = JSON.parse(rawData.profile);
        if(me.rawSpecDef['dataType'] == 'projectType') {
          me.data = me.rawSpecDef['children'] || [];
        } else {
          me.data = me.coreService.parseOpenApiSpec(me.rawSpecDef);
        }
        me.viewApi({
          data: me.data,
          rawSpecDef: me.rawSpecDef
        });
      },
      (reason: any) => {
      });
  }

  showPreviewOrCode = true;
  sourceCodeText = '';
  subPanelType = 1;
  viewApi(evt: any) {
    this.subPanelType = 2;
    this.data = evt.data;
    this.sourceCodeText = JSON.stringify(evt.rawSpecDef, null, 2);
    if(!this.showPreviewOrCode) {
      this.showPreviewOrCodeFn(this.showPreviewOrCode);
    }
  }

  showPreviewOrCodeFn(flag: boolean) {
    this.showPreviewOrCode = flag;
    if(!flag) {
      if(this.apiSourceView) {
        //初始化之前先组件销毁,防止内存泄漏。
        this.apiSourceView.destroy()
      }
      // 替代 setTimeout. 确保在下一次渲染周期后执行代码  setTimeout虽然也可以，但存在潜在的未渲染完成时就执行的可能。requestAnimationFrame比setTimeout更可靠。
      requestAnimationFrame(() => {
        const domView = this.apiSourceCodeContainerView();
        if (domView) {
          this.apiSourceView = new EditorView({
            doc: this.sourceCodeText,
            parent: domView.nativeElement,
            extensions: [basicSetup, json(), EditorView.lineWrapping, // ✅ 正确用法 启用软换行（soft wrapping）
              EditorView.theme({
                '&': {
                  height: '100%',
                  width: '100%',
                  minHeight: '0',
                  fontFamily: 'Consolas',
                  border: 'none', // 移除边框
                  outline: 'none', // 可选：移除聚焦时的 outline
                  boxShadow: 'none',
                },
                '.cm-scroller': {
                  height: '100%',
                  overflow: 'auto',
                  // scrollbarWidth: 'thin',
                  scrollbarColor: '#ccc transparent',
                },
              })
            ],
          });
        }
      })
    }
  }

  backFn() {
    this.subPanelType = 1;
    this.showPreviewOrCode = true;
  }

}
