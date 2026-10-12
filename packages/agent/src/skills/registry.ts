import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { Skill, SkillsStore } from './types.js';
import { discoverSkills, type DiscoverOptions, type SkillDiscovery } from './discovery.js';
import { collectConfigSkillEntries } from './config.js';
import { defaultCatalogCacheDir, refreshCatalogs } from './catalog.js';

const STORE_DIR = join(homedir(), '.clover');
const STORE_FILE = join(STORE_DIR, 'skills.json');

export interface SkillRegistryOptions extends DiscoverOptions {
  /** 为 false 时只读取 `~/.clover/skills.json`，不扫描磁盘来源。 */
  discovery?: boolean;
  /**
   * 构造完成后后台刷新一次 HTTP catalog 缓存（只联网更新 `version` 变化的条目）。
   * 无论成败，加载本身都基于磁盘缓存同步完成，不受网络影响。默认 false。
   */
  autoRefresh?: boolean;
}

export class SkillRegistry {
  /** `~/.clover/skills.json` 的内容，是唯一可写入的存储。 */
  private persisted: SkillsStore = { skills: {} };
  /** 聚合后的视图：store + 所有磁盘来源。 */
  private store: SkillsStore = { skills: {} };
  /** 允许通过 API 修改（存在于 `skills.json` 中）的 skill ID。 */
  private writable = new Set<string>();
  private discovery: SkillDiscovery | null = null;
  private readonly options: SkillRegistryOptions;
  /** 进行中的 catalog 刷新（并发调用复用同一个 Promise）。 */
  private refreshPromise: Promise<SkillDiscovery | null> | null = null;

  constructor(options: SkillRegistryOptions = {}) {
    this.options = options;
    this.loadStore();

    if (options.autoRefresh && options.discovery !== false) {
      void this.refreshRemote().catch((error) => {
        console.error('[Skill Registry] Background catalog refresh failed:', error);
      });
    }
  }

  /**
   * 载入 skill：先读 `~/.clover/skills.json`，再扫描
   * 1. 全局目录（`~/.claude/skills`、`~/.agents/skills`、`~/.config/opencode/skills`、
   *    `~/.clover/skills`，见 `collectSkillSources`；项目级来源永远不纳入发现）
   * 2. 全局 `opencode.json(c)` 与显式 `configFiles` 的 `skills` 条目
   *    （本地路径与 HTTP catalog 缓存）
   * 最后按优先级聚合为同一个视图。
   */
  private loadStore(): void {
    try {
      this.persisted = this.readPersistedStore();
    } catch (error) {
      console.error('[Skill Registry] Failed to load store:', error);
      this.persisted = { skills: {} };
    }

    if (this.options.discovery === false) {
      this.adoptStoreOnly();
      return;
    }

    try {
      const discovery = discoverSkills({ ...this.options, store: this.persisted.skills });

      for (const error of discovery.errors) {
        console.error('[Skill Registry] Discovery warning:', error);
      }

      this.discovery = discovery;
      this.store = { skills: discovery.skills };
      this.writable = new Set(discovery.writable);

      const total = Object.keys(discovery.skills).length;
      const fromDisk = total - this.writable.size;
      console.log(
        `[Skill Registry] Aggregated ${total} skill(s) from ${discovery.sources.length} source(s)` +
          (fromDisk > 0 ? `, ${fromDisk} loaded from disk` : ''),
      );
    } catch (error) {
      console.error('[Skill Registry] Skill discovery failed:', error);
      this.adoptStoreOnly();
    }
  }

  /** 发现失败/被禁用时的兜底：只用 store 里的内容。 */
  private adoptStoreOnly(): void {
    this.discovery = null;
    this.store = { skills: { ...this.persisted.skills } };
    this.writable = new Set(Object.keys(this.persisted.skills));
  }

  private readPersistedStore(): SkillsStore {
    if (!existsSync(STORE_FILE)) return { skills: {} };
    const data = readFileSync(STORE_FILE, 'utf-8');
    const parsed = JSON.parse(data) as SkillsStore;
    if (!parsed || typeof parsed !== 'object' || !parsed.skills) return { skills: {} };
    return parsed;
  }

