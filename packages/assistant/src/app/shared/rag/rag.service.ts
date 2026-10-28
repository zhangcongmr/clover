import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, computed, effect, inject, signal, untracked } from '@angular/core';
import { AcpService, type AcpMessage } from '../acp/acp.service';
import type { ContentBlock } from '../acp/acp.model';
import type { LocalMcpServerConfig } from '../mcp-manager/mcp-registry.service';
import { extractRagResult, type RagDocumentInfo, type RagSearchHit, type RagToolKind } from '../acp/tool-call-info.pipe';
import { RagMetricsService } from './rag-metrics.service';
import {
  canUseTool,
  defaultProfile,
  normalizeProfile,
  type RagAgentProfile,
  type RagRetrievalStrategy,
} from './rag-agent-profile';

const PROFILES_STORAGE_KEY = 'clover.rag.profiles';
const ACTIVE_PROFILE_STORAGE_KEY = 'clover.rag.activeProfile';
/** Pre-profile keys, migrated into the first profile on load. */
const LEGACY_SERVER_STORAGE_KEY = 'clover.rag.serverName';
const LEGACY_AUTO_ATTACH_STORAGE_KEY = 'clover.rag.autoAttach';

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
 * its own beyond the user's {@link RagAgentProfile}s: the knowledge base panel is a
 * prompt composer plus a view over the most recent tool result.
 */
