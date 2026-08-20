import { Component, inject, signal, computed, effect, viewChild } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { AcpService } from "../../shared/acp/acp.service";
import { FilePickerDialogComponent } from "../../shared/file-picker-dialog/file-picker-dialog.component";

const PROJECT_COLORS = [
  '#2196f3', '#4caf50', '#ff9800', '#9c27b0',
  '#f44336', '#00bcd4', '#ff5722', '#607d8b',
  '#e91e63', '#3f51b5', '#009688', '#795548',
];

@Component({
  selector: "div[ast-agent]",
  templateUrl: "./agent.html",
  styleUrls: ["./agent.css"],
  standalone: true,
  imports: [CommonModule, FormsModule, FilePickerDialogComponent],
})
export class AgentComponent {
  protected acpService = inject(AcpService);
  readonly filePicker = viewChild(FilePickerDialogComponent);

  searchQuery = signal('');
  selectedProject = signal<string | null>(null);

  protected projects = computed(() => {
    return this.acpService.projects().map((p, i) => ({
      ...p,
      color: PROJECT_COLORS[i % PROJECT_COLORS.length],
    }));
  });

  protected filteredSessions = computed(() => {
    const query = this.searchQuery().toLowerCase();
    const project = this.selectedProject();
    let sessions = this.acpService.sessions();

    if (project) {
      const projectInfo = this.acpService.projects().find(p => p.name === project);
      if (projectInfo) {
        sessions = sessions.filter(s => s.cwd === projectInfo.path);
      }
    }

    if (query) {
      sessions = sessions.filter(s =>
        (s.title || '').toLowerCase().includes(query) ||
        s.sessionId.toLowerCase().includes(query)
      );
    }

    return sessions;
  });

  protected todaySessions = computed(() => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return this.filteredSessions().filter(s => {
      if (!s.updatedAt) return false;
      return new Date(s.updatedAt) >= todayStart;
    });
  });

  protected yesterdaySessions = computed(() => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    return this.filteredSessions().filter(s => {
      if (!s.updatedAt) return false;
      const d = new Date(s.updatedAt);
      return d >= yesterdayStart && d < todayStart;
    });
  });

  protected olderSessions = computed(() => {
    const now = new Date();
    const yesterdayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    return this.filteredSessions().filter(s => {
      if (!s.updatedAt) return true;
      return new Date(s.updatedAt) < yesterdayStart;
    });
  });

  protected activeSessionId = computed(() => this.acpService.sessionState().sessionId);

  constructor() {
    effect(() => {
      const projects = this.acpService.projects();
      const project = this.selectedProject();
      if (project && !projects.find(p => p.name === project)) {
        this.selectedProject.set(null);
      }
    });
  }

  getProjectColor(name: string): string {
    const project = this.projects().find(p => p.name === name);
    return project?.color || '#607d8b';
  }

  getInitial(name: string): string {
    return (name || '?')[0].toUpperCase();
  }

  selectProject(name: string): void {
    if (this.selectedProject() === name) {
      this.selectedProject.set(null);
    } else {
      this.selectedProject.set(name);
    }
  }

  async loadSession(sessionId: string): Promise<void> {
    await this.acpService.loadSession(sessionId);
  }

  async resumeSession(sessionId: string): Promise<void> {
    await this.acpService.resumeSession(sessionId);
  }

  async deleteSession(event: MouseEvent, sessionId: string): Promise<void> {
    event.stopPropagation();
    if (confirm('Are you sure you want to delete this session?')) {
      await this.acpService.deleteSession(sessionId);
    }
  }

  async createNewSession(): Promise<void> {
    await this.acpService.createSession(this.acpService.workingDirHint() || undefined);
  }

  onSearchInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.searchQuery.set(value);
  }

  // ============================================================================
  // Project management
  // ============================================================================

  openFolderPicker(): void {
    const picker = this.filePicker();
    if (picker) {
      picker.openFolderPicker('/');
    }
  }

  async onFolderSelected(result: { path: string; kind: 'folder' | 'file' }): Promise<void> {
    if (result.kind !== 'folder') return;

    const path = result.path;
    const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
    const name = parts[parts.length - 1] || '';

    if (!name) return;

    try {
      await this.acpService.addProject(name, path);
    } catch (error: any) {
      console.error('[Agent] Failed to add project:', error?.message || error);
      alert('Failed to add project: ' + (error?.message || 'Unknown error'));
    }
  }

  async deleteProject(event: MouseEvent, name: string): Promise<void> {
    event.stopPropagation();
    if (confirm(`Delete project "${name}"?`)) {
      await this.acpService.deleteProject(name);
    }
  }
}
