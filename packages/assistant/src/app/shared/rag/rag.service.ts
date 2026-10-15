import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { AcpService, type AcpMessage } from '../acp/acp.service';
import type { ContentBlock } from '../acp/acp.model';
import type { LocalMcpServerConfig } from '../mcp-manager/mcp-registry.service';
import { extractRagResult, type RagDocumentInfo, type RagSearchHit } from '../acp/tool-call-info.pipe';

const RAG_SERVER_STORAGE_KEY = 'clover.rag.serverName';
const AUTO_ATTACH_STORAGE_KEY = 'clover.rag.autoAttach';

/** Extensions we can hand to the agent as plain text. PDF/DOCX need a real parser. */
const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'json', 'jsonl', 'csv', 'tsv', 'log', 'yaml', 'yml',
  'xml', 'html', 'css', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'go',
  'rs', 'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cs', 'rb', 'php', 'sh', 'sql',
  'toml', 'ini', 'conf', 'env', 'gitignore',
]);

export interface RagUploadCandidate {
  name: string;
  size: number;
  text: string;
}

/**
 * Drives the RAG knowledge base (`@clover/mcp-rag`) through the agent.
 *
 * The app ships no MCP client, so every operation — indexing, searching, listing,
 * deleting — is expressed as an imperative prompt that asks the agent to call the
 * matching MCP tool. Results are then read back off the ACP message stream by
 * {@link extractRagResult}. The service therefore holds no authoritative state of
 * its own: the knowledge base panel is a prompt composer plus a view over the most
 * recent tool result.
 */
