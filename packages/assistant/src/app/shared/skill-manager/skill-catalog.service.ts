import { Injectable } from '@angular/core';

/**
 * HTTP Skill Catalog 客户端（浏览器直连）。
 *
 * 与 MCP 管理器的官方 registry 直查同模式：数据源是配置的 catalog URL
 * （后端 `GET /api/skills` 的 `catalogs` 字段）∪ 内置默认，浏览器直接
 * 拉取 `<base>/index.json`——目录主机普遍返回 `Access-Control-Allow-Origin: *`，
 * 无需后端代理；后端因此不下载、不缓存 catalog。
 *
 * 支持两种线上格式：
 * - agentskills discovery 0.2.0（主流）：`{ name, type: 'skill-md'|'archive',
 *   url, digest, description }`，url 相对 index 解析、允许跨域、sha256 校验
 * - OpenCode 文档格式：`{ name, version, files: [...] }`，文件位于
 *   `<base>/<name>/<file>`（同源）
 *
 * 安装时把条目内容取回本地（archive 用浏览器 DecompressionStream 解 gzip +
 * 最小 ustar 解包），组装成 `POST /api/skills` 的 body（正文 + 附属文件）。
 */

/** 开箱即用的内置 catalog（均带 `Access-Control-Allow-Origin: *`）。 */
export const DEFAULT_SKILL_CATALOGS = [
  'https://developers.cloudflare.com/.well-known/agent-skills/',
  'https://evilmartians.com/.well-known/agent-skills/',
  'https://vercel.com/.well-known/agent-skills/',
] as const;

/** 附属文件限制（与后端 registry 校验对齐，避免装到一半被拒）。 */
const MAX_FILES = 100;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;

/** 单次 index.json 拉取超时。 */
const FETCH_TIMEOUT_MS = 15_000;

/* -------------------------------------------------------------------------- */
/* 类型                                                                        */
/* -------------------------------------------------------------------------- */

/** 归一化后的 catalog 条目。 */
export interface CatalogSkillItem {
  /** 去重键：`<catalogUrl>|<name>`。 */
  key: string;
  /** 条目名（安装时 sanitize 成本地合法名）。 */
  name: string;
  description: string;
  kind: 'skill-md' | 'archive' | 'files';
  /** 已解析为绝对地址的入口/包下载地址。 */
  url: string;
  /** `sha256:<hex>`（0.2.0），文档格式为空。 */
  digest: string;
  /** 文档格式的文件清单（含入口与附属文件）。 */
  files: string[];
  /** 所属 catalog 的 base URL。 */
  catalogUrl: string;
}

/** 单个 catalog 源的加载状态。 */
export interface CatalogSourceState {
  url: string;
  /** 展示名：host + 路径首段。 */
  label: string;
  /** 是否来自配置（否则是内置默认）。 */
  fromConfig: boolean;
  loading: boolean;
  error: string | null;
  items: CatalogSkillItem[];
}

/** `prepareInstall` 的产物：可直接 POST 给后端的 skill 数据。 */
export interface PreparedSkillInstall {
  name: string;
  description: string;
  content: string;
  files: Record<string, string>;
}

/* -------------------------------------------------------------------------- */
/* 纯函数（导出便于测试）                                                       */
/* -------------------------------------------------------------------------- */

/** 把任意字符串 sanitize 成本地 skill 名合法片段（`[a-zA-Z0-9_-]`）。 */
export function sanitizeSkillName(raw: string): string {
  return (raw ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

const SHA256_RE = /^sha256:([0-9a-f]{64})$/i;

/** URL 是否 http(s)。 */
function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

/** 相对 index 地址解析条目 url；非 http(s) 返回 null。 */
function resolveEntryUrl(raw: string, indexUrl: string): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const resolved = new URL(raw, indexUrl);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return null;
    return resolved.href;
  } catch {
    return null;
  }
}

