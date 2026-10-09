import { Component, inject, signal, computed, effect, viewChild, output, PLATFORM_ID } from "@angular/core";
import { CommonModule, isPlatformBrowser } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { AcpService } from "../../shared/acp/acp.service";
import type { ProjectInfo } from "../../shared/acp/acp.service";
import { AcpPanelComponent } from "../../shared/acp/acp-panel.component";
import { FilePickerDialogComponent } from "../../shared/file-picker-dialog/file-picker-dialog.component";
import { AVAILABLE_AGENTS } from "../../shared/acp/acp-agent.types";
import type { SessionInfo } from "../../shared/acp/acp.model";
import { LayoutService } from "../layout.service";

interface SessionWithAgent extends SessionInfo {
  agentId?: string;
}

const PROJECT_COLORS = [
  '#2196f3', '#4caf50', '#ff9800', '#9c27b0',
  '#f44336', '#00bcd4', '#ff5722', '#607d8b',
  '#e91e63', '#3f51b5', '#009688', '#795548',
];

const COLLAPSED_PROJECTS_KEY = 'clover_collapsed_projects';

/** Read the persisted collapsed-project names, returning an empty set on SSR or corrupt data. */
function readCollapsedProjects(): Set<string> {
  if (typeof localStorage === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(COLLAPSED_PROJECTS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((n): n is string => typeof n === 'string'));
  } catch {
    return new Set();
  }
}

@Component({
  selector: "div[ast-agent]",
  templateUrl: "./agent.html",
  styleUrls: ["./agent.css"],
  standalone: true,
  imports: [CommonModule, FormsModule, FilePickerDialogComponent, AcpPanelComponent],
})
export class AgentComponent {
  protected acpService = inject(AcpService);
  protected layoutService = inject(LayoutService);
  private readonly platformId = inject(PLATFORM_ID);
  /** True only in the browser; used to skip rendering the ACP panel during SSR. */
  protected readonly isBrowser = computed(() => isPlatformBrowser(this.platformId));
  readonly filePicker = viewChild(FilePickerDialogComponent);

  searchQuery = signal('');
  selectedProject = computed(() => this.acpService.getSelectedProjectInfo(this.acpService.selectedProjectPath()));
  /** Projects whose session list is collapsed (keyed by project name). */
  collapsedProjects = signal<Set<string>>(readCollapsedProjects());

  /** Session currently being loaded/resumed (spinner on item, guards double-click). */
  sessionLoadingId = signal<string | null>(null);
  /** Whether the ACP panel is waiting for a session load/resume to complete. */
  panelLoading = signal<boolean>(false);
  /** Load/resume failure message shown inside the panel. */
  panelError = signal<string | null>(null);

  /** Re-emitted upward so app.component can toggle the AST content (editor) panel. */
  editorToggle = output<void>();
  /** Re-emitted upward when panel/layout state is changed directly through services (e.g. createNewTask). */
  layoutChanged = output<void>();
  /** Re-emitted upward when user clicks "应用到项目UI" in A2UI theme preview. */
  themeApply = output<Record<string, any>>();

  protected projects = computed(() => {
    return this.acpService.projects()
      .filter(p => p.type === 'project')
      .map((p, i) => ({
        ...p,
        color: PROJECT_COLORS[i % PROJECT_COLORS.length],
      }));
  });

  /** Tasks filtered by the sidebar search query (matches task title / id / path). */
  protected filteredTasks = computed(() => {
    const query = this.searchQuery().toLowerCase();
    if (!query) return this.acpService.tasks();
    return this.acpService.tasks().filter(task =>
      (task.sessions[0]?.title || '').toLowerCase().includes(query) ||
      (task.id || '').toLowerCase().includes(query) ||
      task.path.toLowerCase().includes(query)
    );
  });

