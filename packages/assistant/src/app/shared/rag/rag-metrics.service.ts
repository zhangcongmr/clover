import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, computed, effect, inject, signal, untracked } from '@angular/core';
import { AcpService, type AcpMessage } from '../acp/acp.service';
import { extractRagResult, type RagSearchHit } from '../acp/tool-call-info.pipe';

/**
 * Retrieval observability & evaluation store.
 *
 * The app has no MCP client, so nothing here is instrumented at the protocol
 * level. Everything is derived from the two things we *do* have: the moment the
 * user dispatched a retrieval ({@link beginSearch}), and the ACP message stream
 * that the agent's tool call eventually lands in. That is enough to report hit
 * rate, score quality, citation usage, latency and per-hit relevance feedback.
 *
 * Records live in localStorage (`clover.rag.metrics`) and are capped so a long
 * session cannot grow the entry without bound.
 */

const METRICS_STORAGE_KEY = 'clover.rag.metrics';
const MAX_RECORDS = 300;

export type RagHitFeedback = 'up' | 'down';
export type RagRecordFeedback = 'relevant' | 'irrelevant' | 'mixed';

export interface RagMetricRecord {
  id: string;
  kind: 'search' | 'index';
  startedAt: number;
  /** Wall-clock latency from dispatch to the result landing, when observable. */
  latencyMs: number | null;
  /** A dispatched search whose result has not been finalised yet. */
  pending: boolean;
  /* ── search ── */
  query?: string;
  serverNames?: string[];
  hits?: RagSearchHit[];
  topScore?: number | null;
  meanScore?: number | null;
  /** `documentId#chunkIndex` keys that appeared in the assistant answer. */
  citations?: string[];
  cited?: boolean;
  /** The turn completed without producing an extractable search result. */
  error?: boolean;
  /* ── index ── */
  documentId?: string;
  chunksCount?: number;
  /* ── evaluation ── */
  feedback?: RagRecordFeedback;
  hitFeedback?: Record<string, RagHitFeedback>;
}

export interface RagMetricsSummary {
  searchCount: number;
  completedCount: number;
  errorCount: number;
  hitRate: number | null;
  citedRate: number | null;
  avgTopScore: number | null;
  avgLatencyMs: number | null;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  indexCount: number;
  totalChunks: number;
  evaluatedCount: number;
  relevantRate: number | null;
}

