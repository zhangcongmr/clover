import { Pipe, PipeTransform } from '@angular/core';
import { AcpMessage } from './acp.service';
import type { EmbeddedResource } from './acp.model';
import { renderMarkdownSync } from '../utils/markdown.util';

export interface EditDiffInfo {
  additions: number;
  deletions: number;
  diff: string;
}

export interface ReadInfo {
  offset?: number;
  limit?: number;
  lineStart?: number;
  lineEnd?: number;
  totalLines?: number;
}

export interface DiffLine {
  type: 'add' | 'del' | 'context';
  lineNum?: number;
  content: string;
}

/** A single row of the expanded per-file diff view. */
export interface DiffRow {
  type: 'add' | 'del' | 'context' | 'gap';
  /** Line number in the new version of the file (add/context rows). */
  lineNum?: number;
  /** Line number in the old version of the file (del/context rows). */
  oldLineNum?: number;
  content?: string;
  /** Number of collapsed unmodified lines (gap rows). */
  count?: number;
}

/** One file modified within a single assistant round. */
export interface ChangedFile {
  /** Stable identity (normalized path, or title fallback). */
  key: string;
  /** Path used for display (relative to the workspace when possible). */
  path: string;
  additions: number;
  deletions: number;
  /** Concatenated unified patches for this file, in call order. */
  patch: string;
  /** Total line count of the file when known (from a prior read). */
  totalLines?: number;
}

/** Extracts additions/deletions/patch for an `edit` tool call message. */
export function extractEditDiff(message: AcpMessage): EditDiffInfo | null {
  if (message.toolKind !== 'edit') return null;
  const rawOutput = message.toolRawOutput as any;
  const filediff = rawOutput?.metadata?.filediff;
  if (filediff) {
    return {
      additions: filediff.additions || 0,
      deletions: filediff.deletions || 0,
      diff: filediff.patch || ''
    };
  }
  const diff = rawOutput?.metadata?.diff;
  if (diff) {
    const additions = (diff.match(/^\+[^+]/gm) || []).length;
    const deletions = (diff.match(/^-[^-]/gm) || []).length;
    return { additions, deletions, diff };
  }
  return null;
}

function normalizePath(path: string): string {
  return (path || '').replace(/\\/g, '/');
}

/** Strips the workspace root from an absolute path for display purposes. */
function relativizePath(path: string, cwd?: string): string {
  const normalized = normalizePath(path);
  const root = cwd ? normalizePath(cwd).replace(/\/+$/, '') : '';
  if (root && (normalized === root || normalized.startsWith(root + '/'))) {
    return normalized.slice(root.length).replace(/^\/+/, '');
  }
  return normalized;
}

function resolveFilePath(message: AcpMessage, diff: EditDiffInfo): string {
  const rawOutput = message.toolRawOutput as any;
  const rawInput = message.toolRawInput as any;
  return (
    rawOutput?.metadata?.filediff?.file ||
    rawInput?.filePath ||
    message.toolLocations?.[0]?.path ||
    message.toolTitle ||
    diff.diff.split('\n').find(l => l.startsWith('Index:'))?.slice('Index:'.length).trim() ||
    ''
  );
}

function isAbsolutePath(path: string): boolean {
  return /^[A-Za-z]:\//.test(path) || path.startsWith('/');
}

/** Picks the shortest sensible display path (relative to cwd, else the title). */
function toDisplayPath(message: AcpMessage, rawPath: string, cwd?: string): string {
  const rel = relativizePath(rawPath, cwd);
  if (!isAbsolutePath(rel)) return rel;
  const title = message.toolTitle ? normalizePath(message.toolTitle) : '';
  if (title && !isAbsolutePath(title)) return title;
  return rel;
}

/**
 * Aggregates all completed `edit` tool calls into per-file change entries for
 * every assistant message round. Edits accumulate as messages are scanned and
 * are snapshotted onto the assistant message that closes the round.
 */
