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