@Injectable({ providedIn: 'root' })
export class RagService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly acpService = inject(AcpService);
  private readonly metrics = inject(RagMetricsService);

  /** Every configured MCP server; used to spot RAG ones. */
  readonly servers = signal<LocalMcpServerConfig[]>([]);
  readonly serversLoading = signal(false);
  readonly serversError = signal<string | null>(null);

  /** Named RAG agent profiles (data sources + retrieval strategy). */
  readonly profiles = signal<RagAgentProfile[]>([]);
  readonly activeProfileId = signal<string | null>(null);

  readonly activeProfile = computed<RagAgentProfile>(() => {
    const id = this.activeProfileId();
    const list = this.profiles();
    return list.find(profile => profile.id === id) ?? list[0] ?? defaultProfile();
  });

  /** MCP servers the active profile treats as knowledge bases. */
  readonly serverNames = computed(() => this.activeProfile().serverNames);
  readonly autoAttach = computed(() => this.activeProfile().autoAttach);
  readonly strategy = computed<RagRetrievalStrategy>(() => this.activeProfile().strategy);
  readonly hasRagServer = computed(() => this.serverNames().length > 0);

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

  /**
   * True from the moment an index (upload) turn is dispatched until the agent
   * finishes running it. Kept on the service — rather than in the manager
   * component — so indexing stays visible in the sidebar after the manager
   * dialog auto-closes on submit.
   */
  readonly isIndexing = signal(false);

  /** Set once the dispatched index turn has actually started running. Guards
   *  against clearing {@link isIndexing} during the gap between submit and the
   *  agent picking the prompt up (session creation can take a while). */
  private indexingTurnStarted = false;
  /** Same guard, for finalising the metrics record of a RAG turn. */
  private turnActive = false;

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.restoreProfiles();
    }

    // A RAG turn is "done" once the agent stops processing: clear the indexing
    // badge and let the metrics service fold the stream back into a record.
    effect(() => {
      const processing = this.acpService.isProcessing();
      if (processing) {
        if (untracked(() => this.isIndexing())) this.indexingTurnStarted = true;
        if (untracked(() => this.metrics.hasPending())) this.turnActive = true;
        return;
      }
      if (this.indexingTurnStarted) {
        this.indexingTurnStarted = false;
        this.isIndexing.set(false);
      }
      if (this.turnActive) {
        this.turnActive = false;
        untracked(() => this.metrics.finalizeTurn(this.acpService.messages()));
      }
    });

    // Persist profiles on change (browser only).
    effect(() => {
      const profiles = this.profiles();
      const activeId = this.activeProfileId();
      if (!isPlatformBrowser(this.platformId) || profiles.length === 0) return;
      try {
        localStorage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(profiles));
        if (activeId) localStorage.setItem(ACTIVE_PROFILE_STORAGE_KEY, activeId);
      } catch {
        // Storage unavailable — profiles simply won't survive a reload.
      }
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Profiles                                                               */
  /* ---------------------------------------------------------------------- */

  private restoreProfiles(): void {
    let profiles: RagAgentProfile[] = [];
    try {
      const raw = localStorage.getItem(PROFILES_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed)) profiles = parsed.map(normalizeProfile);
    } catch {
      profiles = [];
    }

    if (profiles.length === 0) {
      const legacyServer = localStorage.getItem(LEGACY_SERVER_STORAGE_KEY);
      const legacyAuto = localStorage.getItem(LEGACY_AUTO_ATTACH_STORAGE_KEY) !== 'false';
      profiles = [
        defaultProfile({
          serverNames: legacyServer ? [legacyServer] : [],
          autoAttach: legacyAuto,
        }),
      ];
    }

    this.profiles.set(profiles);
    const savedActive = localStorage.getItem(ACTIVE_PROFILE_STORAGE_KEY);
    this.activeProfileId.set(
      profiles.some(profile => profile.id === savedActive) ? savedActive : profiles[0].id,
    );
  }

  createProfile(name?: string): RagAgentProfile {
    const profile = defaultProfile({
      name: name?.trim() || `RAG ${this.profiles().length + 1}`,
      serverNames: [],
    });
    this.profiles.update(list => [...list, profile]);
    this.activeProfileId.set(profile.id);
    return profile;
  }

  deleteProfile(id: string): void {
    if (this.profiles().length <= 1) return;
    const remaining = this.profiles().filter(profile => profile.id !== id);
    this.profiles.set(remaining);
    if (this.activeProfileId() === id) this.activeProfileId.set(remaining[0].id);
  }

  setActiveProfile(id: string): void {
    if (this.profiles().some(profile => profile.id === id)) this.activeProfileId.set(id);
  }

  /** Merges `changes` into the active profile (values are re-normalised). */
  updateActiveProfile(changes: Partial<RagAgentProfile>): void {
    const id = this.activeProfileId();
    this.profiles.update(list =>
      list.map(profile => (profile.id === id ? normalizeProfile({ ...profile, ...changes }) : profile)),
    );
  }

  /** Replaces the active profile's data sources (order preserved, deduped). */
  setServerNames(names: string[]): void {
    const seen = new Set<string>();
    const deduped: string[] = [];
    for (const name of names) {
      if (!name || seen.has(name)) continue;
      seen.add(name);
      deduped.push(name);
    }
    this.updateActiveProfile({ serverNames: deduped });
  }

  toggleServer(name: string): void {
    const current = this.serverNames();
    this.setServerNames(
      current.includes(name) ? current.filter(n => n !== name) : [...current, name],
    );
  }

  setStrategy(strategy: RagRetrievalStrategy): void {
    this.updateActiveProfile({ strategy });
  }

  setAutoAttach(enabled: boolean): void {
    this.updateActiveProfile({ autoAttach: enabled });
  }

  setToolEnabled(tool: RagToolKind, enabled: boolean): void {
    const current = this.activeProfile().toolAllowlist;
    const next = enabled
      ? Array.from(new Set([...current, tool]))
      : current.filter(t => t !== tool);
    this.updateActiveProfile({ toolAllowlist: next.length > 0 ? next : current });
  }

  canUse(tool: RagToolKind): boolean {
    return canUseTool(this.activeProfile(), tool);
  }

  /** Whether every server of the active profile is part of the session's MCP selection. */
  isAttached(): boolean {
    const names = this.serverNames();
    if (names.length === 0) return false;
    const selected = this.acpService.selectedMcpServers();
    return names.every(name => selected.includes(name));
  }

  /** True when the user must start a new session for the RAG tools to appear. */
  requiresNewSession(): boolean {
    if (this.serverNames().length === 0) return false;
    return this.acpService.hasActiveSession() && !this.isAttached();
  }

  /* ---------------------------------------------------------------------- */
  /* MCP servers                                                            */
  /* ---------------------------------------------------------------------- */

  /**
   * Loads the configured MCP servers and, when the active profile has none yet,
   * auto-detects the RAG one.
   *
   * The heuristic is deliberately loose: `name`, `command` or `description`
   * mentioning "rag". Users can override the choice in the Agent tab.
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

      // Drop servers that no longer exist, then auto-fill an empty selection.
      const known = new Set(servers.map(server => server.name));
      const current = this.serverNames();
      const stillPresent = current.filter(name => known.has(name));
      if (stillPresent.length !== current.length) {
        this.setServerNames(stillPresent);
      }
      if (stillPresent.length === 0) {
        const detected = this.detectRagServer(servers);
        if (detected) this.setServerNames([detected]);
      }
    } catch (error) {
      this.serversError.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.serversLoading.set(false);
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Prompt builders                                                        */
  /* ---------------------------------------------------------------------- */

  buildUploadPrompt(files: RagUploadCandidate[]): string {
    const names = files.map(f => `"${f.name}"`).join(', ');
    return [
      `Use the index_document tool to write the following ${files.length} documents into the knowledge base: ${names}.`,
      '',
      'Requirements:',
      '- Call index_document one document at a time; do not merge them',
      '- Use the file name (without extension) as documentId',
      '- Pass metadata as { "source": "<original file name>" }',
      '- The document content is in the resource blocks attached to this message; do not recite from memory',
    ].join('\n');
  }

  buildListPrompt(): string {
    return 'Use the list_documents tool to list all documents in the knowledge base and return the result as-is.';
  }

  buildDeletePrompt(documentId: string): string {
    return `Use the delete_document tool to delete the document "${documentId}" from the knowledge base.`;
  }

  buildSearchPrompt(query: string, limit: number, documentId?: string): string {
    const profile = this.activeProfile();
    const lines = [`Use the search tool to query the knowledge base with query "${query}" and limit ${limit}.`];

    if (profile.strategy === 'fanout-rrf' && profile.serverNames.length > 1) {
      lines.push(
        `Run search against each of the following data sources separately: ${profile.serverNames.join(', ')}; ` +
          'then merge and de-duplicate the results with Reciprocal Rank Fusion (keep only one copy per documentId#chunkIndex).',
      );
    } else if (profile.strategy === 'hybrid') {
      lines.push('Prefer hybrid (vector + keyword) retrieval; if a data source does not support hybrid mode, fall back to vector retrieval.');
    }

    if (documentId) lines.push(`Restrict documentId to "${documentId}".`);
    if (profile.minScore > 0) lines.push(`Ignore chunks with a relevance (score) below ${profile.minScore}.`);

    lines.push(
      `After retrieval, answer based on the hit chunks and cite sources at citation points in this format: ` +
        `${profile.citationStyle} (i.e. {documentId}#{chunkIndex}).`,
    );
    if (profile.answerInstruction.trim()) lines.push(profile.answerInstruction.trim());
    return lines.join('\n');
  }

  /* ---------------------------------------------------------------------- */
  /* Submission                                                             */
  /* ---------------------------------------------------------------------- */

  /**
   * Sends a prompt to the agent, attaching the active profile's servers to the
   * session first when auto-attach is on. Throws when no RAG server is
   * configured, since the agent would otherwise silently answer from its own
   * context.
   */
  private async submit(text: string, blocks: ContentBlock[] = []): Promise<void> {
    const names = this.serverNames();
    if (names.length === 0) {
      throw new Error('No RAG MCP server selected. Add clover-rag in MCP Servers first.');
    }
    if (this.autoAttach()) {
      this.acpService.attachMcpServers(names);
    }
    await this.acpService.submitPrompt(text, blocks);
  }

  async upload(files: RagUploadCandidate[]): Promise<void> {
    if (files.length === 0) return;
    const blocks: ContentBlock[] = files.map(file => ({
      type: 'resource',
      resource: { uri: `file:///${file.name}`, text: file.text, mimeType: 'text/plain' },
    }));
    this.indexingTurnStarted = false;
    this.isIndexing.set(true);
    this.metrics.beginIndex();
    try {
      await this.submit(this.buildUploadPrompt(files), blocks);
    } catch (error) {
      // Nothing will ever finish this turn, so drop the badge immediately.
      this.isIndexing.set(false);
      this.metrics.finalizeTurn(this.acpService.messages());
      throw error;
    }
  }

  refreshDocuments(): Promise<void> {
    return this.submit(this.buildListPrompt());
  }

  remove(documentId: string): Promise<void> {
    return this.submit(this.buildDeletePrompt(documentId));
  }

  async search(query: string, limit: number, documentId?: string): Promise<void> {
    const trimmed = query.trim();
    if (!trimmed) return;
    this.metrics.beginSearch(trimmed, this.serverNames());
    try {
      await this.submit(this.buildSearchPrompt(trimmed, limit, documentId));
    } catch (error) {
      this.metrics.finalizeTurn(this.acpService.messages());
      throw error;
    }
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
