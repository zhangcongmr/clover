# 合并 luxio-agent 到 Angular SSR 方案

## 1. 背景与目标

### 现状

- `@luxio/agent`（`packages/luxio-agent`）是一个独立的 Node.js 进程，提供：
  - **文件系统服务**：通过 WebSocket 提供 `listDir`、`readFile`、`writeFile` 等 9 种操作
  - **PTY 终端服务**：通过 `node-pty` 提供伪终端，支持交互式 shell
  - **安全认证**：HMAC-SHA256 一次性 token、路径穿越防护、Origin 校验
- Angular 前端通过 `LocalAgentService` 以 HTTP + WebSocket 连接到 SSR 自身（端口 4200）
- 合并为单进程，文件操作和终端均由 SSR 服务器提供

### 目标

- 将 `luxio-agent` 的功能合并到 Angular SSR 服务器（`packages/assistant/src/server.ts`）
- 前端文件操作改为发送 HTTP 请求到 SSR，由 Node.js 直接处理
- 终端 PTY 仍通过 WebSocket 连接到 SSR 自身（不再连独立进程）
- `AstTreeNode` 增加 `rootPath` 字段保存绝对路径
- 合并后只需部署一个进程
- 去掉 workspace 概念，用户通过文件选择对话框自由浏览任意目录
- 统一部署模型：所有部署使用相同的 Angular SSR 包，通过 agentUrl 配置决定文件访问目标

### 不变的部分

- 远程项目的 WebSocket 文件操作流程不变
- SSR 的 A2A 代理、静态文件服务等功能不变

### 核心改造：浏览器 File System Access API → Node.js API

当前打开本地文件夹/文件依赖浏览器的 `showDirectoryPicker()` 和 `showOpenFilePicker()`，存在以下问题：
- **只有 Chromium 浏览器支持**（Safari、Firefox 不支持）
- **无法获取绝对路径**（浏览器安全限制）
- **浏览器刷新后 handle 丢失**（需要重新选择）

改造后完全由 Node.js API 完成：
- 用户点击 "Open Folder" → 发请求到 SSR → Node.js `fs.readdir()` 扫描目录 → 返回带绝对路径的文件树
- 用户点击 "Open File" → 发请求到 SSR → Node.js `fs.readFile()` 读取文件 → 返回内容和路径
- **所有浏览器都能用**，且天然获取绝对路径

---

## 2. 文件变更清单

### 2.1 需要移动/改造的文件（从 luxio-agent 迁移到 assistant）

| 源文件 | 目标位置 | 说明 |
|---|---|---|
| `packages/luxio-agent/src/auth.ts` | `packages/assistant/src/server/agent/auth.ts` | TokenManager 类，原样迁移 |
| `packages/luxio-agent/src/security.ts` | `packages/assistant/src/server/agent/security.ts` | validatePath 函数，原样迁移 |
| `packages/luxio-agent/src/protocol.ts` | `packages/assistant/src/server/agent/protocol.ts` | 类型定义，原样迁移 |
| `packages/luxio-agent/src/pty-manager.ts` | `packages/assistant/src/server/agent/pty-manager.ts` | PtyManager 类，原样迁移 |
| `packages/luxio-agent/src/file-service.ts` | `packages/assistant/src/server/agent/file-service.ts` | FileService 类，原样迁移 |

### 2.2 需要修改的文件

| 文件 | 修改内容 |
|---|---|
| `packages/assistant/src/server.ts` | 新增 `/api/local/*` 路由和 WebSocket 终端升级 |
| `packages/assistant/package.json` | 新增 `node-pty`、`ws` 依赖 |
| `packages/assistant/src/app/shared/model.ts` | `AstTreeNode` 接口增加 `rootPath` 字段 |
| `packages/assistant/src/app/shared/local-agent/local-agent.service.ts` | 重写为 HTTP 客户端（替代 WebSocket） |
| `packages/assistant/src/app/luxio/content/content.component.ts` | 文件操作改为调用 SSR API，初始化时设置 rootPath |
| `packages/assistant/src/app/luxio/content/content.component.html` | "Open Folder"/"Open File" 改为调用 Node.js API |
| `packages/assistant/src/app/luxio/add-project/add-project.component.ts` | 树构建时设置 rootPath |
| `packages/assistant/src/app/shared/terminal/terminal.component.ts` | 本地项目 WebSocket 连接到 SSR 自身 |
| `pnpm-workspace.yaml` | 保留 `node-pty` 构建许可（已有） |

### 2.3 新增的文件

| 文件 | 说明 |
|---|---|
| `packages/assistant/src/server/agent/index.ts` | 统一导出 |
| `packages/assistant/src/app/shared/file-picker-dialog/file-picker-dialog.component.ts` | 文件/文件夹选择对话框组件 |
| `packages/assistant/src/app/shared/file-picker-dialog/file-picker-dialog.component.html` | 对话框模板 |
| `packages/assistant/src/app/shared/file-picker-dialog/file-picker-dialog.component.css` | 对话框样式 |

---

## 3. 详细设计

### 3.1 `AstTreeNode` 增加 `rootPath` 字段

**文件**: `packages/assistant/src/app/shared/model.ts`

```typescript
export interface AstTreeNode {
  // ... 现有字段 ...

  /**
   * Local project properties
   */
  isLocal?: boolean;
  rootPath?: string;  // 新增：本地项目的绝对路径根目录
}
```

