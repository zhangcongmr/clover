import { Component, inject, signal, computed, effect, viewChild, output, PLATFORM_ID } from "@angular/core";
import { CommonModule, isPlatformBrowser } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { AcpService } from "../../shared/acp/acp.service";
import type { ProjectInfo } from "../../shared/acp/acp.service";
import { AcpPanelComponent } from "../../shared/acp/acp-panel.component";
import { AcpChatComponent } from "../../shared/acp/acp-chat.component";
import { AcpChatInputComponent } from "../../shared/acp/acp-chat-input.component";
import { AcpPermissionDialogComponent } from "../../shared/acp/acp-permission-dialog.component";
import { FilePickerDialogComponent } from "../../shared/file-picker-dialog/file-picker-dialog.component";
import { AVAILABLE_AGENTS } from "../../shared/acp/acp-agent.types";
import type { SessionInfo } from "../../shared/acp/acp.model";
import { AstMenuComponent } from "../../shared/ast-menu/ast-menu.component";
import { RagService } from "../../shared/rag/rag.service";
import { RagMetricsService } from "../../shared/rag/rag-metrics.service";
import { LayoutService } from "../layout.service";
import { CollabPanelComponent } from "./collab/collab-panel.component";
import { CollabService } from "./collab/collab.service";

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
  host: {
    'class': 'agent-container'
  },
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    FilePickerDialogComponent,
    AcpPanelComponent,
    AcpChatComponent,
    AcpChatInputComponent,
    AcpPermissionDialogComponent,
    CollabPanelComponent,
    AstMenuComponent,
  ],
})
export class AgentComponent {
  protected acpService = inject(AcpService);
  protected layoutService = inject(LayoutService);
  protected collabService = inject(CollabService);
  protected ragService = inject(RagService);
  private readonly ragMetrics = inject(RagMetricsService);
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

  // ============================================================================
  // Content-first agent panel
  // ============================================================================

  /** Session whose content is shown as an overlay in the content-first panel. */
  private readonly contentFirstOpenSessionId = signal<string | null>(null);

  /** Sessions of the selected project, newest first. Empty when no project is selected. */
  protected readonly contentFirstSessions = computed<SessionWithAgent[]>(() => {
    const project = this.selectedProject();
    if (!project) return [];
    return (project.sessions || [])
      .map(s => ({
        sessionId: s.sessionId,
        cwd: project.path,
        title: s.title,
        updatedAt: s.updatedAt,
        agentId: s.agentId,
      }))
      .sort((a, b) => {
        const ta = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const tb = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return tb - ta;
      });
  });

  /** True while a session's chat content should cover the session list. */
  protected readonly contentFirstSessionOpen = computed(() =>
    !!this.contentFirstOpenSessionId() && !this.acpService.isNewSession());

  /** Item backing the overlay header (title/agent), may be missing for a freshly created session. */
  protected readonly contentFirstActiveSession = computed(() => {
    const sessionId = this.contentFirstOpenSessionId();
    if (!sessionId) return null;
    return this.contentFirstSessions().find(s => s.sessionId === sessionId) ?? null;
  });

  /** Project paths whose sessions were already auto-fetched in content-first mode. */
  private readonly contentFirstLoadedProjects = new Set<string>();

  /** Session right-click context menu: open flag, cursor anchor, and the targeted session. */
  sessionMenuOpen = false;
  sessionMenuInitiator: DOMRect | undefined;
  private contextSession: SessionWithAgent | null = null;

  /** Project ⋯ dropdown menu: open flag, anchor, and the targeted project. */
  projectMenuOpen = false;
  projectMenuInitiator: DOMRect | undefined;
  contextProject: ProjectInfo | null = null;
  /** Whether the ACP panel is waiting for a session load/resume to complete. */
  panelLoading = signal<boolean>(false);
  /** Load/resume failure message shown inside the panel. */
  panelError = signal<string | null>(null);

  /** Re-emitted upward so app.component can toggle the AST content (editor) panel. */
  editorToggle = output<void>();
  /** Re-emitted upward so app.component can toggle the overview panel (content-first only). */
  overviewToggle = output<void>();
  /** Re-emitted upward when panel/layout state is changed directly through services (e.g. createNewTask). */
  layoutChanged = output<void>();
  /** Re-emitted upward when user clicks "应用到项目UI" in A2UI theme preview. */
  themeApply = output<Record<string, any>>();
  /** Content-first toolbar entries: open the managers owned by AppComponent. */
  skillsManagerToggle = output<void>();
  mcpManagerToggle = output<void>();
  ragManagerToggle = output<void>();

