import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { extractTarGz } from './tar.js';

/**
 * HTTP skill catalog 客户端，支持两种线上格式：
 *
 * 1. OpenCode 文档格式（Catalogs 小节）：条目 `{ name, version, files }`，
 *    文件从 `<base-url>/<name>/<file>` 下载（强制同源）。
 * 2. agentskills discovery 0.2.0（当前真实目录的主流，Cloudflare / Evil
 *    Martians / Vercel / agentskills.io 均为此格式）：条目
 *    `{ name, type, url, digest, description }`，`type` 为 `skill-md`
 *    （单个 SKILL.md）或 `archive`（tar.gz 包），`url` 可为根相对/路径
 *    相对/绝对地址且允许跨域，`digest`（sha256）提供完整性校验并兼做变更检测。
 *
 * 磁盘缓存目录结构（两种格式一致）：
 *
 *     <cacheDir>/<sha1(url)>/
 *       index.json            归一化后的索引（用于 digest/version 比对）
 *       <name>/…              每个 skill 条目的产物（即一个来源根）
 *
 * 同步加载（`loadCachedCatalogDirs`）只读缓存，因此 `discoverSkills()` 保持同步；
 * `refreshCatalog(s)` 负责联网更新缓存，由调用方按需异步触发。
 */

/* -------------------------------------------------------------------------- */
/* 类型                                                                        */
/* -------------------------------------------------------------------------- */

/** OpenCode 文档格式条目（`files` 从 `<base>/<name>/<file>` 下载）。 */
export interface CatalogFilesEntry {
  kind: 'files';
  name: string;
  version?: string | number;
  files: string[];
}

/** discovery 0.2.0 条目：单个 SKILL.md 文件。 */
export interface CatalogSkillMdEntry {
  kind: 'skill-md';
  name: string;
  /** 已解析为绝对 http(s) 地址。 */
  url: string;
  /** `sha256:<hex>`，小写。 */
  digest: string;
  description?: string;
}

/** discovery 0.2.0 条目：tar.gz 包（SKILL.md 在包根）。 */
export interface CatalogArchiveEntry {
  kind: 'archive';
  name: string;
  /** 已解析为绝对 http(s) 地址。 */
  url: string;
  /** `sha256:<hex>`，小写。 */
  digest: string;
  description?: string;
}

export type CatalogEntry = CatalogFilesEntry | CatalogSkillMdEntry | CatalogArchiveEntry;

/** 缓存中一个可用的 skill 来源根；`entryName` 供发现层把 ID 锚定为条目名。 */
export interface CachedCatalogSkill {
  dir: string;
  entryName: string;
}

/** 简化的 fetch 响应形态，便于测试注入。 */
export interface FetchLikeResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<FetchLikeResponse>;

export interface CatalogRefreshOptions {
  fetchImpl?: FetchLike;
  /** 单次请求超时，默认 15s。 */
  timeoutMs?: number;
}

export interface CatalogRefreshResult {
  /** 本次刷新后可用的 skill 来源根目录。 */
  dirs: CachedCatalogSkill[];
  errors: string[];
}

/** 单个下载文件的大小上限（防失控目录）。 */
const MAX_FILE_BYTES = 5 * 1024 * 1024;
/** index 条目数量上限。 */
const MAX_ENTRIES = 500;
/** 单个 `files` 条目的文件数量上限。 */
const MAX_FILES_PER_ENTRY = 100;
/** 默认超时。 */
const DEFAULT_TIMEOUT_MS = 15_000;
/** digest 字段格式。 */
const SHA256_DIGEST_RE = /^sha256:([0-9a-f]{64})$/i;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 条目名必须能安全地用作目录名。 */
function isSafeEntryName(name: string): boolean {
  return typeof name === 'string' && /^[A-Za-z0-9._-]+$/.test(name) && name !== '.' && name !== '..';
}

/** `files` 路径必须是安全的相对路径（无绝对路径、无 `..`、无反斜杠）。 */
function isSafeRelativeFile(file: string): boolean {
  if (typeof file !== 'string' || !file) return false;
  if (file.startsWith('/') || file.startsWith('~') || file.includes('\\')) return false;
  const segments = file.split('/');
  return segments.every((seg) => seg.length > 0 && seg !== '.' && seg !== '..');
}