/**
 * 归一化 index.json 为条目列表（双格式、按条目识别；过滤脏数据）。
 * `base` 是 catalog 基地址，用于解析相对 url 与派生文档格式的文件地址。
 */
export function normalizeCatalogIndex(raw: unknown, base: string): CatalogSkillItem[] {
  const skills = (raw as { skills?: unknown } | null)?.skills;
  if (!Array.isArray(skills)) return [];

  const baseWithSlash = base.endsWith('/') ? base : `${base}/`;
  const items: CatalogSkillItem[] = [];

  for (const entry of skills) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const name = typeof e['name'] === 'string' ? e['name'].trim() : '';
    if (!name) continue;

    const description = typeof e['description'] === 'string' ? e['description'] : '';
    const common = { name, description, catalogUrl: baseWithSlash };

    // 0.2.0：skill-md / archive
    const type = e['type'];
    if (type === 'skill-md' || type === 'archive') {
      const url = resolveEntryUrl(typeof e['url'] === 'string' ? e['url'] : '', new URL('index.json', baseWithSlash).href);
      if (!url) continue;
      const digestRaw = typeof e['digest'] === 'string' ? e['digest'] : '';
      items.push({
        ...common,
        key: `${baseWithSlash}|${name}`,
        kind: type,
        url,
        digest: SHA256_RE.test(digestRaw) ? digestRaw.toLowerCase() : '',
        files: [],
      });
      continue;
    }

    // 文档格式：files[]
    if (Array.isArray(e['files'])) {
      const files = e['files'].filter((f): f is string => typeof f === 'string' && !!f && !f.startsWith('/') && !f.includes('..') && !f.includes('\\'));
      if (files.length === 0) continue;
      // 入口：`SKILL.md` 或 `<name>.md`；下载地址 `<base>/<name>/<file>`
      const entryFile = files.includes('SKILL.md') ? 'SKILL.md' : files.includes(`${name}.md`) ? `${name}.md` : null;
      if (!entryFile) continue;
      const url = resolveEntryUrl(`${name}/${entryFile}`, new URL('index.json', baseWithSlash).href);
      if (!url) continue;
      items.push({
        ...common,
        key: `${baseWithSlash}|${name}`,
        kind: 'files',
        url,
        digest: '',
        files,
      });
    }
  }

  return items;
}

/** 浅解析 frontmatter（与后端一致：只取 `description`，正文去掉 frontmatter 块）。 */
export function parseSkillFrontmatter(text: string): { description: string; body: string } {
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { description: '', body: text };

  let description = '';
  let inMetadata = false;
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim()) continue;
    const nested = /^\s/.test(line);
    const kv = /^\s*([^:]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1].trim();
    const value = kv[2].trim().replace(/^["']|["']$/g, '');
    if (!nested) {
      inMetadata = key === 'metadata';
      if (inMetadata) continue;
    } else if (!inMetadata) {
      continue;
    }
    if (key === 'description' && !description) description = value;
  }
  return { description, body: text.slice(match[0].length).trim() };
}

/** 包内路径安全校验（与后端一致：相对、无 `..`、无反斜杠、段非空且不以点开头）。 */
function isSafeArchivePath(path: string): boolean {
  if (!path || path.startsWith('/') || path.includes('\\') || /^[a-zA-Z]:/.test(path)) return false;
  return path.split('/').every((seg) => seg.length > 0 && seg !== '.' && seg !== '..' && !seg.startsWith('.'));
}

