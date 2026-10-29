import { Injectable, computed, inject, signal } from '@angular/core';
import {
  Client,
  ClientFactory,
  ClientFactoryOptions,
  DefaultAgentCardResolver,
  JsonRpcTransportFactory,
} from '@a2a-js/sdk/client';
import {
  Role,
  TaskState,
  type SendMessageRequest,
  type StreamResponse,
} from '@a2a-js/sdk';
import { LocalAgentService } from '../../../shared/local-agent/local-agent.service';
import { AcpSseService, type AgentStatusInfo } from '../../../shared/acp/acp-sse.service';
import { openSseRequest, readSseFrames } from '../../../shared/acp/sse-transport';
import type { ConfigOption } from '../../../shared/acp/acp.model';
import type { ProjectInfo } from '../../../shared/acp/acp.service';

/**
 * One participating session inside a collaboration space (backend response).
 * `id` is the participant/session key (primary key of the collaboration);
 * `agentId` is the agent implementation bound to this session.
 */
export interface CollabSpaceAgent {
  id: string;
  agentId: string;
  sessionId: string;
  /** mode/model selectors from session/new; live values updated via set_config_option. */
  configOptions?: ConfigOption[];
  /** Session-level role label, e.g. "代码审查专家". */
  role?: string;
  /** What this session is responsible for (used in routing / judgement prompts). */
  responsibility?: string;
  /** Machine-readable capability tags, e.g. ["code_review"]. */
  capabilities?: string[];
}

export interface CollabSpace {
  spaceId: string;
  cwd: string;
  /** Participating sessions (session-primary; several may share an agentId). */
  agents: CollabSpaceAgent[];
  /** Participant id designated as orchestrator (optional). */
  orchestratorId?: string | null;
}

/** One editable session slot in the picker (before the space is created). */
export interface ParticipantDraft {
  /** Client-generated participant id. */
  id: string;
  /** Bound agent implementation; empty until chosen. */
  agentId: string;
  role: string;
  responsibility: string;
}

export type CollabMessageStatus = 'streaming' | 'completed' | 'failed' | 'canceled';

export interface CollabMessage {
  id: string;
  role: 'user' | 'agent';
  text: string;
  /** Participant/session key that produced this message. */
  participantId?: string;
  agentId?: string;
  agentLabel?: string;
  /** ACP session id that produced this message (collaboration trace). */
  sessionId?: string;
  /** Collaboration turn this message belongs to. */
  turn?: number;
  /** Session id whose output this turn continued from. */
  prevSessionId?: string;
  /** Participant id whose output this turn continued from. */
  prevParticipantId?: string;
  /** Voluntary-claim reason (agent messages only). */
  claimReason?: string;
  /** Sessions that passed on this turn (voluntary mode). */
  relinquishedBy?: string[];
  /** Parallel sub-task id (parallel mode). */
  subTaskId?: string;
  /** Role label of the producing session. */
  agentRole?: string;
  status?: CollabMessageStatus;
  statusText?: string;
  time: number;
}

/** Collaboration strategy selected in the panel. */
export type CollabMode = 'single' | 'pipeline' | 'parallel' | 'voluntary';

/**
 * A collaboration transcript message resolved to the ACP session behind it.
 * Used by the session detail panel to `session/load` that session's full history
 * (thoughts / tool calls included).
 */
export interface CollabSessionTarget {
  sessionId: string;
  agentId?: string;
  /** Workspace directory the session belongs to (needed by `session/load`). */
  cwd?: string;
  /** Human label of the owning participant. */
  label: string;
}

export interface ParallelSubTaskDraft {
  id: string;
  prompt: string;
  /** Route by session role (empty = by targetParticipantId / keyword). */
  targetRole: string;
  /** Route by participant id (empty = by role / keyword). */
  targetParticipantId: string;
}

const ORCHESTRATOR_PATH = 'api/a2a/orchestrator/';
/** Client-side cap before the backend clamps again. */
const MAX_TURNS = 30;

@Injectable({ providedIn: 'root' })
export class CollabService {
  private localAgent = inject(LocalAgentService);
  private sseService = inject(AcpSseService);

