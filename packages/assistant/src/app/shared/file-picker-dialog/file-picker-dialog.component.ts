import { Component, computed, inject, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AstModalComponent } from '../ast-modal/ast-modal.component';
import { AstTreeComponent } from '../ast-tree/ast-tree.component';
import { AstTreeNode } from '../model';
import { pickParentObject, getNodeAbsolutePath, getFileIcon, computeFileIcons } from '../ast-tree/ast-tree.component';
import { LocalServerService } from '../local-server/local-server.service';
import { AstTabComponent } from '../ast-tab/ast-tab.component';
import { AstTabGroupComponent } from '../ast-tab/ast-tab-group/ast-tab-group.component';

@Component({
  selector: 'app-file-picker-dialog',
  standalone: true,
  imports: [CommonModule, AstModalComponent, AstTreeComponent, FormsModule, AstTabGroupComponent, AstTabComponent],
  templateUrl: './file-picker-dialog.component.html',
  styleUrls: ['./file-picker-dialog.component.css']
})
export class FilePickerDialogComponent {
  /** Directory names hidden from the picker: they are noise for project selection. */
  private static readonly IGNORED_ENTRIES = [
    'node_modules', '.git', 'dist', 'build', '__pycache__',
    '.angular', '.vscode', '.idea', '.vs', 'target', 'out',
    'coverage', 'logs', 'log', 'tmp', 'temp', 'cache',
    'bin', 'obj', 'vendor', 'third_party', 'jspm_packages'
  ];

  private localServerService = inject(LocalServerService);
  /** Guards against out-of-order responses when the user navigates quickly. */
  private loadSeq = 0;

  visible = signal(false);
  mode = signal<'folder' | 'file'>('folder');
  title = signal('Select Folder');
  currentPath = signal('');
  treeData = signal<AstTreeNode[]>([]);
  selectedNode = signal<AstTreeNode | null>(null);
  loading = signal(false);
  viewMode = signal<'tree' | 'icon'>('icon');
  directoryItems = signal<AstTreeNode[]>([]);
  /** Path separator reported by the file server; "/" until the first scan. */
  pathSeparator = signal<'\\' | '/'>('/');
  /** True while the picker lists filesystem roots (Windows drives) instead of a directory. */
  isRootsView = computed(() => this.currentPath() === '');

  selectedNodePath = computed(() => {
    const node = this.selectedNode();
    return node ? getNodeAbsolutePath(this.treeData(), node) : '';
  });

  readonly selected = output<{ path: string; kind: 'folder' | 'file' }>();

  openFolderPicker(startPath: string = '') {
    this.mode.set('folder');
    this.title.set('Open Folder');
    this.selectedNode.set(null);
    this.viewMode.set('icon');
    this.visible.set(true);
    if (startPath) {
      this.loadDirectory(startPath);
    } else {
      this.loadRoots();
    }
  }

  openFilePicker(startPath: string = '') {
    this.mode.set('file');
    this.title.set('Open File');
    this.selectedNode.set(null);
    this.viewMode.set('icon');
    this.visible.set(true);
    if (startPath) {
      this.loadDirectory(startPath);
    } else {
      this.loadRoots();
    }
  }

  /**
   * Show every filesystem root as a parallel tree/icon root. Windows machines
   * may have several drives; a single-root machine (POSIX) skips this level.
   */
  async loadRoots() {
    const seq = ++this.loadSeq;
    this.loading.set(true);
    this.selectedNode.set(null);
    try {
      const data = await this.localServerService.listRoots();
      if (seq !== this.loadSeq) return;
      const separator: '\\' | '/' = data?.separator === '\\' ? '\\' : '/';
      this.pathSeparator.set(separator);

      const roots: Array<{ name: string; path: string }> = data?.roots || [];
      // A single filesystem root has nothing to choose from: open it directly.
      if (roots.length === 1) {
        await this.loadDirectory(roots[0].path);
        return;
      }

      this.currentPath.set('');
      const nodes: AstTreeNode[] = roots.map(root => ({
        id: this.uuid(),
        label: root.name,
        rootPath: root.path,
        separator,
        nodeType: 'folder',
        isExpanded: false,
        children: [],
      }));
      this.treeData.set(nodes);
      const items = nodes.map(node => ({ ...node }));
      computeFileIcons(items);
      this.directoryItems.set(items);
    } catch (err) {
      if (seq !== this.loadSeq) return;
      console.error('Failed to load filesystem roots:', err);
      // Servers without the roots endpoint (older builds) still browse from the
      // filesystem root instead of showing an empty dialog.
      await this.loadDirectory('/');
    } finally {
      if (seq === this.loadSeq) this.loading.set(false);
    }
  }