/** 规范化基地址，保证以 `/` 结尾。 */
function normalizeBaseUrl(url: string): URL | null {
  try {
    const base = new URL(url);
    if (base.protocol !== 'http:' && base.protocol !== 'https:') return null;
    if (!base.pathname.endsWith('/')) base.pathname += '/';
    return base;
  } catch {
    return null;
  }
}

/**
 * 由 `<base-url>/<name>/<file>` 解析下载地址，并强制同源 + 不越出基地址路径。
 * 仅用于文档格式（0.2.0 的跨域由 digest 保证完整性，见 `resolveDiscoveryUrl`）。
 */
export function resolveCatalogFileUrl(baseUrl: string, name: string, file: string): URL | null {
  const base = normalizeBaseUrl(baseUrl);
  if (!base || !isSafeEntryName(name) || !isSafeRelativeFile(file)) return null;

  let resolved: URL;
  try {
    resolved = new URL(`${name}/${file}`, base);
  } catch {
    return null;
  }

  if (resolved.origin !== base.origin) return null;
  if (!resolved.pathname.startsWith(base.pathname)) return null;
  return resolved;
}

/**
 * 解析 0.2.0 条目的 `url`：相对 index 地址解析（根相对/路径相对/绝对均可），
 * 仅要求 http(s)——允许跨域（如 Vercel 的文件托管在 GitHub Releases），
 * 完整性由 `digest` 保证。
 */
export function resolveDiscoveryUrl(rawUrl: string, indexUrl: string): URL | null {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return null;
  try {
    const resolved = new URL(rawUrl, indexUrl);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return null;
    return resolved;
  } catch {
    return null;
  }
}

/** 缓存键：URL 的 sha1 前 16 位（稳定、跨平台安全的目录名）。 */
export function catalogCacheKey(url: string): string {
  return createHash('sha1').update(url).digest('hex').slice(0, 16);
}

/** 某个 catalog 的缓存根目录。 */
export function catalogCacheRoot(url: string, cacheDir: string): string {
  return join(cacheDir, catalogCacheKey(url));
}

/* -------------------------------------------------------------------------- */
/* 索引解析（双格式归一化）                                                     */
/* -------------------------------------------------------------------------- */

/** 读缓存索引；旧缓存（无 kind 的 files 条目）归一化为 `kind: 'files'`。 */
function readIndex(root: string): CatalogEntry[] | null {
  const file = join(root, 'index.json');
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as { skills?: unknown };
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.skills)) return null;
    const entries: CatalogEntry[] = [];
    for (const raw of parsed.skills) {
      if (!raw || typeof raw !== 'object') continue;
      const entry = raw as Record<string, unknown>;
      if (typeof entry['name'] !== 'string' || !isSafeEntryName(entry['name'])) continue;
      if (typeof entry['kind'] === 'string') {
        entries.push(entry as unknown as CatalogEntry);
      } else if (Array.isArray(entry['files'])) {
        // 旧版本缓存：无 kind 字段的 files 条目
        entries.push({ kind: 'files', name: entry['name'], version: entry['version'] as string | number | undefined, files: entry['files'] as string[] });
      }
    }
    return entries;
  } catch {
    return null;
  }
}

/** `files` 条目的入口文件校验：必须含根层 `SKILL.md` 或 `<name>.md`。 */
function filesHaveEntryPoint(entry: CatalogFilesEntry): boolean {
  return entry.files.some((file) => file === 'SKILL.md' || file === `${entry.name}.md`);
}

/**
 * 解析远端 index 为归一化条目。
 * 按条目识别格式：有 `files` 数组 → 文档格式；有 `type`(archive|skill-md) → 0.2.0。
 */
