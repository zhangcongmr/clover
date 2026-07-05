import { Component, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AstModalComponent } from '../ast-modal/ast-modal.component';
import { AstTreeComponent } from '../ast-tree/ast-tree.component';
import { AstTreeNode } from '../model';
import { LocalAgentService } from '../local-agent/local-agent.service';

@Component({
  selector: 'app-file-picker-dialog',
  standalone: true,
  imports: [AstModalComponent, AstTreeComponent, FormsModule],
  templateUrl: './file-picker-dialog.component.html',
  styleUrls: ['./file-picker-dialog.component.css']
})
export class FilePickerDialogComponent {
  private localAgentService = inject(LocalAgentService);

  visible = signal(false);
  mode = signal<'folder' | 'file'>('folder');
  title = signal('Select Folder');
  currentPath = signal('');
  treeData = signal<AstTreeNode[]>([]);
  selectedNode = signal<AstTreeNode | null>(null);
  loading = signal(false);

  readonly selected = output<{ path: string; kind: 'folder' | 'file' }>();

  openFolderPicker(startPath: string = '/') {
    this.mode.set('folder');
    this.title.set('Open Folder');
    this.selectedNode.set(null);
    this.visible.set(true);
    this.loadDirectory(startPath);
  }

  openFilePicker(startPath: string = '/') {
    this.mode.set('file');
    this.title.set('Open File');
    this.selectedNode.set(null);
    this.visible.set(true);
    this.loadDirectory(startPath);
  }

  async loadDirectory(path: string) {
    this.loading.set(true);
    this.currentPath.set(path);
    try {
      const data = await this.localAgentService.scanDir(path, 1, [
        'node_modules', '.git', 'dist', 'build', '__pycache__',
        '.angular', '.vscode', '.idea', '.vs', 'target', 'out',
        'coverage', 'logs', 'log', 'tmp', 'temp', 'cache',
        'bin', 'obj', 'vendor', 'third_party', 'jspm_packages'
      ]);

      const rootNode = this.scanNodeToTreeNode(data, path, undefined, true);
      this.treeData.set([rootNode]);
    } catch (err) {
      console.error('Failed to load directory:', err);
    } finally {
      this.loading.set(false);
    }
  }

  private scanNodeToTreeNode(scanData: any, rootPath: string, parent?: AstTreeNode, isRoot = false): AstTreeNode {
    const node: AstTreeNode = {
      id: this.uuid(),
      label: scanData.name,
      rootPath: rootPath,
      nodeType: scanData.kind === 'directory' ? 'folder' : 'file',
      isExpanded: isRoot,
      children: [],
      parentItem: parent,
    };
    node.children = (scanData.children || []).map((child: any) =>
      this.scanNodeToTreeNode(child, rootPath, node)
    );
    return node;
  }

  toggleExpand(node: AstTreeNode) {
    if (node.nodeType !== 'folder') return;
    node.isExpanded = !node.isExpanded;

    // Lazy load children on first expand
    if (node.isExpanded && node.children && node.children.length === 0) {
      this.expandFolder(node);
    }
  }

  async expandFolder(node: AstTreeNode) {
    if (node.children?.length > 0) return;
    const fullPath = this.getFullPath(node);
    try {
      const data = await this.localAgentService.scanDir(fullPath, 1);
      const newChildren = (data.children || []).map((child: any) =>
        this.scanNodeToTreeNode(child, node.rootPath || fullPath, node)
      );
      node.children = [...newChildren];
      this.treeData.update(d => [...d]);
    } catch (err) {
      console.error('Failed to expand folder:', err);
    }
  }

  expandFolderFn = (node: AstTreeNode) => this.expandFolder(node);

  // Handle click from ast-tree component
  onTreeNodeClick(node: AstTreeNode) {
    if (this.mode() === 'folder' && node.nodeType === 'folder') {
      this.selectedNode.set(node);
    } else if (this.mode() === 'file' && node.nodeType === 'file') {
      this.selectedNode.set(node);
    }
  }

  async onNodeDblClick(node: AstTreeNode) {
    if (node.nodeType === 'folder') {
      if (!node.isExpanded) {
        node.isExpanded = true;
        if (node.children && node.children.length === 0) {
          await this.expandFolder(node);
        }
      }
      this.selectedNode.set(node);
    }
  }

  getFullPath(node: AstTreeNode): string {
    const root = this.treeData()[0];
    if (!root) return node.label;

    // Walk from node up to root using parentItem
    const parts: string[] = [];
    let current: any = node;
    while (current && current !== root) {
      parts.unshift(current.label);
      current = current.parentItem;
    }
    const rootPath = (root.rootPath || '').replace(/\/+$/, '');
    return rootPath + '/' + parts.join('/');
  }

  async goUp() {
    const current = this.currentPath();
    const parent = current.split('/').slice(0, -1).join('/') || '/';
    await this.loadDirectory(parent);
  }

  confirm() {
    const node = this.selectedNode();
    if (!node) return;
    const fullPath = this.getFullPath(node);
    this.selected.emit({ path: fullPath, kind: node.nodeType as 'folder' | 'file' });
    this.visible.set(false);
  }

  cancel() {
    this.visible.set(false);
  }

  refresh() {
    this.loadDirectory(this.currentPath());
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