function uid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `rag-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

function percentile(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length === 0) return null;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil((p / 100) * sortedAsc.length) - 1));
  return sortedAsc[idx];
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function summarise(records: RagMetricRecord[]): RagMetricsSummary {
  const searches = records.filter(r => r.kind === 'search');
  const completed = searches.filter(r => !r.pending);
  const withHits = completed.filter(r => (r.hits?.length ?? 0) > 0);
  const topScores = completed
    .map(r => r.topScore)
    .filter((score): score is number => typeof score === 'number' && Number.isFinite(score));
  const latencies = completed
    .map(r => r.latencyMs)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    .sort((a, b) => a - b);
  const evaluated = completed.filter(r => r.feedback && r.feedback !== 'mixed');
  const relevant = evaluated.filter(r => r.feedback === 'relevant');
  const indexed = records.filter(r => r.kind === 'index');

  return {
    searchCount: searches.length,
    completedCount: completed.length,
    errorCount: completed.filter(r => r.error).length,
    hitRate: completed.length > 0 ? withHits.length / completed.length : null,
    citedRate: completed.length > 0 ? completed.filter(r => r.cited).length / completed.length : null,
    avgTopScore: average(topScores),
    avgLatencyMs: average(latencies),
    p50LatencyMs: percentile(latencies, 50),
    p95LatencyMs: percentile(latencies, 95),
    indexCount: indexed.length,
    totalChunks: indexed.reduce((sum, r) => sum + (r.chunksCount ?? 0), 0),
    evaluatedCount: evaluated.length,
    relevantRate: evaluated.length > 0 ? relevant.length / evaluated.length : null,
  };
}

function normalizeRecord(raw: unknown): RagMetricRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Partial<RagMetricRecord>;
  if (rec.kind !== 'search' && rec.kind !== 'index') return null;
  return {
    id: typeof rec.id === 'string' && rec.id ? rec.id : uid(),
    kind: rec.kind,
    startedAt: typeof rec.startedAt === 'number' ? rec.startedAt : Date.now(),
    latencyMs: typeof rec.latencyMs === 'number' ? rec.latencyMs : null,
    pending: rec.pending === true,
    query: typeof rec.query === 'string' ? rec.query : undefined,
    serverNames: Array.isArray(rec.serverNames) ? rec.serverNames.filter(n => typeof n === 'string') : undefined,
    hits: Array.isArray(rec.hits) ? (rec.hits as RagSearchHit[]) : undefined,
    topScore: typeof rec.topScore === 'number' ? rec.topScore : null,
    meanScore: typeof rec.meanScore === 'number' ? rec.meanScore : null,
    citations: Array.isArray(rec.citations) ? rec.citations.filter(c => typeof c === 'string') : [],
    cited: rec.cited === true,
    error: rec.error === true,
    documentId: typeof rec.documentId === 'string' ? rec.documentId : undefined,
    chunksCount: typeof rec.chunksCount === 'number' ? rec.chunksCount : undefined,
    feedback: rec.feedback,
    hitFeedback: rec.hitFeedback && typeof rec.hitFeedback === 'object' ? rec.hitFeedback : {},
  };
}

function loadRecords(): RagMetricRecord[] {
  try {
    const raw = localStorage.getItem(METRICS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed?.records) ? parsed.records : [];
    return list.map(normalizeRecord).filter((r: RagMetricRecord | null): r is RagMetricRecord => r !== null);
  } catch {
    return [];
  }
}

function persistRecords(records: RagMetricRecord[]): void {
  try {
    localStorage.setItem(METRICS_STORAGE_KEY, JSON.stringify({ version: 1, records }));
  } catch {
    // Storage full or unavailable — metrics are best-effort.
  }
}

interface SearchProbe {
  result: NonNullable<ReturnType<typeof extractRagResult>>;
  index: number;
}

@Injectable({ providedIn: 'root' })
export class RagMetricsService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly acpService = inject(AcpService);

  readonly records = signal<RagMetricRecord[]>([]);

  private readonly pendingSearchId = signal<string | null>(null);
  private readonly pendingIndexSince = signal<number | null>(null);

  /** Set the first time a search result is observed on the stream; used for latency. */
  private observedSearchCompletionAt: number | null = null;
  /** Message-stream index at dispatch, so an older search result can't be replayed. */
  private searchBaselineIndex = 0;
  private capturedIndexKeys = new Set<string>();

  readonly searchRecords = computed(() => this.records().filter(r => r.kind === 'search'));
  readonly indexRecords = computed(() => this.records().filter(r => r.kind === 'index'));
  /** Newest records first, for the log tables. */
  readonly recentRecords = computed(() => [...this.records()].reverse());
  readonly summary = computed<RagMetricsSummary>(() => summarise(this.records()));

  readonly hasPending = computed(
    () => this.pendingSearchId() !== null || this.pendingIndexSince() !== null,
  );

  /** Latest feedback per `documentId#chunkIndex`, used by the inline result cards. */
  readonly citationFeedback = computed<Record<string, RagHitFeedback>>(() => {
    const map: Record<string, RagHitFeedback> = {};
    for (const record of this.records()) {
      for (const [citation, value] of Object.entries(record.hitFeedback ?? {})) {
        map[citation] = value;
      }
    }
    return map;
  });

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.records.set(loadRecords());
    }

    // Stamp the moment a search result lands. ACP merges the update into the
    // original pending message and keeps the pending timestamp, so we cannot
    // read completion time off the message itself.
    effect(() => {
      const messages = this.acpService.messages();
      untracked(() => this.observeStream(messages));
    });

    // Persist whenever records change (browser only).
    effect(() => {
      const records = this.records();
      if (isPlatformBrowser(this.platformId)) persistRecords(records);
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Turn lifecycle                                                         */
  /* ---------------------------------------------------------------------- */

  /** Records the dispatch of a retrieval and arms latency measurement. */
  beginSearch(query: string, serverNames: string[]): string {
    const id = uid();
    this.observedSearchCompletionAt = null;
    this.searchBaselineIndex = this.acpService.messages().length;
    this.pendingSearchId.set(id);
    const record: RagMetricRecord = {
      id,
      kind: 'search',
      startedAt: Date.now(),
      latencyMs: null,
      pending: true,
      query,
      serverNames: [...serverNames],
      hits: undefined,
      citations: [],
      cited: false,
      hitFeedback: {},
    };
    this.records.update(list => [...list, record].slice(-MAX_RECORDS));
    return id;
  }

  /** Arms index-result capture for the current turn. */
  beginIndex(): void {
    this.pendingIndexSince.set(Date.now());
  }

  /**
   * Closes out the current RAG turn: fills the pending search record from the
   * message stream and captures any index results produced since {@link beginIndex}.
   */
  finalizeTurn(messages: AcpMessage[]): void {
    const searchId = this.pendingSearchId();
    if (searchId) {
      this.finalizeSearch(searchId, messages);
      this.pendingSearchId.set(null);
    }

    const since = this.pendingIndexSince();
    if (since !== null) {
      this.captureIndex(messages, since);
      this.pendingIndexSince.set(null);
    }

    this.observedSearchCompletionAt = null;
  }

  private finalizeSearch(id: string, messages: AcpMessage[]): void {
    const record = this.records().find(r => r.id === id);
    const probe = findLastSearch(messages, this.searchBaselineIndex);
    const hits = probe?.result.hits ?? [];
    const scores = hits.map(h => h.score).filter(score => Number.isFinite(score));
    const citations = probe ? collectCitedKeys(messages, probe.index, hits) : [];

    const startedAt = record?.startedAt ?? this.observedSearchCompletionAt ?? Date.now();
    const latencyMs =
      this.observedSearchCompletionAt !== null
        ? Math.max(0, this.observedSearchCompletionAt - startedAt)
        : null;

    this.patch(id, {
      pending: false,
      error: probe === null,
      hits,
      topScore: scores.length > 0 ? Math.max(...scores) : null,
      meanScore: average(scores),
      citations,
      cited: citations.length > 0,
      latencyMs,
    });
  }

  private captureIndex(messages: AcpMessage[], since: number): void {
    const created: RagMetricRecord[] = [];
    for (const message of messages) {
      if (message.toolStatus !== 'completed') continue;
      if (message.timestamp.getTime() < since) continue;
      const result = extractRagResult(message);
      if (result?.kind !== 'index' || !result.documentId) continue;
      const key = message.toolCallId || message.id;
      if (this.capturedIndexKeys.has(key)) continue;
      this.capturedIndexKeys.add(key);
      created.push({
        id: uid(),
        kind: 'index',
        startedAt: message.timestamp.getTime(),
        latencyMs: null,
        pending: false,
        documentId: result.documentId,
        chunksCount: result.chunksCount ?? 0,
      });
    }
    if (created.length > 0) {
      this.records.update(list => [...list, ...created].slice(-MAX_RECORDS));
    }
  }

  private observeStream(messages: AcpMessage[]): void {
    if (this.pendingSearchId() === null || this.observedSearchCompletionAt !== null) return;
    if (findLastSearch(messages, this.searchBaselineIndex)) {
      this.observedSearchCompletionAt = Date.now();
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Evaluation feedback                                                    */
  /* ---------------------------------------------------------------------- */

  setFeedback(id: string, feedback: RagRecordFeedback | undefined): void {
    this.patch(id, { feedback });
  }

  /** Toggles per-hit feedback by `documentId#chunkIndex` across the newest record holding it. */
  toggleCitationFeedback(citation: string, value: RagHitFeedback): void {
    const records = this.records();
    for (let i = records.length - 1; i >= 0; i--) {
      const record = records[i];
      if (!record.hits?.some(hit => `${hit.documentId}#${hit.chunkIndex}` === citation)) continue;
      const current = record.hitFeedback?.[citation];
      const hitFeedback = { ...(record.hitFeedback ?? {}) };
      if (current === value) delete hitFeedback[citation];
      else hitFeedback[citation] = value;
      this.patch(record.id, { hitFeedback });
      return;
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Maintenance                                                            */
  /* ---------------------------------------------------------------------- */

  remove(id: string): void {
    this.records.update(list => list.filter(record => record.id !== id));
  }

  clear(): void {
    this.capturedIndexKeys = new Set();
    this.records.set([]);
  }

  exportJson(): string {
    return JSON.stringify({ version: 1, records: this.records() }, null, 2);
  }

  /** Replaces the store with the records in `text`; returns how many were imported. */
  importJson(text: string): number {
    const parsed = JSON.parse(text);
    const list = Array.isArray(parsed?.records) ? parsed.records : [];
    const records = list
      .map(normalizeRecord)
      .filter((r: RagMetricRecord | null): r is RagMetricRecord => r !== null);
    this.records.set(records.slice(-MAX_RECORDS));
    return records.length;
  }

  /* ---------------------------------------------------------------------- */

  private patch(id: string, changes: Partial<RagMetricRecord>): void {
    this.records.update(list => list.map(record => (record.id === id ? { ...record, ...changes } : record)));
  }
}

/** Newest completed search result anywhere in the stream, at or after `minIndex`. */
function findLastSearch(messages: AcpMessage[], minIndex = 0): SearchProbe | null {
  for (let i = messages.length - 1; i >= minIndex; i--) {
    const result = extractRagResult(messages[i]);
    if (result?.kind === 'search') return { result, index: i };
  }
  return null;
}

/** Citation keys from `hits` that the assistant actually quoted after `afterIndex`. */
function collectCitedKeys(messages: AcpMessage[], afterIndex: number, hits: RagSearchHit[]): string[] {
  if (hits.length === 0) return [];
  const found = new Set<string>();
  for (let i = afterIndex + 1; i < messages.length; i++) {
    const message = messages[i];
    if (message.role === 'user') break;
    if (message.role !== 'assistant' || !message.content) continue;
    for (const hit of hits) {
      const key = `${hit.documentId}#${hit.chunkIndex}`;
      if (message.content.includes(key)) found.add(key);
    }
  }
  return Array.from(found);
}