export function buildChangedFiles(
  messages: AcpMessage[],
  cwd?: string
): Map<string, ChangedFile[]> {
  const result = new Map<string, ChangedFile[]>();

  // First pass: total line counts discovered by read tool calls.
  const totalLinesByPath = new Map<string, number>();
  for (const msg of messages) {
    if (msg.toolKind !== 'read') continue;
    const path = (msg.toolRawInput as any)?.filePath || msg.toolLocations?.[0]?.path;
    const totalLines = (msg.toolRawOutput as any)?.metadata?.display?.totalLines;
    if (path && typeof totalLines === 'number' && totalLines > 0) {
      const key = normalizePath(path);
      if (!totalLinesByPath.has(key) || totalLinesByPath.get(key)! < totalLines) {
        totalLinesByPath.set(key, totalLines);
      }
    }
  }

  let current: ChangedFile[] | null = null;

  const snapshot = (assistantId: string) => {
    if (!current || current.length === 0) return;
    const files = current.map(f => ({
      ...f,
      totalLines: totalLinesByPath.get(f.key)
    }));
    result.set(assistantId, files);
    current = null;
  };

  for (const msg of messages) {
    if (msg.role === 'user') {
      current = null;
      continue;
    }
    if (msg.role === 'assistant') {
      snapshot(msg.id);
      continue;
    }
    if (msg.toolKind !== 'edit' || msg.toolStatus !== 'completed') continue;
    const diff = extractEditDiff(msg);
    if (!diff || !diff.diff) continue;

    const rawPath = resolveFilePath(msg, diff);
    if (!rawPath) continue;
    const key = normalizePath(rawPath);
    if (!current) current = [];
    const existing = current.find(f => f.key === key);
    if (existing) {
      existing.additions += diff.additions;
      existing.deletions += diff.deletions;
      existing.patch += (existing.patch.endsWith('\n') || !existing.patch ? '' : '\n') + diff.diff;
    } else {
      current.push({
        key,
        path: toDisplayPath(msg, rawPath, cwd) || key,
        additions: diff.additions,
        deletions: diff.deletions,
        patch: diff.diff
      });
    }
  }

  return result;
}

// ── RAG tool results ────────────────────────────────────────────────────────
//
// The frontend has no MCP client: RAG tools (`index_document`, `search`,
// `list_documents`, `delete_document` from @clover/mcp-rag) are invoked by the
// agent on our behalf. Their results therefore arrive as ordinary ACP
// `tool_call` / `tool_call_update` payloads and must be recognised structurally —
// ACP `ToolCall` carries no tool name, only a free-form `title`.
//
// The exact envelope depends on how the agent wraps MCP results, so the parser
// probes a list of candidate locations and takes the first one that parses into a
// recognisable shape. All four shapes are mutually exclusive and narrow enough
// that they will not collide with ordinary file/terminal tool calls.

export type RagToolKind = 'index' | 'search' | 'list' | 'delete';

export interface RagSearchHit {
  text: string;
  score: number;
  documentId: string;
  chunkIndex: number;
  metadata?: Record<string, string>;
}

export interface RagDocumentInfo {
  documentId: string;
  chunkCount: number;
  metadata?: Record<string, string>;
}

export interface RagExtractResult {
  kind: RagToolKind;
  /** `index` / `delete`: the document this call acted on. */
  documentId?: string;
  /** `index`: how many chunks were written. */
  chunksCount?: number;
  /** `search`: ranked hits, best first. */
  hits?: RagSearchHit[];
  /** `list`: every indexed document. */
  documents?: RagDocumentInfo[];
  /** `delete`: whether the server actually removed anything. */
  success?: boolean;
}

/** Candidate locations where an agent may have parked the MCP JSON payload. */
function ragOutputCandidates(rawOutput: any): unknown[] {
  if (rawOutput == null) return [];
  const candidates: unknown[] = [rawOutput, rawOutput.text, rawOutput.output];

  const blocks = Array.isArray(rawOutput.content) ? rawOutput.content : [];
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;
    candidates.push(block.text);
    // Embedded resources nest the payload one level deeper.
    candidates.push(block.resource?.text);
  }
  return candidates;
}

/**
 * Normalises a candidate into a plain object, accepting both an already-parsed
 * value (the common case — agents usually hand us the decoded MCP result) and a
 * JSON string wrapped in an MCP content block.
 */
function parseJson(value: unknown): any | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Whether the payload carries exactly the given top-level keys.
 *
 * `@clover/mcp-rag` returns one key per tool (`{ results }`, `{ documents }`,
 * `{ documentId, chunksCount }`, `{ success }`). Requiring an exact key set is a
 * much tighter signature than looking for a single field, and — unlike a
 * non-empty check — it still recognises a legitimately empty result set.
 */
function hasExactKeys(payload: any, keys: string[]): boolean {
  const actual = Object.keys(payload);
  return actual.length === keys.length && keys.every(key => actual.includes(key));
}

