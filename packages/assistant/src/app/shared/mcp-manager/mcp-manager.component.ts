import { Component, OnDestroy, OnInit, PLATFORM_ID, inject, signal } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  McpRegistryService,
  buildLocalConfig,
  deriveLocalName,
  localNameCandidates,
  summarizeServer,
  type RegistryListItem,
  type LocalMcpServerConfig as McpServerConfig,
} from './mcp-registry.service';
import { LocalServerService } from '../local-server/local-server.service';
import { SkeletonGate, createSkeletonRows } from '../skeleton/skeleton';

type ManagerTab = 'configured' | 'registry';

/** registry 搜索防抖时长（ms）。 */
const SEARCH_DEBOUNCE_MS = 300;

@Component({
  selector: 'app-mcp-manager',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './mcp-manager.component.html',
  styleUrls: ['./mcp-manager.component.css'],
})
export class McpManagerComponent implements OnInit, OnDestroy {
  private readonly registryService = inject(McpRegistryService);
  private readonly localServer = inject(LocalServerService);
  private readonly platformId = inject(PLATFORM_ID);

  servers: McpServerConfig[] = [];
  loading = false;
  error: string | null = null;

  // 新建/编辑表单
  showForm = false;
  editingServer: McpServerConfig | null = null;
  formData: McpServerConfig = this.getEmptyForm();
  nameError: string | null = null;

  // 聚合：官方 MCP Registry 浏览
  tab: ManagerTab = 'configured';
  registryItems: RegistryListItem[] = [];
  registryCursor: string | null = null;
  registryLoading = signal(false);
  /** 首屏骨架屏可见态。独立于 registryLoading —— 后者会在收到数据时立即
   *  置 false，而骨架需要按最短展示时长延后消失。 */
  registrySkeleton = signal(false);
  registryError: string | null = null;
  registrySearch = '';
  /** 正在安装的 registry 条目 key（用于按钮态）。 */
  installingKey: string | null = null;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  /** 请求序号，丢弃过期的搜索/分页响应。 */
  private registryRequestSeq = 0;

  /** 骨架屏占位行。 */
  readonly skeletonRows = createSkeletonRows();
  /** 骨架屏最短展示时长闸门。 */
  private readonly skeletonGate = new SkeletonGate();

  ngOnInit(): void {
    this.loadServers();
  }

  ngOnDestroy(): void {
    if (this.searchTimer !== null) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
    this.skeletonGate.clear();
  }

  loadServers(): void {
    // SSR: Node's fetch rejects relative URLs; the browser re-runs this on hydration.
    if (!isPlatformBrowser(this.platformId)) return;

    this.loading = true;
    this.error = null;

    // 使用 fetch 调用 MCP API
    fetch(`${this.localServer.getBaseUrl()}/api/mcp/servers`)
      .then(res => res.json())
      .then(data => {
        this.servers = data.servers || [];
        this.loading = false;
      })
      .catch(err => {
        this.error = 'Failed to load servers';
        this.loading = false;
        console.error('Failed to load MCP servers:', err);
      });
  }

  /* ---------------------------------------------------------------------- */
  /* 聚合入口：官方 MCP Registry 浏览 / 搜索 / 安装                            */
  /* ---------------------------------------------------------------------- */

  switchTab(tab: ManagerTab): void {
    this.tab = tab;
    if (tab === 'registry' && this.registryItems.length === 0 && !this.registryLoading()) {
      this.loadRegistry(true);
    }
  }