**用途**：
- 根节点的 `rootPath` 存储绝对路径（如 `/home/user/project`）
- 子节点通过遍历父链可获取完整绝对路径
- 替代当前 `generateLocalFilePath()` 通过 `label` 拼接路径的方式

### 3.2 SSR 服务器新增路由

**文件**: `packages/assistant/src/server.ts`

在现有 Express 应用中新增以下路由：

```
HTTP 路由（文件操作）:
  POST /api/local/listDir     - 列出目录内容
  POST /api/local/readFile    - 读取文件
  POST /api/local/writeFile   - 写入文件
  POST /api/local/deleteFile  - 删除文件
  POST /api/local/createFile  - 创建文件
  POST /api/local/createDir   - 创建目录
  POST /api/local/rename      - 重命名
  POST /api/local/stat        - 获取文件信息
  POST /api/local/exists      - 检查是否存在

WebSocket 路由（PTY 终端）:
  WS /ws/terminal?token=xxx   - 连接 PTY 终端
```

#### HTTP 路由实现

```typescript
// 导入迁移过来的模块
import { FileService } from './server/agent/file-service.js';
import { PtyManager } from './server/agent/pty-manager.js';
import { TokenManager } from './server/agent/auth.js';
import { validatePath } from './server/agent/security.js';
import type { LocalFileRequest } from './server/agent/protocol.js';

// 配置
const agentConfig = {
  port: parseInt(process.env['PORT'] || '4200'),
  host: '0.0.0.0',
  readonly: process.env['LUXIO_READONLY'] === 'true',
  tokenSecret: process.env['LUXIO_TOKEN_SECRET'],
  tokenTTL: 30
};

// 初始化服务
const tokenManager = new TokenManager(agentConfig.tokenSecret, agentConfig.tokenTtl);
const fileService = new FileService();  // 无 workspace 限制，用户自由浏览
const ptyManager = new PtyManager();
```

**安全措施**：
- 所有 `/api/local/*` 路由需要验证 Authorization header（Bearer token）
- token 通过 `POST /api/local/auth/token` 获取
- 路径穿越防护复用 `validatePath()`（防止 `../../etc/passwd` 等攻击）
- 默认模式（无 agentUrl）：限制只能访问特定目录（通过环境变量 `ALLOWED_DIRS` 配置）
- agentUrl 模式：访问 agentUrl 所在服务器的文件系统，由该服务器的 ALLOWED_DIRS 控制

**agentUrl 配置机制**：

通过 UI Settings 界面配置，运行时生效，无需重启服务。

- **配置路径**：Settings → Agent URL
- **存储方式**：`localStorage.setItem('assistant_agentUrl', url)`
- **读取方式**：`LocalAgentService` 直接读取 `localStorage.getItem('assistant_agentUrl')`
- **默认值**：空（同源模式，请求发到当前页面所在服务器）
  - **示例**：`http://192.168.1.100:4200`（指向目标 SSR 服务器的端口，与 SSR 端口一致）

**CORS 配置**（仅 agentUrl 指向不同源时需要）：

```typescript
// packages/assistant/src/server.ts

// 固定白名单：SSR 自身 + 开发服务器
const allowedOrigins = [
  'http://localhost:4200',
  'http://127.0.0.1:4200'
];

app.use((req, res, next) => {
  const origin = req.headers.origin || '';
  if (!origin || allowedOrigins.some(o => origin.startsWith(o))) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  next();
});
```

#### WebSocket PTY 路由实现

```typescript
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'node:http';

// 在 Express server 创建后，升级 WebSocket
const httpServer = app.listen(port);
const wss = new WebSocketServer({ noServer: true });

httpServer.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);

  if (url.pathname === '/ws/terminal') {
    const token = url.searchParams.get('token');
    if (!token || !tokenManager.verify(token)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', (ws, req) => {
  let ptyId: string | null = null;

  ws.on('message', (data) => {
    const msg = data.toString();

    if (!ptyId) {
      // 第一条消息：初始化 PTY
      try {
        const init = JSON.parse(msg);
        if (init.type === 'pty') {
          const instance = ptyManager.create(init.cols, init.rows, init.cwd || process.cwd());
          ptyId = instance.id;

          instance.pty.onData((output) => {
            if (ws.readyState === WebSocket.OPEN) ws.send(output);
          });
          instance.pty.onExit(() => {
            if (ws.readyState === WebSocket.OPEN) ws.close(1000, 'PTY exited');
          });
        }
      } catch (e) {
        ws.close(4002, 'Invalid init message');
      }
      return;
    }

    // 后续消息：PTY 输入或 resize
    const instance = ptyManager.getById(ptyId);
    if (!instance) { ws.close(1000, 'PTY not found'); return; }

    try {
      const resizeMsg = JSON.parse(msg);
      if (resizeMsg.type === 'resize') {
        instance.pty.resize(resizeMsg.cols, resizeMsg.rows);
        return;
      }
    } catch (e) { /* 不是 JSON，作为 PTY 输入 */ }

    instance.pty.write(msg);
  });

  ws.on('close', () => { if (ptyId) ptyManager.destroy(ptyId); });
  ws.on('error', () => { if (ptyId) ptyManager.destroy(ptyId); });
});
```

