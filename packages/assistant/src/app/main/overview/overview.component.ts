import { Component, computed, inject, output } from '@angular/core';
import { AcpService } from '../../shared/acp/acp.service';
import { AVAILABLE_AGENTS } from '../../shared/acp/acp-agent.types';

/**
 * Overview 面板：只展示当前激活 session/task 的派生信息，完全依赖 AcpService，
 * 与 content 组件的文件树 / tab 状态无关，因此从 ContentComponent 中独立出来，
 * 由 AppComponent 挂载到中间面板（与 workspace 互斥）。
 */
@Component({
  selector: 'ast-overview',
  templateUrl: './overview.component.html',
  styleUrls: ['./overview.component.css'],
  standalone: true,
})
export class OverviewComponent {
  private acpService = inject(AcpService);

  /** 点击任意卡片即关闭 overview，回到 workspace */
  readonly closed = output<void>();

  close(): void {
    this.closed.emit();
  }

  /** 激活会话标题；无会话时回退到选中项目/任务名 */
  readonly overviewSessionTitle = computed(() => {
    const state = this.acpService.sessionState();
    const title = state.title?.trim();
    if (title) return title;
    const info = this.acpService.getSelectedProjectInfo(this.acpService.selectedProjectPath());
    if (info) return info.name;
    if (state.cwd) return state.cwd.split(/[/\\]/).pop() || state.cwd;
    return this.acpService.hasActiveSession() ? 'Untitled Session' : 'New Task';
  });

  /** 连接状态徽标 */
  readonly overviewStatus = computed<{ label: string; cls: string }>(() => {
    const state = this.acpService.sessionState();
    if (state.error) return { label: 'Error', cls: 'status-error' };
    if (state.isConnecting) return { label: 'Connecting', cls: 'status-connecting' };
    if (state.isConnected && state.agentConnected) return { label: 'Connected', cls: 'status-connected' };
    if (state.isConnected) return { label: 'Agent Offline', cls: 'status-error' };
    if (this.acpService.hasActiveSession()) return { label: 'Disconnected', cls: 'status-idle' };
    return { label: 'Idle', cls: 'status-idle' };
  });

  /** 当前激活会话所属 agent（优先会话记录中的 agentId，其次选中的 agent） */
  readonly overviewAgent = computed<{ name: string; badge: string } | null>(() => {
    let agentId = this.acpService.selectedAgent()?.id;
    const sessionId = this.acpService.sessionState().sessionId;
    if (sessionId) {
      const sessionInfo = this.acpService.findSessionInfo(
        sessionId,
        this.acpService.getSelectedProjectInfo(this.acpService.selectedProjectPath())
      );
      if (sessionInfo.agentId) agentId = sessionInfo.agentId;
    }
    const agent = AVAILABLE_AGENTS.find(a => a.id === agentId);
    if (!agent) return null;
    const badges: Record<string, string> = {
      opencode: 'OC', claude: 'CL', codex: 'CX', gemini: 'GM', qwen: 'QW', augment: 'AU'
    };
    return { name: agent.name, badge: badges[agent.id] ?? '??' };
  });

  readonly overviewModelLabel = computed(() => this.readConfigOptionLabel('model'));
  readonly overviewModeLabel = computed(() => this.readConfigOptionLabel('mode'));

  private readConfigOptionLabel(category: 'model' | 'mode'): string {
    const config = this.acpService.sessionState().configOptions
      ?.find(o => o.category === category && o.type === 'select');
    if (!config) return '';
    const option = config.options?.find(o => o.value === config.currentValue);
    return option?.name ?? String(config.currentValue ?? '');
  }

  /** 当前选中的项目/任务（回退到会话 cwd） */
  readonly overviewProject = computed<{ name: string; type: 'project' | 'task'; path: string } | null>(() => {
    const path = this.acpService.selectedProjectPath();
    const info = this.acpService.getSelectedProjectInfo(path);
    if (info) return { name: info.name, type: info.type, path: info.path };
    const fallback = this.acpService.sessionState().cwd ?? path;
    if (!fallback) return null;
    return { name: fallback.split(/[/\\]/).pop() || fallback, type: 'project', path: fallback };
  });

  readonly overviewMessageCount = computed(() => this.acpService.messageCount());
  readonly overviewProcessing = computed(() => this.acpService.isProcessing());

  readonly overviewActivityText = computed(() => {
    const messages = this.acpService.messages();
    const last = messages[messages.length - 1];
    if (!last?.timestamp) return 'No messages yet';
    const rel = this.getRelativeTime(last.timestamp);
    return rel === 'just now' ? 'Active just now' : `Active ${rel} ago`;
  });

  readonly overviewTokensValue = computed(() => {
    const usage = this.acpService.usage();
    if (!usage) return '—';
    const total = usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
    return total ? `${this.formatCount(total)} tokens` : '—';
  });

  readonly overviewTokensSub = computed(() => {
    const plan = this.overviewPlanProgress();
    if (plan) return `Plan ${plan.done}/${plan.total} steps done`;
    const usage = this.acpService.usage();
    if (!usage) return 'No usage yet';
    return `↑ ${this.formatCount(usage.inputTokens ?? 0)} in · ↓ ${this.formatCount(usage.outputTokens ?? 0)} out`;
  });

  readonly overviewPlanProgress = computed(() => {
    let total = 0;
    let done = 0;
    this.acpService.plans().forEach(plan => plan.entries.forEach(entry => {
      total++;
      if (entry.status === 'completed') done++;
    }));
    return total ? { done, total } : null;
  });

  private getRelativeTime(date: Date | string): string {
    const diffMs = Date.now() - new Date(date).getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h`;
    return `${Math.floor(diffHr / 24)}d`;
  }

  private formatCount(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
    return String(n);
  }
}
