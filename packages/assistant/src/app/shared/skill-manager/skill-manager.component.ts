import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SkillService, type SkillInfo } from '../skills/skill.service';
import { BUILT_IN_SKILL_NAMES } from './built-in-skills';
import {
  SkillCatalogService,
  sanitizeSkillName,
  type CatalogSkillItem,
  type CatalogSourceState,
} from './skill-catalog.service';

type ManagerTab = 'configured' | 'catalog';

@Component({
  selector: 'app-skill-manager',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './skill-manager.component.html',
  styleUrls: ['./skill-manager.component.css'],
})
export class SkillManagerComponent {
  private readonly skillService = inject(SkillService);
  private readonly catalogService = inject(SkillCatalogService);

  skills: SkillInfo[] = [];
  loading = false;
  error: string | null = null;

  showForm = false;
  viewMode = false;
  editingSkill: SkillInfo | null = null;
  formData = this.getEmptyForm();
  nameError: string | null = null;

  // HTTP Catalog 浏览（浏览器直连各 catalog 的 index.json）
  tab: ManagerTab = 'configured';
  catalogSources: CatalogSourceState[] = [];
  catalogLoading = false;
  catalogSearch = '';
  /** 正在安装的条目 key（防连点）。 */
  installingKey: string | null = null;
  private catalogLoaded = false;

  constructor() {
    this.loadSkills();
  }

  loadSkills(): void {
    this.loading = true;
    this.error = null;

    this.skillService.refresh()
      .then(() => {
        this.skills = this.skillService.skills();
        this.loading = false;
      })
      .catch(err => {
        this.error = 'Failed to load skills';
        this.loading = false;
        console.error('Failed to load skills:', err);
      });
  }

  /* ---------------------------------------------------------------------- */
  /* HTTP Catalog（浏览器直连查询，后端不缓存）                               */
  /* ---------------------------------------------------------------------- */

  switchTab(tab: ManagerTab): void {
    this.tab = tab;
    if (tab === 'catalog' && !this.catalogLoaded) {
      this.loadCatalogs();
    }
  }

  /** 加载全部 catalog 源（配置 ∪ 内置默认；单源失败只标记该源）。 */
  loadCatalogs(): void {
    this.catalogLoaded = true;
    this.catalogLoading = true;
    const configUrls = this.skillService.catalogs();
    this.catalogService
      .loadSources(configUrls, url => configUrls.includes(url))
      .then(sources => {
        this.catalogSources = sources;
        this.catalogLoading = false;
      })
      .catch(err => {
        this.catalogLoading = false;
        this.error = 'Failed to load skill catalogs';
        console.error('Failed to load skill catalogs:', err);
      });
  }

  /** 过滤后的全部条目（跨源扁平化，按名称排序）。 */
  get filteredCatalogItems(): Array<{ item: CatalogSkillItem; source: CatalogSourceState }> {
    const query = this.catalogSearch.trim().toLowerCase();
    const rows: Array<{ item: CatalogSkillItem; source: CatalogSourceState }> = [];
    for (const source of this.catalogSources) {
      for (const item of source.items) {
        if (
          query &&
          !item.name.toLowerCase().includes(query) &&
          !item.description.toLowerCase().includes(query)
        ) {
          continue;
        }
        rows.push({ item, source });
      }
    }
    return rows.sort((a, b) => a.item.name.localeCompare(b.item.name));
  }

  /** 本地已安装（同名 skill 存在）。 */
  isInstalled(item: CatalogSkillItem): boolean {
    const local = sanitizeSkillName(item.name);
    return !!local && this.skills.some(s => s.name === local);
  }

  /** 条目来源标签（host/…）。 */
  sourceLabel(source: CatalogSourceState): string {
    return source.label;
  }

