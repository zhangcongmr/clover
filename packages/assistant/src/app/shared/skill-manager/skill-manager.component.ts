import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SkillService, type SkillInfo } from '../skills/skill.service';

@Component({
  selector: 'app-skill-manager',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './skill-manager.component.html',
  styleUrls: ['./skill-manager.component.css'],
})
export class SkillManagerComponent {
  private readonly skillService = inject(SkillService);

  skills: SkillInfo[] = [];
  loading = false;
  error: string | null = null;

  showForm = false;
  editingSkill: SkillInfo | null = null;
  formData = this.getEmptyForm();
  nameError: string | null = null;

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

  openAddForm(): void {
    this.editingSkill = null;
    this.formData = this.getEmptyForm();
    this.nameError = null;
    this.showForm = true;
  }

  openEditForm(skill: SkillInfo): void {
    this.editingSkill = skill;
    this.formData = { ...skill };
    this.nameError = null;
    this.showForm = true;
  }

  closeForm(): void {
    this.showForm = false;
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