export function normalizeIndex(raw: unknown, errors: string[], source: string, indexUrl: string): CatalogEntry[] | null {
  const parsed = raw as { skills?: unknown } | null;
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.skills)) {
    errors.push(`Catalog ${source}: index.json must contain a "skills" array`);
    return null;
  }
  if (parsed.skills.length > MAX_ENTRIES) {
    errors.push(`Catalog ${source}: too many entries (${parsed.skills.length} > ${MAX_ENTRIES})`);
    return null;
  }

  const entries: CatalogEntry[] = [];
  for (const raw of parsed.skills) {
    if (!raw || typeof raw !== 'object') {
      errors.push(`Catalog ${source}: invalid entry skipped`);
      continue;
    }
    const entry = raw as Record<string, unknown>;
    const name = entry['name'];
    if (typeof name !== 'string' || !isSafeEntryName(name)) {
      errors.push(`Catalog ${source}: invalid entry name skipped`);
      continue;
    }

    // 1) 文档格式：{ name, version?, files }
    if (Array.isArray(entry['files'])) {
      const files = entry['files'];
      if (files.length === 0) {
        errors.push(`Catalog ${source}: entry "${name}" has no files`);
        continue;
      }
      if (files.length > MAX_FILES_PER_ENTRY) {
        errors.push(`Catalog ${source}: entry "${name}" has too many files`);
        continue;
      }
      if (!files.every((file) => isSafeRelativeFile(file))) {
        errors.push(`Catalog ${source}: entry "${name}" contains an unsafe file path`);
        continue;
      }
      const normalized: CatalogFilesEntry = {
        kind: 'files',
        name,
        version: typeof entry['version'] === 'string' || typeof entry['version'] === 'number' ? entry['version'] : undefined,
        files: files as string[],
      };
      if (!filesHaveEntryPoint(normalized)) {
        errors.push(`Catalog ${source}: entry "${name}" lacks SKILL.md or ${name}.md`);
        continue;
      }
      entries.push(normalized);
      continue;
    }

    // 2) discovery 0.2.0：{ name, type, url, digest }
    const type = entry['type'];
    if (type !== 'skill-md' && type !== 'archive') {
      errors.push(`Catalog ${source}: entry "${name}" has neither "files" nor a supported "type"`);
      continue;
    }
    const resolved = resolveDiscoveryUrl(typeof entry['url'] === 'string' ? entry['url'] : '', indexUrl);
    if (!resolved) {
      errors.push(`Catalog ${source}: entry "${name}" has a missing or non-http(s) url`);
      continue;
    }
    const digest = typeof entry['digest'] === 'string' ? entry['digest'] : '';
    if (!SHA256_DIGEST_RE.test(digest)) {
      errors.push(`Catalog ${source}: entry "${name}" has a missing or invalid sha256 digest`);
      continue;
    }
    const description = typeof entry['description'] === 'string' ? entry['description'] : undefined;
    entries.push({
      kind: type,
      name,
      url: resolved.href,
      digest: digest.toLowerCase(),
      ...(description ? { description } : {}),
    });
  }
  return entries;
}

/* -------------------------------------------------------------------------- */
/* 下载与落盘                                                                  */
/* -------------------------------------------------------------------------- */

async function fetchText(fetchImpl: FetchLike, url: string, timeoutMs: number): Promise<string> {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const text = await res.text();
  if (text.length > MAX_FILE_BYTES) throw new Error(`Response too large for ${url}`);
  return text;
}

async function fetchFileBytes(fetchImpl: FetchLike, url: string, timeoutMs: number): Promise<Buffer> {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > MAX_FILE_BYTES) throw new Error(`File too large: ${url}`);
  return bytes;
}

/** 校验下载内容的 sha256 与 index 声明的 digest 一致（大小写不敏感）。 */
function verifyDigest(bytes: Buffer, digest: string, name: string): void {
  const expected = SHA256_DIGEST_RE.exec(digest)?.[1]?.toLowerCase();
  if (!expected) throw new Error(`invalid digest for "${name}"`);
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== expected) {
    throw new Error(`digest mismatch for "${name}" (expected ${digest}, got sha256:${actual})`);
  }
}