@Injectable({ providedIn: 'root' })
export class RagService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly acpService = inject(AcpService);

  /** Every configured MCP server; used to spot the RAG one. */
  readonly servers = signal<LocalMcpServerConfig[]>([]);
  readonly serversLoading = signal(false);
  readonly serversError = signal<string | null>(null);

  /** Name of the MCP server the agent should treat as the knowledge base. */
  readonly ragServerName = signal<string | null>(null);

  /** When on, the RAG server is attached to the session on every submit. */
  readonly autoAttach = signal(true);

  /** Most recent RAG tool result of each kind, derived from the message stream. */
  readonly lastSearchResult = computed<RagSearchHit[]>(() => this.latestResult('search')?.hits ?? []);
  readonly lastListResult = computed<RagDocumentInfo[]>(() => this.latestResult('list')?.documents ?? []);
  readonly lastIndexResult = computed(() => this.latestResult('index') ?? null);

  /**
   * Whether a result of that kind exists at all.
   *
   * Needed because an empty array is ambiguous on its own: it means both "the
   * knowledge base is empty" and "the agent has never been asked".
   */
  readonly hasListResult = computed(() => this.latestResult('list') !== null);
  readonly hasSearchResult = computed(() => this.latestResult('search') !== null);

  readonly hasRagServer = computed(() => this.ragServerName() !== null);

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.ragServerName.set(localStorage.getItem(RAG_SERVER_STORAGE_KEY));
      this.autoAttach.set(localStorage.getItem(AUTO_ATTACH_STORAGE_KEY) !== 'false');
    }
  }

  /**
   * Loads the configured MCP servers and picks the RAG one.
   *
   * The heuristic is deliberately loose: `name`, `command` or `description`
   * mentioning "rag". Users can override the choice in the panel's Settings tab.
   */
  async refreshServers(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;
    this.serversLoading.set(true);
    this.serversError.set(null);
    try {
      const response = await fetch('/api/mcp/servers');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      const servers: LocalMcpServerConfig[] = Array.isArray(body?.servers) ? body.servers : [];
      this.servers.set(servers);

      const current = this.ragServerName();
      const stillPresent = current && servers.some(s => s.name === current);
      if (!stillPresent) {
        this.setRagServerName(this.detectRagServer(servers));
      }
    } catch (error) {
      this.serversError.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.serversLoading.set(false);
    }
  }

  setRagServerName(name: string | null): void {
    this.ragServerName.set(name);
    if (!isPlatformBrowser(this.platformId)) return;
    if (name) localStorage.setItem(RAG_SERVER_STORAGE_KEY, name);
    else localStorage.removeItem(RAG_SERVER_STORAGE_KEY);
  }

  setAutoAttach(enabled: boolean): void {
    this.autoAttach.set(enabled);
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem(AUTO_ATTACH_STORAGE_KEY, String(enabled));
    }
  }

  /** Whether the RAG server is part of the session's current MCP selection. */
  isAttached(): boolean {
    const name = this.ragServerName();
    return !!name && this.acpService.selectedMcpServers().includes(name);
  }

  /** True when the user must start a new session for the RAG tools to appear. */
  requiresNewSession(): boolean {
    const name = this.ragServerName();
    if (!name) return false;
    return this.acpService.hasActiveSession() && !this.isAttached();
  }

  /* ---------------------------------------------------------------------- */
  /* Prompt builders                                                        */
  /* ---------------------------------------------------------------------- */

  buildUploadPrompt(files: RagUploadCandidate[]): string {
    const names = files.map(f => `"${f.name}"`).join('、');
    return [
      `请使用 index_document 工具将以下 ${files.length} 个文档写入知识库：${names}。`,
      '',
      '要求：',
      '- 逐个调用 index_document，不要合并',
      '- documentId 使用文件名（不含扩展名）',
      '- metadata 传入 { "source": "<原始文件名>" }',
      '- 文档正文见本次消息附带的资源块，不要凭记忆复述',
    ].join('\n');
  }

  buildListPrompt(): string {
    return '请调用 list_documents 工具列出知识库中的全部文档，并原样返回结果。';
  }

  buildDeletePrompt(documentId: string): string {
    return `请调用 delete_document 工具从知识库中删除文档 "${documentId}"。`;
  }

  buildSearchPrompt(query: string, limit: number, documentId?: string): string {
    const lines = [`请调用 search 工具检索知识库，query 为「${query}」，limit 为 ${limit}。`];
    if (documentId) {
      lines.push(`限定 documentId 为 "${documentId}"。`);
    }
    lines.push('检索完成后，请基于命中的分块回答，并在引用处标注 【documentId#chunkIndex】。');
    return lines.join('\n');
  }

  /* ---------------------------------------------------------------------- */
  /* Submission                                                             */
  /* ---------------------------------------------------------------------- */

  /**
   * Sends a prompt to the agent, attaching the RAG server to the session first
   * when auto-attach is on. Throws when no RAG server is configured, since the
   * agent would otherwise silently answer from its own context.
   */
  private async submit(text: string, blocks: ContentBlock[] = []): Promise<void> {
    const name = this.ragServerName();
    if (!name) {
      throw new Error('No RAG MCP server selected. Add clover-rag in MCP Servers first.');
    }
    if (this.autoAttach()) {
      this.acpService.attachMcpServers([name]);
    }
    await this.acpService.submitPrompt(text, blocks);
  }

  upload(files: RagUploadCandidate[]): Promise<void> {
    if (files.length === 0) return Promise.resolve();
    const blocks: ContentBlock[] = files.map(file => ({
      type: 'resource',
      resource: { uri: `file:///${file.name}`, text: file.text, mimeType: 'text/plain' },
    }));
    return this.submit(this.buildUploadPrompt(files), blocks);
  }

  refreshDocuments(): Promise<void> {
    return this.submit(this.buildListPrompt());
  }

  remove(documentId: string): Promise<void> {
    return this.submit(this.buildDeletePrompt(documentId));
  }

  search(query: string, limit: number, documentId?: string): Promise<void> {
    if (!query.trim()) return Promise.resolve();
    return this.submit(this.buildSearchPrompt(query.trim(), limit, documentId));
  }

  /* ---------------------------------------------------------------------- */
  /* File handling                                                          */
  /* ---------------------------------------------------------------------- */

  /** Extensions this panel can turn into text attachments. */
  isSupported(file: File): boolean {
    const dot = file.name.lastIndexOf('.');
    if (dot < 0) return (file.type || '').startsWith('text/');
    return TEXT_EXTENSIONS.has(file.name.slice(dot + 1).toLowerCase());
  }

  /** Reads a picked file into an upload candidate, or `null` if unusable. */
  async readFile(file: File): Promise<RagUploadCandidate | null> {
    if (!this.isSupported(file)) return null;
    try {
      return { name: file.name, size: file.size, text: await file.text() };
    } catch {
      return null;
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Result derivation                                                      */
  /* ---------------------------------------------------------------------- */

  /** The newest tool result of the given kind anywhere in the message stream. */
  private latestResult(kind: 'search' | 'list' | 'index' | 'delete') {
    const messages = this.acpService.messages();
    for (let i = messages.length - 1; i >= 0; i--) {
      const result = extractRagResult(messages[i] as AcpMessage);
      if (result?.kind === kind) return result;
    }
    return null;
  }

  private detectRagServer(servers: LocalMcpServerConfig[]): string | null {
    const match = servers.find(server => {
      const haystack = [server.name, server.command, server.url, server.description]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes('rag');
    });
    return match?.name ?? null;
  }
}