### 3.3 重写 LocalAgentService

**文件**: `packages/assistant/src/app/shared/local-agent/local-agent.service.ts`

将 WebSocket 通信改为 HTTP 请求（文件操作）+ WebSocket（PTY 终端）。

**关键设计**：支持同源部署和分离部署两种模式。通过 `agentUrl` 配置项决定 API 地址：
- 未配置 `agentUrl` → 同源模式，请求发到当前页面所在服务器
- 配置了 `agentUrl` → 分离模式，请求发到指定的本地 SSR 服务器

```typescript
@Injectable({ providedIn: 'root' })
export class LocalAgentService {
  private agentUrl = '';
  private token: string | null = null;
  private tokenExpiry = 0;

  isAvailable = signal(false);
  connectedUrl = signal<string>('');

  constructor() {
    const stored = localStorage.getItem('assistant_agentUrl');
    if (stored) {
      this.agentUrl = stored;
    }
  }

  // 获取 API 基础地址（同源 or 分离）
  private getBaseUrl(): string {
    return this.agentUrl || window.location.origin;
  }

  // 获取认证 token
  async getToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiry) return this.token;
    const base = this.getBaseUrl();
    const res = await fetch(`${base}/api/local/auth/token`);
    if (!res.ok) throw new Error(`Token request failed: ${res.status}`);
    const data = await res.json();
    this.token = data.token;
    this.tokenExpiry = Date.now() + (data.expiresIn * 1000) - 5000;
    return this.token!;
  }

  // 获取 WebSocket 终端地址
  async getTerminalWsUrl(): Promise<string> {
    const token = await this.getToken();
    const base = this.getBaseUrl();
    const url = new URL(base);
    const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${url.host}/ws/terminal?token=${token}`;
  }

  // 文件操作
  async scanDir(path: string, depth = 1, ignore: string[] = []): Promise<any> {
    const token = await this.getToken();
    const base = this.getBaseUrl();
    const res = await fetch(`${base}/api/local/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ path, depth, ignore })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    return data.data;
  }

  async listDir(path: string): Promise<any[]> {
    const token = await this.getToken();
    const base = this.getBaseUrl();
    const res = await fetch(`${base}/api/local/listDir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ path })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    return data.data;
  }

  async readFile(path: string): Promise<string> {
    const token = await this.getToken();
    const base = this.getBaseUrl();
    const res = await fetch(`${base}/api/local/readFile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ path })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    return data.data.content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    const token = await this.getToken();
    const base = this.getBaseUrl();
    const res = await fetch(`${base}/api/local/writeFile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ path, content })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
  }

  async deleteFile(path: string): Promise<void> { /* 类似 */ }
  async createFile(path: string): Promise<void> { /* 类似 */ }
  async createDir(path: string): Promise<void> { /* 类似 */ }
  async rename(oldPath: string, newName: string): Promise<void> { /* 类似 */ }
  async stat(path: string): Promise<any> { /* 类似 */ }
  async exists(path: string): Promise<boolean> { /* 类似 */ }

  // 健康检查
  async probeAndConnect(): Promise<boolean> {
    try {
      const base = this.getBaseUrl();
      const res = await fetch(`${base}/api/local/health`);
      this.isAvailable.set(res.ok);
      if (res.ok) this.connectedUrl.set(base);
      return res.ok;
    } catch {
      this.isAvailable.set(false);
      return false;
    }
  }

  disconnect() { /* 清理 token */ }
}
```

### 3.4 content.component.ts 修改

**文件**: `packages/assistant/src/app/luxio/content/content.component.ts`

#### 3.4.1 `generateLocalFilePath` 改为使用 rootPath

```typescript
// 旧：通过 label 拼接
private generateLocalFilePath(node: AstTreeNode): string {
  const pathParts: string[] = [];
  let current: any = node;
  while (current) {
    pathParts.unshift(current.label);
    current = current.parentItem;
  }
  return pathParts.join('/');
}

// 新：通过 rootPath + 相对路径
private generateLocalFilePath(node: AstTreeNode): string {
  // 找到根节点的 rootPath
  const root = this.dataList()[0];
  const rootPath = root?.rootPath || '';
  if (!rootPath) {
    // fallback：旧逻辑
    const pathParts: string[] = [];
    let current: any = node;
    while (current) {
      pathParts.unshift(current.label);
      current = current.parentItem;
    }
    return pathParts.join('/');
  }

  // 从当前节点向上遍历到根节点（排除根节点本身）
  const pathParts: string[] = [];
  let current: any = node;
  while (current && current !== root) {
    pathParts.unshift(current.label);
    current = current.parentItem;
  }
  return rootPath + '/' + pathParts.join('/');
}
```

#### 3.4.2 新增 FilePickerDialogComponent（文件/文件夹选择对话框）

新建一个专用的文件选择对话框组件，复用现有的 `AstModalComponent` 和 `AstTreeComponent`。

**文件**: `packages/assistant/src/app/shared/file-picker-dialog/file-picker-dialog.component.ts`

```typescript
@Component({
  selector: 'app-file-picker-dialog',
  standalone: true,
  imports: [AstModalComponent, AstTreeComponent, FormsModule],
  templateUrl: './file-picker-dialog.component.html',
  styleUrls: ['./file-picker-dialog.component.css']
})
export class FilePickerDialogComponent {
  private localAgentService = inject(LocalAgentService);

