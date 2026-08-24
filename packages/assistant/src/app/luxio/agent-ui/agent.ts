import { Component, inject, signal, computed, effect, viewChild } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { AcpService } from "../../shared/acp/acp.service";
import type { TaskInfo } from "../../shared/acp/acp.service";
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

  /** Sidebar view state: which section is active */
  activeView = signal<'tasks' | 'new-task'>('tasks');
  /** Currently selected task ID (for highlighting in sidebar) */
  selectedTaskId = signal<string | null>(null);

  /** Session currently being loaded/resumed (spinner on item, guards double-click). */
  sessionLoadingId = signal<string | null>(null);
  /** Whether the ACP panel is waiting for a session load/resume to complete. */
  panelLoading = signal<boolean>(false);
  /** Load/resume failure message shown inside the panel. */
  panelError = signal<string | null>(null);

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
        mergedMap.set(s.sessionId, { ...s, agentId: (s as any).agentId || this.acpService.selectedAgent()?.id });
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
        agentId: (s as any).agentId || this.acpService.selectedAgent()?.id,
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
  private syncedProjectPath: string | null = null;
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
        if (projectInfo && projectInfo.path !== this.syncedProjectPath) {
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

  switchToTasksView(): void {
    this.activeView.set('tasks');
    this.selectedProject.set(null);
    this.syncedProjectPath = null;
    this.acpService.saveSelectedProject(null);
    this.selectedTaskId.set(null);
    this.acpService.saveSelectedTask(null);
  }

  selectProject(name: string): void {
    this.selectedTaskId.set(null);
    this.acpService.saveSelectedTask(null);
    this.activeView.set('new-task');
    if (this.selectedProject() === name) {
      this.selectedProject.set(null);
      this.syncedProjectPath = null;
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
    this.syncedProjectPath = cwd;
    try {
      await this.acpService.listSessionsFromAllAgents(cwd);
    } finally {
      this.isLoadingSessions = false;
    }
  }

  async loadSession(sessionId: string): Promise<void> {
    if (this.sessionLoadingId()) return;

    const { cwd, agentId } = this.findSessionInfo(sessionId);
    this.sessionLoadingId.set(sessionId);
    this.panelError.set(null);
    this.acpService.isLoadedSession.set(true);
    this.showAcpPanel.set(true);
    this.panelLoading.set(true);

    try {
      await this.acpService.loadSession(sessionId, cwd, agentId);
      await this.ensureSessionInProject(sessionId);
    } catch (error: any) {
      console.error('[Agent] Failed to load session:', error);
      this.panelError.set(error?.message || 'Failed to load session');
    } finally {
      this.panelLoading.set(false);
      this.sessionLoadingId.set(null);
    }
  }

  async resumeSession(sessionId: string): Promise<void> {
    if (this.sessionLoadingId()) return;

    const { cwd, agentId } = this.findSessionInfo(sessionId);
    this.sessionLoadingId.set(sessionId);
    this.panelError.set(null);
    this.acpService.isLoadedSession.set(true);
    this.showAcpPanel.set(true);
    this.panelLoading.set(true);

    try {
      await this.acpService.resumeSession(sessionId, cwd, agentId);
      await this.ensureSessionInProject(sessionId);
    } catch (error: any) {
      console.error('[Agent] Failed to resume session:', error);
      this.panelError.set(error?.message || 'Failed to resume session');
    } finally {
      this.panelLoading.set(false);
      this.sessionLoadingId.set(null);
    }
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

  async createNewTask(): Promise<void> {
    this.selectedProject.set(null);
    this.syncedProjectPath = null;
    this.panelError.set(null);
    this.acpService.isLoadedSession.set(false);
    this.showAcpPanel.set(true);
    this.panelLoading.set(true);

    try {
      await this.acpService.createSession(undefined);
      this.acpService.pendingTaskCreation.set(true);
      this.activeView.set('tasks');
    } catch (error: any) {
      console.error('[Agent] Failed to create new task:', error);
      this.panelError.set(error?.message || 'Failed to create task');
    } finally {
      this.panelLoading.set(false);
    }
  }

  async loadTask(taskId: string): Promise<void> {
    const task = this.acpService.tasks().find(t => t.id === taskId);
    if (!task) return;
    if (this.sessionLoadingId()) return;

    this.selectedProject.set(null);
    this.syncedProjectPath = null;
    this.sessionLoadingId.set(task.sessionId);
    this.panelError.set(null);
    this.selectedTaskId.set(taskId);
    this.acpService.saveSelectedTask(taskId);
    this.showAcpPanel.set(true);

    const currentSessionId = this.acpService.sessionState().sessionId;
    if (currentSessionId === task.sessionId && this.acpService.sessionState().isConnected) {
      this.acpService.isLoadedSession.set(false);
      this.sessionLoadingId.set(null);
      return;
    }

    this.acpService.isLoadedSession.set(true);
    this.panelLoading.set(true);

    try {
      await this.acpService.loadSession(task.sessionId, task.cwd, task.agentId);
    } catch (error: any) {
      console.error('[Agent] Failed to load task:', error);
      this.panelError.set(error?.message || 'Failed to load task');
    } finally {
      this.panelLoading.set(false);
      this.sessionLoadingId.set(null);
    }
  }

  async deleteTask(event: MouseEvent, taskId: string): Promise<void> {
    event.stopPropagation();
    if (confirm('Are you sure you want to delete this task?')) {
      const wasSelected = this.selectedTaskId() === taskId;
      await this.acpService.deleteTask(taskId);
      if (wasSelected) {
        this.selectedTaskId.set(null);
        this.acpService.saveSelectedTask(null);
      }
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

  getRelativeTime(dateStr: string): string {
    const now = new Date();
    const date = new Date(dateStr);
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h`;
    const diffDay = Math.floor(diffHr / 24);
    return `${diffDay}d`;
  }

  toggleAcpPanel(): void {
    this.showAcpPanel.update(v => !v);
    if (this.showAcpPanel()) {
      this.acpService.isLoadedSession.set(false);
      this.createNewSession();
    }
  }

  closeAcpPanel(): void {
    this.showAcpPanel.set(false);
    this.activeView.set('tasks');
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
      const wasSelected = this.selectedProject() === name;
      // 先删除（deleteProject 内部会刷新 projects 列表），再清除选中状态，保证编辑器能感知项目已删除
      await this.acpService.deleteProject(name);
      if (wasSelected) {
        this.selectedProject.set(null);
        this.syncedProjectPath = null;
        await this.acpService.saveSelectedProject(null);
      }
    }
  }
}