  /** Knowledge-base tooltip, mirroring the AppComponent sidebar button. */
  protected readonly ragButtonTitle = computed(() => {
    const summary = this.ragMetrics.summary();
    if (summary.completedCount === 0) return 'Knowledge Base';
    const hitRate = summary.hitRate === null ? '—' : `${Math.round(summary.hitRate * 100)}%`;
    return `Knowledge Base · hit rate ${hitRate} · ${summary.completedCount} searches`;
  });

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

  protected activeSessionId = computed(() => this.acpService.sessionState().sessionId);

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

    // Content-first: a session selected from the list (or created by sending a
    // message) opens the chat overlay automatically. Back-to-list clears the
    // session and flips isNewSession back to true, so this won't reopen it.
    effect(() => {
      if (this.layoutService.dockMode() !== 'content-first') return;
      if (this.acpService.isNewSession()) {
        this.contentFirstOpenSessionId.set(null);
        return;
      }
      const sessionId = this.acpService.sessionState().sessionId;
      if (sessionId) {
        this.contentFirstOpenSessionId.set(sessionId);
      }
    });

    // Content-first: lazily fetch the selected project's sessions once, so the
    // panel is not empty when the project was picked from the chat input menu.
    effect(() => {
      if (this.layoutService.dockMode() !== 'content-first') return;
      const project = this.selectedProject();
      if (!project || project.type !== 'project') return;
      if ((project.sessions?.length ?? 0) > 0) return;
      if (this.contentFirstLoadedProjects.has(project.path)) return;
      this.contentFirstLoadedProjects.add(project.path);
      void this.loadSessionsForProject(project.path);
    });