  visible = false;
  mode = signal<'folder' | 'file'>('folder');  // 选择模式
  title = signal('Select Folder');
  currentPath = signal('');                     // 当前浏览路径
  treeData = signal<AstTreeNode[]>([]);        // 文件树
  selectedNode = signal<AstTreeNode | null>(null);  // 选中的节点
  loading = false;

  readonly selected = output<{ path: string; kind: 'folder' | 'file' }>();

  // 打开对话框（默认从根目录 / 开始浏览）
  openFolderPicker(startPath: string = '/') {
    this.mode.set('folder');
    this.title.set('Open Folder');
    this.selectedNode.set(null);
    this.visible = true;
    this.loadDirectory(startPath);
  }

  openFilePicker(startPath: string = '/') {
    this.mode.set('file');
    this.title.set('Open File');
    this.selectedNode.set(null);
    this.visible = true;
    this.loadDirectory(startPath);
  }

  // 加载目录（调用 SSR scan API）
  async loadDirectory(path: string) {
    this.loading = true;
    this.currentPath.set(path);
    try {
      const data = await this.localAgentService.scanDir(path, 1, [
        'node_modules', '.git', 'dist', 'build', '__pycache__',
        '.angular', '.vscode', '.idea', '.vs', 'target', 'out',
        'coverage', 'logs', 'log', 'tmp', 'temp', 'cache',
        'bin', 'obj', 'vendor', 'third_party', 'jspm_packages'
      ]);

      this.treeData.set([this.scanNodeToTreeNode(data, path)]);
    } catch (err) {
      console.error('Failed to load directory:', err);
    } finally {
      this.loading = false;
    }
  }

  // scan API 返回值 → AstTreeNode
  private scanNodeToTreeNode(scanData: any, rootPath: string): AstTreeNode {
    return {
      id: this.uuid(),
      label: scanData.name,
      rootPath: rootPath,
      nodeType: scanData.kind === 'directory' ? 'folder' : 'file',
      isExpanded: true,
      children: (scanData.children || []).map((child: any) =>
        this.scanNodeToTreeNode(child, rootPath)
      ),
    };
  }

  // 点击节点
  onNodeClick(node: AstTreeNode) {
    if (this.mode() === 'folder' && node.nodeType === 'folder') {
      this.selectedNode.set(node);
    } else if (this.mode() === 'file' && node.nodeType === 'file') {
      this.selectedNode.set(node);
    }
  }

  // 双击文件夹 → 进入子目录
  async onNodeDblClick(node: AstTreeNode) {
    if (node.nodeType === 'folder') {
      const fullPath = this.getFullPath(node);
      await this.loadDirectory(fullPath);
    }
  }

  // 展开子目录 → 懒加载
  async onExpandFolder(node: AstTreeNode) {
    if (node.children && node.children.length > 0) return; // 已加载
    const fullPath = this.getFullPath(node);
    try {
      const data = await this.localAgentService.scanDir(fullPath, 1);
      node.children = (data.children || []).map((child: any) =>
        this.scanNodeToTreeNode(child, node.rootPath || fullPath)
      );
    } catch (err) {
      console.error('Failed to expand folder:', err);
    }
  }

  // 获取节点的完整绝对路径
  private getFullPath(node: AstTreeNode): string {
    const parts: string[] = [];
    let current: any = node;
    while (current) {
      parts.unshift(current.label);
      current = current.parentItem;
    }
    // 如果有 rootPath，用 rootPath 作为基准
    const root = this.treeData()[0];
    if (root?.rootPath) {
      return root.rootPath + '/' + parts.slice(1).join('/');
    }
    return parts.join('/');
  }

  // 导航到上级目录
  async goUp() {
    const current = this.currentPath();
    const parent = current.split('/').slice(0, -1).join('/') || '/';
    await this.loadDirectory(parent);
  }

  // 确认选择
  confirm() {
    const node = this.selectedNode();
    if (!node) return;
    const fullPath = this.mode() === 'folder'
      ? this.getFullPath(node)
      : this.getFullPath(node);
    this.selected.emit({ path: fullPath, kind: node.nodeType as 'folder' | 'file' });
    this.visible = false;
  }

  // 关闭
  cancel() {
    this.visible = false;
  }
}
```

**模板** (`file-picker-dialog.component.html`)：

```html
<ast-modal [visible]="visible()" [title]="title()" modalSize="large" (close)="cancel()">
  <div class="file-picker">
    <!-- 路径导航栏 -->
    <div class="path-bar">
      <button (click)="goUp()" class="nav-btn" title="Go up">../</button>
      <input [value]="currentPath()" (keyup.enter)="loadDirectory($event.target.value)"
             class="path-input" placeholder="Enter path...">
      <button (click)="loadDirectory(currentPath())" class="nav-btn" title="Refresh">...</button>
    </div>

    <!-- 文件树 -->
    <div class="tree-container" [style.height]="'350px'">
      @if (loading()) {
        <div class="loading">Loading...</div>
      } @else {
        <div [ast-tree] [data]="treeData()"
             (nodeClick)="onNodeClick($event)"
             (nodeDblClick)="onNodeDblClick($event)">
        </div>
      }
    </div>

    <!-- 底部按钮 -->
    <div class="dialog-footer">
      <span class="selected-info">
        @if (selectedNode()) {
          Selected: {{ getFullPath(selectedNode()!) }}
        }
      </span>
      <div class="footer-buttons">
        <button (click)="cancel()" class="btn-cancel">Cancel</button>
        <button (click)="confirm()" class="btn-confirm" [disabled]="!selectedNode()">Open</button>
      </div>
    </div>
  </div>
