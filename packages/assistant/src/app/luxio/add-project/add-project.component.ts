import { Component, OnInit, inject, output } from '@angular/core';
import { CoreService, ConfigService } from '../../core.service';
import { AstTableComponent } from '../../shared/ast-table/ast-table.component';
import { FormsModule } from '@angular/forms';

import { AstModalComponent } from '../../shared/ast-modal/ast-modal.component';
import { ServerTreeComponent } from '../../shared/server-tree/server.tree.component';
import { FileInputComponent } from '../../shared/file-input/file-input.component';
import { ExplorerComponent } from '../../shared/explorer/explorer.component';

@Component({
    selector: 'app-add-project',
    templateUrl: './add-project.component.html',
    styleUrls: ['./add-project.component.css'],
    standalone: true,
    imports: [ExplorerComponent, AstModalComponent, ServerTreeComponent,FileInputComponent, FormsModule, AstTableComponent]
})
export class AddProjectComponent implements OnInit {
  private coreService = inject(CoreService);

  readonly confirmed = output<Array<any>>();
  readonly apiInfoSelected = output<Array<any>>();

  visible!: boolean;
  importType = '1';  // 1 - From API Definition  2 - From Community  3 - From Local
  fileName: string = '';
  sourceCodeText: string = '';
  importFromApiDefUrl = ""

  data = [];


  serverList: Array<any> = [];
  currentServer: any = {};
  selectedApiInfos: Array<any> = [];
  showServerInfo = false;

  ngOnInit() {
  }

  async openAddDlg() {
    this.visible = true;
  }

  close() {
    this.data = [];
    this.selectedApiInfos = [];
    this.visible = false;
    this.importType = '1';
  }

  beforeClose = () => {
    // this.msgBox.confirm({
    //   title: '提示',
    //   content: '有未保存的数据，确认关闭吗？',
    //   type: 'warning',
    //   callback: (action: XMessageBoxAction) => {
    //     action === 'confirm' && this.close();
    //   }
    // });
    this.close();
  };

  confirm() {
    this.confirmSelected(this.selectedApiInfos);
  }

  private confirmSelected(selectedData: any) {
    this.apiInfoSelected.emit(selectedData);
    this.close();
    this.reset();
  }

  cancel() {
    this.close();
    this.reset();
  }

  clickRoot(evt: any) {
    this.showServerInfo = true;
    this.currentServer = evt;
  }

  serviceApis(evt: any) {
    this.data = evt;
    this.showServerInfo = false;
  }

  apiCheckedFun(evt: any) {
    // this.selectedApiInfos = evt;
  }

  importTypeChangeFn(flag: string) {
    this.importType = flag;
    this.reset();
  }

  private reset() {
    this.data = [];
    this.selectedApiInfos = [];
    this.sourceCodeText = '';
    this.fileName = '';
  }

  fileContentChangedFn(evt: any) {
    this.sourceCodeText = evt.content;
    this.fileName = evt.fileName;
    this.data = this.coreService.parseOpenApiSpec(JSON.parse(evt.content));
  }

  clearFileSelected() {
    this.reset();
  }

  importFromApiDef(evt: any) {
    let me = this;
    this.coreService.getData(this.importFromApiDefUrl).subscribe(
      (rawData: any) => {
        me.coreService.choosingApiLoading = false;
        if (!rawData) {
          return;
        }
        me.data = this.coreService.parseOpenApiSpec(rawData);
        me.confirmSelected({
          sourceCodeText: JSON.stringify(rawData),
          apiData: me.data
        })
      });
  }

  importOutFromEcosystem(evt: any) {
    this.confirmSelected({
      apiData: evt
    })
  }

  importOutFromLocal() {
    this.confirmSelected({
      fileName: this.fileName,
      sourceCodeText: this.sourceCodeText,
      apiData: this.data
    })
  }
}