/** 条目产物是否已在缓存中完整存在。 */
function artifactPresent(root: string, entry: CatalogEntry): boolean {
  const dir = join(root, entry.name);
  switch (entry.kind) {
    case 'files': {
      try {
        if (!statSync(dir).isDirectory()) return false;
      } catch {
        return false;
      }
      return entry.files.every((file) => existsSync(join(dir, file)));
    }
    case 'skill-md':
      return existsSync(join(dir, `${entry.name}.md`));
    case 'archive':
      return existsSync(join(dir, 'SKILL.md'));
  }
}

/** 是否可跳过下载：文档格式比 version，0.2.0 比 digest。 */
function isUpToDate(previous: Map<string, CatalogEntry>, entry: CatalogEntry): boolean {
  const prev = previous.get(entry.name);
  if (!prev || prev.kind !== entry.kind) return false;
  if (entry.kind === 'files') {
    if (prev.kind !== 'files') return false;
    if (prev.version === undefined || entry.version === undefined) return false;
    return String(prev.version) === String(entry.version);
  }
  if (prev.kind === 'files') return false;
  return prev.digest === entry.digest;
}

/* -------------------------------------------------------------------------- */
/* 缓存读取（同步）                                                            */
/* -------------------------------------------------------------------------- */

/**
 * 同步读取缓存：返回 index 中产物完整、可用的 skill 来源根。
 * 首次运行（无缓存）时返回空数组，联网刷新后即可用。
 */
export function loadCachedCatalogDirs(url: string, cacheDir: string): CachedCatalogSkill[] {
  const root = catalogCacheRoot(url, cacheDir);
  const entries = readIndex(root);
  if (!entries) return [];

  const skills: CachedCatalogSkill[] = [];
  for (const entry of entries) {
    if (!isSafeEntryName(entry.name)) continue;
    if (artifactPresent(root, entry)) skills.push({ dir: join(root, entry.name), entryName: entry.name });
  }
  return skills;
}

/* -------------------------------------------------------------------------- */
/* 刷新（联网）                                                                */
/* -------------------------------------------------------------------------- */

/**
 * 刷新一个 catalog 的缓存（双格式）：
 * 1. 拉取 `<base>/index.json` 并归一化
 * 2. 与缓存比对（`version` / `digest`），只下载变化或产物缺失的条目
 * 3. 下载到临时目录：
 *    - `files`：逐文件下载（同源校验）
 *    - `skill-md`：单文件下载 → digest 校验 → 写 `<name>.md`
 *    - `archive`：tar.gz 下载 → digest 校验 → 解包 → 要求根层有 SKILL.md
 * 4. 原子替换；失败保留旧版本；清理 index 中已移除的条目
 *
 * 单个条目失败不影响其它条目；网络失败时旧缓存保持可用。
 */