  async loadDirectory(path: string) {
    if (!path) {
      await this.loadRoots();
      return;
    }
    const seq = ++this.loadSeq;
    this.loading.set(true);
    this.currentPath.set(path);
    // Node ids are regenerated on every load, so any previous selection is stale.
    this.selectedNode.set(null);
    try {
      const data = await this.localServerService.scanDir(path, 1, FilePickerDialogComponent.IGNORED_ENTRIES);
      if (seq !== this.loadSeq) return;

      // The server resolves the requested path against its own filesystem, so
      // prefer its answer: a POSIX-looking input like "/" becomes "D:\\" on Windows.
      const resolvedPath = data?.absolutePath || path;
      this.currentPath.set(resolvedPath);
      this.pathSeparator.set(this.resolveSeparator(data, resolvedPath));

      const rootNode = this.scanNodeToTreeNode(data, resolvedPath, undefined, true);
      this.treeData.set([rootNode]);

      const items = (rootNode.children || []).map(c => ({ ...c }));
      computeFileIcons(items);
      this.directoryItems.set(items);
    } catch (err) {
      if (seq === this.loadSeq) console.error('Failed to load directory:', err);
    } finally {
      if (seq === this.loadSeq) this.loading.set(false);
    }
  }

  private scanNodeToTreeNode(scanData: any, rootPath: string, parent?: AstTreeNode, isRoot = false): AstTreeNode {
    const absolutePath = isRoot && scanData.absolutePath ? scanData.absolutePath : rootPath;
    const node: AstTreeNode = {
      id: this.uuid(),
      label: isRoot ? this.rootLabel(scanData, absolutePath) : scanData.name,
      rootPath: absolutePath,
      separator: isRoot ? this.resolveSeparator(scanData, absolutePath) : undefined,
      nodeType: scanData.kind === 'directory' ? 'folder' : 'file',
      isExpanded: isRoot,
      children: [],
      parentItem: parent ? pickParentObject(parent) : undefined,
    };
    node.children = (scanData.children || []).map((child: any) =>
      this.scanNodeToTreeNode(child, rootPath, node)
    );
    return node;
  }

  /**
   * Filesystem roots have no basename. Show the drive ("C:") on Windows and "/"
   * elsewhere, falling back to the path when talking to an older server.
   */
  private rootLabel(scanData: any, path: string): string {
    if (scanData?.name) return scanData.name;
    const drive = /^([A-Za-z]:)[\\/]/.exec(path);
    return drive ? drive[1] : (scanData?.separator === '\\' ? path : '/');
  }

  /**
   * Prefer the separator reported by the file server; fall back to the platform
   * it reports, then to inferring it from the path shape for older servers.
   */
  private resolveSeparator(scanData: any, path: string): '\\' | '/' {
    const reported = scanData?.separator;
    if (reported === '\\' || reported === '/') return reported;
    if (scanData?.platform) return scanData.platform === 'win32' ? '\\' : '/';
    return /^[A-Za-z]:[\\/]|^\\\\/.test(scanData?.absolutePath || path) ? '\\' : '/';
  }

  toggleExpand(node: AstTreeNode) {
    if (node.nodeType !== 'folder') return;
    node.isExpanded = !node.isExpanded;

    if (node.isExpanded && node.children && node.children.length === 0) {
      this.expandFolder(node);
    }
  }

  async expandFolder(node: AstTreeNode) {
    if (node.children?.length > 0) return;
    const fullPath = getNodeAbsolutePath(this.treeData(), node);
    try {
      const data = await this.localServerService.scanDir(fullPath, 1, FilePickerDialogComponent.IGNORED_ENTRIES);
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

  onIconClick(item: AstTreeNode) {
    if (this.mode() === 'folder' && item.nodeType === 'folder') {
      this.selectedNode.set(item);
    } else if (this.mode() === 'file' && item.nodeType === 'file') {
      this.selectedNode.set(item);
    }
  }

  async onIconDblClick(item: AstTreeNode) {
    if (item.nodeType === 'folder') {
      const fullPath = getNodeAbsolutePath(this.treeData(), item);
      await this.loadDirectory(fullPath);
      this.selectedNode.set(null);
    }
  }

  setViewMode(mode: 'tree' | 'icon') {
    this.viewMode.set(mode);
  }

  getFileIconName(label: string): string {
    return getFileIcon(label);
  }

  async goUp() {
    const current = this.currentPath();
    if (!current) return; // Already at the filesystem roots list.
    const sep = this.pathSeparator();
    // A filesystem root ("/", "D:\" or a bare drive) or a UNC share root has no
    // parent directory: on Windows go up to the list of drives instead.
    const isUncShareRoot = sep === '\\' && /^\\\\[^\\]+\\[^\\]+\\?$/.test(current);
    if (current === '/' || current === '\\' || /^[A-Za-z]:[\\/]?$/.test(current) || isUncShareRoot) {
      if (sep === '\\') await this.loadRoots();
      return;
    }
    const normalized = current.replace(/[\\/]+$/, '');
    const idx = normalized.lastIndexOf(sep);
    let parent = idx > 0 ? normalized.slice(0, idx) : sep;
    // Keep the drive root intact: "D:" -> "D:\".
    if (/^[A-Za-z]:$/.test(parent)) parent += sep;
    await this.loadDirectory(parent);
  }

  confirm() {
    const node = this.selectedNode();
    if (!node) return;
    const fullPath = getNodeAbsolutePath(this.treeData(), node);
    if (!fullPath) return;
    this.selected.emit({ path: fullPath, kind: node.nodeType as 'folder' | 'file' });
    this.visible.set(false);
  }

  cancel() {
    this.visible.set(false);
  }

  refresh() {
    if (this.isRootsView()) {
      this.loadRoots();
    } else {
      this.loadDirectory(this.currentPath());
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
