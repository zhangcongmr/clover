import { logger } from '../helpers/logger.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type { Skill, SkillsStore } from './types.js';
import { discoverSkills, type DiscoverOptions, type SkillDiscovery } from './discovery.js';

/** 目录 store 内附属文件数量上限。 */
const MAX_FILES_PER_SKILL = 100;
/** 单个附属文件大小上限（512KB）。 */
const MAX_FILE_BYTES = 512 * 1024;
/** 附属文件总大小上限（4MB）。 */
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
/** skill 名（同时是目录名）。 */
const SKILL_NAME_RE = /^[a-zA-Z0-9_-]+$/;

export interface SkillRegistryOptions extends DiscoverOptions {
  /** 为 false 时只读取 store，不扫描磁盘来源。 */
  discovery?: boolean;
}

/** 校验 skill 名，同时防御路径穿越。 */
export function isValidSkillName(name: string): boolean {
  return SKILL_NAME_RE.test(name);
}

/** 校验附属文件映射：安全相对路径、数量与体积上限；返回错误信息或 null。 */
export function validateSkillFiles(files: Record<string, string> | undefined): string | null {
  if (!files) return null;
  const entries = Object.entries(files);
  if (entries.length > MAX_FILES_PER_SKILL) {
    return `too many supporting files (>${MAX_FILES_PER_SKILL})`;
  }
  let total = 0;
  for (const [path, content] of entries) {
    if (typeof content !== 'string') return `supporting file "${path}" must be a string`;
    if (!isSafeRelativePath(path)) return `unsafe supporting file path "${path}"`;
    const bytes = Buffer.byteLength(content, 'utf-8');
    if (bytes > MAX_FILE_BYTES) return `supporting file "${path}" too large (>${MAX_FILE_BYTES} bytes)`;
    total += bytes;
  }
  if (total > MAX_TOTAL_BYTES) return `supporting files too large in total (>${MAX_TOTAL_BYTES} bytes)`;
  return null;
}

/** 安全的相对路径：无绝对路径/盘符/`..`/反斜杠，段非空且不以点开头。 */
function isSafeRelativePath(path: string): boolean {
  if (!path || path.startsWith('/') || path.includes('\\') || /^[a-zA-Z]:/.test(path)) return false;
  const segments = path.split('/');
  return segments.every((seg) => seg.length > 0 && seg !== '.' && seg !== '..' && !seg.startsWith('.'));
}

