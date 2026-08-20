import { Component, inject, signal, computed, effect, viewChild } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { AcpService } from "../../shared/acp/acp.service";
import { AcpPanelComponent } from "../../shared/acp/acp-panel.component";
import { FilePickerDialogComponent } from "../../shared/file-picker-dialog/file-picker-dialog.component";
import { AVAILABLE_AGENTS } from "../../shared/acp/acp-agent.types";
import type { SessionInfo } from "../../shared/acp/acp-websocket.service";

interface SessionWithAgent extends SessionInfo {
  agentId?: string;
}

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
  imports: [CommonModule, FormsModule, FilePickerDialogComponent, AcpPanelComponent],
})
export class AgentComponent {
  protected acpService = inject(AcpService);
  readonly filePicker = viewChild(FilePickerDialogComponent);

  searchQuery = signal('');
  selectedProject = signal<string | null>(null);
  showAcpPanel = signal<boolean>(false);
  acpPanelMaximized = signal<boolean>(false);
  acpPanelDockPosition = signal<'left' | 'right'>('right');

  protected projects = computed(() => {
    return this.acpService.projects().map((p, i) => ({
      ...p,
      color: PROJECT_COLORS[i % PROJECT_COLORS.length],
    }));
  });

  protected filteredSessions = computed(() => {
    const query = this.searchQuery().toLowerCase();
    const project = this.selectedProject();
    
    let sessions: SessionWithAgent[];
    
    if (project) {
      const projectInfo = this.acpService.projects().find(p => p.name === project);
      const agentSessions = this.acpService.sessions()
        .filter(s => s.cwd === projectInfo?.path);
      
      const persistedSessions = (projectInfo?.sessions || []).map(s => ({
        sessionId: s.sessionId,
        cwd: projectInfo!.path,
        title: s.title,
        updatedAt: s.updatedAt,
        agentId: s.agentId,
      }));
      
      const mergedMap = new Map<string, SessionWithAgent>();
      
      for (const s of agentSessions) {
        mergedMap.set(s.sessionId, { ...s, agentId: this.acpService.selectedAgent()?.id });
      }
      
      for (const s of persistedSessions) {
        if (!mergedMap.has(s.sessionId)) {
          mergedMap.set(s.sessionId, s);
        } else {
          const existing = mergedMap.get(s.sessionId)!;
          if (!existing.agentId && s.agentId) {
            existing.agentId = s.agentId;
          }
          if (!existing.title && s.title) {
            existing.title = s.title;
          }
        }
      }
      
      sessions = Array.from(mergedMap.values());
    } else {
      sessions = this.acpService.sessions().map(s => ({
        ...s,
        agentId: this.acpService.selectedAgent()?.id,
      }));
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
  
  private isLoadingSessions = false;
  private initialized = false;

  constructor() {
    effect(() => {
      const projects = this.acpService.projects();
      const project = this.selectedProject();
      if (project && !projects.find(p => p.name === project)) {
        this.selectedProject.set(null);
      }
    });
    
    effect(() => {
      const project = this.selectedProject();
      if (project && !this.isLoadingSessions) {
        const projectInfo = this.acpService.projects().find(p => p.name === project);
        if (projectInfo) {
          this.loadSessionsForProject(projectInfo.path);
        }
      }
    });
    
    this.loadInitialSelectedProject();
  }

  private async loadInitialSelectedProject(): Promise<void> {
    try {
      const savedPath = await this.acpService.getSelectedProject();
      if (savedPath) {
        const projects = this.acpService.projects();
        const match = projects.find(p => p.path === savedPath);
        if (match) {
          this.selectedProject.set(match.name);
        }
      }
    } catch (error) {
      console.error('[Agent] Failed to load selected project:', error);
    } finally {
      this.initialized = true;
    }
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
      this.acpService.saveSelectedProject(null);
    } else {
      this.selectedProject.set(name);
      const projectInfo = this.acpService.projects().find(p => p.name === name);
      this.acpService.saveSelectedProject(projectInfo?.path || null);
    }
  }

  private async loadSessionsForProject(cwd: string): Promise<void> {
    if (this.isLoadingSessions) {
      return;
    }
    
    this.isLoadingSessions = true;
    try {
      await this.acpService.listSessionsFromAllAgents(cwd);
    } finally {
      this.isLoadingSessions = false;
    }
  }

  async loadSession(sessionId: string): Promise<void> {
    const { cwd, agentId } = this.findSessionInfo(sessionId);
    await this.acpService.loadSession(sessionId, cwd, agentId);
    await this.ensureSessionInProject(sessionId);
  }

  async resumeSession(sessionId: string): Promise<void> {
    const { cwd, agentId } = this.findSessionInfo(sessionId);
    await this.acpService.resumeSession(sessionId, cwd, agentId);
    await this.ensureSessionInProject(sessionId);
  }

  async deleteSession(event: MouseEvent, sessionId: string): Promise<void> {
    event.stopPropagation();
    if (confirm('Are you sure you want to delete this session?')) {
      for (const project of this.acpService.projects()) {
        if (project.sessions?.some(s => s.sessionId === sessionId)) {
          await this.acpService.deleteSessionFromProject(project.path, sessionId);
          break;
        }
      }
      await this.acpService.deleteSession(sessionId);
    }
  }

  async createNewSession(): Promise<void> {
    const selectedProjectName = this.selectedProject();
    const agentId = this.acpService.selectedAgent()?.id || 'opencode';
    let cwd: string | undefined;
    let projectPath: string | undefined;
    
    if (selectedProjectName) {
      const project = this.acpService.projects().find(p => p.name === selectedProjectName);
      cwd = project?.path;
      projectPath = project?.path;
    }
    if (!cwd) {
      cwd = this.acpService.workingDirHint() || undefined;
      projectPath = cwd;
    }
    
    await this.acpService.createSession(cwd);
    
    const sessionId = this.acpService.sessionState().sessionId;
    if (sessionId && projectPath) {
      await this.acpService.saveSessionToProject(projectPath, {
        sessionId,
        agentId,
        title: 'New session',
        updatedAt: new Date().toISOString(),
      });
    }
  }

  private findSessionInfo(sessionId: string): { cwd?: string; agentId?: string } {
    const selectedName = this.selectedProject();
    if (selectedName) {
      const project = this.acpService.projects().find(p => p.name === selectedName);
      const session = project?.sessions?.find(s => s.sessionId === sessionId);
      if (session && project) {
        return { cwd: project.path, agentId: session.agentId };
      }
    }
    
    for (const project of this.acpService.projects()) {
      const session = project.sessions?.find(s => s.sessionId === sessionId);
      if (session) {
        return { cwd: project.path, agentId: session.agentId };
      }
    }
    
    return { cwd: this.acpService.workingDirHint() || undefined };
  }

  private async ensureSessionInProject(sessionId: string): Promise<void> {
    const selectedName = this.selectedProject();
    if (!selectedName) return;
    
    const project = this.acpService.projects().find(p => p.name === selectedName);
    if (!project) return;
    
    const exists = project.sessions?.some(s => s.sessionId === sessionId);
    if (exists) return;
    
    const session = this.acpService.sessions().find(s => s.sessionId === sessionId);
    if (session) {
      await this.acpService.saveSessionToProject(project.path, {
        sessionId,
        agentId: this.acpService.selectedAgent()?.id || 'opencode',
        title: session.title || 'Loaded session',
        updatedAt: new Date().toISOString(),
      });
    }
  }

  getAgentName(agentId?: string): string {
    const agent = AVAILABLE_AGENTS.find(a => a.id === agentId);
    return agent?.name || 'Unknown';
  }

  getAgentIcon(agentId?: string): string {
    const icons: Record<string, string> = {
      opencode: 'OC',
      claude: 'CL',
      codex: 'CX',
      gemini: 'GM',
      qwen: 'QW',
      augment: 'AU',
    };
    return icons[agentId || ''] || '??';
  }

  toggleAcpPanel(): void {
    this.showAcpPanel.update(v => !v);
    if (this.showAcpPanel()) {
      this.createNewSession();
    }
  }

  closeAcpPanel(): void {
    this.showAcpPanel.set(false);
  }

  onAcpPanelMaximize(): void {
    this.acpPanelMaximized.set(true);
  }

  onAcpPanelRestore(): void {
    this.acpPanelMaximized.set(false);
  }

  onAcpPanelDockChange(position: 'left' | 'right'): void {
    this.acpPanelDockPosition.set(position);
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
