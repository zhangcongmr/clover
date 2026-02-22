import { Component, OnInit, inject, output } from '@angular/core';
import { CoreService } from '../../core.service';
import { AstTableComponent } from '../../shared/ast-table/ast-table.component';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { AstTreeComponent } from '../../shared/ast-tree/ast-tree.component';
import { AstTreeNode } from '../../shared/model';

import { AstModalComponent } from '../../shared/ast-modal/ast-modal.component';
import { ServerTreeComponent } from '../../shared/server-tree/server.tree.component';
import { FileInputComponent } from '../../shared/file-input/file-input.component';
import { ExplorerComponent } from '../../shared/explorer/explorer.component';

@Component({
    selector: 'app-add-project',
    templateUrl: './add-project.component.html',
    styleUrls: ['./add-project.component.css'],
    standalone: true,
    imports: [ExplorerComponent, AstModalComponent, ServerTreeComponent, FileInputComponent, FormsModule, AstTableComponent, AstTreeComponent, CommonModule]
})
export class AddProjectComponent implements OnInit {
  private coreService = inject(CoreService);

  readonly confirmed = output<Array<any>>();
  readonly apiInfoSelected = output<Array<any>>();

  visible!: boolean;
  importType = '1';  // 1 - From API Definition  2 - From Community  3 - From Local
  fileName: string = '';
  content: string = '';
  importFromApiDefUrl = "";

  // folder import state
  folderHandle: any = null;
  directoryTreeData: Array<AstTreeNode> = [];
  folderReadWriteMode: 'read' | 'readwrite' = 'read';

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
    this.clearFolderSelection();
  }

  fileContentChangedFn(evt: any) {
    this.content = evt.content;
    this.fileName = evt.fileName;
    // when selecting a file we should clear any previous folder data
    this.clearFolderSelection();
  }

  clearFileSelected() {
    this.reset();
    this.clearFolderSelection();
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
    });
  }

  importOutFromLocal() {
    if (this.directoryTreeData && this.directoryTreeData.length > 0) {
      // folder selected
      this.confirmSelected({
        folderHandle: this.folderHandle,
        tree: this.directoryTreeData,
        mode: this.folderReadWriteMode
      });
    } else {
      this.confirmSelected({
        fileName: this.fileName,
        content: this.content,
      });
    }
  }

  async openFolder(mode: 'read' | 'readwrite' = 'read') {
    if (!('showDirectoryPicker' in window)) {
      alert('The File System Access API is not supported in this browser.');
      return;
    }
    try {
      this.folderHandle = await (window as any).showDirectoryPicker({ mode });
      this.directoryTreeData = [];
      await this.buildTreeFromDirectory(this.folderHandle, this.directoryTreeData);
    } catch (err) {
      console.error('openFolder error', err);
    }
  }

  private clearFolderSelection() {
    this.folderHandle = null;
    this.directoryTreeData = [];
  }

  private async buildTreeFromDirectory(dirHandle: any, target: Array<AstTreeNode>) {
    for await (const [name, handle] of (dirHandle as any).entries()) {
      const node: AstTreeNode = {
        id: this.uuid(),
        label: name,
        children: [],
        nodeType: handle.kind === 'file' ? 'file' : 'folder',
        isExpanded: false,
        // keep reference to handle for later read/write operations
        custom: true,
        folderHandle: handle,
        mode: this.folderReadWriteMode
      } as any;
      target.push(node);
      if (handle.kind === 'directory') {
        await this.buildTreeFromDirectory(handle, node.children!);
      }
    }
  }

  private uuid(): string {
    let s: Array<any> = [];
    const hexDigits = '0123456789abcdef';
    for (let i = 0; i < 28; i++) {
      const start = Math.floor(Math.random() * 0x10);
      s[i] = hexDigits.substring(start, start + 1);
    }
    s[14] = '4';
    const start1 = (s[19] & 0x3) | 0x8;
    s[19] = hexDigits.substring(start1, start1 + 1);
    s[8] = s[13] = s[18] = s[23] = '-';
    s[0] = 'a';
    return s.join('');
  }
}

