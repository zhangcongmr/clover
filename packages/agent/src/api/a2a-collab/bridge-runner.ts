import {
  AgentEvent,
  type ExecutionEventBus,
} from '@a2a-js/sdk/server';
import {
  Role,
  TaskState,
  type Message,
  type Part,
  type Task,
} from '@a2a-js/sdk';
import type * as acp from '@agentclientprotocol/sdk';
import type { AcpSessionManager, AcpWrapperEvent } from '../../acp/session-manager.js';
import { AVAILABLE_AGENTS } from '../../acp/acp-agent.types.js';
import type { CollabSpaceStore, CollabSpace } from './spaces.js';

/** `metadata.collab` contract shared with the frontend. */
export interface CollabMetadata {
  spaceId?: string;
  agentIds?: string[];
  targetAgentId?: string;
  cwd?: string;
}

export interface RunTaskInput {
  taskId: string;
  contextId: string;
  /** Existing task when the message continues a previous turn. */
  snapshot?: Task;
  userMessage: Message;
  /** `SendMessageRequest.metadata` (top-level). */
  requestMetadata?: Record<string, any>;
  eventBus: ExecutionEventBus;
  /** Forces the target agent (used by the per-agent A2A servers). */
  forcedAgentId?: string;
}

interface ActiveRun {
  wrapperId?: string;
  cancelled: boolean;
}

