import { Pipe, PipeTransform, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { AcpMessage } from './acp.service';
import type { EmbeddedResource, ToolCallContent } from './acp.model';
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

/** Extracted input/output of a `grep` (content search) tool call. */
export interface GrepInfo {
  /** Search root reported by the tool (`rawInput.path`, else the tool location). */
  path: string;
  /** Pattern that was searched for. */
  pattern: string;
  /** Optional `include`/glob filter applied to the search. */
  include?: string;
  /** Number of matches, when the tool reported one. */
  matchCount?: number;
  /** Whether the tool truncated the result set. */
  truncated: boolean;
}

/** Extracted input/output of a `glob` (file search) tool call. */
export interface GlobInfo {
  /** Search root reported by the tool; `/` when the tool searched from the workspace root. */
  path: string;
  /** Glob pattern that was matched. */
  pattern: string;
  /** Number of matched paths, when the tool reported one. */
  matchCount?: number;
  /** Whether the tool truncated the result set. */
  truncated: boolean;
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
  // Some agents (e.g. opencode) report edits as `rawOutput.metadata.files[]`,
  // one entry per touched file, instead of a single `filediff`/`diff`.
  const files = metadataFiles(rawOutput);
  if (files.length > 0) {
    const patches: string[] = [];
    let additions = 0;
    let deletions = 0;
    let hasCounts = false;

    for (const file of files) {
      if (!file || typeof file !== 'object') continue;
      const patch = typeof file.patch === 'string' ? file.patch.replace(/\r\n/g, '\n') : '';
      if (patch) patches.push(patch);
      if (typeof file.additions === 'number' || typeof file.deletions === 'number') {
        additions += typeof file.additions === 'number' ? file.additions : 0;
        deletions += typeof file.deletions === 'number' ? file.deletions : 0;
        hasCounts = true;
      }
    }

    const patch = patches.join('\n');
    if (patch) {
      return {
        additions: hasCounts ? additions : countPatchLines(patch, '+'),
        deletions: hasCounts ? deletions : countPatchLines(patch, '-'),
        diff: patch
      };
    }
  }
  // ACP agents such as Claude Code report writes/edits as `toolContent` diff
  // blocks (`{ type: 'diff', path, oldText, newText }`) instead of a pre-built
  // patch inside `rawOutput.metadata`. Without this branch the diff section in
  // acp-chat.component.html (`| editDiff`) stays hidden for those calls.
  const contentDiff = buildContentDiff(message.toolContent);
  if (contentDiff) return contentDiff;
  return null;
}

/**
 * Builds an `EditDiffInfo` from ACP `type: 'diff'` content blocks, or `null` when
 * the message carries none. Each block's `oldText`/`newText` are turned into a
 * single-hunk unified patch so the `parseDiff` pipe can render it line-by-line.
 */
function buildContentDiff(toolContent: ToolCallContent[] | undefined): EditDiffInfo | null {
  const blocks = (toolContent ?? []).filter(
    (b): b is ToolCallContent =>
      !!b && b.type === 'diff' && (typeof b.newText === 'string' || typeof b.oldText === 'string')
  );
  if (blocks.length === 0) return null;

  const patches: string[] = [];
  let additions = 0;
  let deletions = 0;

  for (const block of blocks) {
    const oldLines = splitLines(block.oldText);
    const newLines = splitLines(block.newText);
    const { patch, add, del } = buildUnifiedDiff(oldLines, newLines, block.path);
    if (patch) patches.push(patch);
    additions += add;
    deletions += del;
  }

  const diff = patches.join('\n');
  if (!diff) return null;
  return { additions, deletions, diff };
}

/** Splits text into lines, tolerating CRLF/CR and a single trailing newline. */
function splitLines(text: string | null | undefined): string[] {
  if (!text) return [];
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const trimmed = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized;
  return trimmed.length === 0 ? [] : trimmed.split('\n');
}

/** Line-level edit script via longest-common-subsequence backtracking. */
function lineDiff(oldLines: string[], newLines: string[]): Array<'eq' | 'add' | 'del'> {
  const n = oldLines.length;
  const m = newLines.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = oldLines[i] === newLines[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: Array<'eq' | 'add' | 'del'> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      ops.push('eq');
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push('del');
      i++;
    } else {
      ops.push('add');
      j++;
    }
  }
  while (i < n) {
    ops.push('del');
    i++;
  }
  while (j < m) {
    ops.push('add');
    j++;
  }
  return ops;
}