  /** 搜索框变更：300ms 防抖后重置列表重新加载。 */
  onRegistrySearchChange(value: string): void {
    this.registrySearch = value;
    if (this.searchTimer !== null) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.searchTimer = null;
      this.loadRegistry(true);
    }, SEARCH_DEBOUNCE_MS);
  }

  /**
   * 加载 registry 一页数据。
   * `reset=true` 清空列表（新搜索），否则按游标追加（Load more）。
   */
  loadRegistry(reset: boolean): void {
    if (reset) this.registryCursor = null;
    const requestId = ++this.registryRequestSeq;
    const cursor = this.registryCursor;
    const search = this.registrySearch.trim();

    // 首屏（尚无任何条目）时展示骨架屏；后续翻页保留已有列表，不遮挡。
    const firstLoad = this.registryItems.length === 0;

    this.registryLoading.set(true);
    this.registryError = null;
    if (firstLoad) {
      this.registrySkeleton.set(true);
      this.skeletonGate.begin();
    }

    this.registryService
      .listServers({ search: search || undefined, cursor })
      .then(page => {
        if (requestId !== this.registryRequestSeq) return; // 过期响应
        if (reset) {
          this.registryItems = page.items;
        } else {
          const seen = new Set(this.registryItems.map(item => item.key));
          this.registryItems = [
            ...this.registryItems,
            ...page.items.filter(item => !seen.has(item.key)),
          ];
        }
        this.registryCursor = page.nextCursor;
        this.registryLoading.set(false);
        this.finishRegistrySkeleton(requestId, firstLoad);
      })
      .catch(err => {
        if (requestId !== this.registryRequestSeq) return;
        // registryError 是普通字段，必须在 signal 写入（触发变更检测）之前
        // 赋值，否则模板可能读到上一轮的旧值。
        this.registryError =
          err instanceof Error && err.message
            ? err.message
            : 'Failed to reach the official MCP registry';
        this.registryLoading.set(false);
        this.finishRegistrySkeleton(requestId, firstLoad);
        console.error('Failed to load official MCP registry:', err);
      });
  }

  /**
   * 结束骨架屏。
   *
   * 首屏走闸门，保证骨架至少展示 MIN_SKELETON_DURATION，避免接口秒回时
   * 骨架一闪而过；翻页（Load more）没有骨架，立即收起。
   * 过期的请求（requestId 不匹配）直接忽略。
   */
  private finishRegistrySkeleton(requestId: number, firstLoad: boolean): void {
    if (requestId !== this.registryRequestSeq) return;

    if (!firstLoad) {
      this.registrySkeleton.set(false);
      return;
    }

    this.skeletonGate.end(() => {
      if (requestId === this.registryRequestSeq) {
        this.registrySkeleton.set(false);
      }
    });
  }

  /** 条目的本地安装名（已被本地同名配置占用时返回该名，视为已安装）。 */
  installedLocalName(item: RegistryListItem): string | null {
    const taken = new Set(this.servers.map(server => server.name));
    for (const candidate of localNameCandidates(item.server.name)) {
      if (taken.has(candidate)) return candidate;
    }
    return null;
  }

  /** 是否可本地安装（能映射出 stdio/http 配置）。 */
  canInstall(item: RegistryListItem): boolean {
    return buildLocalConfig(item.server, 'probe') !== null;
  }

  /** 列表预览串：`npx -y pkg@1.2.3` 或 remote URL。 */
  registryPreview(item: RegistryListItem): string | null {
    return summarizeServer(item.server);
  }

  /** 外链：官网 → 仓库 → registry 文档。 */
  registryLink(item: RegistryListItem): string | null {
    const server = item.server;
    if (server.websiteUrl) return server.websiteUrl;
    if (server.repository?.url) return server.repository.url;
    return null;
  }

  /**
   * 安装 registry 条目为本地 MCP server：
   * 派生本地 name（防覆盖 upsert）→ 映射配置 → POST /api/mcp/servers → 刷新列表。
   */
  installRegistryServer(item: RegistryListItem): void {
    if (this.installingKey) return;
    this.error = null;

    const taken = new Set(this.servers.map(server => server.name));
    const localName = deriveLocalName(item.server.name, taken);
    if (!localName) {
      this.error = `"${item.server.name}" conflicts with an existing server name`;
      return;
    }
    const config = buildLocalConfig(item.server, localName);
    if (!config) {
      this.error = `"${item.server.name}" cannot be installed locally (no runnable package or remote transport)`;
      return;
    }

    this.installingKey = item.key;
    fetch(`${this.localServer.getBaseUrl()}/api/mcp/servers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    })
      .then(res => res.json())
      .then(data => {
        if (data.error) {
          this.error = data.error;
        } else {
          this.loadServers();
        }
      })
      .catch(err => {
        this.error = 'Failed to install server from registry';
        console.error('Failed to install MCP server from registry:', err);
      })
      .finally(() => {
        this.installingKey = null;
      });
  }

  openAddForm(): void {
    this.editingServer = null;
    this.formData = this.getEmptyForm();
    this.nameError = null;
    this.showForm = true;
  }

  openEditForm(server: McpServerConfig): void {
    this.editingServer = server;
    this.formData = { ...server };
    this.nameError = null;
    this.showForm = true;
  }

  closeForm(): void {
    this.showForm = false;
    this.editingServer = null;
    this.formData = this.getEmptyForm();
    this.nameError = null;
  }

  onNameChange(): void {
    this.nameError = null;
  }

  saveServer(): void {
    const name = this.formData.name?.trim();
    if (!name) {
      this.nameError = 'Name is required';
      return;
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      this.nameError = 'Name may only contain letters, numbers, hyphens and underscores (no spaces)';
      return;
    }

    // 清理输入字段中的不可见字符
    this.formData.name = name;
    this.formData.description = this.formData.description?.trim() || '';
    this.formData.command = this.formData.command?.trim() || '';

    const base = this.localServer.getBaseUrl();
    const url = this.editingServer
      ? `${base}/api/mcp/servers/${this.editingServer.name}`
      : `${base}/api/mcp/servers`;

    const method = this.editingServer ? 'PUT' : 'POST';

    fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(this.formData),
    })
      .then(res => res.json())
      .then(data => {
        if (data.error) {
          this.error = data.error;
        } else {
          this.closeForm();
          this.loadServers();
        }
      })
      .catch(err => {
        this.error = 'Failed to save server';
        console.error('Failed to save MCP server:', err);
      });
  }

  deleteServer(name: string): void {
    if (!confirm(`Are you sure you want to delete server "${name}"?`)) {
      return;
    }

    fetch(`${this.localServer.getBaseUrl()}/api/mcp/servers/${name}`, { method: 'DELETE' })
      .then(res => res.json())
      .then(data => {
        if (data.error) {
          this.error = data.error;
        } else {
          this.loadServers();
        }
      })
      .catch(err => {
        this.error = 'Failed to delete server';
        console.error('Failed to delete MCP server:', err);
      });
  }

  private getEmptyForm(): McpServerConfig {
    return {
      type: 'stdio',
      name: '',
      description: '',
      command: '',
      args: [],
      env: {},
    };
  }
}
