import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { BUILT_IN_SKILLS } from '../skill-manager/built-in-skills';

export interface SkillInfo {
  name: string;
  description: string;
  content: string;
  /** 目录 store skill 的附属文件数量（列表接口下发；0 表示无附属文件）。 */
  fileCount?: number;
}

@Injectable({ providedIn: 'root' })
export class SkillService {
  private readonly platformId = inject(PLATFORM_ID);

  readonly skills = signal<SkillInfo[]>([]);
  /** 后端配置的 HTTP catalog URL（供 skill 管理器直连查询）。 */
  readonly catalogs = signal<string[]>([]);

  /** 附属文件缓存：name → 相对路径 → 内容。 */
  private readonly filesCache = new Map<string, Promise<Record<string, string>>>();

  refresh(): Promise<void> {
    // SSR: Node's fetch rejects relative URLs; the browser re-runs this on hydration.
    if (!isPlatformBrowser(this.platformId)) return Promise.resolve();

    return fetch('/api/skills')
      .then(res => res.json())
      .then(async data => {
        const skills: SkillInfo[] = data.skills || [];
        this.catalogs.set(Array.isArray(data.catalogs) ? data.catalogs : []);
        await this.registerMissingBuiltIns(skills);
        this.skills.set(skills);
      })
      .catch(err => {
        console.error('Failed to load skills:', err);
        this.skills.set([]);
      });
  }

  /**
   * 按需拉取并缓存 skill 的附属文件（`GET /api/skills/:name` 的 files 字段）。
   * 无附属文件（fileCount 为 0/缺失）或拉取失败时返回空映射。
   * 并发调用共享同一个 Promise；编辑/删除后由 `invalidateFiles` 丢弃缓存。
   */
  loadFiles(name: string): Promise<Record<string, string>> {
    if (!isPlatformBrowser(this.platformId)) return Promise.resolve({});

    const cached = this.filesCache.get(name);
    if (cached) return cached;

    const skill = this.skills().find(s => s.name === name);
    if (!skill || !skill.fileCount) {
      return Promise.resolve({});
    }

    const promise = fetch(`/api/skills/${encodeURIComponent(name)}`)
      .then(res => (res.ok ? res.json() : { files: {} }))
      .then(data =>
        data && typeof data.files === 'object' && data.files
          ? (data.files as Record<string, string>)
          : {},
      )
      .catch(err => {
        this.filesCache.delete(name); // 失败不缓存，下次重试
        console.error(`Failed to load files for skill "${name}":`, err);
        return {} as Record<string, string>;
      });

    this.filesCache.set(name, promise);
    return promise;
  }

  /** 丢弃某个 skill 的附属文件缓存（编辑或删除后调用）。 */
  invalidateFiles(name: string): void {
    this.filesCache.delete(name);
  }

  /**
   * Seed built-in skills to the server when they are missing, and overwrite
   * existing ones whose stored content no longer matches the bundled copy so
   * built-in skill updates actually reach the agent. Built-in skills are
   * read-only in the skill manager (copies get a different name), so an
   * overwrite cannot destroy user edits. Failures are swallowed so skill
   * loading keeps working.
   */
  private async registerMissingBuiltIns(skills: SkillInfo[]): Promise<void> {
    const existing = new Map(skills.map(s => [s.name, s]));
    for (const builtin of BUILT_IN_SKILLS) {
      const current = existing.get(builtin.name);
      const method = !current ? 'POST' : current.content !== builtin.content ? 'PUT' : null;
      if (!method) continue;
      try {
        const res = await fetch(
          !current
            ? '/api/skills'
            : `/api/skills/${encodeURIComponent(builtin.name)}`,
          {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(builtin),
          }
        );
        if (res.ok) {
          if (current) {
            current.content = builtin.content;
            current.description = builtin.description;
          } else {
            skills.push(builtin);
          }
          existing.set(builtin.name, builtin);
        }
      } catch (err) {
        console.error(`Failed to register built-in skill "${builtin.name}":`, err);
      }
    }
  }

  getByName(name: string): SkillInfo | undefined {
    return this.skills().find(s => s.name === name);
  }
}