</ast-modal>
```

**交互流程**：
```
用户点击 "Open Folder"
       ↓
弹出 FilePickerDialog（模态对话框）
       ↓
自动调用 scan API 加载 /（根目录）或上次路径
       ↓
用户浏览：点击文件夹 → 进入子目录（调用 scan API 懒加载）
       ↓
用户点击 "Open" 确认
       ↓
返回 { path: "/home/user/project", kind: "folder" }
       ↓
content.component 用这个路径调用 scan API 构建完整文件树
```

#### 3.4.3 HTML 模板改造

`content.component.html` 中的 "Open Folder" 和 "Open File" 按钮改为触发对话框：

```html
<!-- 替换原有的 Open Folder / Open File 按钮 -->
<div style="text-align:center; color: var(--vscode-foreground);">
  <div style="border:1px solid var(--vscode-statusBar-background); padding:1.25rem; border-radius:4px; background:var(--vscode-background); display:inline-block;">
    <div style="font-weight:600; margin-bottom:0.5rem;">NO FOLDER/FILE OPENED</div>
    <div style="margin-bottom:1rem; color:var(--vscode-textSeparator-foreground);">You have not yet opened a folder or file.</div>
    <div style="display:flex;gap:0.5rem;justify-content:center;align-items:center;margin-bottom:0.6rem;">
      <button (click)="filePicker.openFolderPicker()"
              style="background:var(--primary-color, rgb(103, 137, 186));color:#fff;border:none;padding:0.6rem 1.25rem;border-radius:4px;cursor:pointer;">
        Open Folder
      </button>
      <button (click)="filePicker.openFilePicker()"
              style="background:#e1e1e1;color:#222;border:none;padding:0.6rem 1.25rem;border-radius:4px;cursor:pointer;">
        Open File
      </button>
    </div>
    <div style="margin-top:0.2rem; color:var(--vscode-textSeparator-foreground); font-size:0.9rem;">
      Click to browse and select a local folder or file.
    </div>
  </div>
</div>

<!-- 文件选择对话框 -->
<app-file-picker-dialog #filePicker (selected)="onFilePickerSelected($event)"></app-file-picker-dialog>
```

对应 `content.component.ts`：

```typescript
// 引用对话框组件
@ViewChild('filePicker') filePicker!: FilePickerDialogComponent;

// 对话框确认回调
async onFilePickerSelected(result: { path: string; kind: 'folder' | 'file' }) {
  if (result.kind === 'folder') {
    await this.openFolderViaNodeApi(result.path);
  } else {
    await this.openFileViaNodeApi(result.path);
  }
}

// 通过 Node.js API 打开文件夹
async openFolderViaNodeApi(path: string) {
  try {
    const data = await this.localAgentService.scanDir(path, 1, [
      'node_modules', '.git', 'dist', 'build', '__pycache__'
    ]);
    const rootNode: AstTreeNode = {
      id: this.uuid(),
      label: data.name,
      rootPath: data.absolutePath,
      isLocal: true,
      nodeType: 'folder',
      children: (data.children || []).map((e: any) => ({
        id: this.uuid(),
        label: e.name,
        rootPath: data.absolutePath,
        nodeType: e.kind === 'directory' ? 'folder' : 'file',
        children: e.kind === 'directory' ? [] : undefined,
      })),
      isExpanded: true,
    };
    assignDeepLevel([rootNode]);
    this.assignDeepParent([rootNode]);
    this.dataList.set([rootNode]);
    this.storeApi();
  } catch (err) {
    this.notificationService.showNotification('Failed to open folder', 'error');
  }
}

// 通过 Node.js API 打开文件
async openFileViaNodeApi(path: string) {
  try {
    const content = await this.localAgentService.readFile(path);
    const fileName = path.split(/[/\\]/).pop() || path;
    const fileNode: AstTreeNode = {
      id: this.uuid(),
      label: fileName,
      rootPath: path,
      isLocal: true,
      nodeType: 'file',
      content: content,
      children: [],
    };
    assignDeepLevel([fileNode]);
    this.dataList.set([fileNode]);
    this.storeApi();
  } catch (err) {
    this.notificationService.showNotification('Failed to open file', 'error');
  }
}
```

`ngOnInit` 中的 `'dataList' in docObj || 'openedList' in docObj` 分支保持不变。当 OPFS 中保存了 `isLocal: true` 和 `rootPath` 的数据时，会自动恢复。需要确保：

- `restoreHandles` 在遇到 `isLocal: true` 的节点时，跳过 `folderHandle` 恢复（浏览器 handle 不能持久化）
- 恢复后 `rootPath` 字段自然被保留（因为它是 JSON 序列化的）

### 3.5 add-project.component.ts 修改

**文件**: `packages/assistant/src/app/luxio/add-project/add-project.component.ts`

改造后，`fileContentChangedFn` 不再接收 `FileSystemHandle`，改为接收 Node.js scan API 返回的数据：

```typescript
// 新方法：接收 Node.js scan API 的结果构建树
buildTreeFromScanResult(scanData: any, target: Array<AstTreeNode>, rootPath: string) {
  const node: AstTreeNode = {
    id: this.uuid(),
    label: scanData.name,
    rootPath: rootPath,
    nodeType: scanData.kind === 'directory' ? 'folder' : 'file',
    isExpanded: false,
    children: [],
  };
  target.push(node);

  if (scanData.children) {
    for (const child of scanData.children) {
      this.buildTreeFromScanResult(child, node.children!, rootPath);
    }
  }
}

