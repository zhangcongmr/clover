import { Component, inject, signal, computed, effect, viewChild, output, PLATFORM_ID } from "@angular/core";
import { CommonModule, isPlatformBrowser } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { AcpService } from "../../shared/acp/acp.service";
import type { ProjectInfo } from "../../shared/acp/acp.service";
import { AcpPanelComponent } from "../../shared/acp/acp-panel.component";
import { FilePickerDialogComponent } from "../../shared/file-picker-dialog/file-picker-dialog.component";
import { AVAILABLE_AGENTS } from "../../shared/acp/acp-agent.types";
import type { SessionInfo } from "../../shared/acp/acp-websocket.service";
import { LayoutService } from "../layout.service";
import { APP_VERSION } from "../../../app-version";

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
  readonly version = APP_VERSION;
  protected acpService = inject(AcpService);
  protected layoutService = inject(LayoutService);
  private readonly platformId = inject(PLATFORM_ID);
  /** True only in the browser; used to skip rendering the ACP panel during SSR. */
  protected readonly isBrowser = computed(() => isPlatformBrowser(this.platformId));
  readonly filePicker = viewChild(FilePickerDialogComponent);

  searchQuery = signal('');
  selectedProject = computed(() => {
    const savedPath = this.acpService.selectedProjectPath();
    if (!savedPath) return null;
    const projects = this.acpService.projects();
    const tasks = this.acpService.tasks();
    return projects.find(p => p.path === savedPath)
      || tasks.find(t => t.path === savedPath)
      || null;
  });
  acpPanelMaximized = signal<boolean>(false);
  acpPanelDockPosition = signal<'left' | 'right'>('right');
  /** Left sidebar collapsed state before the panel was maximized, restored on restore. */
  private previousSidebarCollapsed = false;

  /** Session currently being loaded/resumed (spinner on item, guards double-click). */
  sessionLoadingId = signal<string | null>(null);
  /** Whether the ACP panel is waiting for a session load/resume to complete. */
  panelLoading = signal<boolean>(false);
  /** Load/resume failure message shown inside the panel. */
  panelError = signal<string | null>(null);

  /** Re-emitted upward so app.component can toggle the AST content (editor) panel. */
  editorToggle = output<void>();
  /** Re-emitted upward when the ACP panel is maximized. */
  maximizePanel = output<void>();
  /** Re-emitted upward when the ACP panel is restored. */
  restorePanel = output<void>();

  protected projects = computed(() => {
    return this.acpService.projects()
      .filter(p => p.type === 'project')
      .map((p, i) => ({
        ...p,
        color: PROJECT_COLORS[i % PROJECT_COLORS.length],
      }));
  });

  /** Merge a project's live + persisted sessions, deduped, with search applied. */
  protected sessionsOf(project: ProjectInfo): SessionWithAgent[] {
    const query = this.searchQuery().toLowerCase();

    const agentSessions = this.acpService.sessions()
      .filter(s => s.cwd === project.path);

    const persistedSessions = (project.sessions || []).map(s => ({
      sessionId: s.sessionId,
      cwd: project.path,
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

    let sessions = Array.from(mergedMap.values());

    if (query) {
      sessions = sessions.filter(s =>
        (s.title || '').toLowerCase().includes(query) ||
        s.sessionId.toLowerCase().includes(query)
      );
    }

    // 最新更新的排在最前
    sessions.sort((a, b) => {
      const ta = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const tb = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return tb - ta;
    });

    return sessions;
  }

  protected activeSessionId = computed(() => this.acpService.acpSessionId());
  
  private isLoadingSessions = false;
  /** 上次加载 sessions 的 project path，防止 listProjects() 更新后 effect 重复触发加载 */
  private lastLoadedProjectPath: string | null = null;
  /** 已恢复的 sessionId，防止 effect 重复触发自动加载 */
  private restoredSessionId: string | null = null;

  constructor() {
    // 初始状态：默认激活 New Task，右侧显示 ACP panel（仅浏览器端渲染，避免 SSR 报错）
    this.acpService.isNewSession.set(true);

    // 核心 effect：依赖 selectedProject()（computed from selectedProjectPath + projects + tasks）
    // 当 selectedProject 变化时加载 sessions
    // 注意：listSessionsFromAllAgents 末尾会调用 listProjects() 更新 projects()，
    // 导致本 effect 重跑。通过 lastLoadedProjectPath 避免对同一 project 重复加载 sessions。
    effect(() => {
      const cur = this.selectedProject();
      if (cur && !this.isLoadingSessions && !this.sessionLoadingId()) {
        if (cur.type === 'project') {
          // project: 加载 sessions 列表
          if (cur.path !== this.lastLoadedProjectPath) {
            this.lastLoadedProjectPath = cur.path;
            this.restoredSessionId = null;
            this.loadSessionsForProject(cur.path);
          }

          // 自动恢复上次选中的 session（sessions 加载完成后）
          const savedSessionId = this.acpService.selectedSessionId();
          if (savedSessionId && !this.acpService.acpSessionId() && this.restoredSessionId !== savedSessionId) {
            this.restoredSessionId = savedSessionId;
            this.loadSession(savedSessionId);
          }
        } else if (cur.type === 'task' && cur.sessions?.length > 0) {
          // task: 页面刷新时加载 session 消息
          const sessionId = cur.sessions[0]?.sessionId;
          if (sessionId && this.acpService.acpSessionId() !== sessionId && this.acpService.isNewSession()) {
            this.loadTaskSession(cur.id!, sessionId);
          }
        }
      } else if (!cur) {
        this.lastLoadedProjectPath = null;
      }
    });
  }

  getInitial(name: string): string {
    return (name || '?')[0].toUpperCase();
  }

  switchToTasksView(): void {
    this.lastLoadedProjectPath = null;
    this.restoredSessionId = null;
    this.acpService.saveSelectedProject(null);
    this.acpService.saveSelectedSession(null);
  }

  selectProject(name: string): void {
    const projectInfo = this.acpService.projects().find(p => p.name === name);
    if (projectInfo) {
      this.acpService.saveSelectedProject(projectInfo.path);
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
    if (this.sessionLoadingId()) return;

    const { cwd, agentId } = this.findSessionInfo(sessionId);
    this.sessionLoadingId.set(sessionId);
    this.panelError.set(null);
    this.acpService.isNewSession.set(false);
    this.panelLoading.set(true);

    try {
      await this.acpService.loadSession(sessionId, cwd, agentId);
      await this.ensureSessionInProject(sessionId);
      await this.acpService.saveSelectedSession(sessionId);
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
    this.acpService.isNewSession.set(false);
    this.panelLoading.set(true);

    try {
      await this.acpService.resumeSession(sessionId, cwd, agentId);
      await this.ensureSessionInProject(sessionId);
      await this.acpService.saveSelectedSession(sessionId);
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

  async createNewTask(): Promise<void> {
    this.panelError.set(null);
    // 先清空 selectedProject，再设 isNewSession，
    // 防止 effect 在 selectedProject 仍指向 Task 时触发 loadTaskSession
    await this.acpService.saveSelectedSession(null);
    await this.acpService.saveSelectedProject(null);
    await this.acpService.disconnect();
    this.acpService.isNewSession.set(true);
  }

  async deleteTask(event: MouseEvent, taskId: string): Promise<void> {
    event.stopPropagation();
    if (confirm('Are you sure you want to delete this task?')) {
      const wasSelected = this.selectedProject()?.id === taskId;
      await this.acpService.deleteTask(taskId);
      if (wasSelected) {
        this.acpService.saveSelectedProject(null);
        this.acpService.saveSelectedSession(null);
      }
    }
  }

  async loadTaskSession(taskId: string, sessionId: string): Promise<void> {
    const task = this.acpService.tasks().find(t => t.id === taskId);
    if (!task) return;
    if (this.sessionLoadingId()) return;

    this.sessionLoadingId.set(sessionId);
    this.panelError.set(null);
    this.acpService.saveSelectedProject(task.path || null);

    // 已在此任务会话上（真实 ACP 会话 id 匹配）且连接中，直接打开面板
    if (this.acpService.acpSessionId() === sessionId && this.acpService.sessionState().isConnected) {
      this.sessionLoadingId.set(null);
      return;
    }

    this.acpService.isNewSession.set(false);
    this.panelLoading.set(true);

    const agentId = task.sessions?.find(s => s.sessionId === sessionId)?.agentId;
    try {
      await this.acpService.loadSession(sessionId, task.path, agentId);
      // 用任务记录的标题填充会话标题（任务会话通常不在 sessions 列表，无法回填）
      if (task.name) {
        this.acpService.sessionState.update(s => ({ ...s, title: task.name }));
      }
    } catch (error: any) {
      console.error('[Agent] Failed to load task session:', error);
      this.panelError.set(error?.message || 'Failed to load session');
    } finally {
      this.panelLoading.set(false);
      this.sessionLoadingId.set(null);
    }
  }

  private findSessionInfo(sessionId: string): { cwd?: string; agentId?: string } {
    const selected = this.selectedProject();
    if (selected) {
      const session = selected.sessions?.find(s => s.sessionId === sessionId);
      if (session) {
        return { cwd: selected.path, agentId: session.agentId };
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
    const selected = this.selectedProject();
    if (!selected) return;
    
    const exists = selected.sessions?.some(s => s.sessionId === sessionId);
    if (exists) return;
    
    const session = this.acpService.sessions().find(s => s.sessionId === sessionId);
    if (session) {
      await this.acpService.saveSessionToProject(selected.path, {
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

  onAcpPanelMaximize(): void {
    this.previousSidebarCollapsed = this.layoutService.sidebarCollapsed();
    this.acpPanelMaximized.set(true);
    this.layoutService.collapseSidebar();
    this.maximizePanel.emit();
  }

  onAcpPanelRestore(): void {
    this.acpPanelMaximized.set(false);
    this.layoutService.setSidebarCollapsed(this.previousSidebarCollapsed);
    this.restorePanel.emit();
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
      const wasSelected = this.selectedProject()?.name === name;
      // 先删除（deleteProject 内部会刷新 projects 列表），再清除选中状态，保证编辑器能感知项目已删除
      await this.acpService.deleteProject(name);
      if (wasSelected) {
        await this.acpService.saveSelectedProject(null);
        await this.acpService.saveSelectedSession(null);
      }
    }
  }
}