export async function refreshCatalog(
  url: string,
  cacheDir: string,
  options: CatalogRefreshOptions = {},
): Promise<CatalogRefreshResult> {
  const errors: string[] = [];
  const root = catalogCacheRoot(url, cacheDir);
  const fetchImpl: FetchLike = options.fetchImpl ?? ((u, init) => fetch(u, init));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const base = normalizeBaseUrl(url);
  if (!base) {
    errors.push(`Catalog ${url}: invalid http(s) base URL`);
    return { dirs: [], errors };
  }

  const indexUrl = new URL('index.json', base).href;
  let rawIndex: unknown;
  try {
    rawIndex = JSON.parse(await fetchText(fetchImpl, indexUrl, timeoutMs));
  } catch (error) {
    errors.push(`Catalog ${url}: failed to load index.json (${messageOf(error)})`);
    // 离线时保留旧缓存
    return { dirs: loadCachedCatalogDirs(url, cacheDir), errors };
  }

  const entries = normalizeIndex(rawIndex, errors, url, indexUrl);
  if (!entries) return { dirs: loadCachedCatalogDirs(url, cacheDir), errors };

  const previousList = readIndex(root);
  const previous = new Map<string, CatalogEntry>();
  for (const entry of previousList ?? []) previous.set(entry.name, entry);

  mkdirSync(root, { recursive: true });

  /**
   * 持久化的索引条目必须与磁盘产物一致：下载成功记新条目；失败时若旧产物
   * 仍在则保留旧条目（其 digest/version 与磁盘内容匹配），否则丢弃该条目
   * 以便下次刷新重试——避免"index 声明了新 digest 但磁盘还是旧内容"。
   */
  const persisted: CatalogEntry[] = [];

  for (const entry of entries) {
    const dir = join(root, entry.name);
    const prev = previous.get(entry.name);
    if (isUpToDate(previous, entry) && artifactPresent(root, entry)) {
      persisted.push(entry);
      continue;
    }

    const tmpDir = join(root, `.tmp-${entry.name}`);
    try {
      rmSync(tmpDir, { recursive: true, force: true });
      mkdirSync(tmpDir, { recursive: true });

      if (entry.kind === 'files') {
        for (const file of entry.files) {
          const fileUrl = resolveCatalogFileUrl(url, entry.name, file);
          if (!fileUrl) {
            throw new Error(`unsafe or cross-origin file path "${file}"`);
          }
          const bytes = await fetchFileBytes(fetchImpl, fileUrl.href, timeoutMs);
          const target = join(tmpDir, file);
          mkdirSync(dirname(target), { recursive: true });
          writeFileSync(target, bytes);
        }
      } else if (entry.kind === 'skill-md') {
        const bytes = await fetchFileBytes(fetchImpl, entry.url, timeoutMs);
        verifyDigest(bytes, entry.digest, entry.name);
        writeFileSync(join(tmpDir, `${entry.name}.md`), bytes);
      } else {
        const bytes = await fetchFileBytes(fetchImpl, entry.url, timeoutMs);
        verifyDigest(bytes, entry.digest, entry.name);
        const { files } = extractTarGz(bytes, { maxFileBytes: MAX_FILE_BYTES });
        if (files.length === 0) throw new Error('archive is empty');
        for (const file of files) {
          const target = join(tmpDir, file.path);
          mkdirSync(dirname(target), { recursive: true });
          writeFileSync(target, file.data);
        }
        if (!existsSync(join(tmpDir, 'SKILL.md'))) {
          throw new Error('archive lacks root SKILL.md');
        }
      }

      rmSync(dir, { recursive: true, force: true });
      renameSync(tmpDir, dir);
      persisted.push(entry);
    } catch (error) {
      errors.push(`Catalog ${url}: entry "${entry.name}" failed (${messageOf(error)})`);
      rmSync(tmpDir, { recursive: true, force: true });
      if (prev && artifactPresent(root, prev)) persisted.push(prev);
    }
  }

  // 清理 index 中已移除的条目与残留的临时目录，然后持久化归一化索引
  try {
    const keep = new Set(persisted.map((entry) => entry.name));
    for (const name of readdirSync(root)) {
      if (name === 'index.json') continue;
      if (name.startsWith('.tmp-') || !keep.has(name)) {
        rmSync(join(root, name), { recursive: true, force: true });
      }
    }

    const tmpIndex = join(root, '.index.json.tmp');
    writeFileSync(tmpIndex, JSON.stringify({ skills: persisted }, null, 2));
    renameSync(tmpIndex, join(root, 'index.json'));
  } catch (error) {
    errors.push(`Catalog ${url}: failed to persist index (${messageOf(error)})`);
  }

  return { dirs: loadCachedCatalogDirs(url, cacheDir), errors };
}

/** 刷新多个 catalog，返回聚合后的来源目录与错误。 */
export async function refreshCatalogs(
  urls: string[],
  cacheDir: string,
  options: CatalogRefreshOptions = {},
): Promise<CatalogRefreshResult> {
  const dirs: CachedCatalogSkill[] = [];
  const errors: string[] = [];

  for (const url of [...new Set(urls)]) {
    const result = await refreshCatalog(url, cacheDir, options);
    dirs.push(...result.dirs);
    errors.push(...result.errors);
  }

  return { dirs, errors };
}

/** 默认缓存目录：`<home>/.clover/skills-cache`。 */
export function defaultCatalogCacheDir(home = homedir()): string {
  return join(home, '.clover', 'skills-cache');
}
