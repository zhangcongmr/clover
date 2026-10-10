import { Injectable, inject, signal } from '@angular/core';
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
import type { ConfigOption } from '../../../shared/acp/acp.model';
import type { ProjectInfo } from '../../../shared/acp/acp.service';

/** One wrapper session inside a collaboration space (backend response). */
export interface CollabSpaceAgent {
  agentId: string;
  sessionId: string;
  /** mode/model selectors from session/new; live values updated via set_config_option. */
  configOptions?: ConfigOption[];
}

export interface CollabSpace {
  spaceId: string;
  cwd: string;
  agents: CollabSpaceAgent[];
  /** Member agent that routes each prompt to the answering agent (optional). */
  orchestratorAgentId?: string | null;
}

export type CollabMessageStatus = 'streaming' | 'completed' | 'failed' | 'canceled';

export interface CollabMessage {
  id: string;
  role: 'user' | 'agent';
  text: string;
  agentId?: string;
  agentLabel?: string;
  status?: CollabMessageStatus;
  statusText?: string;
  time: number;
}

const ORCHESTRATOR_PATH = 'api/a2a/orchestrator/';

@Injectable({ providedIn: 'root' })
export class CollabService {
  private localAgent = inject(LocalAgentService);
  private sseService = inject(AcpSseService);

  /** Whether the collaboration panel replaces the ACP panel. */
  readonly panelOpen = signal(false);
  readonly project = signal<ProjectInfo | null>(null);
  /** All agents reported by the backend registry (unfiltered). */
  readonly availableAgents = signal<AgentStatusInfo[]>([]);
  /** Agents chosen for the space (before it is created). */
  readonly selectedAgentIds = signal<string[]>([]);
  /** Chosen orchestrator agent (must be a selected agent; empty = none). */
  readonly orchestratorAgentId = signal<string>('');
  readonly space = signal<CollabSpace | null>(null);
  readonly messages = signal<CollabMessage[]>([]);
  readonly sending = signal(false);
  readonly creating = signal(false);
  readonly error = signal<string | null>(null);
  /** Explicit routing target; empty string = auto (keyword / first agent). */
  readonly targetAgentId = signal('');

  private wrapperSources = new Map<string, EventSource>();
  private currentAbort: AbortController | null = null;
  private messageSeq = 0;

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

  toggleAgent(agentId: string): void {
    this.selectedAgentIds.update(ids =>
      ids.includes(agentId) ? ids.filter(id => id !== agentId) : [...ids, agentId],
    );
    if (!this.selectedAgentIds().includes(agentId) && this.orchestratorAgentId() === agentId) {
      this.orchestratorAgentId.set('');
    }
  }

  /** Toggles the orchestrator role for a selected agent (clicking again clears it). */
  setOrchestrator(agentId: string): void {
    if (!this.selectedAgentIds().includes(agentId)) return;
    this.orchestratorAgentId.update(current => (current === agentId ? '' : agentId));
  }

