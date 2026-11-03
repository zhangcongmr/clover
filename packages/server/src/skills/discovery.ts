import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { Skill } from './types.js';
import { directoryExists, resolveUserPath } from './paths.js';
import { collectConfigSkillEntries } from './config.js';

export { directoryExists } from './paths.js';

/**
 * Skill 发现（Discovery）。
 *
 * 每个「来源」都是一个目录，同一来源可同时包含两种形式：
 *   - 来源根下的普通 markdown：`<source>/review.md`            -> ID `review`
 *   - 任意深度的 `SKILL.md`：`<source>/team/release/SKILL.md`  -> ID `release`
 * 来源目录名本身（如 `skills`）不参与 ID 计算。
 *
 * 发现范围刻意收窄为**用户级**来源：全局目录（`~/.claude/skills` 等，
 * 含可写的目录 store `~/.clover/skills`）、全局 `opencode.json(c)` 的本地
 * 路径条目，以及调用方显式传入的 `extraRoots` / `configFiles`。项目内的
 * `.claude` / `.agents` / `.opencode` 目录与项目配置文件**永远不纳入发现**。
 *
 * HTTP catalog URL 仅收集进 `report.catalogs`（由前端浏览器直连查询），
 * 后端不下载、不缓存。
 */

/** 旧的 JSON store 位置，作为最低优先级来源。 */
export const STORE_DIR = join(homedir(), '.clover');

/** 单个来源的默认扫描深度上限，避免误扫进 node_modules 之类的深层目录。 */
const DEFAULT_MAX_DEPTH = 6;
/** 目录遍历时跳过的目录名（`.git` 等以点开头的目录一并跳过）。 */
const IGNORED_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  'vendor',
]);

/** 扫描到的 skill：`name` 是路径推导出的 ID，`displayName` 是展示名。 */
export interface DiscoveredSkill extends Skill {
  /** 展示名：frontmatter `name` 优先，否则等于 ID。 */
  displayName: string;
  /** 来源标签，用于日志与 UI 展示。 */
  source: string;
  /** skill 入口文件的绝对路径。 */
  path: string;
  /** frontmatter 未设置 `opencode/autoinvoke: false` / `disable-model-invocation: true`。 */
  autoinvoke: boolean;
}

export interface SkillSource {
  /** 来源目录的绝对路径。 */
  dir: string;
  /** 用于日志与去重的来源标签。 */
  label: string;
  /** 该来源的扫描深度上限。 */
  maxDepth: number;
}

export interface DiscoverOptions {
  /** `~/.clover/skills.json` 的内容，作为最低优先级来源。 */
  store?: Record<string, Skill>;
  /** 活动工作目录，默认 `process.cwd()`（相对路径条目从此解析）。 */
  cwd?: string;
  /** 用户主目录，默认 `os.homedir()`。 */
  home?: string;
  /** 显式追加的来源根目录（在全局来源之后按顺序递增）。 */
  extraRoots?: string[];
  /** 是否读取全局来源（目录 + 全局配置），默认 true。 */
  includeGlobal?: boolean;
  /** 是否解析 `opencode.json(c)` 的 `skills` 配置（全局配置 + `configFiles`），默认 true。 */
  includeConfig?: boolean;
  /** 额外指定的配置文件（追加在全局配置之后）。 */
  configFiles?: string[];
  maxDepth?: number;
}

/** `collectSkillSources` 的附带发现结果。 */
export interface SourceReport {
  /** 非致命错误（配置解析失败等）。 */
  errors: string[];
  /** 实际读取到的配置文件。 */
  configFiles: string[];
  /** 配置中声明的 HTTP catalog 地址（与缓存是否存在无关）。 */
  catalogs: string[];
}

export interface SkillDiscovery {
  /** 聚合后的 skills，key 为 skill ID；后者覆盖前者。 */
  skills: Record<string, Skill>;
  /**
   * 可写（已存在于 `~/.clover/skills.json`）的 skill ID。
   * 只出现在磁盘来源里的 skill 不在其中 —— 对它们的写入会被拒绝。
   */
  writable: Set<string>;
  /** 实际扫描到的来源目录，按优先级从低到高排列。 */
  sources: string[];
  /** 实际读取到的 `opencode.json(c)` 配置文件。 */
  configFiles: string[];
  /** 配置中声明的 HTTP catalog 地址。 */
  catalogs: string[];
  /** 非致命错误（目录不可读、文件读取失败、配置解析失败等）。 */
  errors: string[];
}

/* -------------------------------------------------------------------------- */
/* frontmatter                                                                */
/* -------------------------------------------------------------------------- */

interface FrontMatter {
  name?: string;
  description?: string;
  autoinvoke?: boolean;
}

const FRONTMATTER_RE = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * 浅解析 frontmatter 中我们关心的字段。
 * 刻意不引入 YAML 依赖：只处理顶层 `key: value` 与单层缩进的 `metadata:`，
 * 足以覆盖 `name` / `description` / `opencode/autoinvoke`。
 */