function toStringMap(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => typeof v === 'string' || typeof v === 'number');
  return entries.length > 0
    ? Object.fromEntries(entries.map(([k, v]) => [k, String(v)]))
    : undefined;
}

/** `search` → `{ results: [{ text, score, documentId, chunkIndex }] }` */
function asSearchResults(payload: any): RagSearchHit[] | null {
  if (!hasExactKeys(payload, ['results'])) return null;
  const results = payload.results;
  if (!Array.isArray(results)) return null;
  // Requiring both `score` and `chunkIndex` keeps this from matching an unrelated
  // tool that happens to return a bare `{ results: [...] }` envelope.
  if (!results.every((r: any) => r && 'score' in r && 'chunkIndex' in r)) return null;
  return results.map((r: any) => ({
    text: typeof r.text === 'string' ? r.text : '',
    score: typeof r.score === 'number' ? r.score : 0,
    documentId: typeof r.documentId === 'string' ? r.documentId : '',
    chunkIndex: typeof r.chunkIndex === 'number' ? r.chunkIndex : 0,
    metadata: toStringMap(r.metadata),
  }));
}

/** `list_documents` → `{ documents: [{ documentId, chunkCount, metadata }] }` */
function asDocumentList(payload: any): RagDocumentInfo[] | null {
  if (!hasExactKeys(payload, ['documents'])) return null;
  const documents = payload.documents;
  if (!Array.isArray(documents)) return null;
  if (!documents.every((d: any) => d && typeof d.documentId === 'string' && 'chunkCount' in d)) {
    return null;
  }
  return documents.map((d: any) => ({
    documentId: d.documentId,
    chunkCount: typeof d.chunkCount === 'number' ? d.chunkCount : 0,
    metadata: toStringMap(d.metadata),
  }));
}

/**
 * Recognises an RAG tool result inside an ACP tool-call message.
 * Returns `null` for every non-RAG tool call.
 */
export function extractRagResult(message: AcpMessage): RagExtractResult | null {
  if (message.role !== 'tool_call' && message.role !== 'tool_call_update') return null;
  // Only completed calls carry a meaningful result; pending/in_progress tool calls
  // must keep rendering as a normal status card.
  if (message.toolStatus !== 'completed') return null;

  const rawInput = message.toolRawInput as any;
  const candidates = ragOutputCandidates(message.toolRawOutput);

  for (const candidate of candidates) {
    const payload = parseJson(candidate);
    if (!payload) continue;

    const hits = asSearchResults(payload);
    if (hits) return { kind: 'search', hits };

    const documents = asDocumentList(payload);
    if (documents) return { kind: 'list', documents };

    if (hasExactKeys(payload, ['documentId', 'chunksCount'])
        && typeof payload.documentId === 'string'
        && typeof payload.chunksCount === 'number') {
      return { kind: 'index', documentId: payload.documentId, chunksCount: payload.chunksCount };
    }

    // `{ success: true }` alone is far too generic to trust, so require both the
    // exact `{ success }` envelope and the matching `delete_document` input shape.
    if (hasExactKeys(payload, ['success'])
        && typeof payload.success === 'boolean'
        && typeof rawInput?.documentId === 'string') {
      return { kind: 'delete', documentId: rawInput.documentId, success: payload.success };
    }
  }

  return null;
}

@Pipe({ name: 'ragResult', standalone: true, pure: true })
export class RagResultPipe implements PipeTransform {
  transform(message: AcpMessage): RagExtractResult | null {
    return extractRagResult(message);
  }
}

@Pipe({ name: 'editDiff', standalone: true, pure: true })
export class EditDiffPipe implements PipeTransform {
  transform(message: AcpMessage): EditDiffInfo | null {
    return extractEditDiff(message);
  }
}

@Pipe({ name: 'readInfo', standalone: true, pure: true })
export class ReadInfoPipe implements PipeTransform {
  transform(message: AcpMessage): ReadInfo | null {
    if (message.toolKind !== 'read') return null;
    const rawInput = message.toolRawInput as any;
    const rawOutput = message.toolRawOutput as any;
    const display = rawOutput?.metadata?.display;
    return {
      offset: rawInput?.offset,
      limit: rawInput?.limit,
      lineStart: display?.lineStart,
      lineEnd: display?.lineEnd,
      totalLines: display?.totalLines
    };
  }
}

