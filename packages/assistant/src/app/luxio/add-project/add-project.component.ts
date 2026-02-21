import { Component, OnInit, inject, output } from '@angular/core';
import { CoreService } from '../../core.service';
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
  content: string = '';
  importFromApiDefUrl = ""

  ngOnInit() {
  }

  async openAddDlg() {
    this.visible = true;
  }

  close() {
    this.visible = false;
    this.importType = '1';
  }

  private confirmSelected(selectedData: any) {
    this.apiInfoSelected.emit(selectedData);
    this.close();
    this.reset();
  }

  importTypeChangeFn(flag: string) {
    this.importType = flag;
    this.reset();
  }

  private reset() {
    this.content = '';
    this.fileName = '';
  }

  fileContentChangedFn(evt: any) {
    this.content = evt.content;
    this.fileName = evt.fileName;
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
        me.confirmSelected({
          content: JSON.stringify(rawData),
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
      content: this.content,
    })
  }
}