/**
 * Produces a single-hunk unified diff (with an `@@` header) for display. Used when
 * an agent ships the edit as `oldText`/`newText` rather than a ready-made patch.
 */
function buildUnifiedDiff(
  oldLines: string[],
  newLines: string[],
  path?: string
): { patch: string; add: number; del: number } {
  const ops = lineDiff(oldLines, newLines);
  const add = ops.filter(o => o === 'add').length;
  const del = ops.filter(o => o === 'del').length;
  if (ops.length === 0) return { patch: '', add: 0, del: 0 };

  let oldIdx = 0;
  let newIdx = 0;
  const rows: Array<{ sign: ' ' | '+' | '-'; text: string }> = [];
  for (const op of ops) {
    if (op === 'eq') {
      rows.push({ sign: ' ', text: oldLines[oldIdx] });
      oldIdx++;
      newIdx++;
    } else if (op === 'del') {
      rows.push({ sign: '-', text: oldLines[oldIdx] });
      oldIdx++;
    } else {
      rows.push({ sign: '+', text: newLines[newIdx] });
      newIdx++;
    }
  }

  const oldStart = oldLines.length === 0 ? 0 : 1;
  const newStart = newLines.length === 0 ? 0 : 1;
  const header = `@@ -${oldStart},${oldLines.length} +${newStart},${newLines.length} @@`;
  const fileHeader = `--- a/${path ?? ''}\n+++ b/${path ?? ''}`;
  const body = rows.map(r => `${r.sign}${r.text}`).join('\n');
  return { patch: `${fileHeader}\n${header}\n${body}`, add, del };
}

/**
 * Normalises `rawOutput.metadata.files` into a list of entries. Agents use either
 * an array (`[{ file, patch, additions, deletions }]`) or a map keyed by path
 * (`{ 'src/a.ts': { patch, additions, deletions } }`).
 */
function metadataFiles(rawOutput: any): any[] {
  const files = rawOutput?.metadata?.files;
  if (Array.isArray(files)) return files;
  if (files && typeof files === 'object') {
    return Object.entries(files).map(([file, value]) => (
      value && typeof value === 'object' ? { file, ...(value as Record<string, unknown>) } : { file, patch: value }
    ));
  }
  return [];
}

/** Counts added/removed lines in a unified patch (skipping `+++`/`---` headers). */
function countPatchLines(patch: string, sign: '+' | '-'): number {
  const pattern = sign === '+' ? /^\+[^+]/gm : /^-[^-]/gm;
  return (patch.match(pattern) || []).length;
}

/**
 * Display path for an edit tool call (relative to the workspace when possible).
 * Falls back to the tool title when the payload carries no path.
 */
export function resolveEditFilePath(message: AcpMessage, cwd?: string): string {
  const diff = extractEditDiff(message);
  if (!diff) return '';
  const rawPath = resolveFilePath(message, diff);
  if (!rawPath) return '';
  return toDisplayPath(message, rawPath, cwd);
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
  const firstFile = metadataFiles(rawOutput)[0];
  // Agents put the target path in different places: `rawInput.filePath` (ACP),
  // `rawInput.path` (e.g. the Edit tool) or a `diff` content block.
  const diffBlockPath = (message.toolContent ?? [])
    .find(block => block?.type === 'diff' && typeof block.path === 'string')
    ?.path;
  return (
    rawOutput?.metadata?.filediff?.file ||
    firstFile?.file ||
    rawInput?.filePath ||
    rawInput?.path ||
    diffBlockPath ||
    message.toolLocations?.[0]?.path ||
    message.toolTitle ||
    diff.diff.split('\n').find(l => l.startsWith('Index:'))?.slice('Index:'.length).trim() ||
    ''
  );
}