  /** A project's persisted sessions, with search applied. */
  protected sessionsOf(project: ProjectInfo): SessionWithAgent[] {
    const query = this.searchQuery().toLowerCase();

    let sessions: SessionWithAgent[] = (project.sessions || []).map(s => ({
      sessionId: s.sessionId,
      cwd: project.path,
      title: s.title,
      updatedAt: s.updatedAt,
      agentId: s.agentId,
    }));

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

  protected activeSessionId = computed(() => this.acpService.selectedSessionId());

  /**
   * Single source of truth for the sidebar highlight: exactly one of
   * New Task / Task / Project / Session can be active at a time.
   *
   * Priority:
   *  1. The selected task's own session — the task row stands in for it.
   *  2. A session actually rendered under a project (first project wins).
   *  3. The selected task.
   *  4. The selected project.
   *  5. New Task — default when nothing else is selected.
   *
   * A session id that is not listed in the sidebar (e.g. the internal session
   * created to prefetch config options, which acp.service records before it
   * knows the session is internal) never wins, so the highlight falls back
   * instead of going dark.
   */
  private readonly activeItemKey = computed(() => {
    const selected = this.selectedProject();
    const sessionId = this.activeSessionId();

    if (selected?.type === 'task' && sessionId &&
        selected.sessions?.some(s => s.sessionId === sessionId)) {
      return `task:${selected.path}`;
    }

    if (sessionId) {
      for (const project of this.projects()) {
        if (this.sessionsOf(project).some(s => s.sessionId === sessionId)) {
          return `session:${project.name}:${sessionId}`;
        }
      }
    }

    if (selected?.type === 'task') return `task:${selected.path}`;
    if (selected?.type === 'project') return `project:${selected.name}`;

    return 'new-task';
  });

  protected isNewTaskActive(): boolean {
    return this.activeItemKey() === 'new-task';
  }

  protected isTaskActive(task: ProjectInfo): boolean {
    return this.activeItemKey() === `task:${task.path}`;
  }

  protected isProjectActive(project: ProjectInfo): boolean {
    return this.activeItemKey() === `project:${project.name}`;
  }

  protected isSessionActive(project: ProjectInfo, session: SessionWithAgent): boolean {
    return this.activeItemKey() === `session:${project.name}:${session.sessionId}`;
  }

  private isLoadingSessions = false;

  constructor() {
    // Persist collapsed project state to localStorage whenever it changes (browser only).
    if (isPlatformBrowser(this.platformId)) {
      effect(() => {
        const names = Array.from(this.collapsedProjects());
        try {
          localStorage.setItem(COLLAPSED_PROJECTS_KEY, JSON.stringify(names));
        } catch {
          // ignore quota/serialization failures
        }
      });
    }

    // 初始状态：默认激活 New Task，右侧显示 ACP panel（仅浏览器端渲染，避免 SSR 报错）
    this.acpService.isNewSession.set(true);
    if (typeof window !== 'undefined') {
      this.acpService.listAll().then(() => {
        // Hydrate the persisted selected project path and session id
        this.acpService.getSelectedProject().then(p => {
          if (p.selectedProject) this.acpService.selectedProjectPath.set(p.selectedProject);
          if (p.selectedSessionId) this.acpService.selectedSessionId.set(p.selectedSessionId);

          if (!p.selectedSessionId) {
            this.acpService.isSwitchingSession.set(false);
          }

          const cur = this.acpService.getSelectedProjectInfo(p.selectedProject);
          if (cur) {
            if (cur.type === 'project') {
              this.loadSessionsForProject(cur.path).then(() => {
                const selectedSessionId = this.acpService.selectedSessionId();
                if (selectedSessionId) {
                  this.loadSession(selectedSessionId);
                }
              });
            } else if (cur.type === 'task' && cur.sessions?.length > 0) {
              // task: 页面刷新时加载 session 消息
              const sessionId = cur.sessions[0]?.sessionId;
              if (sessionId) {
                this.loadTaskSession(cur.id!, sessionId);
              }
            }
          }
        });
      }).catch(err => {
        console.error('[Agent] Failed to list projects and tasks:', err);
        this.panelError.set(err?.message || 'Failed to list projects and tasks');
      });
    }
  }

  getInitial(name: string): string {
    return (name || '?')[0].toUpperCase();
  }

  switchToTasksView(): void {
    this.acpService.saveSelectedProject(null);
    this.acpService.saveSelectedSession(null);
  }

  selectProject(name: string): void {
    const projectInfo = this.acpService.projects().find(p => p.name === name);
    if (!projectInfo) return;

    // If already selected, toggle collapse instead of re-selecting
    if (this.selectedProject()?.name === name && this.selectedProject()?.type === 'project') {
      this.toggleProjectCollapse(name);
      return;
    }

    // Expand if it was collapsed
    this.expandProject(name);

    this.acpService.saveSelectedProject(projectInfo.path);
    if (!projectInfo.sessions?.length) {
      this.loadSessionsForProject(projectInfo.path);
    }
  }

  toggleProjectCollapse(name: string): void {
    this.collapsedProjects.update(set => {
      const next = new Set(set);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }

  expandProject(name: string): void {
    this.collapsedProjects.update(set => {
      if (!set.has(name)) return set;
      const next = new Set(set);
      next.delete(name);
      return next;
    });
  }

  isProjectCollapsed(name: string): boolean {
    return this.collapsedProjects().has(name);
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

    const { cwd, agentId } = this.acpService.findSessionInfo(sessionId, this.selectedProject());
    this.sessionLoadingId.set(sessionId);
    this.panelError.set(null);
    this.acpService.isNewSession.set(false);
    this.panelLoading.set(true);

    try {
      await this.acpService.loadSession(sessionId, cwd, agentId, this.acpService.selectedMcpServers());
      this.acpService.selectedProjectPath.set(cwd || null);
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

    const { cwd, agentId } = this.acpService.findSessionInfo(sessionId, this.selectedProject());
    this.sessionLoadingId.set(sessionId);
    this.panelError.set(null);
    this.acpService.isNewSession.set(false);
    this.panelLoading.set(true);

    try {
      await this.acpService.resumeSession(sessionId, cwd, agentId, undefined, this.acpService.selectedMcpServers());
      this.acpService.selectedProjectPath.set(cwd || null);
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
    this.layoutService.toggleAstContentPanel(false);
    // 通知父组件把关闭后的布局状态同步进 dock 快照，保证刷新后仍是 Maximize Agent
    this.layoutChanged.emit();
    // 先清空 selectedProject，再设 isNewSession，
    // 防止 effect 在 selectedProject 仍指向 Task 时触发 loadTaskSession
    await this.acpService.saveSelectedSession(null);
    await this.acpService.saveSelectedProject(null);
    await this.acpService.disconnect();
    this.acpService.isNewSession.set(true);
    // disconnect 重置了 sessionState（含 configOptions），重新拉取
    // 当前 agent 持久化的配置，恢复 mode/model 选择器
    void this.acpService.reloadConfigOptions();
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
    if (this.acpService.selectedSessionId() === sessionId && this.acpService.sessionState().isConnected) {
      this.sessionLoadingId.set(null);
      return;
    }

    this.acpService.isNewSession.set(false);
    this.panelLoading.set(true);
    // 用任务记录的标题填充会话标题（任务会话通常不在 sessions 列表，无法回填）
    if (task.name) {
      this.acpService.sessionState.update(s => ({ ...s, title: task.name }));
    }

    const agentId = task.sessions?.find(s => s.sessionId === sessionId)?.agentId;
    try {
      await this.acpService.loadSession(sessionId, task.path, agentId, this.acpService.selectedMcpServers());
    } catch (error: any) {
      console.error('[Agent] Failed to load task session:', error);
      this.panelError.set(error?.message || 'Failed to load session');
    } finally {
      this.panelLoading.set(false);
      this.sessionLoadingId.set(null);
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
