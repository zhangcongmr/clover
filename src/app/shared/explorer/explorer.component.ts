import { AfterViewChecked, AfterViewInit, Component, OnInit, inject, input, output } from '@angular/core';
import { ServerTreeComponent } from '../server-tree/server.tree.component';
import { AstTableComponent } from '../ast-table/ast-table.component';
import { PrivacyErrorDialogComponent } from '../privacy-error-dialog/privacy-error-dialog.component';
import { CoreService } from '../../core.service';

@Component({
  selector: 'app-api-explorer',
  templateUrl: './explorer.component.html',
  styleUrls: ['./explorer.component.css'],
  standalone: true,
  imports: [ServerTreeComponent, AstTableComponent, PrivacyErrorDialogComponent]
})
export class ExplorerComponent implements OnInit, AfterViewChecked, AfterViewInit {
  coreService = inject(CoreService);
  readonly importOut = output<Array<any>>();
  readonly viewOut = output<any>();
  readonly currentSidebarTab = input<number>(1);

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

  constructor() {
  }

  ngOnInit() {
    let me = this;
    this.coreService.fetchApiFromServer("https://127.0.0.1:8980/user/allBriefs", false).subscribe(
      (rawData: any) => {
        me.coreService.choosingApiLoading = false;
        if (!rawData) {
          return;
        }
        me.rawSpecBriefDefs = rawData;
        // me.data = this.coreService.parseOpenApiSpec(rawData);
      },
      (reason: any) => {
      });
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

  importFromApiDef(rawSpecBrief: any) {
    let me = this;
    this.coreService.fetchApiFromServer("https://127.0.0.1:8980/user/userModel/" + rawSpecBrief.id, false).subscribe(
      (rawData: any) => {
        me.coreService.choosingApiLoading = false;
        if (!rawData) {
          return;
        }
        me.rawSpecDef = JSON.parse(rawData.profile);
        if(me.rawSpecDef['dataType'] == 'projectType') {
          me.data = me.rawSpecDef['children'] || [];
          me.importOut.emit(me.data);
        } else {
          me.data = me.coreService.parseOpenApiSpec(me.rawSpecDef);
          me.importOut.emit(me.data);
        }
      },
      (reason: any) => {
      });
  }

  view(rawSpecBrief: any) {
    let me = this;
    this.coreService.fetchApiFromServer("https://127.0.0.1:8980/user/userModel/" + rawSpecBrief.id, false).subscribe(
      (rawData: any) => {
        me.coreService.choosingApiLoading = false;
        if (!rawData) {
          return;
        }
        me.rawSpecDef = JSON.parse(rawData.profile);
        me.data = me.coreService.parseOpenApiSpec(me.rawSpecDef);
        me.viewOut.emit({
          data: me.data,
          rawSpecDef: me.rawSpecDef
        });
      },
      (reason: any) => {
      });
  }
}