/** 最小 ustar untar：仅普通文件（typeflag `0`/`\0`），跳过目录等其余类型。 */
export function untar(buffer: ArrayBuffer): Map<string, Uint8Array> {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const out = new Map<string, Uint8Array>();
  let offset = 0;

  const readString = (start: number, length: number): string => {
    const slice = bytes.subarray(start, start + length);
    const end = slice.indexOf(0);
    return new TextDecoder().decode(slice.subarray(0, end === -1 ? slice.length : end));
  };
  const readOctal = (start: number, length: number): number => {
    const raw = readString(start, length).trim();
    if (!raw) return 0;
    const value = parseInt(raw, 8);
    return Number.isFinite(value) && value >= 0 ? value : 0;
  };

  while (offset + 512 <= buffer.byteLength) {
    // 全零块 = 结束标记
    let isZero = true;
    for (let i = offset; i < offset + 512; i++) {
      if (bytes[i] !== 0) { isZero = false; break; }
    }
    if (isZero) break;

    const headerOffset = offset;
    const size = readOctal(headerOffset + 124, 12);
    const type = String.fromCharCode(view.getUint8(headerOffset + 156)) || '0';
    const dataStart = headerOffset + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > buffer.byteLength) break; // 截断：放弃尾部
    offset = dataStart + Math.ceil(size / 512) * 512;

    if (type !== '0' && type !== '\u0000') continue; // 目录/链接等跳过

    const path = readString(headerOffset, 100);
    if (!isSafeArchivePath(path)) continue;
    if (size > MAX_FILE_BYTES) continue;
    out.set(path, bytes.slice(dataStart, dataEnd));
  }

  return out;
}

/** gunzip：浏览器原生 `DecompressionStream('gzip')`；不支持时抛错。 */
export async function gunzip(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser does not support DecompressionStream (required to install archive skills)');
  }
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

/** 校验 sha256 digest（0.2.0）；未声明 digest 时跳过。 */
async function verifyDigest(bytes: ArrayBuffer, digest: string, name: string): Promise<void> {
  if (!digest) return;
  const expected = SHA256_RE.exec(digest)?.[1]?.toLowerCase();
  if (!expected) return;
  const actual = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  if (actual !== expected) {
    throw new Error(`"${name}" failed integrity check (digest mismatch)`);
  }
}