  async createSpace(): Promise<void> {
    const project = this.project();
    const agentIds = this.selectedAgentIds();
    if (!project || agentIds.length === 0 || this.creating() || this.space()) return;

    this.creating.set(true);
    this.error.set(null);
    try {
      const token = await this.localAgent.getToken();
      const res = await fetch(`${this.localAgent.getBaseUrl()}/api/a2a/collab/spaces`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          cwd: project.path,
          agentIds,
          orchestratorAgentId: this.orchestratorAgentId() || undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.message || `Create space failed (${res.status})`);
      }
      const space: CollabSpace = {
        spaceId: data.spaceId,
        cwd: data.cwd,
        agents: Array.isArray(data.agents) ? data.agents : [],
        orchestratorAgentId: data.orchestratorAgentId ?? null,
      };
      this.space.set(space);
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
  // Agent config (mode/model) — session-level state applied to later prompts
  // ==========================================================================

  /**
   * Applies a config option (mode/model/…) to one space agent's ACP session.
   * The new value takes effect on that agent's next prompt; updating between
   * turns is race-free because prompts are serialized per wrapper (FIFO lock).
   */
  async setAgentConfigOption(
    agentId: string,
    configId: string,
    type: 'id' | 'boolean',
    value: string | boolean,
  ): Promise<void> {
    const space = this.space();
    const agent = space?.agents.find(a => a.agentId === agentId);
    if (!space || !agent) return;

    try {
      const result = await this.sseService.setConfigOption(agent.sessionId, configId, type, value);
      const nextOptions = result?.configOptions;
      if (Array.isArray(nextOptions)) {
        this.space.update(current =>
          current
            ? {
                ...current,
                agents: current.agents.map(a =>
                  a.agentId === agentId ? { ...a, configOptions: nextOptions as ConfigOption[] } : a,
                ),
              }
            : current,
        );
      }
    } catch (error) {
      console.error(`[Collab] Failed to set ${configId} on ${agentId}:`, error);
      this.error.set((error as Error)?.message || `Failed to update ${configId}`);
    }
  }

  // ==========================================================================
  // Wrapper SSE (permission bypass)
  // ==========================================================================

  private openWrapperSse(space: CollabSpace, token: string): void {
    this.closeWrapperSse();
    const base = this.localAgent.getBaseUrl();
    for (const { sessionId } of space.agents) {
      const source = new EventSource(`${base}/api/acp/events/${sessionId}?token=${encodeURIComponent(token)}`);
      source.onmessage = event => {
        try {
          this.handleWrapperEvent(sessionId, JSON.parse(event.data));
        } catch (error) {
          console.error('[Collab] Failed to parse wrapper event:', error);
        }
      };
      // EventSource reconnects automatically; ignore transient errors.
      source.onerror = () => undefined;
      this.wrapperSources.set(sessionId, source);
    }
  }

  private closeWrapperSse(): void {
    for (const source of this.wrapperSources.values()) {
      source.close();
    }
    this.wrapperSources.clear();
  }

  /**
   * Mirrors `AcpService.handlePermissionRequest`: dispatches the shared
   * `acp-permission-request` window event so the existing permission dialog
   * can answer through `/api/acp/permission` on the wrapper session.
   */
  private handleWrapperEvent(sessionId: string, event: { type?: string; payload?: any }): void {
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
        await fetch(`${this.localAgent.getBaseUrl()}/api/acp/permission`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ sessionId, requestId, outcome }),
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

  async send(text: string): Promise<void> {
    const space = this.space();
    const trimmed = text.trim();
    if (!space || !trimmed || this.sending()) return;

    this.error.set(null);
    this.appendMessage({ role: 'user', text: trimmed });
    this.sending.set(true);

    const controller = new AbortController();
    this.currentAbort = controller;

    let agentMessageId: string | null = null;
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
            if (!agentMessageId && (statusText || state !== TaskState.TASK_STATE_SUBMITTED)) {
              agentMessageId = this.appendMessage({
                role: 'agent',
                text: '',
                status: 'streaming',
                statusText: statusText || undefined,
              }).id;
            }
            if (agentMessageId && statusText) {
              this.updateMessage(agentMessageId, { statusText });
            }
            const mapped = this.mapState(state);
            if (agentMessageId && mapped) {
              this.updateMessage(agentMessageId, statusText ? { status: mapped, statusText } : { status: mapped });
            }
            break;
          }

          case 'artifactUpdate': {
            const artifact = payload.value.artifact;
            if (!artifact) break;
            const chunk = this.extractArtifactText(artifact.parts);
            const initialAgentId = artifact.metadata?.['agentId'];
            if (!agentMessageId) {
              agentMessageId = this.appendMessage({
                role: 'agent',
                text: '',
                agentId: typeof initialAgentId === 'string' ? initialAgentId : undefined,
                status: 'streaming',
              }).id;
            }
            if (chunk) {
              this.updateMessage(agentMessageId, { text: chunk }, true);
            }
            const artifactAgentId = artifact.metadata?.['agentId'];
            if (typeof artifactAgentId === 'string' && !this.messageById(agentMessageId)?.agentId) {
              this.updateMessage(agentMessageId, { agentId: artifactAgentId });
            }
            break;
          }

          case 'message': {
            const direct = this.extractMessageText(payload.value);
            if (direct) {
              if (!agentMessageId) {
                agentMessageId = this.appendMessage({ role: 'agent', text: direct, status: 'completed' }).id;
              } else {
                this.updateMessage(agentMessageId, { text: direct }, true);
              }
            }
            break;
          }
        }
      }

      if (agentMessageId) {
        const current = this.messageById(agentMessageId);
        if (current?.status === 'streaming') {
          this.updateMessage(agentMessageId, { status: 'completed' });
        }
      } else {
        this.appendMessage({ role: 'agent', text: '', status: 'completed', statusText: '' });
      }
    } catch (error) {
      const aborted = controller.signal.aborted;
      const message = (error as Error)?.message || 'Stream failed';
      if (agentMessageId) {
        this.updateMessage(agentMessageId, {
          status: aborted ? 'canceled' : 'failed',
          statusText: aborted ? 'Canceled' : message,
        });
      } else if (!aborted) {
        this.error.set(message);
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
    const collab: Record<string, unknown> = {
      spaceId: space.spaceId,
      agentIds: space.agents.map(agent => agent.agentId),
      cwd: space.cwd,
      targetAgentId: this.targetAgentId() || undefined,
    };
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