// 旧方法保留作为 fallback（浏览器环境）
private async buildTreeFromDirectory(dirHandle: any, target: Array<AstTreeNode>, rootPath?: string) {
  // ... 保持不变 ...
}
```

### 3.6 terminal.component.ts 修改

**文件**: `packages/assistant/src/app/shared/terminal/terminal.component.ts`

#### 3.6.1 `detectLocalProject` 使用 rootPath

```typescript
private detectLocalProject(dataList: Array<any>) {
  if (dataList.length === 0) return;
  const docObj = dataList[0];
  this.userName = this.coreService.userData?.username || "Anonymous";
  this.isLocalProject = docObj.isLocal === true;

  if (this.isLocalProject) {
    // 优先使用 rootPath（绝对路径），fallback 到 label
    this.customCwd = docObj.rootPath || docObj.label;
  } else {
    this.customCwd = "/mnt/storage/" + docObj.label;
  }
  this.containerName = 'con-' + this.userName + '-' + docObj.label;
}
```

#### 3.6.2 `connectLocalPty` 连接到 SSR 自身

```typescript
private async connectLocalPty(): Promise<void> {
  try {
    // 改为从 SSR 获取 WebSocket URL
    const wsUrl = await this.localAgentService.getTerminalWsUrl();

    this.websocket = new WebSocket(wsUrl);

    this.websocket.onopen = () => {
      this.websocket!.send(JSON.stringify({
        type: 'pty',
        cols: this.terminal.cols,
        rows: this.terminal.rows,
        cwd: this.customCwd  // 使用绝对路径
      }));

      this.attachAddon = new AttachAddon(this.websocket!);
      this.terminal.loadAddon(this.attachAddon);
      this.isConnected = true;
    };

    this.websocket.onerror = (err) => {
      console.error('[Terminal] PTY error:', err);
    };

    this.websocket.onclose = () => {
      this.isConnected = false;
    };
  } catch (err) {
    console.error('[Terminal] Failed to connect to PTY:', err);
    this.terminal.writeln('\r\n\x1b[31m[Error] Failed to connect to terminal.\x1b[0m');
  }
}
```

### 3.7 package.json 依赖变更

**文件**: `packages/assistant/package.json`

```jsonc
{
  "dependencies": {
    // 新增
    "node-pty": "^1.1.0",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    // 新增
    "@types/ws": "^8.18.0"
  }
}
```

---

## 4. API 接口设计

### 4.1 认证

```
POST /api/local/auth/token
Response: { token: string, expiresIn: number }
```

### 4.2 文件操作

所有文件操作 API 使用 POST 方法，请求体统一格式：

```typescript
interface LocalFileRequest {
  path: string;
  content?: string;    // writeFile 使用
  newName?: string;    // rename 使用
}
```

| 端点 | 说明 | 响应 |
|---|---|---|
| `POST /api/local/scan` | 扫描目录，构建文件树 | `{ success, data: ScanResult }` |
| `POST /api/local/listDir` | 列出目录内容（单层） | `{ success, data: [{name, absolutePath, kind, size, mtime}] }` |
| `POST /api/local/readFile` | 读取文件 | `{ success, data: {content, size, absolutePath} }` |
| `POST /api/local/writeFile` | 写入文件 | `{ success, data: {size} }` |
| `POST /api/local/deleteFile` | 删除 | `{ success }` |
| `POST /api/local/createFile` | 创建文件 | `{ success }` |
| `POST /api/local/createDir` | 创建目录 | `{ success }` |
| `POST /api/local/rename` | 重命名 | `{ success, data: {newPath} }` |
| `POST /api/local/stat` | 文件信息 | `{ success, data: {name, kind, size, mtime, absolutePath} }` |
| `POST /api/local/exists` | 是否存在 | `{ success, data: {exists} }` |

#### 4.2.1 `POST /api/local/scan` — 扫描目录构建文件树（核心新增）

这是替代浏览器 `showDirectoryPicker()` 的核心 API。

**请求**：
```json
{
  "path": "/home/user/project",
  "depth": 1,
  "ignore": ["node_modules", ".git", "dist", "build", "__pycache__"]
}
```

**响应**：
```json
{
  "success": true,
  "data": {
    "name": "project",
    "absolutePath": "/home/user/project",
    "kind": "directory",
    "children": [
      {
        "name": "src",
        "absolutePath": "/home/user/project/src",
        "kind": "directory",
        "children": []
      },
      {
        "name": "package.json",
        "absolutePath": "/home/user/project/package.json",
        "kind": "file",
        "size": 1234,
        "mtime": "2026-07-04T10:00:00Z"
      }
    ]
  }
}
```

**设计要点**：
- `depth` 控制递归深度，默认 `1`（只扫描第一层），展开文件夹时按需加载子目录
- `ignore` 是忽略的目录名列表，前端传入，后端过滤
- 返回 `absolutePath`，前端直接存入 `AstTreeNode.rootPath`
- 子目录的 `children` 为空数组，前端展开时再调用 `scan` 加载

**SSR 实现**：
```typescript
// server.ts 中
app.post('/api/local/scan', async (req, res) => {
  const { path: dirPath, depth = 1, ignore = [] } = req.body;
  // 防路径穿越
  const resolved = resolve(dirPath);
  if (!existsSync(resolved)) {
    return res.json({ success: false, message: 'Path not found' });
  }

  async function scanDir(dir: string, currentDepth: number): Promise<any> {
    const entries = await readdir(dir, { withFileTypes: true });
    const children = [];

    for (const entry of entries) {
      if (ignore.includes(entry.name)) continue;
      const fullPath = join(dir, entry.name);
      const s = statSync(fullPath, { throwIfNoEntry: false });

      const node: any = {
        name: entry.name,
        absolutePath: fullPath,
        kind: entry.isDirectory() ? 'directory' : 'file',
      };

      if (entry.isDirectory() && currentDepth > 0) {
        node.children = await scanDir(fullPath, currentDepth - 1);
      } else if (entry.isDirectory()) {
        node.children = []; // 懒加载
      } else {
        node.size = s?.size || 0;
        node.mtime = s?.mtime?.toISOString() || null;
      }

      children.push(node);
    }
    return children;
  }

  const tree = await scanDir(resolved, depth - 1);
  res.json({ success: true, data: tree[0] }); // 返回根节点
});
```

### 4.3 PTY 终端

```
WebSocket /ws/terminal?token=<token>
  Client → Server: { type: "pty", cols: 80, rows: 24, cwd: "/path/to/project" }
  Server → Client: PTY 输出（原始数据）
  Client → Server: { type: "resize", cols: 120, rows: 40 }
  Client → Server: PTY 输入（原始数据）