  /** Whether the collaboration panel replaces the ACP panel. */
  readonly panelOpen = signal(false);
  readonly project = signal<ProjectInfo | null>(null);
  /** All agents reported by the backend registry (unfiltered, bindable targets). */
  readonly availableAgents = signal<AgentStatusInfo[]>([]);
  /** Editable session slots (session-primary picker). */
  readonly participants = signal<ParticipantDraft[]>([]);
  /** Chosen orchestrator participant id (must be a participant; empty = none). */
  readonly orchestratorId = signal<string>('');
  readonly space = signal<CollabSpace | null>(null);
  readonly messages = signal<CollabMessage[]>([]);
  readonly sending = signal(false);
  readonly creating = signal(false);
  readonly error = signal<string | null>(null);
  /** Explicit routing target participant id; empty = auto (role / keyword / first session). */
  readonly targetParticipantId = signal('');
  /** Route by session role (01 单点协作); empty = auto. */
  readonly targetRole = signal('');

  /**
   * Unified routing selection for 01 单点协作: `''` (auto) / `role:<role>` /
   * `participant:<id>`. Only one of `targetRole` / `targetParticipantId` is set.
   */
  readonly targetRoute = computed(() => {
    const role = this.targetRole();
    if (role) return `role:${role}`;
    const participantId = this.targetParticipantId();
    return participantId ? `participant:${participantId}` : '';
  });

  // === Collaboration mode (shared metadata contract with the backend) ===
  readonly collabMode = signal<CollabMode>('single');

  // 02 流水线
  readonly pipelineMode = signal<'static' | 'orchestrated'>('static');
  readonly pipelineMaxTurns = signal(8);
  /** Static pipeline order (participant ids); empty = the space declaration order. */
  readonly pipelineOrder = signal<string[]>([]);

  // 03 并行
  readonly parallelSubTasks = signal<ParallelSubTaskDraft[]>([]);
  readonly parallelAggregator = signal('');
  readonly parallelMaxConcurrency = signal(4);

  // 04 自愿认领
  readonly voluntaryConflict = signal<'first-come' | 'priority' | 'random'>('first-come');
  readonly voluntaryMaxTurns = signal(8);

  private wrapperAborts = new Map<string, AbortController>();
  /** wrapper 流的 clientId / epoch：权限响应要用它通过所有权栅栏。 */
  private wrapperClientId: string | null = null;
  private wrapperEpochs = new Map<string, number>();
  private currentAbort: AbortController | null = null;
  private messageSeq = 0;
  private participantSeq = 0;
  private subTaskSeq = 0;

  // ==========================================================================
  // Space lifecycle
  // ==========================================================================

  async open(project: ProjectInfo): Promise<void> {
    this.project.set(project);
    this.panelOpen.set(true);
    this.error.set(null);
    if (this.availableAgents().length === 0) {
      await this.refreshAgents();
    }
    if (this.participants().length === 0) {
      this.addParticipant();
    }
  }

  close(): void {
    const space = this.space();
    this.panelOpen.set(false);
    this.abortStream();
    this.closeWrapperSse();
    if (space) {
      void this.deleteSpace(space.spaceId).catch(err => {
        console.error('[Collab] Failed to release space:', err);
      });
    }
    this.space.set(null);
    this.sending.set(false);
    this.creating.set(false);
  }

  async refreshAgents(): Promise<void> {
    try {
      this.availableAgents.set(await this.sseService.listAgents());
    } catch (error) {
      console.error('[Collab] Failed to list agents:', error);
      this.error.set((error as Error).message || 'Failed to list agents');
    }
  }

  // --- Session slots (participants) -----------------------------------------

  /** Adds a new session slot, optionally pre-bound to an agent (default: unbound). */
  addParticipant(agentId?: string): void {
    const fallback = agentId ?? '';
    this.participants.update(list => [
      ...list,
      { id: `s${++this.participantSeq}`, agentId: fallback, role: '', responsibility: '' },
    ]);
  }

  removeParticipant(id: string): void {
    this.participants.update(list => list.filter(participant => participant.id !== id));
    if (this.orchestratorId() === id) this.orchestratorId.set('');
  }

  updateParticipant(id: string, patch: Partial<Omit<ParticipantDraft, 'id'>>): void {
    this.participants.update(list =>
      list.map(participant => (participant.id === id ? { ...participant, ...patch } : participant)),
    );
  }

  /** Toggles the orchestrator role for a session slot (clicking again clears it). */
  setOrchestrator(id: string): void {
    this.orchestratorId.update(current => (current === id ? '' : id));
  }