  /** 安装 catalog 条目：取回内容（+附属文件）→ POST /api/skills → 刷新列表。 */
  installSkill(item: CatalogSkillItem): void {
    if (this.installingKey) return;
    this.error = null;

    const localName = sanitizeSkillName(item.name);
    if (localName && this.skills.some(s => s.name === localName)) {
      if (!confirm(`Skill "${localName}" already exists. Overwrite it?`)) return;
    }

    this.installingKey = item.key;
    this.catalogService
      .prepareInstall(item)
      .then(prepared =>
        fetch('/api/skills', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(prepared),
        }).then(res => res.json()),
      )
      .then(data => {
        if (data.error) {
          this.error = data.error;
        } else {
          this.loadSkills();
        }
      })
      .catch(err => {
        this.error = err instanceof Error && err.message ? err.message : 'Failed to install skill';
        console.error('Failed to install skill from catalog:', err);
      })
      .finally(() => {
        this.installingKey = null;
      });
  }

  /* ---------------------------------------------------------------------- */
  /* Configured 列表 / 表单（原有逻辑）                                       */
  /* ---------------------------------------------------------------------- */

  openAddForm(): void {
    this.editingSkill = null;
    this.viewMode = false;
    this.formData = this.getEmptyForm();
    this.nameError = null;
    this.showForm = true;
  }

  openEditForm(skill: SkillInfo): void {
    if (this.isBuiltIn(skill.name)) {
      this.openViewForm(skill);
      return;
    }
    this.editingSkill = skill;
    this.viewMode = false;
    this.formData = { ...skill };
    this.nameError = null;
    this.showForm = true;
  }

  openViewForm(skill: SkillInfo): void {
    this.editingSkill = skill;
    this.viewMode = true;
    this.formData = { ...skill };
    this.nameError = null;
    this.showForm = true;
  }

  isBuiltIn(name: string): boolean {
    return BUILT_IN_SKILL_NAMES.has(name);
  }

  closeForm(): void {
    this.showForm = false;
    this.viewMode = false;
    this.editingSkill = null;
    this.formData = this.getEmptyForm();
    this.nameError = null;
  }

  onNameChange(): void {
    this.nameError = null;
  }

  saveSkill(): void {
    const name = this.formData.name?.trim();
    const content = this.formData.content || '';

    if (!name) {
      this.nameError = 'Name is required';
      return;
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      this.nameError = 'Name may only contain letters, numbers, hyphens and underscores (no spaces)';
      return;
    }
    if (!content.trim()) {
      this.error = 'Content is required';
      return;
    }

    this.formData.name = name;
    this.formData.description = this.formData.description?.trim() || '';
    this.formData.content = content;

    const url = this.editingSkill
      ? `/api/skills/${encodeURIComponent(this.editingSkill.name)}`
      : '/api/skills';
    const method = this.editingSkill ? 'PUT' : 'POST';

    fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(this.formData),
    })
      .then(res => res.json())
      .then(data => {
        if (data.error) {
          this.error = data.error;
        } else {
          this.closeForm();
          this.loadSkills();
        }
      })
      .catch(err => {
        this.error = 'Failed to save skill';
        console.error('Failed to save skill:', err);
      });
  }

  copySkill(name: string): void {
    fetch(`/api/skills/${encodeURIComponent(name)}/duplicate`, { method: 'POST' })
      .then(res => res.json())
      .then(data => {
        if (data.error) {
          this.error = data.error;
        } else {
          this.loadSkills();
        }
      })
      .catch(err => {
        this.error = 'Failed to copy skill';
        console.error('Failed to copy skill:', err);
      });
  }

  deleteSkill(name: string): void {
    if (!confirm(`Are you sure you want to delete skill "${name}"?`)) {
      return;
    }

    fetch(`/api/skills/${encodeURIComponent(name)}`, { method: 'DELETE' })
      .then(res => res.json())
      .then(data => {
        if (data.error) {
          this.error = data.error;
        } else {
          this.loadSkills();
        }
      })
      .catch(err => {
        this.error = 'Failed to delete skill';
        console.error('Failed to delete skill:', err);
      });
  }

  private getEmptyForm(): SkillInfo {
    return { name: '', description: '', content: '' };
  }
}