export class BridgeTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Bridge prompt timed out after ${timeoutMs}ms`);
    this.name = 'BridgeTimeoutError';
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function textPart(value: string): Part {
  return {
    content: { $case: 'text', value },
    metadata: undefined,
    filename: '',
    mediaType: 'text/plain',
  };
}

function extractText(message: Message): string {
  return (message.parts ?? [])
    .map(part => (part.content?.$case === 'text' ? part.content.value : ''))
    .filter(text => text.length > 0)
    .join('\n')
    .trim();
}

/** Pulls an `agent_message_chunk` delta out of a wrapper event. */
function extractAgentChunk(event: AcpWrapperEvent): string | undefined {
  if (event.type !== 'session_update') return undefined;
  const update = event.payload?.update;
  if (update?.sessionUpdate !== 'agent_message_chunk') return undefined;
  const content = update.content;
  if (content && typeof content.text === 'string') return content.text;
  return undefined;
}

function agentLabel(agentId: string): string {
  return AVAILABLE_AGENTS.find(agent => agent.id === agentId)?.name ?? agentId;
}

function readCollabMetadata(input: RunTaskInput): CollabMetadata | undefined {
  const fromRequest = input.requestMetadata?.['collab'];
  const fromMessage = input.userMessage.metadata?.['collab'];
  const md = fromRequest ?? fromMessage;
  if (md && typeof md === 'object') return md as CollabMetadata;
  return undefined;
}

/**
 * Deterministic tiers of target resolution:
 * explicit `targetAgentId` → first agent of the space.
 * (Forced ids and the orchestrator LLM step are handled by the caller.)
 */
function explicitTarget(collab: CollabMetadata, forcedAgentId?: string): string | undefined {
  if (forcedAgentId) return forcedAgentId;

  const agentIds = (collab.agentIds ?? []).map(String).filter(Boolean);
  if (collab.targetAgentId && (agentIds.length === 0 || agentIds.includes(collab.targetAgentId))) {
    return collab.targetAgentId;
  }
  return undefined;
}

/**
 * Fallback tiers: keyword match against the prompt → first agent of the space.
 */
function keywordTarget(collab: CollabMetadata, promptText: string): string | undefined {
  const agentIds = (collab.agentIds ?? []).map(String).filter(Boolean);
  if (agentIds.length === 0) return undefined;

  const normalized = promptText.toLowerCase();
  for (const agentId of agentIds) {
    const config = AVAILABLE_AGENTS.find(agent => agent.id === agentId);
    if (!config) continue;
    if (normalized.includes(agentId.toLowerCase()) || normalized.includes(config.name.toLowerCase())) {
      return agentId;
    }
  }
  return agentIds[0];
}

/** Routing instruction sent to the orchestrator agent's wrapper session. */
function buildRoutingPrompt(memberIds: string[], question: string): string {
  const catalog = memberIds
    .map(id => {
      const config = AVAILABLE_AGENTS.find(agent => agent.id === id);
      const description = config?.description ? ` — ${config.description}` : '';
      return `- ${id}: ${config?.name ?? id}${description}`;
    })
    .join('\n');
  return [
    'You are the orchestrator of a multi-agent collaboration.',
    'Decide which single agent should answer the user question below.',
    '',
    'Available agents:',
    catalog,
    '',
    'Rules:',
    '- Reply with ONLY a JSON object, no markdown fences and no explanation:',
    '  {"agentId":"<id>"}',
    `- agentId must be exactly one of: ${memberIds.join(', ')}`,
    '- You may pick yourself if you are the best fit.',
    '- Pick the single best fit; never list multiple agents.',
    '',
    'User question:',
    question,
  ].join('\n');
}

/**
 * Extracts a target agent from the orchestrator's reply.
 *  1. strict `{"agentId":"..."}` field, 2. exactly one known id/name
 * mentioned anywhere in the reply. Ambiguous or empty replies → undefined
 * so the caller can fall back to rule-based routing.
 */
function parseRoutingReply(reply: string, memberIds: string[]): string | undefined {
  const text = reply.trim();
  if (!text) return undefined;

  const known = new Map<string, string>();
  for (const id of memberIds) {
    known.set(id.toLowerCase(), id);
    const config = AVAILABLE_AGENTS.find(agent => agent.id === id);
    if (config?.name) known.set(config.name.toLowerCase(), id);
  }

  const match = text.match(/"agentId"\s*:\s*"([^"]+)"/i);
  if (match) {
    const hit = known.get(match[1].trim().toLowerCase());
    if (hit) return hit;
  }

  const lower = text.toLowerCase();
  const found = new Set<string>();
  for (const [key, id] of known) {
    if (lower.includes(key)) found.add(id);
  }
  return found.size === 1 ? [...found][0] : undefined;
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => Promise<unknown>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      Promise.resolve(onTimeout()).catch(() => undefined);
      reject(new BridgeTimeoutError(timeoutMs));
    }, timeoutMs);
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Shared A2A → ACP bridge used by both the orchestrator server and the
 * per-agent A2A servers:
 *
 *  1. publish the task snapshot (A2A streams must start with a Task),
 *  2. resolve the target agent: forced/explicit → orchestrator LLM routing →
 *     keyword/first-member rules,
 *  3. serialize prompts per wrapper session (ACP allows one prompt at a time),
 *  4. run the ACP prompt, forwarding `agent_message_chunk` events as
 *     appending A2A artifact updates,
 *  5. publish the terminal status (COMPLETED / CANCELED / FAILED).
 */
export class BridgeRunner {
  /** Per-wrapper FIFO: serializes prompts targeting the same agent session. */
  private locks: Map<string, Promise<void>> = new Map();
  private active: Map<string, ActiveRun> = new Map();

  constructor(
    private readonly sessionManager: AcpSessionManager,
    private readonly spaces: CollabSpaceStore,
    private readonly timeoutMs: number,
    private readonly routeTimeoutMs: number,
  ) {}

  cancel = async (taskId: string): Promise<void> => {
    const run = this.active.get(taskId);
    if (!run) return;
    run.cancelled = true;
    if (run.wrapperId) {
      await this.sessionManager.cancelPrompt(run.wrapperId);
    }
  };

  /**
   * Asks the space's orchestrator agent (an ordinary ACP agent session) which
   * member should answer the prompt. Returns the chosen agent id, or
   * `undefined` on parse failure / timeout / cancel so the caller can fall
   * back to rule-based routing. The orchestrator may choose itself.
   */
  private async routeViaOrchestrator(
    runState: ActiveRun,
    space: CollabSpace,
    promptText: string,
    setStatus: (state: TaskState, text?: string) => void,
  ): Promise<string | undefined> {
    const orchestratorAgentId = space.orchestratorAgentId;
    if (!orchestratorAgentId) return undefined;
    const wrapperId = space.wrappers.get(orchestratorAgentId);
    if (!wrapperId) return undefined;

    setStatus(TaskState.TASK_STATE_WORKING, 'Orchestrator 正在选择目标 Agent…');

    let reply = '';
    try {
      await this.withLock(wrapperId, async () => {
        if (runState.cancelled) return;
        runState.wrapperId = wrapperId;
        try {
          await this.sessionManager.ensureAgentSession(wrapperId);
          await withTimeout(
            this.sessionManager.promptAndWait(
              wrapperId,
              [{ type: 'text', text: buildRoutingPrompt(space.agentIds, promptText) }] as acp.ContentBlock[],
              event => {
                const delta = extractAgentChunk(event);
                if (delta) reply += delta;
              },
            ),
            this.routeTimeoutMs,
            () => this.sessionManager.cancelPrompt(wrapperId),
          );
        } finally {
          runState.wrapperId = undefined;
        }
      });
    } catch (error) {
      console.warn('[A2A Collab] Orchestrator routing failed, falling back to rules:', error);
      return undefined;
    }

    if (runState.cancelled) return undefined;

    const target = parseRoutingReply(reply, space.agentIds);
    if (target) {
      console.log(`[A2A Collab] Orchestrator selected ${target} for: ${promptText.slice(0, 120)}`);
      return target;
    }
    console.warn('[A2A Collab] Orchestrator reply unparsable, falling back to rules:', reply.slice(0, 200));
    return undefined;
  }

  async run(input: RunTaskInput): Promise<void> {
    const { taskId, contextId, eventBus, userMessage } = input;
    const runState: ActiveRun = { cancelled: false };
    this.active.set(taskId, runState);

    const setStatus = (state: TaskState, text?: string): void => {
      eventBus.publish(
        AgentEvent.statusUpdate({
          taskId,
          contextId,
          status: {
            state,
            message: text
              ? {
                  role: Role.ROLE_AGENT,
                  messageId: `status-${taskId}-${Date.now()}`,
                  parts: [textPart(text)],
                  taskId,
                  contextId,
                  extensions: [],
                  metadata: {},
                  referenceTaskIds: [],
                }
              : undefined,
            timestamp: nowIso(),
          },
          metadata: undefined,
        }),
      );
    };

    try {
      // 1. Streaming turns must begin with a Task event.
      const snapshot: Task = input.snapshot ?? {
        id: taskId,
        contextId,
        status: {
          state: TaskState.TASK_STATE_SUBMITTED,
          message: undefined,
          timestamp: nowIso(),
        },
        artifacts: [],
        history: [userMessage],
        metadata: userMessage.metadata ?? {},
      };
      eventBus.publish(AgentEvent.task(snapshot));

      const promptText = extractText(userMessage);
      if (!promptText) {
        setStatus(TaskState.TASK_STATE_FAILED, '请发送文本内容作为协作任务。');
        return;
      }

      setStatus(TaskState.TASK_STATE_WORKING, '正在选择目标 Agent…');
      if (runState.cancelled) {
        setStatus(TaskState.TASK_STATE_CANCELED, '任务已取消');
        return;
      }

      const collab = readCollabMetadata(input);
      if (!collab) {
        setStatus(
          TaskState.TASK_STATE_FAILED,
          '缺少协作空间信息（message.metadata.collab），请先创建协作空间。',
        );
        return;
      }

      const space = this.spaces.get(collab.spaceId);
      if (!space) {
        setStatus(TaskState.TASK_STATE_FAILED, '协作空间不存在或已关闭，请重新创建协作空间。');
        return;
      }

      let targetAgentId = explicitTarget(collab, input.forcedAgentId);
      let routedByOrchestrator = false;
      if (!targetAgentId && space.orchestratorAgentId) {
        const routed = await this.routeViaOrchestrator(runState, space, promptText, setStatus);
        if (runState.cancelled) {
          setStatus(TaskState.TASK_STATE_CANCELED, '任务已取消');
          return;
        }
        if (routed) {
          targetAgentId = routed;
          routedByOrchestrator = true;
        } else {
          setStatus(TaskState.TASK_STATE_WORKING, 'Orchestrator 路由未命中，改用规则路由…');
        }
      }
      if (!targetAgentId) {
        targetAgentId = keywordTarget(collab, promptText);
      }
      if (!targetAgentId) {
        setStatus(
          TaskState.TASK_STATE_FAILED,
          '无法确定目标 Agent：请指定 metadata.collab.targetAgentId，或在协作空间中选择 Agent。',
        );
        return;
      }

      const wrapperId = space.wrappers.get(targetAgentId);
      if (!wrapperId) {
        setStatus(TaskState.TASK_STATE_FAILED, `协作空间未包含 Agent「${targetAgentId}」。`);
        return;
      }

      const label = agentLabel(targetAgentId);
      setStatus(
        TaskState.TASK_STATE_WORKING,
        `${routedByOrchestrator ? 'Orchestrator 已选择' : '已路由到'} ${label}，正在调用…`,
      );

      const artifactId = `${taskId}-reply`;
      await this.withLock(wrapperId, async () => {
        if (runState.cancelled) {
          setStatus(TaskState.TASK_STATE_CANCELED, '任务已取消');
          return;
        }
        runState.wrapperId = wrapperId;

        let chunkPublished = false;
        const publishChunk = (delta: string): void => {
          eventBus.publish(
            AgentEvent.artifactUpdate({
              taskId,
              contextId,
              artifact: {
                artifactId,
                name: 'AgentReply',
                description: `${label} 的回复`,
                parts: [textPart(delta)],
                metadata: { agentId: targetAgentId },
                extensions: [],
              },
              append: chunkPublished,
              lastChunk: false,
              metadata: undefined,
            }),
          );
          chunkPublished = true;
        };

        try {
          await this.sessionManager.ensureAgentSession(wrapperId);

          const result = await withTimeout(
            this.sessionManager.promptAndWait(
              wrapperId,
              [{ type: 'text', text: promptText }] as acp.ContentBlock[],
              event => {
                const delta = extractAgentChunk(event);
                if (delta) publishChunk(delta);
              },
            ),
            this.timeoutMs,
            () => this.sessionManager.cancelPrompt(wrapperId),
          );

          if (runState.cancelled || result.stopReason === 'cancelled') {
            setStatus(TaskState.TASK_STATE_CANCELED, `${label} 已取消`);
            return;
          }

          if (chunkPublished) {
            // Close the artifact stream so clients can finalize assembly.
            eventBus.publish(
              AgentEvent.artifactUpdate({
                taskId,
                contextId,
                artifact: {
                  artifactId,
                  name: 'AgentReply',
                  description: `${label} 的回复`,
                  parts: [],
                  metadata: { agentId: targetAgentId },
                  extensions: [],
                },
                append: true,
                lastChunk: true,
                metadata: undefined,
              }),
            );
          }
          setStatus(TaskState.TASK_STATE_COMPLETED, `${label} 回复完成`);
        } catch (error) {
          const message =
            error instanceof BridgeTimeoutError
              ? `调用 ${label} 超时（${this.timeoutMs}ms）`
              : (error as Error).message;
          console.error(`[A2A Collab] Bridge task ${taskId} failed:`, error);
          setStatus(TaskState.TASK_STATE_FAILED, `${label} 调用失败：${message}`);
        } finally {
          runState.wrapperId = undefined;
        }
      });
    } finally {
      this.active.delete(taskId);
    }
  }

  private async withLock(key: string, fn: () => Promise<void>): Promise<void> {
    const tail = (this.locks.get(key) ?? Promise.resolve()).then(() => fn());
    // Chain guard never rejects so the queue survives failing tasks.
    const guard = tail.then(
      () => undefined,
      () => undefined,
    );
    this.locks.set(key, guard);
    try {
      await tail;
    } finally {
      if (this.locks.get(key) === guard) {
        this.locks.delete(key);
      }
    }
  }
}