  /** Whether a space can be created from the current session slots. */
  canCreateSpace(): boolean {
    const list = this.participants();
    return !this.creating() && list.length > 0 && list.every(participant => Boolean(participant.agentId));
  }

  async createSpace(): Promise<void> {
    const project = this.project();
    const list = this.participants();
    if (!project || !this.canCreateSpace() || this.space()) return;

    this.creating.set(true);
    this.error.set(null);
    try {
      const token = await this.localAgent.getToken();
      const participants = list.map(participant => ({
        id: participant.id,
        agentId: participant.agentId,
        role: participant.role.trim() || undefined,
        responsibility: participant.responsibility.trim() || undefined,
      }));
      const res = await fetch(`${this.localAgent.getBaseUrl()}/api/a2a/collab/spaces`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          cwd: project.path,
          participants,
          orchestratorId: this.orchestratorId() || undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.message || `Create space failed (${res.status})`);
      }
      const space: CollabSpace = {
        spaceId: data.spaceId,
        cwd: data.cwd,
        agents: (Array.isArray(data.participants) ? data.participants : []).map(
          (participant: CollabSpaceAgent) => ({
            ...participant,
            configOptions: this.sortConfigOptions(participant.configOptions),
          }),
        ),
        orchestratorId: data.orchestratorId ?? null,
      };
      this.space.set(space);
      this.pipelineOrder.set(space.agents.map(agent => agent.id));
      this.parallelAggregator.set('');
      this.openWrapperSse(space, token);
    } catch (error) {
      this.error.set((error as Error).message || 'Failed to create collaboration space');
      throw error;
    } finally {
      this.creating.set(false);
    }
  }

  private async deleteSpace(spaceId: string): Promise<void> {
    const token = await this.localAgent.getToken();
    await fetch(`${this.localAgent.getBaseUrl()}/api/a2a/collab/spaces/${encodeURIComponent(spaceId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  // ==========================================================================
  // Collaboration mode configuration
  // ==========================================================================

  /** Roles available on the current space (for routing dropdowns). */
  availableRoles(): string[] {
    const space = this.space();
    if (!space) return [];
    return [...new Set(space.agents.map(agent => agent.role).filter((role): role is string => Boolean(role)))];
  }

  /** Applies a unified routing selection, clearing the other routing signal. */
  setTargetRoute(value: string): void {
    const separator = value.indexOf(':');
    const kind = separator >= 0 ? value.slice(0, separator) : '';
    const target = separator >= 0 ? value.slice(separator + 1) : '';
    if (kind === 'role' && target) {
      this.targetParticipantId.set('');
      this.targetRole.set(target);
      return;
    }
    if (kind === 'participant' && target) {
      this.targetRole.set('');
      this.targetParticipantId.set(target);
      return;
    }
    this.targetParticipantId.set('');
    this.targetRole.set('');
  }

  addSubTask(): void {
    this.parallelSubTasks.update(list => [
      ...list,
      { id: `task-${++this.subTaskSeq}`, prompt: '', targetRole: '', targetParticipantId: '' },
    ]);
  }

  removeSubTask(id: string): void {
    this.parallelSubTasks.update(list => list.filter(subTask => subTask.id !== id));
  }

  updateSubTask(id: string, patch: Partial<ParallelSubTaskDraft>): void {
    this.parallelSubTasks.update(list =>
      list.map(subTask => (subTask.id === id ? { ...subTask, ...patch } : subTask)),
    );
  }

  /** Moves a pipeline stage up/down in the static order. */
  movePipelineStage(participantId: string, delta: number): void {
    this.pipelineOrder.update(order => {
      const index = order.indexOf(participantId);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= order.length) return order;
      const next = [...order];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  clampTurns(value: number): number {
    if (!Number.isFinite(value)) return 8;
    return Math.max(1, Math.min(Math.floor(value), MAX_TURNS));
  }

  // ==========================================================================
  // Agent config (mode/model) — session-level state applied to later prompts
  // ==========================================================================

  /**
   * Applies a config option (mode/model/…) to one participating session.
   * The new value takes effect on that session's next prompt; updating between
   * turns is race-free because prompts are serialized per session (FIFO lock).
   */
  async setAgentConfigOption(
    participantId: string,
    configId: string,
    type: 'id' | 'boolean',
    value: string | boolean,
  ): Promise<void> {
    const space = this.space();
    const agent = space?.agents.find(a => a.id === participantId);
    if (!space || !agent) return;

    try {
      const result = await this.sseService.setConfigOption(agent.sessionId, configId, type, value);
      const nextOptions = result?.configOptions;
      if (Array.isArray(nextOptions)) {
        const sorted = this.sortConfigOptions(nextOptions as ConfigOption[]);
        this.space.update(current =>
          current
            ? {
                ...current,
                agents: current.agents.map(a =>
                  a.id === participantId ? { ...a, configOptions: sorted } : a,
                ),
              }
            : current,
        );
      }
    } catch (error) {
      console.error(`[Collab] Failed to set ${configId} on ${participantId}:`, error);
      this.error.set((error as Error)?.message || `Failed to update ${configId}`);
    }
  }

  /**
   * Orders config options mode → model → effort once at write time (space
   * creation / config update), so change detection iterates a ready-made
   * array without re-sorting. Stable sort keeps the agent's original order
   * for everything else.
   */
  private sortConfigOptions(options: ConfigOption[] | undefined): ConfigOption[] | undefined {
    if (!options || options.length <= 1) return options;
    return [...options].sort((a, b) => this.optionRank(a) - this.optionRank(b));
  }

  private optionRank(option: ConfigOption): number {
    const category = (option.category ?? '').toLowerCase();
    const id = (option.id ?? '').toLowerCase();
    const name = (option.name ?? '').toLowerCase();

    if (category === 'mode' || id === 'mode') return 0;
    if (category === 'model' || category === 'model_config' || id === 'model') return 1;
    if (category === 'thought_level' || category === 'effort' || id === 'effort' || name === 'effort') return 2;
    return 3;
  }

  // ==========================================================================
  // Wrapper SSE (permission bypass)
  // ==========================================================================

  private openWrapperSse(space: CollabSpace, token: string): void {
    this.closeWrapperSse();
    const base = this.localAgent.getBaseUrl();
    const clientId = `collab:${space.spaceId}`;
    this.wrapperClientId = clientId;

    for (const { sessionId } of space.agents) {
      const controller = new AbortController();
      this.wrapperAborts.set(sessionId, controller);
      void this.loopWrapperStream(base, sessionId, token, clientId, controller.signal);
    }
  }

  /** wrapper 事件流：有限次重试，避免后台无限重连。 */
  private async loopWrapperStream(
    base: string,
    sessionId: string,
    token: string,
    clientId: string,
    signal: AbortSignal,
  ): Promise<void> {
    const maxAttempts = 10;

    for (let attempt = 0; attempt < maxAttempts && !signal.aborted; attempt++) {
      await this.runWrapperStream(base, sessionId, token, clientId, signal);
      if (signal.aborted) return;
      await new Promise<void>((resolve) => setTimeout(resolve, 3000));
    }

    if (!signal.aborted) {
      console.warn(`[Collab] Giving up wrapper stream for ${sessionId} after ${maxAttempts} attempts`);
    }
  }

  private async runWrapperStream(
    base: string,
    sessionId: string,
    token: string,
    clientId: string,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      const response = await openSseRequest(
        `${base}/api/acp/stream/${encodeURIComponent(sessionId)}`,
        {
          headers: {
            Accept: 'text/event-stream',
            Authorization: `Bearer ${token}`,
            // 'X-Client-Id': clientId,
            // wrapper session 只由协作面板消费
            'X-Takeover': '1',
          },
          signal,
        },
      );

      if (!response.ok || !response.body) {
        console.warn(`[Collab] Wrapper stream failed (${sessionId}): HTTP ${response.status}`);
        return;
      }

      for await (const frame of readSseFrames(response.body, signal)) {
        if (!frame.data) continue;
        try {
          this.handleWrapperEvent(sessionId, JSON.parse(frame.data));
        } catch (error) {
          console.error('[Collab] Failed to parse wrapper event:', error);
        }
      }
    } catch (error) {
      if (!signal.aborted) {
        console.warn(`[Collab] Wrapper stream error (${sessionId}):`, error);
      }
    }
  }

  private closeWrapperSse(): void {
    for (const controller of this.wrapperAborts.values()) {
      controller.abort();
    }
    this.wrapperAborts.clear();
    this.wrapperEpochs.clear();
    this.wrapperClientId = null;
  }

  /**
   * Mirrors `AcpService.handlePermissionRequest`: dispatches the shared
   * `acp-permission-request` window event so the existing permission dialog
   * can answer through the wrapper session's stream command channel.
   */
  private handleWrapperEvent(sessionId: string, event: { type?: string; payload?: any }): void {
    // `connected` 携带本次连接的所有权 epoch，权限响应要用它通过栅栏
    if (event.type === 'connected') {
      const epoch = event.payload?.epoch;
      if (typeof epoch === 'number') {
        this.wrapperEpochs.set(sessionId, epoch);
      }
      return;
    }

    if (event.type !== 'permission_request') return;
    const payload = event.payload ?? {};
    const options = (Array.isArray(payload.options) ? payload.options : []).map((option: any) => ({
      optionId: option.optionId,
      label: option.name ?? option.optionId,
      description: option.description,
    }));
    const requestId = payload.requestId;
    const resolve = async (outcome: any): Promise<void> => {
      try {
        const token = await this.localAgent.getToken();
        const epoch = this.wrapperEpochs.get(sessionId);
        await fetch(`${this.localAgent.getBaseUrl()}/api/acp/stream/${encodeURIComponent(sessionId)}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            // ...(this.wrapperClientId ? { 'X-Client-Id': this.wrapperClientId } : {}),
            // ...(epoch !== undefined ? { 'X-Epoch': String(epoch) } : {}),
          },
          body: JSON.stringify({ method: 'permission', params: { requestId, outcome } }),
        });
      } catch (error) {
        console.error('[Collab] Failed to answer permission request:', error);
      }
    };
    window.dispatchEvent(
      new CustomEvent('acp-permission-request', {
        detail: { requestId, params: { ...payload, options }, resolve },
      }),
    );
  }

  // ==========================================================================
  // Messaging
  // ==========================================================================

  /** Whether the current mode has a dispatchable payload. */
  canSend(draft: string): boolean {
    if (this.sending()) return false;
    if (draft.trim()) return true;
    return this.collabMode() === 'parallel' && this.parallelSubTasks().some(subTask => subTask.prompt.trim());
  }

  async send(text: string): Promise<void> {
    const space = this.space();
    const trimmed = text.trim();
    if (!space || this.sending()) return;
    const parallelReady = this.collabMode() === 'parallel' && this.parallelSubTasks().some(subTask => subTask.prompt.trim());
    if (!trimmed && !parallelReady) return;

    this.error.set(null);
    if (trimmed) this.appendMessage({ role: 'user', text: trimmed });
    this.sending.set(true);

    const controller = new AbortController();
    this.currentAbort = controller;

    // Each artifact (turn / sub-task) maps to its own transcript message.
    const messagesByArtifact = new Map<string, string>();
    // Turn → transcript message id (so per-turn status updates land on the
    // same message the turn's artifact streams into).
    // Parallel mode: several sub-tasks share the same `turn`, so the key also
    // carries `subTaskId` — otherwise concurrent sub-tasks would collapse into
    // a single bubble and overwrite each other.
    const turnMessageIds = new Map<string, string>();
    // Transcript message currently streaming per turn key; finalized per key so
    // finishing one parallel sub-task does not close the others.
    const streamingByKey = new Map<string, string>();
    let activeId: string | null = null;
    let statusId: string | null = null;

    const finalize = (id: string | null, status: CollabMessageStatus, statusText?: string): void => {
      if (!id) return;
      const current = this.messageById(id);
      if (current?.status === 'streaming') {
        this.updateMessage(id, statusText ? { status, statusText } : { status });
      }
    };

    /** Closes every still-streaming message (used at stream end / on error). */
    const finalizeAll = (status: CollabMessageStatus, statusText?: string): void => {
      for (const id of streamingByKey.values()) {
        finalize(id, status, statusText);
      }
      streamingByKey.clear();
    };

    /** Turn + sub-task identity of a message (sub-task id may be undefined). */
    const streamKey = (turn: number, fields: Partial<CollabMessage>): string =>
      `${turn}::${fields.subTaskId ?? ''}`;

    const ensureTurnMessage = (turn: number, fields: Partial<CollabMessage>): string => {
      const key = streamKey(turn, fields);
      const existing = turnMessageIds.get(key);
      if (existing) return existing;
      // Starting a new stream for this sub-task: close out its previous
      // streaming message (per key — other parallel sub-tasks keep streaming).
      finalize(streamingByKey.get(key) ?? null, 'completed');
      streamingByKey.delete(key);
      let id: string;
      if (statusId && activeId === null && streamingByKey.size === 0) {
        // Reuse the routing status message for the first stream.
        id = statusId;
        this.updateMessage(id, { turn, ...fields, status: 'streaming' });
        statusId = null;
      } else {
        id = this.appendMessage({ role: 'agent', text: '', status: 'streaming', turn, ...fields }).id;
      }
      turnMessageIds.set(key, id);
      streamingByKey.set(key, id);
      return id;
    };

    try {
      const client = await this.createOrchestratorClient();
      const request = this.buildRequest(space, trimmed);

      const stream = client.sendMessageStream(request, { signal: controller.signal });
      for await (const response of stream) {
        const event = response as StreamResponse;
        const payload = event.payload;
        if (!payload) continue;

        switch (payload.$case) {
          case 'task':
            break;

          case 'statusUpdate': {
            const status = payload.value.status;
            const state = status?.state;
            const statusText = status?.message ? this.extractMessageText(status.message) : '';
            const mapped = this.mapState(state);
            const meta = (payload.value.metadata ?? {}) as Record<string, any>;
            const fields = this.metaToFields(meta);
            const turn = typeof meta['turn'] === 'number' ? (meta['turn'] as number) : undefined;

            let targetId: string | null;
            if (turn !== undefined) {
              targetId = ensureTurnMessage(turn, fields);
            } else {
              targetId = activeId ?? statusId;
              if (!targetId && (statusText || (state !== undefined && state !== TaskState.TASK_STATE_SUBMITTED))) {
                targetId = this.appendMessage({
                  role: 'agent',
                  text: '',
                  status: mapped ?? 'streaming',
                  statusText: statusText || undefined,
                }).id;
                statusId = targetId;
              }
            }
            if (targetId) {
              if (statusText) this.updateMessage(targetId, { statusText });
              if (mapped) {
                this.updateMessage(targetId, statusText ? { status: mapped, statusText } : { status: mapped });
              }
            }
            break;
          }

          case 'artifactUpdate': {
            const artifact = payload.value.artifact;
            if (!artifact) break;
            const artifactId = artifact.artifactId || 'default';
            const meta = (artifact.metadata ?? {}) as Record<string, any>;
            const fields = this.metaToFields(meta);
            const turn = typeof meta['turn'] === 'number' ? (meta['turn'] as number) : undefined;

            let id = messagesByArtifact.get(artifactId);
            if (!id) {
              if (turn !== undefined) {
                // Reuse the message opened by this turn's status updates.
                id = ensureTurnMessage(turn, fields);
                this.updateMessage(id, { ...fields, status: 'streaming' });
              } else if (statusId && activeId === null) {
                // Adopt the pending status-only message on the first turn.
                id = statusId;
                this.updateMessage(id, { ...fields, status: 'streaming' });
                statusId = null;
              } else {
                id = this.appendMessage({ role: 'agent', text: '', status: 'streaming', ...fields }).id;
              }
              messagesByArtifact.set(artifactId, id);
            }
            activeId = id;

            const chunk = this.extractArtifactText(artifact.parts);
            if (chunk) this.updateMessage(id, { text: chunk }, true);

            if (payload.value.lastChunk) {
              const current = this.messageById(id);
              if (current?.status === 'streaming') this.updateMessage(id, { status: 'completed' });
            }
            break;
          }

          case 'message': {
            const direct = this.extractMessageText(payload.value);
            if (direct) {
              const id: string =
                activeId ?? statusId ?? this.appendMessage({ role: 'agent', text: '', status: 'streaming' }).id;
              this.updateMessage(id, { text: direct }, true);
              activeId = id;
            }
            break;
          }
        }
      }

      finalizeAll('completed');
      if (!activeId && !statusId && streamingByKey.size === 0) {
        this.appendMessage({ role: 'agent', text: '', status: 'completed', statusText: '' });
      }
    } catch (error) {
      const aborted = controller.signal.aborted;
      const message = (error as Error)?.message || 'Stream failed';
      const status = aborted ? 'canceled' : 'failed';
      const statusText = aborted ? 'Canceled' : message;
      const hadStreams = streamingByKey.size > 0;
      finalizeAll(status, statusText);
      if (hadStreams) {
        // Non-streaming tracked ids (e.g. the routing status bubble) also land.
        const id = activeId ?? statusId;
        const current = id ? this.messageById(id) : null;
        if (current?.status === 'streaming') {
          this.updateMessage(id!, { status, statusText });
        }
      } else {
        const id = activeId ?? statusId;
        if (id) {
          this.updateMessage(id, { status, statusText });
        } else if (!aborted) {
          this.error.set(message);
        }
      }
    } finally {
      this.sending.set(false);
      this.currentAbort = null;
    }
  }

  cancel(): void {
    this.abortStream();
  }

  private abortStream(): void {
    if (this.currentAbort) {
      this.currentAbort.abort();
      this.currentAbort = null;
    }
  }

  // ==========================================================================
  // A2A client plumbing
  // ==========================================================================

  private async createOrchestratorClient(): Promise<Client> {
    const token = await this.localAgent.getToken();
    const authFetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const headers = new Headers(init?.headers);
      headers.set('Authorization', `Bearer ${token}`);
      return fetch(input, { ...init, headers });
    }) as typeof fetch;

    const factory = new ClientFactory(
      ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
        transports: [new JsonRpcTransportFactory({ fetchImpl: authFetch })],
        cardResolver: new DefaultAgentCardResolver({ fetchImpl: authFetch }),
      }),
    );
    // createFromUrl resolves `base + /.well-known/agent-card.json`, so the
    // base URL must carry a trailing slash to stay under the orchestrator path.
    return factory.createFromUrl(`${this.localAgent.getBaseUrl()}/${ORCHESTRATOR_PATH}`);
  }

  private buildRequest(space: CollabSpace, prompt: string): SendMessageRequest {
    const participantIds = space.agents.map(agent => agent.id);
    const mode = this.collabMode();
    const collab: Record<string, unknown> = {
      spaceId: space.spaceId,
      participantIds,
      agentIds: space.agents.map(agent => agent.agentId),
      cwd: space.cwd,
    };

    // Explicit routing only applies to 01 单点协作; the other modes decide
    // their entry themselves (pipeline order / sub-task targets / broadcast claim).
    if (mode === 'single') {
      collab['targetParticipantId'] = this.targetParticipantId() || undefined;
      collab['targetRole'] = this.targetRole() || undefined;
    }

    if (mode === 'pipeline') {
      const order = this.pipelineOrder().length ? this.pipelineOrder() : participantIds;
      collab['pipeline'] = {
        mode: this.pipelineMode(),
        order,
        orchestratorAgentId: this.orchestratorId() || undefined,
        maxTurns: this.clampTurns(this.pipelineMaxTurns()),
      };
    } else if (mode === 'parallel') {
      const subTasks = this.parallelSubTasks()
        .filter(subTask => subTask.prompt.trim())
        .map(subTask => ({
          id: subTask.id,
          prompt: subTask.prompt.trim(),
          targetAgentId: subTask.targetParticipantId || undefined,
          targetRole: subTask.targetRole || undefined,
        }));
      collab['parallel'] = {
        enabled: true,
        subTasks,
        aggregatorAgentId: this.parallelAggregator() || undefined,
        maxConcurrency: this.parallelMaxConcurrency(),
      };
    } else if (mode === 'voluntary') {
      collab['voluntary'] = {
        enabled: true,
        maxTurns: this.clampTurns(this.voluntaryMaxTurns()),
        conflictResolution: this.voluntaryConflict(),
        priorityOrder: participantIds,
      };
    }

    return {
      tenant: '',
      message: {
        messageId: crypto.randomUUID(),
        contextId: '',
        taskId: '',
        role: Role.ROLE_USER,
        parts: [{ content: { $case: 'text', value: prompt }, metadata: undefined, filename: '', mediaType: 'text/plain' }],
        metadata: { collab },
        extensions: [],
        referenceTaskIds: [],
      },
      configuration: undefined,
      metadata: { collab },
    };
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  private appendMessage(partial: Omit<CollabMessage, 'id' | 'time'>): CollabMessage {
    const message: CollabMessage = {
      id: `collab-${++this.messageSeq}`,
      time: Date.now(),
      ...partial,
    };
    this.messages.update(list => [...list, message]);
    return message;
  }

  private messageById(id: string): CollabMessage | undefined {
    return this.messages().find(message => message.id === id);
  }

  private updateMessage(id: string, patch: Partial<CollabMessage>, appendText = false): void {
    this.messages.update(list =>
      list.map(message => {
        if (message.id !== id) return message;
        return {
          ...message,
          ...patch,
          text: appendText && patch.text ? message.text + patch.text : (patch.text ?? message.text),
        };
      }),
    );
  }

  /** Maps A2A artifact/status metadata onto transcript message fields. */
  private metaToFields(meta: Record<string, any>): Partial<CollabMessage> {
    const fields: Partial<CollabMessage> = {};
    if (typeof meta['participantId'] === 'string') fields.participantId = meta['participantId'];
    if (typeof meta['agentId'] === 'string') {
      fields.agentId = meta['agentId'];
      fields.agentLabel = this.agentLabelOf(meta['agentId']);
    }
    if (typeof meta['sessionId'] === 'string') fields.sessionId = meta['sessionId'];
    if (typeof meta['role'] === 'string') fields.agentRole = meta['role'];
    if (typeof meta['turn'] === 'number') fields.turn = meta['turn'];
    if (typeof meta['prevParticipantId'] === 'string') fields.prevParticipantId = meta['prevParticipantId'];
    if (typeof meta['prevSessionId'] === 'string') fields.prevSessionId = meta['prevSessionId'];
    if (typeof meta['claimReason'] === 'string') fields.claimReason = meta['claimReason'];
    if (Array.isArray(meta['relinquishedBy'])) fields.relinquishedBy = meta['relinquishedBy'].map(String);
    if (typeof meta['subTaskId'] === 'string') fields.subTaskId = meta['subTaskId'];
    return fields;
  }

  agentLabelOf(agentId: string | undefined): string {
    if (!agentId) return '';
    return this.availableAgents().find(agent => agent.id === agentId)?.name ?? agentId;
  }

  /** Human label of a participating session (agent name + role). */
  participantLabel(participantId: string | undefined): string {
    if (!participantId) return '';
    const participant = this.space()?.agents.find(agent => agent.id === participantId);
    if (!participant) return participantId;
    const name = this.agentLabelOf(participant.agentId);
    return participant.role ? `${name}·${participant.role}` : name;
  }

  /** Resolves the participant label owning an ACP session id. */
  participantLabelBySession(sessionId: string | undefined): string {
    if (!sessionId) return '';
    const participant = this.space()?.agents.find(agent => agent.sessionId === sessionId);
    return participant ? this.participantLabel(participant.id) : sessionId;
  }

  /**
   * Resolves the ACP session a transcript message came from, so the detail
   * panel can load that session's full history.
   *
   * Preference: the message's own `sessionId` (collaboration trace), then the
   * participant bound to it (routing / status messages may lack the trace).
   * Returns null for messages that are not backed by a session (e.g. the user's
   * own prompts).
   */
  sessionTargetOf(message: CollabMessage): CollabSessionTarget | null {
    const space = this.space();
    const participant =
      space?.agents.find(agent => agent.id === message.participantId) ??
      space?.agents.find(agent => agent.sessionId === message.sessionId);
    const sessionId = message.sessionId ?? participant?.sessionId;
    if (!sessionId) return null;

    const owner = space?.agents.find(agent => agent.sessionId === sessionId) ?? participant;
    const label =
      (owner ? this.participantLabel(owner.id) : '') ||
      this.agentLabelOf(message.agentId) ||
      sessionId;

    return {
      sessionId,
      agentId: owner?.agentId ?? message.agentId,
      cwd: space?.cwd,
      label,
    };
  }

  private mapState(state: TaskState | undefined): CollabMessageStatus | undefined {
    switch (state) {
      case TaskState.TASK_STATE_COMPLETED:
        return 'completed';
      case TaskState.TASK_STATE_FAILED:
        return 'failed';
      case TaskState.TASK_STATE_CANCELED:
        return 'canceled';
      default:
        return undefined;
    }
  }

  private extractMessageText(message: any): string {
    return (message?.parts ?? [])
      .map((part: any) => (part?.content?.$case === 'text' ? String(part.content.value) : ''))
      .filter((text: string) => text.length > 0)
      .join('');
  }

  private extractArtifactText(parts: any[] | undefined): string {
    return (parts ?? [])
      .map(part => (part?.content?.$case === 'text' ? String(part.content.value) : ''))
      .filter(text => text.length > 0)
      .join('');
  }
}