function isAbsolutePath(path: string): boolean {
  return /^[A-Za-z]:\//.test(path) || path.startsWith('/');
}

/** Whether a tool title actually names the same file as the resolved path. */
function sharesFileName(title: string, path: string): boolean {
  const titleName = title.split('/').pop()?.toLowerCase() ?? '';
  const pathName = path.split('/').pop()?.toLowerCase() ?? '';
  return !!titleName && titleName === pathName;
}

/** Picks the shortest sensible display path (relative to cwd, else the title). */
function toDisplayPath(message: AcpMessage, rawPath: string, cwd?: string): string {
  const rel = relativizePath(rawPath, cwd);
  if (!isAbsolutePath(rel)) return rel;
  const title = message.toolTitle ? normalizePath(message.toolTitle) : '';
  // Only trust the title when it names the same file. Agents often send generic
  // titles ("edit", "write"), which would hide the actual path.
  if (title && !isAbsolutePath(title) && sharesFileName(title, rel)) return title;
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
// probes a list of candidate locations — `rawOutput` and the tool call's
// `content` result blocks — and takes the first one that parses into a
// recognisable shape. `rawOutput` is not enough on its own: `opencode acp`
// reports the textual result in `content` and leaves `rawOutput` metadata-only.
// All four shapes are mutually exclusive and narrow enough that they will not
// collide with ordinary file/terminal tool calls.

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

/**
 * Renders a citation for a hit using a template such as
 * `【{documentId}#{chunkIndex}】`. Kept here (next to {@link RagSearchHit}) so
 * both the RAG prompt builders and the result views format citations identically.
 */
export function formatCitation(
  style: string,
  hit: { documentId: string; chunkIndex: number },
): string {
  return style
    .replace(/\{documentId\}/g, hit.documentId)
    .replace(/\{chunkIndex\}/g, String(hit.chunkIndex));
}

/** Candidate locations where an agent may have parked the MCP JSON payload. */
function ragOutputCandidates(rawOutput: any, toolContent?: ToolCallContent[]): unknown[] {
  const candidates: unknown[] = [];

  if (rawOutput != null) {
    candidates.push(rawOutput, rawOutput.text, rawOutput.output);

    const blocks = Array.isArray(rawOutput.content) ? rawOutput.content : [];
    for (const block of blocks) {
      if (!block || typeof block !== 'object') continue;
      candidates.push(block.text);
      // Embedded resources nest the payload one level deeper.
      candidates.push(block.resource?.text);
    }
  }

  // ACP tool-call result blocks. Agents such as `opencode acp` report the tool's
  // textual output here and leave `rawOutput` metadata-only, so without this the
  // payload is never seen.
  for (const block of toolContent ?? []) {
    if (!block || typeof block !== 'object' || block.type !== 'content') continue;
    const inner = block.content as any;
    if (!inner || typeof inner !== 'object') continue;
    candidates.push(inner.text);
    if (inner.type === 'resource') candidates.push(inner.resource?.text);
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
  const candidates = ragOutputCandidates(message.toolRawOutput, message.toolContent);

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

/** Command executed by an `execute` (shell) tool call. */
export function extractShellCommand(message: AcpMessage): string {
  const rawInput = message.toolRawInput as any;
  return rawInput?.command || rawInput?.cmd || message.toolTitle || '';
}

/** Combined stdout/stderr text of an `execute` (shell) tool call. */
export function extractShellOutput(message: AcpMessage): string {
  const parts: string[] = [];

  for (const block of message.toolContent ?? []) {
    if (!block || block.type !== 'content') continue;
    const inner = block.content as any;
    if (inner?.type === 'text' && typeof inner.text === 'string') {
      parts.push(inner.text);
    } else if (typeof inner?.text === 'string') {
      parts.push(inner.text);
    }
  }

  if (parts.length === 0) {
    const rawOutput = message.toolRawOutput as any;
    for (const key of ['stdout', 'stderr', 'output', 'text']) {
      if (typeof rawOutput?.[key] === 'string' && rawOutput[key]) {
        parts.push(rawOutput[key]);
      }
    }
  }

  // Keep leading spaces (git status/diff output relies on the first column),
  // only drop blank lines at both ends.
  return parts.join('\n').replace(/^\n+/, '').replace(/\n+$/, '');
}

@Pipe({ name: 'shellCommand', standalone: true, pure: true })
export class ShellCommandPipe implements PipeTransform {
  transform(message: AcpMessage): string {
    return extractShellCommand(message);
  }
}

@Pipe({ name: 'shellOutput', standalone: true, pure: true })
export class ShellOutputPipe implements PipeTransform {
  transform(message: AcpMessage): string {
    return extractShellOutput(message);
  }
}

/** Textual result of a tool call, harvested from its content blocks / raw output. */
function toolResultText(message: AcpMessage): string {
  const parts: string[] = [];
  for (const block of message.toolContent ?? []) {
    if (!block || block.type !== 'content') continue;
    const inner = block.content as any;
    if (typeof inner?.text === 'string') parts.push(inner.text);
    else if (inner?.type === 'resource' && typeof inner.resource?.text === 'string') {
      parts.push(inner.resource.text);
    }
  }
  if (parts.length === 0) {
    const rawOutput = message.toolRawOutput as any;
    for (const key of ['text', 'output', 'stdout']) {
      if (typeof rawOutput?.[key] === 'string' && rawOutput[key]) parts.push(rawOutput[key]);
    }
  }
  return parts.join('\n');
}

/**
 * Whether the tool call is a content search (`grep`) rather than some other
 * `search`-kind tool (glob, web search, ...).
 *
 * ACP tool calls carry no stable tool name, only a free-form title, so the check
 * combines the title with the shape of the payload: grep always has a `pattern`
 * input and reports either "Found N matches" or per-line "Line N: ..." entries.
 */
function isGrepToolCall(message: AcpMessage): boolean {
  const title = (message.toolTitle || '').toLowerCase();
  if (/(^|[^a-z])grep([^a-z]|$)/.test(title)) return true;
  if (/(glob|find files|file search|web search|search the web)/.test(title)) return false;
  if (message.toolKind !== 'search') return false;
  const output = toolResultText(message);
  return /found\s+\d+\s+match/i.test(output) || /^\s*Line\s+\d+:/m.test(output);
}

/** Recognises a `grep` tool call and extracts what the compact row displays. */
export function extractGrepInfo(message: AcpMessage): GrepInfo | null {
  if (message.role !== 'tool_call' && message.role !== 'tool_call_update') return null;

  const rawInput = message.toolRawInput as any;
  const pattern = typeof rawInput?.pattern === 'string' ? rawInput.pattern : '';
  if (!pattern) return null;
  if (!isGrepToolCall(message)) return null;

  const rawPath = typeof rawInput?.path === 'string' && rawInput.path
    ? rawInput.path
    : message.toolLocations?.[0]?.path || '';

  const rawOutput = message.toolRawOutput as any;
  let matchCount: number | undefined;
  if (typeof rawOutput?.metadata?.matches === 'number') {
    matchCount = rawOutput.metadata.matches;
  } else {
    const output = toolResultText(message);
    const found = output.match(/found\s+(\d+)\s+match/i);
    if (found) {
      matchCount = parseInt(found[1], 10);
    } else if (/no matches found/i.test(output)) {
      matchCount = 0;
    } else if (output) {
      // Matches are listed as `Line <n>: <text>`; only trust the fallback when
      // the payload actually has that shape.
      const lines = output.match(/^\s*Line\s+\d+:/gm);
      if (lines) matchCount = lines.length;
    }
  }

  const rawInclude = rawInput?.include;
  const include = Array.isArray(rawInclude)
    ? rawInclude.filter((v: unknown) => typeof v === 'string').join(', ')
    : typeof rawInclude === 'string' ? rawInclude : undefined;

  return {
    path: (rawPath || '').replace(/\\/g, '/'),
    pattern,
    include: include || undefined,
    matchCount,
    truncated: rawOutput?.metadata?.truncated === true
  };
}

@Pipe({ name: 'grepInfo', standalone: true, pure: true })
export class GrepInfoPipe implements PipeTransform {
  transform(message: AcpMessage): GrepInfo | null {
    return extractGrepInfo(message);
  }
}

/**
 * Whether the tool call is a file-name search (`glob`) rather than some other
 * `search`-kind tool (grep, web search, ...).
 *
 * Like grep, glob carries a `pattern` input and is usually titled with the tool
 * name. When the title is generic, the result shape decides: glob returns a bare
 * list of paths, while grep reports match counts or `Line N:` entries.
 */
function isGlobToolCall(message: AcpMessage): boolean {
  const title = (message.toolTitle || '').toLowerCase();
  if (/(^|[^a-z])glob([^a-z]|$)/.test(title)) return true;
  if (/(grep|web search|search the web)/.test(title)) return false;
  if (message.toolKind !== 'search') return false;
  const output = toolResultText(message);
  if (!output) return false;
  if (/found\s+\d+\s+match/i.test(output) || /no matches found/i.test(output)) return false;
  if (/^\s*Line\s+\d+:/m.test(output)) return false;
  return true;
}

/** Recognises a `glob` tool call and extracts what the compact row displays. */
export function extractGlobInfo(message: AcpMessage): GlobInfo | null {
  if (message.role !== 'tool_call' && message.role !== 'tool_call_update') return null;

  const rawInput = message.toolRawInput as any;
  const pattern = typeof rawInput?.pattern === 'string' ? rawInput.pattern : '';
  if (!pattern) return null;
  if (!isGlobToolCall(message)) return null;

  const rawPath = typeof rawInput?.path === 'string' && rawInput.path
    ? rawInput.path
    : message.toolLocations?.[0]?.path || '';

  const rawOutput = message.toolRawOutput as any;
  let matchCount: number | undefined;
  if (typeof rawOutput?.metadata?.count === 'number') {
    matchCount = rawOutput.metadata.count;
  } else {
    const output = toolResultText(message);
    if (/no files found/i.test(output)) {
      matchCount = 0;
    } else if (output) {
      // Glob results are one path per line.
      const lines = output.split(/\r?\n/).filter(line => line.trim().length > 0);
      if (lines.length > 0) matchCount = lines.length;
    }
  }

  return {
    path: (rawPath || '/').replace(/\\/g, '/'),
    pattern,
    matchCount,
    truncated: rawOutput?.metadata?.truncated === true
  };
}

@Pipe({ name: 'globInfo', standalone: true, pure: true })
export class GlobInfoPipe implements PipeTransform {
  transform(message: AcpMessage): GlobInfo | null {
    return extractGlobInfo(message);
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
  private readonly sanitizer = inject(DomSanitizer);

  transform(content: string): SafeHtml {
    const html = renderMarkdownSync(content);
    if (!html) return this.sanitizer.bypassSecurityTrustHtml('');
    // Wrap the rendered markdown so long lines soft-wrap inside the bubble:
    // chat bubbles are sized to their content, so an unbreakable token (path,
    // URL, long code line) would otherwise widen the bubble and overflow the
    // viewport. The class lives in the global stylesheet because this pipe is
    // shared by the chat, thought and A2UI renderers.
    return this.sanitizer.bypassSecurityTrustHtml(`<div class="md-content">${html}</div>`);
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