/** 把 description 写成安全的 YAML 双引号标量。 */
function yamlQuote(value: string): string {
  return `"${value.replace(/[\r\n]+/g, ' ').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** 组装带 frontmatter 的 SKILL.md 内容。 */
function renderSkillMarkdown(skill: Pick<Skill, 'name' | 'description'>, body: string): string {
  return `---\nname: ${yamlQuote(skill.name)}\ndescription: ${yamlQuote(skill.description ?? '')}\n---\n\n${body.trim()}\n`;
}

export class SkillRegistry {
  /** legacy `~/.clover/skills.json`：只读 fallback + remove 时同步删除。 */
  private persisted: SkillsStore = { skills: {} };
  /** 聚合后的视图：store + 所有磁盘来源。 */
  private store: SkillsStore = { skills: {} };
  /** 允许通过 API 修改的 skill ID（目录 store 写入 + legacy store 条目）。 */
  private writable = new Set<string>();
  private discovery: SkillDiscovery | null = null;
  private readonly options: SkillRegistryOptions;
  /** legacy JSON 文件位置（跟随 options.home，便于测试）。 */
  private readonly storeFile: string;
  /** 目录 store 根：`<home>/.clover/skills`（本身已是发现来源）。 */
  private readonly storeRoot: string;

  constructor(options: SkillRegistryOptions = {}) {
    this.options = options;
    const home = options.home ?? homedir();
    this.storeFile = join(home, '.clover', 'skills.json');
    this.storeRoot = join(home, '.clover', 'skills');
    this.loadStore();
  }

  /**
   * 载入 skill：legacy `skills.json` 作为最低优先级 fallback，再扫描
   * 1. 全局目录（`~/.claude/skills`、`~/.agents/skills`、`~/.config/opencode/skills`、
   *    `~/.clover/skills`；项目级来源永远不纳入发现）
   * 2. 全局 `opencode.json(c)` 与显式 `configFiles` 的 `skills` 条目
   *    （本地路径原样作为来源；HTTP catalog 由前端直连查询，不参与发现）
   * 最后按优先级聚合为同一个视图。
   */
  private loadStore(): void {
    try {
      this.persisted = this.readPersistedStore();
    } catch (error) {
      logger.error('[Skill Registry] Failed to load store:', error);
      this.persisted = { skills: {} };
    }

    if (this.options.discovery === false) {
      this.adoptStoreOnly();
      return;
    }

    try {
      const discovery = discoverSkills({ ...this.options, store: this.persisted.skills });

      for (const error of discovery.errors) {
        logger.error('[Skill Registry] Discovery warning:', error);
      }

      this.discovery = discovery;
      this.store = { skills: discovery.skills };

      // 可写 = legacy store 独有条目 + 目录 store（`~/.clover/skills`）里的 skill
      const writable = new Set(discovery.writable);
      for (const [id, skill] of Object.entries(discovery.skills)) {
        if (skill.source === DIR_STORE_LABEL) writable.add(id);
      }
      this.writable = writable;

      const total = Object.keys(discovery.skills).length;
      logger.log(
        `[Skill Registry] Aggregated ${total} skill(s) from ${discovery.sources.length} source(s)`,
      );
    } catch (error) {
      logger.error('[Skill Registry] Skill discovery failed:', error);
      this.adoptStoreOnly();
    }
  }

  /** 发现失败/被禁用时的兜底：只用 legacy store 里的内容。 */
  private adoptStoreOnly(): void {
    this.discovery = null;
    this.store = { skills: { ...this.persisted.skills } };
    this.writable = new Set(Object.keys(this.persisted.skills));
  }

  private readPersistedStore(): SkillsStore {
    if (!existsSync(this.storeFile)) return { skills: {} };
    const data = readFileSync(this.storeFile, 'utf-8');
    const parsed = JSON.parse(data) as SkillsStore;
    if (!parsed || typeof parsed !== 'object' || !parsed.skills) return { skills: {} };
    return parsed;
  }

  /** legacy JSON 仅在 remove 删除条目时重写（upsert 已迁移到目录 store）。 */
  private savePersistedStore(): void {
    try {
      mkdirSync(dirname(this.storeFile), { recursive: true });
      writeFileSync(this.storeFile, JSON.stringify(this.persisted, null, 2));
    } catch (error) {
      logger.error('[Skill Registry] Failed to save legacy store:', error);
    }
  }

  /** 重新读取 store 与所有磁盘来源。 */
  reload(): SkillDiscovery | null {
    this.loadStore();
    return this.discovery;
  }

  /** 最近一次发现的结果（来源列表、错误），未启用发现时为 null。 */
  getDiscovery(): SkillDiscovery | null {
    return this.discovery;
  }

  /**
   * skill 是否可修改：目录 store（`~/.clover/skills`）里的 skill，
   * 以及 legacy `skills.json` 独有（未被目录来源覆盖）的条目。
   * 扫描自其它来源（`~/.claude` 等）的 skill 只读。
   */
  canModify(name: string): boolean {
    return this.writable.has(name);
  }

  /** skill 的目录 store 路径。 */
  private skillDir(name: string): string {
    return join(this.storeRoot, name);
  }

  /**
   * 新增/更新 skill：写入目录 store `<home>/.clover/skills/<name>/`（SKILL.md +
   * 附属文件），该目录本身是发现来源，写入即进入聚合视图。
   * legacy `skills.json` 里的同名条目保留为备份（目录来源优先级更高，自动覆盖）。
   */
  upsert(name: string, skill: Omit<Skill, 'name'>, files?: Record<string, string>): void {
    const cleanName = name.trim();
    if (!isValidSkillName(cleanName)) {
      throw new Error('name may only contain letters, numbers, hyphens and underscores');
    }
    const filesError = validateSkillFiles(files);
    if (filesError) throw new Error(filesError);

    const dir = this.skillDir(cleanName);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), renderSkillMarkdown({ name: cleanName, description: skill.description ?? '' }, skill.content ?? ''));

    let fileCount = 0;
    for (const [path, content] of Object.entries(files ?? {})) {
      if (path === 'SKILL.md') continue; // 正文以 content 字段为准
      const target = join(dir, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
      fileCount++;
    }

    // 立即可见（source 标记为目录 store，canModify 据此放行）
    const next: Skill = {
      ...skill,
      name: cleanName,
      displayName: cleanName,
      source: DIR_STORE_LABEL,
      path: join(dir, 'SKILL.md'),
      autoinvoke: true,
    };
    this.store.skills[cleanName] = next;
    this.writable.add(cleanName);
    logger.log(
      `[Skill Registry] Skill "${cleanName}" saved to directory store` +
        (fileCount > 0 ? ` (${fileCount} supporting file(s))` : ''),
    );
  }

  /** 删除 skill：目录 store 删目录，legacy JSON 有同名条目则一并删除（防复活）。 */
  remove(name: string): boolean {
    if (!isValidSkillName(name) || !this.store.skills[name]) return false;

    if (this.persisted.skills[name]) {
      delete this.persisted.skills[name];
      this.savePersistedStore();
    }
    rmSync(this.skillDir(name), { recursive: true, force: true });

    this.writable.delete(name);
    delete this.store.skills[name];
    logger.log(`[Skill Registry] Skill "${name}" removed`);
    return true;
  }

  get(name: string): Skill | null {
    return this.store.skills[name] || null;
  }

  list(): Skill[] {
    return Object.values(this.store.skills);
  }

  /** 附属文件数量（目录 store 里的 skill；不含 SKILL.md 正文）。 */
  fileCount(name: string): number {
    return Object.keys(this.listSkillFiles(name)).length;
  }

  /** 按需读取附属文件映射（相对路径 → 内容；不含 SKILL.md）。 */
  listSkillFiles(name: string): Record<string, string> {
    const out: Record<string, string> = {};
    if (!isValidSkillName(name)) return out;
    const dir = this.skillDir(name);

    const walk = (current: string, prefix: string): void => {
      let dirents;
      try {
        dirents = readdirSync(current, { withFileTypes: true });
      } catch {
        return;
      }
      for (const dirent of dirents) {
        if (Object.keys(out).length >= MAX_FILES_PER_SKILL) return;
        const rel = prefix ? `${prefix}/${dirent.name}` : dirent.name;
        const full = join(current, dirent.name);
        if (dirent.isDirectory()) {
          walk(full, rel);
        } else if (dirent.isFile() && rel !== 'SKILL.md') {
          try {
            out[rel] = readFileSync(full, 'utf-8');
          } catch {
            // 跳过不可读文件
          }
        }
      }
    };

    try {
      if (statSync(dir).isDirectory()) walk(dir, '');
    } catch {
      // 目录不存在：无附属文件
    }
    return out;
  }

  /**
   * 复制 skill，副本插入到原 skill 之后（列表顺序可见）。
   * 源为目录 store skill 时连同附属文件一起复制。
   */
  duplicate(name: string): Skill | null {
    const source = this.store.skills[name];
    if (!source || !isValidSkillName(name)) return null;

    const newName = this.uniqueCopyName(name);
    const sourceFiles = this.listSkillFiles(name);
    this.upsert(newName, { description: source.description, content: source.content }, sourceFiles);

    const copy = this.store.skills[newName]!;

    const entries = Object.entries(this.store.skills);
    const next: Record<string, Skill> = {};
    let inserted = false;
    for (const [key, value] of entries) {
      if (key === newName) continue; // 先摘掉 upsert 追加到末尾的副本
      next[key] = value;
      if (key === name) {
        next[newName] = copy;
        inserted = true;
      }
    }
    if (!inserted) next[newName] = copy;
    this.store.skills = next;

    logger.log(`[Skill Registry] Skill "${name}" duplicated as "${newName}"`);
    return copy;
  }

  private uniqueCopyName(base: string): string {
    let candidate = `${base}-copy`;
    let n = 2;
    while (this.store.skills[candidate]) {
      candidate = `${base}-copy-${n}`;
      n++;
    }
    return candidate;
  }
}

/** 目录 store 在发现结果里的来源标签（与 `collectSkillSources` 保持一致）。 */
const DIR_STORE_LABEL = '~/.clover/skills';