```

### 4.4 健康检查

```
GET /api/local/health
Response: { status: "ok" }
```

---

## 5. 数据流

### 5.1 打开本地文件夹（Node.js API + 文件选择对话框）

```
用户点击 "Open Folder" 按钮
       ↓
弹出 FilePickerDialog（模态对话框，复用 AstModalComponent）
       ↓
自动调用 POST /api/local/scan 加载根目录
       ↓
用户浏览：点击文件夹进入子目录（懒加载，每次只扫一层）
       ↓
路径栏可手动输入/编辑路径
       ↓
用户选中文件夹 → 点击 "Open"
       ↓
返回 { path: "/home/user/project", kind: "folder" }
       ↓
content.component.openFolderViaNodeApi(path)
       ↓
调用 scan API 重新扫描完整目录（depth=1）
       ↓
构建 AstTreeNode，rootPath = "/home/user/project"
       ↓
dataList.set([rootNode])  →  UI 渲染文件树
```

### 5.2 打开本地文件（Node.js API + 文件选择对话框）

```
用户点击 "Open File" 按钮
       ↓
弹出 FilePickerDialog（mode="file"）
       ↓
用户浏览并选中文件 → 点击 "Open"
       ↓
返回 { path: "/home/user/project/src/index.ts", kind: "file" }
       ↓
content.component.openFileViaNodeApi(path)
       ↓
调用 LocalAgentService.readFile(path)  →  HTTP POST /api/local/readFile
       ↓
SSR: fs.readFile(path, 'utf-8')
       ↓
构建文件节点，rootPath = 文件绝对路径
       ↓
dataList.set([fileNode])  →  UI 渲染文件内容
```

### 5.3 终端连接

```
terminal.component.connectLocalPty()
       ↓
LocalAgentService.getTerminalWsUrl()  →  /ws/terminal?token=xxx
       ↓
WebSocket 连接到 SSR 自身
       ↓
发送 { type: "pty", cols, rows, cwd: "/home/user/project" }
       ↓
SSR PtyManager.create()  →  node-pty spawn shell
       ↓
双向数据流：PTY output → WS → xterm.js
```

### 5.4 文件读写

```
读取文件:
  content.component → localAgentService.readFile(rootPath + "/src/index.ts")
    → HTTP POST /api/local/readFile { path: "/home/user/project/src/index.ts" }
    → SSR FileService.readFile() → fs.readFile()
    → 返回文件内容

保存文件:
  content.component → localAgentService.writeFile(rootPath + "/src/index.ts", content)
    → HTTP POST /api/local/writeFile { path: "/home/user/project/src/index.ts", content }
    → SSR FileService.writeFile() → fs.writeFile()
```

### 5.5 agentUrl 模式数据流

当配置了 agentUrl 时，文件操作请求跨域发到 agentUrl 指定的服务器。

```
浏览器加载页面（来自当前 SSR）
       ↓
Angular 启动，读取 agentUrl 配置
  → agentUrl = "http://192.168.1.100:4200"
       ↓
用户点击 "Open Folder" → FilePickerDialog
       ↓
LocalAgentService.scanDir(path)
  → getBaseUrl() 返回 "http://192.168.1.100:4200"
  → HTTP POST http://192.168.1.100:4200/api/local/scan（跨域请求）
       ↓
目标 SSR 收到请求
  → CORS 中间件检查 origin
  → Node.js fs.readdir() 扫描文件系统
  → 返回文件树
       ↓
