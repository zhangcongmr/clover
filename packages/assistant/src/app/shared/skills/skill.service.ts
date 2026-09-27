import { Injectable, signal } from '@angular/core';
import { BUILT_IN_SKILLS } from '../skill-manager/built-in-skills';

export interface SkillInfo {
  name: string;
  description: string;
  content: string;
}

@Injectable({ providedIn: 'root' })
export class SkillService {
  readonly skills = signal<SkillInfo[]>([]);

  refresh(): Promise<void> {
    return fetch('/api/skills')
      .then(res => res.json())
      .then(async data => {
        const skills: SkillInfo[] = data.skills || [];
        await this.registerMissingBuiltIns(skills);
        this.skills.set(skills);
      })
      .catch(err => {
        console.error('Failed to load skills:', err);
        this.skills.set([]);
      });
  }

  /**
   * Seed built-in skills to the server when they are missing.
   * Failures are swallowed so skill loading keeps working.
   */
  private async registerMissingBuiltIns(skills: SkillInfo[]): Promise<void> {
    const existing = new Set(skills.map(s => s.name));
    for (const builtin of BUILT_IN_SKILLS) {
      if (existing.has(builtin.name)) continue;
      try {
        const res = await fetch('/api/skills', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(builtin),
        });
        if (res.ok) {
          skills.push(builtin);
          existing.add(builtin.name);
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
