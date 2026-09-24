import { Injectable, signal } from '@angular/core';

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
      .then(data => {
        this.skills.set(data.skills || []);
      })
      .catch(err => {
        console.error('Failed to load skills:', err);
        this.skills.set([]);
      });
  }

  getByName(name: string): SkillInfo | undefined {
    return this.skills().find(s => s.name === name);
  }
}