浏览器渲染文件树，rootPath = "/home/user/project"
```

**CORS 跨域流程**：
```
浏览器请求 http://192.168.1.100:4200/api/local/scan
  Origin: http://当前SSR服务器:4200
       ↓
目标 SSR CORS 中间件:
  allowedOrigins = ['http://localhost:4200']
  包含 http://当前SSR服务器:4200 ✓
        ↓
设置 Access-Control-Allow-Origin: http://当前SSR服务器:4200
       ↓
浏览器允许跨域请求 ✓
```

### 5.6 部署模型

所有部署使用相同的 Angular SSR 包，通过 `agentUrl` 配置决定文件系统访问目标。

#### 默认模式（agentUrl 不设置）

文件操作请求发到当前 SSR 服务器，由该服务器的 Node.js 处理。

```
浏览器 ──→ 当前 SSR 服务器
              └── Node.js fs ──→ 该服务器的文件系统
                                （限制只能访问 ALLOWED_DIRS 指定的目录）
```

#### agentUrl 模式（agentUrl 已配置）

文件操作请求发到 agentUrl 指定的服务器。

```
浏览器 ──→ agentUrl 指定的服务器
              └── Node.js fs ──→ 该服务器的文件系统
```

- `agentUrl = "http://localhost:4200"` → 访问浏览器所在机器的文件系统
- `agentUrl = "http://192.168.1.100:4200"` → 访问 192.168.1.100 的文件系统

#### 配置项

| 配置方式 | 说明 | 默认值 |
|---|---|---|
| UI Settings → Agent URL | 跨域目标 SSR 地址（端口与 SSR 一致） | 空（同源模式） |
| `ALLOWED_DIRS` | 允许访问的目录列表（逗号分隔） | `/home,/tmp,/mnt` |

---

## 6. 实施步骤

### 阶段一：迁移 agent 核心模块（不破坏现有功能）

1. 创建 `packages/assistant/src/server/agent/` 目录
2. 将 `auth.ts`、`security.ts`、`protocol.ts`、`pty-manager.ts`、`file-service.ts` 复制到该目录
3. 创建 `index.ts` 统一导出
4. 验证 TypeScript 编译通过

### 阶段二：SSR 服务器新增 API 路由

5. 在 `server.ts` 中导入 agent 模块
6. 新增 CORS 中间件（支持分离部署）
7. 新增 `/api/local/auth/token` 路由
8. 新增 `/api/local/health` 路由
9. 新增 `/api/local/*` 文件操作路由（复用 FileService）
10. 新增 WebSocket `/ws/terminal` 路由（复用 PtyManager）
11. 验证 API 可用（curl 测试）

### 阶段三：前端改造

11. `model.ts`：`AstTreeNode` 增加 `rootPath` 字段
12. `local-agent.service.ts`：重写为 HTTP 客户端
13. `content.component.ts`：修改 `generateLocalFilePath` 使用 rootPath
14. `content.component.ts`：新增 `openLocalPath` 方法
15. `content.component.html`：增加路径输入框 UI
16. `add-project.component.ts`：`buildTreeFromDirectory` 设置 rootPath
17. `terminal.component.ts`：`detectLocalProject` 使用 rootPath
18. `terminal.component.ts`：`connectLocalPty` 连接到 SSR

### 阶段四：依赖与构建

19. `package.json`：添加 `node-pty`、`ws` 依赖
20. 验证 `pnpm install` 和 `pnpm build` 通过
21. 测试完整流程

---

## 7. 风险与注意事项

| 风险 | 影响 | 缓解措施 |
|---|---|---|
| `node-pty` 编译失败 | 构建阻塞 | `pnpm-workspace.yaml` 已允许 `node-pty` 构建；Docker 镜像需安装 `build-essential` |
| PTY 实例耗尽 SSR 内存 | 服务不稳定 | PtyManager 已有 `maxInstances=10` 和 30 分钟空闲超时 |
| 合并后 PTY 崩溃影响 SSR | 全站不可用 | PTY 错误需要 try-catch 隔离，不向上冒泡 |
| 用户需要手动输入路径 | 体验不如文件选择器 | 可后续增加"最近打开的路径"历史记录功能 |
| 大目录扫描耗时 | 首次加载慢 | scan API 的 `depth` 参数控制递归深度，子目录懒加载 |
| node-pty 原生依赖增加 Docker 镜像体积 | 部署包变大 | 使用多阶段构建，只在 build 阶段安装编译工具 |
| 分离部署时本地 SSR 暴露公网 | 文件系统被外部访问 | 必须启用 token 认证 + 绑定 `127.0.0.1`（仅局域网） |
| 默认模式目录限制过严 | 用户无法访问目标目录外的文件 | 调整 `ALLOWED_DIRS` 环境变量 |
| agentUrl 指向错误的端口 | 文件操作失败 | agentUrl 端口必须与目标 SSR 服务器端口一致 |

---

## 8. 后续可选优化

- **只读模式**：通过环境变量 `LUXIO_READONLY=true` 禁止写操作
- **文件监视**：合并后可用 `fs.watch` 实现文件变更自动刷新
- **多用户隔离**：如果部署为多用户服务，需要增加认证和路径限制
- **Electron 桌面应用**：合并后 SSR 服务器可直接内嵌到 Electron main process