@Pipe({ name: 'parseDiff', standalone: true, pure: true })
export class ParseDiffPipe implements PipeTransform {
  transform(diff: string): DiffLine[] {
    const lines: DiffLine[] = [];
    if (!diff) return lines;
    
    const diffLines = diff.split('\n');
    let lineNum = 0;
    
    for (const line of diffLines) {
      if (line.startsWith('Index:') || line.startsWith('===') || 
          line.startsWith('---') || line.startsWith('+++')) {
        continue;
      }
      const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (hunkMatch) {
        lineNum = parseInt(hunkMatch[1], 10);
        continue;
      }
      if (line.startsWith('+')) {
        lines.push({ type: 'add', lineNum, content: line.slice(1) });
        lineNum++;
      } else if (line.startsWith('-')) {
        lines.push({ type: 'del', content: line.slice(1) });
      } else if (line.startsWith(' ')) {
        lines.push({ type: 'context', lineNum, content: line.slice(1) });
        lineNum++;
      }
    }
    return lines;
  }
}

/** Rendered view of a single file's diff: collapsed gaps + trailing count. */
export interface FileDiffView {
  rows: DiffRow[];
  /** Unmodified lines after the last hunk, when the total line count is known. */
  tail?: number;
}

/**
 * Parses a (possibly concatenated) unified patch into display rows, inserting
 * gap rows between hunks so unmodified regions stay collapsed.
 */
export function parsePatchView(patch: string, totalLines?: number): FileDiffView {
  const rows: DiffRow[] = [];
  if (!patch) return { rows };

  const diffLines = patch.split('\n');
  if (diffLines.length > 0 && diffLines[diffLines.length - 1] === '') {
    diffLines.pop();
  }

  let inHunk = false;
  let oldLine = 0;
  let newLine = 0;

  for (const line of diffLines) {
    if (line.startsWith('Index:') || line.startsWith('===')) {
      inHunk = false;
      continue;
    }
    const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      const startOld = parseInt(hunkMatch[1], 10);
      const startNew = parseInt(hunkMatch[2], 10);
      if (inHunk && startNew > newLine) {
        rows.push({ type: 'gap', count: startNew - newLine });
      }
      oldLine = startOld;
      newLine = startNew;
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith('+')) {
      rows.push({ type: 'add', lineNum: newLine, content: line.slice(1) });
      newLine++;
    } else if (line.startsWith('-')) {
      rows.push({ type: 'del', oldLineNum: oldLine, content: line.slice(1) });
      oldLine++;
    } else if (line.startsWith(' ') || line === '') {
      rows.push({
        type: 'context',
        lineNum: newLine,
        oldLineNum: oldLine,
        content: line.slice(1)
      });
      newLine++;
      oldLine++;
    }
  }

  const view: FileDiffView = { rows };
  if (typeof totalLines === 'number' && totalLines > 0 && inHunk && newLine > 0) {
    const tail = totalLines - (newLine - 1);
    if (tail > 0) view.tail = tail;
  }
  return view;
}

@Pipe({ name: 'fileDiffView', standalone: true, pure: true })
export class FileDiffViewPipe implements PipeTransform {
  transform(file: ChangedFile): FileDiffView {
    return parsePatchView(file.patch, file.totalLines);
  }
}

@Pipe({ name: 'formatMessage', standalone: true, pure: true })
export class FormatMessagePipe implements PipeTransform {
  transform(content: string): string {
    return renderMarkdownSync(content);
  }
}

@Pipe({ name: 'resourceName', standalone: true, pure: true })
export class ResourceNamePipe implements PipeTransform {
  transform(block: EmbeddedResource): string {
    const uri = block.resource.uri;
    return uri.split(/[\\/]/).pop() || uri;
  }
}

@Pipe({ name: 'completedCount', standalone: true, pure: true })
export class CompletedCountPipe implements PipeTransform {
  transform(message: AcpMessage): number {
    const rawOutput = message.toolRawOutput as any;
    const fromOutput = rawOutput?.metadata?.todos;
    if (Array.isArray(fromOutput) && fromOutput.length > 0) {
      return fromOutput.filter((t: any) => t.status === 'completed').length;
    }
    const rawInput = message.toolRawInput as any;
    const fromInput = rawInput?.todos;
    if (Array.isArray(fromInput) && fromInput.length > 0) {
      return fromInput.filter((t: any) => t.status === 'completed').length;
    }
    return 0;
  }
}
