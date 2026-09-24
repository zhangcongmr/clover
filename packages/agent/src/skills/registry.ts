import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { Skill, SkillsStore } from './types.js';

const STORE_DIR = join(homedir(), '.clover');
const STORE_FILE = join(STORE_DIR, 'skills.json');

export class SkillRegistry {
  private store: SkillsStore = { skills: {} };

  constructor() {
    this.loadStore();
  }

  private loadStore(): void {
    try {
      if (existsSync(STORE_FILE)) {
        const data = readFileSync(STORE_FILE, 'utf-8');
        this.store = JSON.parse(data);
        if (!this.store.skills) this.store.skills = {};
      }
    } catch (error) {
      console.error('[Skill Registry] Failed to load store:', error);
      this.store = { skills: {} };
    }
  }

  private saveStore(): void {
    try {
      if (!existsSync(STORE_DIR)) {
        mkdirSync(STORE_DIR, { recursive: true });
      }
      writeFileSync(STORE_FILE, JSON.stringify(this.store, null, 2));
    } catch (error) {
      console.error('[Skill Registry] Failed to save store:', error);
    }
  }

  upsert(name: string, skill: Omit<Skill, 'name'>): void {
    const cleanName = name.trim();
    this.store.skills[cleanName] = { ...skill, name: cleanName };
    this.saveStore();
    console.log(`[Skill Registry] Skill "${cleanName}" saved`);
  }

  remove(name: string): boolean {
    if (!this.store.skills[name]) return false;
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