export function parseFrontMatter(raw: string): { attributes: FrontMatter; body: string } {
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) return { attributes: {}, body: raw };

  const attributes: FrontMatter = {};
  let inMetadata = false;

  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;

    const kv = /^\s*([^:]+):\s*(.*)$/.exec(line);
    if (!kv) continue;

    const key = kv[1].trim();
    const value = stripQuotes(kv[2].trim());
    const nested = /^\s/.test(line);

    if (!nested) {
      inMetadata = key === 'metadata';
      if (inMetadata) continue;
    } else if (!inMetadata) {
      continue;
    }

    if (key === 'name' && !attributes.name) attributes.name = value;
    else if (key === 'description' && !attributes.description) attributes.description = value;
    else if (key === 'disable-model-invocation' && value === 'true') attributes.autoinvoke = false;
    else if (key === 'opencode/autoinvoke' && value) attributes.autoinvoke = value !== 'false';
  }

  return { attributes, body: raw.slice(match[0].length) };
}

function stripQuotes(value: string): string {
  const first = value[0];
  if (value.length >= 2 && (first === '"' || first === "'") && value.endsWith(first)) {
    return value.slice(1, -1);
  }
  return value;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/* -------------------------------------------------------------------------- */
/* 单个文件 -> Skill                                                           */
/* -------------------------------------------------------------------------- */

const MARKDOWN_RE = /\.(md|markdown)$/i;

/** 来源根下的普通 markdown（`review.md`）才是 skill 入口。 */
export function isRootSkillFile(fileName: string): boolean {
  return MARKDOWN_RE.test(fileName) && !fileName.startsWith('.');
}

/** 只有文件名恰好为 `SKILL.md` 的嵌套文件才是 skill 入口（大小写不敏感）。 */
export function isNestedSkillFile(fileName: string): boolean {
  return fileName.toLowerCase() === 'skill.md';
}

/** 由入口文件推导 skill ID：取父目录名，来源根下的文件则取去掉扩展名的文件名。 */
export function deriveSkillId(entryFile: string, sourceDir: string): string {
  const parent = dirname(entryFile);
  if (parent === sourceDir) return basename(entryFile).replace(MARKDOWN_RE, '');
  return basename(parent);
}

function readSkillFile(
  entryFile: string,
  id: string,
  source: SkillSource,
  errors: string[],
): DiscoveredSkill | null {
  try {
    const raw = readFileSync(entryFile, 'utf-8');
    const { attributes, body } = parseFrontMatter(raw);
    return {
      name: id,
      displayName: attributes.name?.trim() || id,
      description: attributes.description?.trim() || '',
      content: body.trim(),
      source: source.label,
      path: entryFile,
      autoinvoke: attributes.autoinvoke !== false,
    };
  } catch (error) {
    errors.push(`Failed to read skill file ${entryFile}: ${messageOf(error)}`);
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* 目录扫描                                                                    */
/* -------------------------------------------------------------------------- */

export interface ScanResult {
  entries: DiscoveredSkill[];
  errors: string[];
}

/** 扫描单个来源目录：根层 markdown + 任意深度（有上限）的 `SKILL.md`。 */
export function scanSkillSource(source: SkillSource): ScanResult {
  const entries: DiscoveredSkill[] = [];
  const errors: string[] = [];

  const walk = (dir: string, depth: number): void => {
    let dirents;
    try {
      dirents = readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      errors.push(`Failed to read skill directory ${dir}: ${messageOf(error)}`);
      return;
    }

    for (const dirent of dirents) {
      const full = join(dir, dirent.name);

      if (dirent.isDirectory()) {
        if (depth >= source.maxDepth) continue;
        if (dirent.name.startsWith('.') || IGNORED_DIRS.has(dirent.name)) continue;
        walk(full, depth + 1);
        continue;
      }

      const isRoot = depth === 0;
      const matches = isRoot ? isRootSkillFile(dirent.name) : isNestedSkillFile(dirent.name);
      if (!matches) continue;

      // 符号链接：确认最终指向的是普通文件
      if (dirent.isSymbolicLink()) {
        try {
          if (!statSync(full).isFile()) continue;
        } catch {
          continue;
        }
      } else if (!dirent.isFile()) {
        continue;
      }

      const id = deriveSkillId(full, source.dir);
      if (!id) continue;

      const skill = readSkillFile(full, id, source, errors);
      if (skill) entries.push(skill);
    }
  };

  walk(source.dir, 0);
  return { entries, errors };
}

/* -------------------------------------------------------------------------- */
/* 来源装配                                                                    */
/* -------------------------------------------------------------------------- */

function sourceKey(dir: string): string {
  return process.platform === 'win32' ? dir.toLowerCase() : dir;
}

/**
 * 列出所有 skill 来源目录，按优先级从低到高排序。
 *
 * **只包含用户级来源**——项目内的 `.claude` / `.agents` / `.opencode`
 * 目录与项目配置文件永远不纳入发现：
 *
 *  1. `~/.claude/skills`
 *  2. `~/.agents/skills`
 *  3. `~/.config/opencode/skills`、`~/.clover/skills`（后者是目录 store）
 *  4. `extraRoots`（调用方显式指定）
 *  5. `opencode.json(c)` 的本地路径条目（最高优先级）：按 全局配置 ->
 *    显式 `configFiles`、文件内数组顺序。
 *
 * HTTP catalog URL（`http(s)://…`）不产生来源目录，只收集进 `report.catalogs`
 * 供前端直连查询。同一个目录只会注册一次（先出现的标签保留）。
 */
export function collectSkillSources(options: DiscoverOptions = {}, report?: SourceReport): SkillSource[] {
  const out: SourceReport = report ?? { errors: [], configFiles: [], catalogs: [] };
  const cwd = resolve(options.cwd ?? process.cwd());
  const home = options.home ?? homedir();
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const includeGlobal = options.includeGlobal !== false;

  const sources: SkillSource[] = [];
  const seen = new Set<string>();

  const push = (dir: string, label: string): void => {
    const absolute = resolve(dir);
    const key = sourceKey(absolute);
    if (seen.has(key)) return;
    seen.add(key);
    sources.push({ dir: absolute, label, maxDepth });
  };

  // 1. 全局兼容性目录
  if (includeGlobal) push(join(home, '.claude', 'skills'), '~/.claude/skills');

  // 2. 全局兼容性目录
  if (includeGlobal) push(join(home, '.agents', 'skills'), '~/.agents/skills');

  // 3. 全局 opencode 目录（含目录 store ~/.clover/skills）
  if (includeGlobal) {
    push(join(home, '.config', 'opencode', 'skills'), '~/.config/opencode/skills');
    push(join(home, '.clover', 'skills'), '~/.clover/skills');
  }

  // 4. 调用方显式指定的根目录
  for (const root of options.extraRoots ?? []) {
    if (typeof root !== 'string' || !root.trim()) continue;
    push(resolveUserPath(root.trim(), cwd, home), root.trim());
  }

  // 5. opencode.json(c) 的 skills 条目：本地路径成为来源；URL 仅上报给前端
  if (options.includeConfig !== false) {
    const config = collectConfigSkillEntries({
      home,
      includeGlobal,
      configFiles: options.configFiles,
    });
    out.errors.push(...config.errors);
    out.configFiles.push(...config.files);

    for (const entry of config.entries) {
      if (entry.kind === 'path') {
        push(resolveUserPath(entry.value, cwd, home), entry.value);
      } else if (!out.catalogs.includes(entry.value)) {
        out.catalogs.push(entry.value);
      }
    }
  }

  return sources;
}

/* -------------------------------------------------------------------------- */
/* 聚合                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * 读取所有来源并聚合为一个 skills 映射。
 * 同一 ID 由后出现的来源覆盖先出现的来源（与文档的 Precedence 一致）；
 * `~/.clover/skills.json` 作为最低优先级来源，磁盘上的同名 skill 会覆盖它。
 */
export function discoverSkills(options: DiscoverOptions = {}): SkillDiscovery {
  const errors: string[] = [];
  const skills: Record<string, Skill> = {};
  const writable = new Set<string>();

  // 1. 最低优先级：旧的 JSON store。只补齐缺省字段，不覆盖 UI 已有的数据。
  for (const [id, value] of Object.entries(options.store ?? {})) {
    if (!id || !value) continue;
    skills[id] = {
      ...value,
      name: id,
      source: value.source ?? 'store',
      displayName: value.displayName ?? id,
      autoinvoke: value.autoinvoke ?? true,
      path: value.path ?? join(STORE_DIR, 'skills.json'),
    };
  }

  // 2. 磁盘来源，优先级递增（含 opencode.json(c) 配置条目与 catalog 缓存）
  const report: SourceReport = { errors: [], configFiles: [], catalogs: [] };
  const sources = collectSkillSources(options, report);
  errors.push(...report.errors);
  const scanned: string[] = [];
  const storeIds = new Set(Object.keys(skills));

  for (const source of sources) {
    if (!directoryExists(source.dir)) continue;
    scanned.push(source.dir);

    const result = scanSkillSource(source);
    errors.push(...result.errors);

    for (const entry of result.entries) {
      skills[entry.name] = entry;
    }
  }

  // 3. 磁盘来源里出现的 ID 一律视为只读；只有 store 独有、且未被覆盖的条目可写。
  for (const id of storeIds) {
    if (skills[id] !== undefined && !isFromDisk(id, sources)) writable.add(id);
  }

  return {
    skills,
    writable,
    sources: scanned,
    configFiles: report.configFiles,
    catalogs: report.catalogs,
    errors,
  };
}

/** 该 ID 是否由某个磁盘来源提供（用于决定可写性）。 */
function isFromDisk(id: string, sources: SkillSource[]): boolean {
  for (const source of sources) {
    if (!directoryExists(source.dir)) continue;
    const direct = join(source.dir, id);
    try {
      // 目录形式：<source>/<id>/SKILL.md
      if (statSync(direct).isDirectory() && existsSync(join(direct, 'SKILL.md'))) return true;
      // 根层 markdown：<source>/<id>.md
      const flat = join(source.dir, `${id}.md`);
      if (existsSync(flat) && statSync(flat).isFile()) return true;
    } catch {
      // 该来源没有这个 ID，继续看下一个
    }
  }
  return false;
}
