import { Component, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  McpRegistryService,
  buildLocalConfig,
  deriveLocalName,
  localNameCandidates,
  summarizeServer,
  type RegistryListItem,
} from './mcp-registry.service';

interface McpServerConfig {
  type: 'stdio' | 'http';
  name: string;
  description: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

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
export class McpManagerComponent implements OnDestroy {
  private readonly registryService = inject(McpRegistryService);

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
  registryError: string | null = null;
  registrySearch = '';
  /** 正在安装的 registry 条目 key（用于按钮态）。 */
  installingKey: string | null = null;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  /** 请求序号，丢弃过期的搜索/分页响应。 */
  private registryRequestSeq = 0;

  constructor() {
    this.loadServers();
  }

  ngOnDestroy(): void {
    if (this.searchTimer !== null) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
  }

  loadServers(): void {
    this.loading = true;
    this.error = null;

    // 使用 fetch 调用 MCP API
    fetch('/api/mcp/servers')
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

    this.registryLoading.set(true);
    this.registryError = null;

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
      })
      .catch(err => {
        if (requestId !== this.registryRequestSeq) return;
        this.registryError =
          err instanceof Error && err.message
            ? err.message
            : 'Failed to reach the official MCP registry';
        this.registryLoading.set(false);
        console.error('Failed to load official MCP registry:', err);
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
    fetch('/api/mcp/servers', {
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

    const url = this.editingServer
      ? `/api/mcp/servers/${this.editingServer.name}`
      : '/api/mcp/servers';

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

    fetch(`/api/mcp/servers/${name}`, { method: 'DELETE' })
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
