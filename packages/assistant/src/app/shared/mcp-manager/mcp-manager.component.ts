import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

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

@Component({
  selector: 'app-mcp-manager',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './mcp-manager.component.html',
  styleUrls: ['./mcp-manager.component.css'],
})
export class McpManagerComponent {
  servers: McpServerConfig[] = [];
  loading = false;
  error: string | null = null;

  // 新建/编辑表单
  showForm = false;
  editingServer: McpServerConfig | null = null;
  formData: McpServerConfig = this.getEmptyForm();

  constructor() {
    this.loadServers();
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

  openAddForm(): void {
    this.editingServer = null;
    this.formData = this.getEmptyForm();
    this.showForm = true;
  }

  openEditForm(server: McpServerConfig): void {
    this.editingServer = server;
    this.formData = { ...server };
    this.showForm = true;
  }

  closeForm(): void {
    this.showForm = false;
    this.editingServer = null;
    this.formData = this.getEmptyForm();
  }

  saveServer(): void {
    if (!this.formData.name) {
      this.error = 'Name is required';
      return;
    }

    // 清理输入字段中的不可见字符
    this.formData.name = this.formData.name.trim();
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