  /** 只把 `skills.json` 里的内容写回磁盘，磁盘来源的 skill 不会被写入。 */
  private saveStore(): void {
    try {
      if (!existsSync(STORE_DIR)) {
        mkdirSync(STORE_DIR, { recursive: true });
      }
      writeFileSync(STORE_FILE, JSON.stringify(this.persisted, null, 2));
    } catch (error) {
      console.error('[Skill Registry] Failed to save store:', error);
    }
  }

  /** 重新读取 store 与所有磁盘来源。 */
  reload(): SkillDiscovery | null {
    this.loadStore();
    return this.discovery;
  }

  /**
   * 联网刷新配置中声明的 HTTP catalog 缓存，然后重新加载。
   * - 并发调用会复用同一次刷新
   * - 网络失败时保留旧缓存，加载不受影响
   * - 只下载 `version` 变化或文件缺失的条目
   */
  async refreshRemote(): Promise<SkillDiscovery | null> {
    if (this.options.discovery === false) return this.reload();
    if (this.refreshPromise) return this.refreshPromise;

    const promise = (async () => {
      try {
        const config = collectConfigSkillEntries({
          home: this.options.home,
          includeGlobal: this.options.includeGlobal,
          configFiles: this.options.configFiles,
        });
        const urls = config.entries.filter((entry) => entry.kind === 'url').map((entry) => entry.value);

        if (urls.length > 0) {
          const cacheDir = this.options.cacheDir ?? defaultCatalogCacheDir(this.options.home);
          const { errors } = await refreshCatalogs(urls, cacheDir, { fetchImpl: this.options.fetchImpl });
          for (const error of errors) {
            console.error('[Skill Registry] Catalog refresh:', error);
          }
        }
      } catch (error) {
        console.error('[Skill Registry] Catalog refresh failed:', error);
      }

      return this.reload();
    })();

    // 先同步赋值再等待，避免无 catalog 时 IIFE 同步跑完导致的状态残留
    this.refreshPromise = promise;
    try {
      return await promise;
    } finally {
      if (this.refreshPromise === promise) this.refreshPromise = null;
    }
  }

  /** 最近一次发现的结果（来源列表、错误），未启用发现时为 null。 */
  getDiscovery(): SkillDiscovery | null {
    return this.discovery;
  }

  /**
   * skill 是否可修改：只有存在于 `~/.clover/skills.json` 的条目可以。
   * 扫描得到的 skill 每次启动都会重新读取，API 写入会被拒绝。
   */
  canModify(name: string): boolean {
    return this.writable.has(name);
  }

  upsert(name: string, skill: Omit<Skill, 'name'>): void {
    const cleanName = name.trim();
    const existing = this.persisted.skills[cleanName];
    const next: Skill = { ...existing, ...skill, name: cleanName };
    this.persisted.skills[cleanName] = next;
    this.writable.add(cleanName);
    // 覆盖可能来自磁盘来源的同名 skill，让写入立即可见
    this.store.skills[cleanName] = { ...next };
    this.saveStore();
    console.log(`[Skill Registry] Skill "${cleanName}" saved`);
  }

  remove(name: string): boolean {
    if (!this.store.skills[name]) return false;
    delete this.persisted.skills[name];
    this.writable.delete(name);
    delete this.store.skills[name];
    this.saveStore();
    console.log(`[Skill Registry] Skill "${name}" removed`);
    return true;
  }

  get(name: string): Skill | null {
    return this.store.skills[name] || null;
  }

  list(): Skill[] {
    return Object.values(this.store.skills);
  }

  /**
   * Duplicate a skill and insert the copy immediately after the source
   * in the store (so list order reflects it).
   */
  duplicate(name: string): Skill | null {
    const source = this.store.skills[name];
    if (!source) return null;

    const newName = this.uniqueCopyName(name);
    const copy: Skill = { ...source, name: newName };

    const entries = Object.entries(this.store.skills);
    const next: Record<string, Skill> = {};
    let inserted = false;
    for (const [key, value] of entries) {
      next[key] = value;
      if (key === name) {
        next[newName] = copy;
        inserted = true;
      }
    }
    if (!inserted) {
      next[newName] = copy;
    }

    this.store.skills = next;
    this.persisted.skills[newName] = copy;
    this.writable.add(newName);
    this.saveStore();
    console.log(`[Skill Registry] Skill "${name}" duplicated as "${newName}"`);
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
