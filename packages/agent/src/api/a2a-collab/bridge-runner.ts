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
import type { CollabSpaceStore } from './spaces.js';

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
 * Picks the target agent: explicit `targetAgentId` → keyword match against
 * the prompt → first agent of the space.
 */
function resolveTargetAgent(
  collab: CollabMetadata,
  promptText: string,
  forcedAgentId?: string,
): string | undefined {
  if (forcedAgentId) return forcedAgentId;

  const agentIds = (collab.agentIds ?? []).map(String).filter(Boolean);
  if (collab.targetAgentId && (agentIds.length === 0 || agentIds.includes(collab.targetAgentId))) {
    return collab.targetAgentId;
  }
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
 *  2. resolve the target agent from `metadata.collab`,
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
  ) {}

  cancel = async (taskId: string): Promise<void> => {
    const run = this.active.get(taskId);
    if (!run) return;
    run.cancelled = true;
    if (run.wrapperId) {
      await this.sessionManager.cancelPrompt(run.wrapperId);
    }
  };

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

      const targetAgentId = resolveTargetAgent(collab, promptText, input.forcedAgentId);
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
      setStatus(TaskState.TASK_STATE_WORKING, `已路由到 ${label}，正在调用…`);

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