    // 初始状态：默认激活 New Task，右侧显示 ACP panel（仅浏览器端渲染，避免 SSR 报错）
    this.acpService.isNewSession.set(true);
    if (typeof window !== 'undefined') {
      this.acpService.listAll().then(() => {
        // Hydrate the persisted selected project path and session id
        this.acpService.getSelectedProject().then(p => {
          if (p.selectedProject) this.acpService.selectedProjectPath.set(p.selectedProject);

          if (!p.selectedSessionId) {
            this.acpService.isSwitchingSession.set(false);
          }

          const cur = this.acpService.getSelectedProjectInfo(p.selectedProject);
          if (cur) {
            if (cur.type === 'project') {
              this.loadSessionsForProject(cur.path).then(() => {
                if (p.selectedSessionId) {
                  this.loadSession(p.selectedSessionId);
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

  /** Accent color of a project, reusing the sidebar palette. */
  getProjectColor(name: string): string {
    const index = this.projects().findIndex(p => p.name === name);
    return index >= 0 ? PROJECT_COLORS[index % PROJECT_COLORS.length] : 'transparent';
  }

  /** Content-first: open a session's chat content over the session list. */
  async openContentFirstSession(sessionId: string): Promise<void> {
    if (this.sessionLoadingId()) return;
    // Show the overlay immediately; the chat component renders its loading state.
    this.contentFirstOpenSessionId.set(sessionId);
    await this.loadSession(sessionId);
  }

  /**
   * Content-first: close the session content overlay and return to the list.
   * The session selection is cleared (keeping the project), so the next message
   * starts a fresh session as described by the panel behaviour.
   */
  async closeContentFirstSession(): Promise<void> {
    if (this.acpService.isProcessing()) return;
    this.contentFirstOpenSessionId.set(null);
    await this.acpService.saveSelectedSession(null);
    await this.acpService.disconnect();
    this.acpService.isNewSession.set(true);
    // disconnect() resets sessionState; restore the persisted config selectors.
    void this.acpService.reloadConfigOptions();
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
    this.leaveCollab();
    const { cwd, agentId } = this.acpService.findSessionInfo(sessionId, this.selectedProject());
    this.sessionLoadingId.set(sessionId);
    this.panelError.set(null);
    this.acpService.isNewSession.set(false);
    this.panelLoading.set(true);

    try {
      await this.acpService.loadSession(sessionId, cwd, agentId);
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
    this.leaveCollab();
    const { cwd, agentId } = this.acpService.findSessionInfo(sessionId, this.selectedProject());
    this.sessionLoadingId.set(sessionId);
    this.panelError.set(null);
    this.acpService.isNewSession.set(false);
    this.panelLoading.set(true);

    try {
      await this.acpService.resumeSession(sessionId, cwd, agentId, undefined);
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

  async deleteSession(event: MouseEvent, sessionId: string, agentId?: string): Promise<void> {
    event.stopPropagation();
    if (!confirm('Are you sure you want to delete this session?')) return;

    const owner = this.acpService.projects()
      .find(p => p.sessions?.some(s => s.sessionId === sessionId));
    const wasActive = this.activeSessionId() === sessionId;
    const index = owner ? this.sessionsOf(owner).findIndex(s => s.sessionId === sessionId) : -1;

    for (const project of this.acpService.projects()) {
      const record = project.sessions?.find(s => s.sessionId === sessionId);
      if (record) {
        // 服务端没有该会话的内存记录时（后端重启 / 会话只出现在 agent 列表里），
        // 需要 agentId 才能解析 agent 完成删除。记录先被移除，所以必须提前取。
        agentId = agentId || record.agentId;
        await this.acpService.deleteSessionFromProject(project.path, sessionId);
        break;
      }
    }
    await this.acpService.deleteSession(sessionId, agentId);

    // 只有删除的是当前激活会话时才自动跳转
    if (!wasActive) return;
    if (!owner) {
      await this.resetToNewTask();
      return;
    }

    const refreshed = this.acpService.projects().find(p => p.name === owner.name);
    const next = refreshed ? this.pickNeighbor(this.sessionsOf(refreshed), index) : null;
    if (next) {
      await this.loadSession(next.sessionId);
    } else if (refreshed) {
      // 该项目已无会话：停留在项目上，仅清空右侧面板
      await this.resetSessionPanelKeepingSelection(refreshed.path);
    } else {
      await this.resetToNewTask();
    }
  }

  /** Opens the custom context menu on a session row (suppresses the browser's native menu). */
  showSessionContextMenu(evt: MouseEvent, session: SessionWithAgent): void {
    evt.preventDefault();
    evt.stopPropagation();
    // 同一时间只显示一个自定义菜单
    this.projectMenuOpen = false;
    this.contextSession = session;
    this.sessionMenuInitiator = this.cursorDomRect(evt);
    this.sessionMenuOpen = true;
  }

  /** Menu item click: always close first, then dispatch to the existing session actions. */
  onSessionMenuAction(action: 'load' | 'resume' | 'delete', evt: MouseEvent): void {
    this.sessionMenuOpen = false;
    const session = this.contextSession;
    this.contextSession = null;
    if (!session || this.sessionLoadingId()) return;

    if (action === 'load') {
      void this.loadSession(session.sessionId);
    } else if (action === 'resume') {
      void this.resumeSession(session.sessionId);
    } else {
      void this.deleteSession(evt, session.sessionId, session.agentId);
    }
  }

  /** ⋯ button click: open the custom dropdown anchored at the button (re-click closes it). */
  showProjectMenu(evt: MouseEvent, project: ProjectInfo): void {
    evt.stopPropagation();
    if (this.projectMenuOpen && this.contextProject?.name === project.name) {
      this.projectMenuOpen = false;
      this.contextProject = null;
      return;
    }
    const anchor = ((evt.currentTarget as HTMLElement | null) || evt.target) as HTMLElement;
    this.openProjectMenu(project, anchor.getBoundingClientRect());
  }

  /** ⋯ button right-click: open the same menu as a context menu at the cursor. */
  showProjectContextMenu(evt: MouseEvent, project: ProjectInfo): void {
    evt.preventDefault();
    evt.stopPropagation();
    this.openProjectMenu(project, this.cursorDomRect(evt));
  }

  private openProjectMenu(project: ProjectInfo, initiator: DOMRect): void {
    // 同一时间只显示一个自定义菜单
    this.sessionMenuOpen = false;
    this.contextProject = project;
    this.projectMenuInitiator = initiator;
    this.projectMenuOpen = true;
  }

  /** Menu item click: always close first, then dispatch to the existing project actions. */
  onProjectMenuAction(action: 'toggle-collapse' | 'delete' | 'collab', evt: MouseEvent): void {
    this.projectMenuOpen = false;
    const project = this.contextProject;
    this.contextProject = null;
    if (!project) return;

    if (action === 'toggle-collapse') {
      this.toggleProjectCollapse(project.name);
    } else if (action === 'collab') {
      void this.openCollab(project);
    } else {
      void this.deleteProject(evt, project.name);
    }
  }

  /** Opens the multi-agent collaboration panel for the project. */
  async openCollab(project: ProjectInfo): Promise<void> {
    try {
      await this.collabService.open(project);
    } catch (error) {
      console.error('[Agent] Failed to open collaboration panel:', error);
    }
  }

  /** Closes the collaboration panel and releases its space/sessions. */
  closeCollab(): void {
    this.collabService.close();
  }

  /** Leaving the collaboration view for a regular session/task flow. */
  private leaveCollab(): void {
    if (this.collabService.panelOpen()) {
      this.collabService.close();
    }
  }

  /** Pseudo DOMRect anchored at the cursor, for ast-menu positioning/viewport flipping. */
  private cursorDomRect(evt: MouseEvent): DOMRect {
    return {
      x: evt.clientX,
      y: evt.clientY,
      left: evt.clientX,
      top: evt.clientY,
      bottom: evt.clientY,
      right: evt.clientX,
      width: 0,
      height: 0,
      toJSON: () => { },
    };
  }

  async createNewTask(): Promise<void> {
    this.leaveCollab();
    this.panelError.set(null);
    // content-first 下内容面板常开（收放入口在 content 组件右上角），新建任务不应去关它；
    // 只有 agent-first 才顺带收起内容面板，状态写入 agent-first 自己的参数集
    if (this.layoutService.dockMode() === 'agent-first') {
      this.layoutService.toggleAstContentPanel(false);
    }
    // 通知父组件把关闭后的布局状态同步进 dock 快照
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
    if (!confirm('Are you sure you want to delete this task?')) return;

    const selected = this.selectedProject();
    const wasActive = selected?.type === 'task' && selected.id === taskId;
    const index = this.filteredTasks().findIndex(t => t.id === taskId);

    await this.acpService.deleteTask(taskId);

    // 只有删除的是当前激活任务时才自动跳转，删除背景项保持当前视图不变
    if (!wasActive) return;

    const next = this.pickNeighbor(this.filteredTasks(), index);
    if (!next) {
      // 列表已空：回到 New Task
      await this.resetToNewTask();
      return;
    }

    const nextSessionId = next.sessions?.[0]?.sessionId;
    if (next.id && nextSessionId) {
      await this.loadTaskSession(next.id, nextSessionId);
    } else {
      // 兜底：任务没有可加载的会话时，选中该任务并清空右侧面板
      await this.resetSessionPanelKeepingSelection(next.path);
    }
  }

  /**
   * 删除后选取相邻项：优先取删除位置上的下一项，没有则回退到上一项。
   * `indexBeforeRemoval` 是被删项在「删除前可见列表」中的下标。
   */
  private pickNeighbor<T>(remaining: T[], indexBeforeRemoval: number): T | null {
    if (!remaining.length) return null;
    const index = Math.min(Math.max(indexBeforeRemoval, 0), remaining.length - 1);
    return remaining[index] ?? null;
  }

  /** 删除后没有可跳转项时，回到 New Task 初始状态（不改动布局）。 */
  private async resetToNewTask(): Promise<void> {
    this.leaveCollab();
    this.panelError.set(null);
    await this.acpService.saveSelectedSession(null);
    await this.acpService.saveSelectedProject(null);
    await this.acpService.disconnect();
    this.acpService.isNewSession.set(true);
    void this.acpService.reloadConfigOptions();
  }

  /** 清空当前会话并重置右侧面板，但保留指定项目/任务为选中项。 */
  private async resetSessionPanelKeepingSelection(path: string): Promise<void> {
    this.panelError.set(null);
    await this.acpService.saveSelectedSession(null);
    await this.acpService.disconnect();
    await this.acpService.saveSelectedProject(path);
    this.acpService.isNewSession.set(true);
    void this.acpService.reloadConfigOptions();
  }

  async loadTaskSession(taskId: string, sessionId: string): Promise<void> {
    const task = this.acpService.tasks().find(t => t.id === taskId);
    if (!task) return;
    if (this.sessionLoadingId()) return;
    this.leaveCollab();
    this.sessionLoadingId.set(sessionId);
    this.panelError.set(null);
    this.acpService.saveSelectedProject(task.path || null);

    // 已在此任务会话上（真实 ACP 会话 id 匹配）且连接中，直接打开面板
    if (this.acpService.sessionState().sessionId === sessionId && this.acpService.sessionState().isConnected) {
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
      await this.acpService.loadSession(sessionId, task.path, agentId);
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

  getRelativeTime(dateStr?: string): string {
    if (!dateStr) return '';
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
    if (!confirm(`Delete project "${name}"?`)) return;

    const selected = this.selectedProject();
    const wasActive = selected?.type === 'project' && selected.name === name;
    const index = this.projects().findIndex(p => p.name === name);

    // deleteProject 内部会刷新 projects 列表
    await this.acpService.deleteProject(name);

    // 只有删除的是当前选中项目时才自动跳转
    if (!wasActive) return;

    const next = this.pickNeighbor(this.projects(), index);
    // 先回到 New Task 清空旧项目残留，再选中下一个项目
    await this.resetToNewTask();
    if (next) {
      this.selectProject(next.name);
    }
  }
}