/** 把 Uint8Array 按 UTF-8 解码为文本（附属文件均为文本资产）。 */
function decodeText(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

/* -------------------------------------------------------------------------- */
/* Service                                                                     */
/* -------------------------------------------------------------------------- */

@Injectable({ providedIn: 'root' })
export class SkillCatalogService {
  /**
   * 加载全部 catalog 源（配置 ∪ 内置默认，去重）。
   * 每个源独立拉取 `<base>/index.json`，**单源失败只标记该源**，不影响其它源。
   */
  async loadSources(configUrls: string[], fromConfig: (url: string) => boolean): Promise<CatalogSourceState[]> {
    const merged = [...new Set([...configUrls, ...DEFAULT_SKILL_CATALOGS])]
      .filter((url) => isHttpUrl(url))
      .map((url) => (url.endsWith('/') ? url : `${url}/`));

    return Promise.all(
      merged.map(async (url): Promise<CatalogSourceState> => {
        const state: CatalogSourceState = {
          url,
          label: catalogLabel(url),
          fromConfig: fromConfig(url),
          loading: true,
          error: null,
          items: [],
        };
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
          let res: Response;
          try {
            res = await fetch(new URL('index.json', url).href, {
              signal: controller.signal,
              headers: { Accept: 'application/json' },
            });
          } finally {
            clearTimeout(timer);
          }
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const body: unknown = await res.json();
          state.items = normalizeCatalogIndex(body, url);
        } catch (err) {
          state.error =
            err instanceof Error && err.message
              ? `Cannot load ${catalogLabel(url)}: ${err.message}`
              : `Cannot load ${catalogLabel(url)} (network or CORS error)`;
        } finally {
          state.loading = false;
        }
        return state;
      }),
    );
  }

  /**
   * 准备安装：按条目类型取回内容与附属文件。
   * - `skill-md`：下载单文件 SKILL.md
   * - `archive`：下载 tar.gz → 解 gzip + untar → 根层 SKILL.md + 其余文本文件
   * - `files`（文档格式）：下载 `<base>/<name>/` 下清单内全部文件
   *
   * 0.2.0 条目先做 sha256 完整性校验，不通过则中止。
   */
  async prepareInstall(item: CatalogSkillItem): Promise<PreparedSkillInstall> {
    const name = sanitizeSkillName(item.name);
    if (!name) throw new Error(`"${item.name}" cannot be mapped to a valid local skill name`);

    if (item.kind === 'archive') {
      return this.installArchive(item, name);
    }
    if (item.kind === 'files') {
      return this.installFiles(item, name);
    }
    return this.installSkillMd(item, name);
  }

  private async fetchBytes(url: string): Promise<ArrayBuffer> {
    let res: Response;
    try {
      res = await fetch(url);
    } catch {
      throw new Error(`Cannot reach ${new URL(url).host} (network or CORS error)`);
    }
    if (!res.ok) throw new Error(`Download failed (HTTP ${res.status}) for ${url}`);
    return res.arrayBuffer();
  }

  private async installSkillMd(item: CatalogSkillItem, name: string): Promise<PreparedSkillInstall> {
    const bytes = await this.fetchBytes(item.url);
    await verifyDigest(bytes, item.digest, name);
    const text = decodeText(new Uint8Array(bytes));
    const { description, body } = parseSkillFrontmatter(text);
    if (!body.trim()) throw new Error(`"${name}" has an empty SKILL.md`);
    return { name, description: description || item.description, content: body, files: {} };
  }

  private async installArchive(item: CatalogSkillItem, name: string): Promise<PreparedSkillInstall> {
    const bytes = await this.fetchBytes(item.url);
    await verifyDigest(bytes, item.digest, name);
    const entries = untar(await gunzip(bytes));

    const skillFile = entries.get('SKILL.md');
    if (!skillFile) throw new Error(`"${name}" archive has no root SKILL.md`);
    const { description, body } = parseSkillFrontmatter(decodeText(skillFile));
    if (!body.trim()) throw new Error(`"${name}" has an empty SKILL.md`);

    const files: Record<string, string> = {};
    let total = 0;
    for (const [path, data] of entries) {
      if (path === 'SKILL.md') continue;
      if (Object.keys(files).length >= MAX_FILES || data.byteLength > MAX_FILE_BYTES) continue;
      total += data.byteLength;
      if (total > MAX_TOTAL_BYTES) break;
      files[path] = decodeText(data);
    }

    return { name, description: description || item.description, content: body, files };
  }

  private async installFiles(item: CatalogSkillItem, name: string): Promise<PreparedSkillInstall> {
    const base = item.url.slice(0, item.url.lastIndexOf('/') + 1); // `<base>/<name>/`
    const entryFile = item.url.slice(item.url.lastIndexOf('/') + 1);

    const files: Record<string, string> = {};
    let content = '';
    let description = item.description;
    let total = 0;

    for (const file of item.files) {
      const url = resolveEntryUrl(file, item.url);
      if (!url) continue;
      let text: string;
      try {
        const bytes = await this.fetchBytes(url);
        if (bytes.byteLength > MAX_FILE_BYTES) continue;
        total += bytes.byteLength;
        if (total > MAX_TOTAL_BYTES) break;
        text = decodeText(new Uint8Array(bytes));
      } catch {
        continue; // 附属文件下载失败不阻断安装
      }
      if (file === entryFile) {
        const parsed = parseSkillFrontmatter(text);
        content = parsed.body;
        description = parsed.description || description;
      } else {
        files[file] = text;
      }
    }

    if (!content.trim()) throw new Error(`"${name}" entry file is empty or unavailable`);
    return { name, description, content, files };
  }
}

/** catalog URL → 展示标签：host + 首个路径段（如 `developers.cloudflare.com/agent-skills`）。 */
export function catalogLabel(url: string): string {
  try {
    const u = new URL(url);
    const seg = u.pathname.split('/').filter(Boolean)[0];
    return seg ? `${u.host}/${seg}` : u.host;
  } catch {
    return url;
  }
}
