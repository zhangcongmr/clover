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

  directoryTreeData: Array<AstTreeNode> = [];
  folderReadWriteMode: 'read' | 'readwrite' = 'readwrite';

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

  async fileContentChangedFn(evt: Array<FileSystemFileHandle | FileSystemDirectoryHandle>) {
    this.directoryTreeData = [];
    for (let index = 0; index < evt.length; index++) {
      const hd: any = evt[index];
      if (hd.kind === 'directory') {
        const tempTree: any = []
        await this.buildTreeFromDirectory(hd, tempTree);
        const rootName = hd.name || 'folder';

        this.directoryTreeData.push(
          {
            id: this.uuid(),
            label: rootName,
            children: tempTree,
            nodeType: 'folder',
            isExpanded: true,
            // store handle for later operations
            folderHandle: hd,
            folderInfo: {
              servers: []
            },
            mode: 'read'
          }
        );
      } else {
        const tempTree: any = []
        await this.buildTreeFromDirectory(hd, tempTree);
        this.directoryTreeData.push(...tempTree)
      }
    }
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
      this.confirmSelected(this.directoryTreeData);
    }
  }


  async openFolder(mode: 'read' | 'readwrite' = 'readwrite') {
    if (!('showDirectoryPicker' in window)) {
      alert('The File System Access API is not supported in this browser.');
      return;
    }
    try {
      const folderHandle = await (window as any).showDirectoryPicker({ mode });
      await this.fileContentChangedFn([folderHandle]);
    } catch (err) {
      console.error('openFolder error', err);
    }
  }

  async openFileInContent() {
    if (!('showOpenFilePicker' in window)) {
      alert('The File System Access API is not supported in this browser.');
      return;
    }
    try {
      const folderHandle = await (window as any).showOpenFilePicker({ multiple: true });
      await this.fileContentChangedFn(folderHandle);
    } catch (err) {
      console.error('openFolder error', err);
    }
  }

  private clearFolderSelection() {
    this.directoryTreeData = [];
  }

  private async buildTreeFromDirectory(dirHandle: any, target: Array<AstTreeNode>) {
    if(dirHandle.kind === 'file') {
      const node: AstTreeNode = await this.createAstTreeNode(dirHandle.name, dirHandle);
      target.push(node);
    } else {
      for await (const [name, handle] of (dirHandle as any).entries()) {
        // don't traverse into node_modules, .git, dist/build, etc. to avoid performance issues
        const ignoreDirs = new Set(['node_modules', '.git', 'dist', 'build', 'venv', 'bower_components',
          '.cache', '__pycache__', '.angular', '.vscode', '.idea', '.vs', 'target', 'out', 'coverage',
          'logs', 'log', 'tmp', 'temp', 'cache', 'build', 'bin', 'obj', 'vendor', 'third_party',
          'jspm_packages']);
        if (handle.kind === 'directory' && ignoreDirs.has(name)) {
          continue;
        }
        const node: AstTreeNode = await this.createAstTreeNode(name, handle);

        target.push(node);
        if (handle.kind === 'directory') {
          await this.buildTreeFromDirectory(handle, node.children!);
        }
      }
    }
  }

  private async createAstTreeNode(name: any, handle: any) {
    const node: AstTreeNode = {
      id: this.uuid(),
      label: name,
      children: [],
      nodeType: handle.kind === 'file' ? 'file' : 'folder',
      isExpanded: false,
      // keep reference to handle for later read/write operations
      folderHandle: handle,
      mode: this.folderReadWriteMode
    } as any;

    if (handle.kind === 'file') {
      if (!this.coreService.isBinaryName(name)) {
        try {
          const fh = await handle.getFile();
          node.content = await fh.text();
        } catch (err) {
          console.warn('add-project: failed to read file content', name, err);
          node.content = '';
        }
      } else {
        node.content = 'Binary file - content not loaded';
      }
    }
    return node;
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

