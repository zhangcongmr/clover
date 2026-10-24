import { logger } from '../../helpers/logger.js';
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
import type { AcpSessionManager, AcpSessionEvent } from '../../acp/session-manager.js';
import { AVAILABLE_AGENTS } from '../../acp/acp-agent.types.js';
import { memberIds, type CollabSpaceStore, type CollabSpace } from './spaces.js';

// ---------------------------------------------------------------------------
// metadata.collab contract shared with the frontend
// ---------------------------------------------------------------------------

/** 02 — pipeline / sequential collaboration. */
export interface CollabPipelineConfig {
  mode: 'static' | 'orchestrated';
  /**
   * static: ordered members. Each entry accepts a participantId, sessionId or
   * agentId. Defaults to the space declaration order.
   */
  order?: string[];
  /** orchestrated: member that decides the next session (participant/session/agent ref). */
  orchestratorAgentId?: string;
  /** Hard stop against A→B→A→B loops. */
  maxTurns?: number;
}

/** 03 — parallel division of labour. */
export interface CollabParallelSubTask {
  id: string;
  prompt: string;
  /** Target member (participant/session/agent ref). */
  targetAgentId?: string;
  targetRole?: string;
}

export interface CollabParallelConfig {
  enabled: boolean;
  subTasks: CollabParallelSubTask[];
  /** Optional member that merges all sub-task results (participant/session/agent ref). */
  aggregatorAgentId?: string;
  /** Upper bound on concurrent prompts. */
  maxConcurrency?: number;
}

/** 04 — voluntary claim / competitive handoff. */
export interface CollabVoluntaryConfig {
  enabled: boolean;
  maxTurns?: number;
  conflictResolution?: 'first-come' | 'priority' | 'random';
  /** priority mode: member order (participant/session/agent refs). */
  priorityOrder?: string[];
}

/** `metadata.collab` contract shared with the frontend. */
export interface CollabMetadata {
  spaceId?: string;
  /** Participant ids of the space (hint; the backend space is authoritative). */
  participantIds?: string[];
  /** Legacy agent-id hint (kept for compatibility). */
  agentIds?: string[];
  /** Target member; accepts a participantId, sessionId or agentId. */
  targetParticipantId?: string;
  /** Legacy alias of {@link targetParticipantId}. */
  targetAgentId?: string;
  /** 01 — route to the member whose session role matches this label. */
  targetRole?: string;
  cwd?: string;
  pipeline?: CollabPipelineConfig;
  parallel?: CollabParallelConfig;
  voluntary?: CollabVoluntaryConfig;
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
  /** ACP session id the run is currently prompting (for cancellation). */
  sessionId?: string;
  cancelled: boolean;
}

interface RunContext {
  taskId: string;
  contextId: string;
  eventBus: ExecutionEventBus;
  runState: ActiveRun;
  setStatus: (state: TaskState, text?: string, metadata?: Record<string, any>) => void;
}

/** One member taking over a voluntary-claim turn. */
interface MemberClaim {
  memberId: string;
  reason: string;
}

interface SubTaskResult {
  subTaskId: string;
  memberId: string;
  output: string;
  ok: boolean;
  error?: string;
}

// Loop / concurrency guard rails.
const DEFAULT_MAX_TURNS = 10;
const HARD_MAX_TURNS = 30;
const DEFAULT_MAX_CONCURRENCY = 4;
const HARD_MAX_CONCURRENCY = 8;
/** Keep handoff / responsibility prompts from ballooning. */
const CONTEXT_OUTPUT_MAX_LEN = 8000;

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

/** Pulls an `agent_message_chunk` delta out of an ACP session event. */
function extractAgentChunk(event: AcpSessionEvent): string | undefined {
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

/** Human label of a participating session (its bound agent's name). */
function memberLabel(space: CollabSpace, memberId: string): string {
  const info = space.members.get(memberId);
  return info ? agentLabel(info.agentId) : memberId;
}

function clampTurns(value: unknown, fallback = DEFAULT_MAX_TURNS): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.min(Math.floor(parsed), HARD_MAX_TURNS));
}

function clampConcurrency(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_CONCURRENCY;
  return Math.max(1, Math.min(Math.floor(parsed), HARD_MAX_CONCURRENCY));
}

function truncate(text: string, max = CONTEXT_OUTPUT_MAX_LEN): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…（输出已截断，共 ${text.length} 字）`;
}

function readCollabMetadata(input: RunTaskInput): CollabMetadata | undefined {
  const fromRequest = input.requestMetadata?.['collab'];
  const fromMessage = input.userMessage.metadata?.['collab'];
  const md = fromRequest ?? fromMessage;
  if (md && typeof md === 'object') return md as CollabMetadata;
  return undefined;
}

/**
 * Resolves a member reference to a participant id. Accepts (in order) a
 * participant id, an ACP session id, or an agent id (first matching member).
 */
function resolveMemberId(space: CollabSpace, ref: string | undefined): string | undefined {
  const value = String(ref ?? '').trim();
  if (!value) return undefined;
  if (space.members.has(value)) return value;
  for (const [memberId, sessionId] of space.sessions) {
    if (sessionId === value) return memberId;
  }
  for (const [memberId, info] of space.members) {
    if (info.agentId === value) return memberId;
  }
  return undefined;
}

/**
 * Deterministic first tier of target resolution:
 * explicit member reference (participantId/sessionId/agentId) or a forced agent.
 */
function explicitTarget(space: CollabSpace, collab: CollabMetadata, forcedAgentId?: string): string | undefined {
  if (forcedAgentId) {
    const forced = resolveMemberId(space, forcedAgentId);
    if (forced) return forced;
  }
  const explicit =
    resolveMemberId(space, collab.targetParticipantId) ?? resolveMemberId(space, collab.targetAgentId);
  return explicit;
}

/** Session-role routing tier (01): match `targetRole` against member roles. */
function roleTarget(space: CollabSpace, targetRole: string | undefined): string | undefined {
  const wanted = String(targetRole ?? '').trim();
  if (!wanted) return undefined;
  return memberIds(space).find(memberId => space.members.get(memberId)?.role === wanted);
}

/**
 * Fallback tier: keyword match against participantId / agentId / agent name /
 * role / capabilities → first member of the space.
 */
function keywordTarget(space: CollabSpace, promptText: string): string | undefined {
  const ids = memberIds(space);
  if (ids.length === 0) return undefined;

  const normalized = promptText.toLowerCase();
  for (const memberId of ids) {
    const info = space.members.get(memberId);
    if (!info) continue;
    const config = AVAILABLE_AGENTS.find(agent => agent.id === info.agentId);
    const keys = [memberId, info.agentId, config?.name, info.role, ...(info.capabilities ?? [])]
      .filter((key): key is string => Boolean(key))
      .map(key => key.toLowerCase());
    if (keys.some(key => normalized.includes(key))) return memberId;
  }
  return ids[0];
}

/** Member catalog (optionally excluding one) used inside routing prompts. */
function buildMemberCatalog(space: CollabSpace, excludeMemberId?: string): string {
  return memberIds(space)
    .filter(memberId => memberId !== excludeMemberId)
    .map(memberId => {
      const info = space.members.get(memberId);
      const name = info ? agentLabel(info.agentId) : memberId;
      const agent = info?.agentId ? `，agent: ${info.agentId}` : '';
      const role = info?.role ? `，角色：${info.role}` : '';
      const responsibility = info?.responsibility ? `，职责：${info.responsibility}` : '';
      return `- ${memberId}: ${name}${agent}${role}${responsibility}`;
    })
    .join('\n');
}

/** Routing instruction sent to a single-mode orchestrator agent's ACP session. */
function buildRoutingPrompt(space: CollabSpace, question: string): string {
  const ids = memberIds(space);
  return [
    'You are the orchestrator of a multi-agent collaboration.',
    'Decide which single session should answer the user question below.',
    '',
    'Available sessions:',
    buildMemberCatalog(space),
    '',
    'Rules:',
    '- Reply with ONLY a JSON object, no markdown fences and no explanation:',
    '  {"memberId":"<id>"}',
    `- memberId must be exactly one of: ${ids.join(', ')}`,
    '- You may pick yourself if you are the best fit.',
    '- Pick the single best fit; never list multiple sessions.',
    '',
    'User question:',
    question,
  ].join('\n');
}

/** Instruction for a pipeline orchestrator picking the next session. */
function buildPipelineDecisionPrompt(
  space: CollabSpace,
  currentMemberId: string,
  priorOutput: string,
): string {
  const info = space.members.get(currentMemberId);
  return [
    'You are the orchestrator of a sequential (pipeline) multi-agent collaboration.',
    'The current session just finished a step. Decide who should handle the next step.',
    '',
    'Current session:',
    `- ${currentMemberId}${info?.role ? ` （角色：${info.role}）` : ''}`,
    '',
    'Remaining sessions:',
    buildMemberCatalog(space, currentMemberId) || '- (none)',
    '',
    'Rules:',
    '- Reply with ONLY a JSON object, no markdown fences and no explanation.',
    '- To continue, reply: {"memberId":"<id>"} where <id> is one of the remaining sessions.',
    '- If the task is complete, reply: {"done":true}',
    '',
    'Output of the current step:',
    priorOutput,
  ].join('\n');
}

/** Builds the known-reference → memberId map used to parse routing replies. */
function memberAliases(space: CollabSpace, ids: string[]): Map<string, string> {
  const known = new Map<string, string>();
  for (const memberId of ids) {
    known.set(memberId.toLowerCase(), memberId);
    const info = space.members.get(memberId);
    if (!info) continue;
    known.set(info.agentId.toLowerCase(), memberId);
    const config = AVAILABLE_AGENTS.find(agent => agent.id === info.agentId);
    if (config?.name) known.set(config.name.toLowerCase(), memberId);
    if (info.role) known.set(info.role.toLowerCase(), memberId);
  }
  return known;
}

/**
 * Extracts a target member from a routing reply.
 *  1. strict `{"memberId":"..."}` (or legacy `agentId`) field, 2. exactly one
 * known id/name mentioned anywhere in the reply. Ambiguous/empty → undefined.
 */
function parseRoutingReply(reply: string, space: CollabSpace, ids: string[]): string | undefined {
  const text = reply.trim();
  if (!text) return undefined;
  const known = memberAliases(space, ids);

  const match = text.match(/"(?:memberId|agentId)"\s*:\s*"([^"]+)"/i);
  if (match) {
    const hit = known.get(match[1].trim().toLowerCase());
    if (hit) return hit;
  }

  const lower = text.toLowerCase();
  const found = new Set<string>();
  for (const [key, memberId] of known) {
    if (lower.includes(key)) found.add(memberId);
  }
  return found.size === 1 ? [...found][0] : undefined;
}

/** Pipeline decision reply → next memberId, or `undefined` when done. */
function parsePipelineDecision(reply: string, candidateIds: string[]): string | undefined {
  const text = reply.trim();
  if (!text) return undefined;
  if (/"done"\s*:\s*true/i.test(text)) return undefined;

  const match = text.match(/"(?:memberId|agentId)"\s*:\s*"([^"]+)"/i);
  if (match) {
    const ref = match[1].trim();
    return candidateIds.find(id => id === ref) ?? undefined;
  }
  const lower = text.toLowerCase();
  const found = candidateIds.filter(id => lower.includes(id.toLowerCase()));
  return found.length === 1 ? found[0] : undefined;
}

/** Parses a voluntary-claim verdict; a non-empty string means "claim". */
function parseClaimVerdict(reply: string | undefined): string | undefined {
  if (!reply) return undefined;
  if (!reply.includes('认领')) return undefined;
  const reason = reply.replace(/^[\s\S]*?认领[：:]\s*/, '').trim();
  return (reason || reply.trim()).slice(0, 200);
}

/** Ordered concurrency limiter. */
async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const runners: Promise<void>[] = [];
  const run = async (): Promise<void> => {
    for (;;) {
      const next = queue.shift();
      if (next === undefined) return;
      await worker(next);
    }
  };
  const count = Math.min(limit, items.length);
  for (let i = 0; i < count; i++) runners.push(run());
  await Promise.all(runners);
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

/** Human handoff prompt carrying the previous session's output. */
function buildHandoffPrompt(role: string | undefined, priorOutput: string, claimReason?: string): string {
  const roleLabel = role ? `（角色：${role}）` : '';
  const claim = claimReason ? `你已认领继续处理，认领理由：${claimReason}\n\n` : '';
  return (
    `${claim}前一位 Session${roleLabel}的输出如下：\n${truncate(priorOutput)}\n\n` +
    '请基于此继续工作，按你的角色职责处理。'
  );
}

/**
 * Shared A2A → ACP bridge used by both the orchestrator server and the
 * per-agent A2A servers:
 *
 *  1. publish the task snapshot (A2A streams must start with a Task),
 *  2. dispatch by collaboration mode:
 *       - 03 parallel  : fan out sub-tasks, optional aggregator,
 *       - 04 voluntary : broadcast output, collect claims, hand off,
 *       - 02 pipeline  : sequential handoff (static or orchestrated),
 *       - 01 single    : route to one session (explicit/role/orchestrator/keyword),
 *  3. serialize prompts per ACP session (ACP allows one prompt at a time),
 *  4. forward `agent_message_chunk` events as appending A2A artifact updates,
 *  5. publish the terminal status (COMPLETED / CANCELED / FAILED).
 */
export class BridgeRunner {
  /** Per-session FIFO: serializes prompts targeting the same agent session. */
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
    if (run.sessionId) {
      await this.sessionManager.cancelPrompt(run.sessionId);
    }
  };

  async run(input: RunTaskInput): Promise<void> {
    const { taskId, contextId, eventBus, userMessage } = input;
    const runState: ActiveRun = { cancelled: false };
    this.active.set(taskId, runState);

    const setStatus = (state: TaskState, text?: string, metadata?: Record<string, any>): void => {
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
          metadata,
        }),
      );
    };

    const ctx: RunContext = { taskId, contextId, eventBus, runState, setStatus };

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

      setStatus(TaskState.TASK_STATE_WORKING, '正在选择目标 Session…');
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

      // Parallel mode may carry its work entirely in `parallel.subTasks`, so an
      // empty top-level prompt is allowed there.
      if (!promptText && !collab.parallel?.enabled) {
        setStatus(TaskState.TASK_STATE_FAILED, '请发送文本内容作为协作任务。');
        return;
      }

      // 2. Dispatch by collaboration mode.
      if (collab.parallel?.enabled) {
        await this.runParallel(ctx, collab, space);
      } else if (collab.voluntary?.enabled) {
        await this.runVoluntary(ctx, collab, space, promptText, input.forcedAgentId);
      } else if (collab.pipeline) {
        await this.runPipeline(ctx, collab, space, promptText, input.forcedAgentId);
      } else {
        await this.runSingle(ctx, collab, space, promptText, input.forcedAgentId);
      }
    } finally {
      this.active.delete(taskId);
    }
  }

  // ==========================================================================
  // 01 — single-target collaboration
  // ==========================================================================

  private async runSingle(
    ctx: RunContext,
    collab: CollabMetadata,
    space: CollabSpace,
    promptText: string,
    forcedAgentId?: string,
  ): Promise<void> {
    const { setStatus, runState } = ctx;

    let targetMemberId = explicitTarget(space, collab, forcedAgentId);
    if (!targetMemberId) {
      targetMemberId = roleTarget(space, collab.targetRole);
      if (targetMemberId) {
        setStatus(
          TaskState.TASK_STATE_WORKING,
          `已按角色「${collab.targetRole}」路由到 ${memberLabel(space, targetMemberId)}…`,
        );
      }
    }

    let routedByOrchestrator = false;
    if (!targetMemberId && space.orchestratorId) {
      const routed = await this.routeViaOrchestrator(ctx, space, promptText);
      if (runState.cancelled) {
        setStatus(TaskState.TASK_STATE_CANCELED, '任务已取消');
        return;
      }
      if (routed) {
        targetMemberId = routed;
        routedByOrchestrator = true;
      } else {
        setStatus(TaskState.TASK_STATE_WORKING, 'Orchestrator 路由未命中，改用规则路由…');
      }
    }
    if (!targetMemberId) {
      targetMemberId = keywordTarget(space, promptText);
    }
    if (!targetMemberId) {
      setStatus(
        TaskState.TASK_STATE_FAILED,
        '无法确定目标 Session：请指定 metadata.collab.targetParticipantId / targetRole，或在协作空间中选择 Session。',
      );
      return;
    }

    const sessionId = space.sessions.get(targetMemberId);
    if (!sessionId) {
      setStatus(TaskState.TASK_STATE_FAILED, `协作空间未包含 Session「${targetMemberId}」。`);
      return;
    }

    const label = memberLabel(space, targetMemberId);
    setStatus(
      TaskState.TASK_STATE_WORKING,
      `${routedByOrchestrator ? 'Orchestrator 已选择' : '已路由到'} ${label}，正在调用…`,
      this.turnMeta(space, targetMemberId, 1),
    );

    try {
      const { cancelled } = await this.promptMember({
        ctx,
        space,
        memberId: targetMemberId,
        promptText,
        artifactId: `${ctx.taskId}-reply`,
        metadata: { turn: 1 },
      });
      if (cancelled || runState.cancelled) {
        setStatus(TaskState.TASK_STATE_CANCELED, `${label} 已取消`);
        return;
      }
      setStatus(TaskState.TASK_STATE_COMPLETED, `${label} 回复完成`, this.turnMeta(space, targetMemberId, 1));
    } catch (error) {
      const message =
        error instanceof BridgeTimeoutError
          ? `调用 ${label} 超时（${this.timeoutMs}ms）`
          : (error as Error).message;
      logger.error(`[A2A Collab] Single task ${ctx.taskId} failed:`, error);
      setStatus(TaskState.TASK_STATE_FAILED, `${label} 调用失败：${message}`);
    }
  }

  /**
   * Asks the space's orchestrator session (an ordinary ACP agent session) which
   * member should answer the prompt. Returns the chosen member id, or
   * `undefined` on parse failure / timeout / cancel.
   */
  private async routeViaOrchestrator(
    ctx: RunContext,
    space: CollabSpace,
    promptText: string,
  ): Promise<string | undefined> {
    const orchestratorId = space.orchestratorId;
    if (!orchestratorId) return undefined;
    const sessionId = space.sessions.get(orchestratorId);
    if (!sessionId) return undefined;

    ctx.setStatus(TaskState.TASK_STATE_WORKING, 'Orchestrator 正在选择目标 Session…');

    const reply = await this.askRaw(ctx.runState, sessionId, buildRoutingPrompt(space, promptText), this.routeTimeoutMs);
    if (reply === undefined || ctx.runState.cancelled) return undefined;

    const target = parseRoutingReply(reply, space, memberIds(space));
    if (target) {
      logger.log(
        `[A2A Collab] Orchestrator selected ${target} (space: ${space.id}) for: ${promptText.slice(0, 120)}`,
      );
      return target;
    }
    logger.warn(
      `[A2A Collab] Orchestrator reply unparsable (space: ${space.id}), falling back to rules:`,
      reply.slice(0, 200),
    );
    return undefined;
  }

  // ==========================================================================
  // 02 — pipeline / sequential collaboration
  // ==========================================================================

  private async runPipeline(
    ctx: RunContext,
    collab: CollabMetadata,
    space: CollabSpace,
    promptText: string,
    forcedAgentId?: string,
  ): Promise<void> {
    const pipeline = collab.pipeline!;
    const { setStatus, runState } = ctx;
    const maxTurns = clampTurns(pipeline.maxTurns);

    // Resolve the static execution order (defaults to the space member order).
    const order = (pipeline.order?.length ? pipeline.order : memberIds(space))
      .map(ref => resolveMemberId(space, ref))
      .filter((id): id is string => Boolean(id));

    let currentMemberId: string | undefined =
      explicitTarget(space, collab, forcedAgentId) ?? roleTarget(space, collab.targetRole) ?? order[0];
    if (!currentMemberId) {
      setStatus(TaskState.TASK_STATE_FAILED, '流水线没有可执行的 Session，请检查协作空间配置。');
      return;
    }
    // Normalize a static order so the handoff walk is positional.
    if (pipeline.mode === 'static' && !order.includes(currentMemberId)) {
      order.unshift(currentMemberId);
    }

    let currentPrompt = promptText;
    let prevMemberId: string | undefined;
    let pendingMeta: Record<string, any> = {};
    let turn = 0;

    while (currentMemberId && turn < maxTurns) {
      turn++;
      const label = memberLabel(space, currentMemberId);
      const role = space.members.get(currentMemberId)?.role;
      setStatus(TaskState.TASK_STATE_WORKING, `第 ${turn} 轮：调用 ${label}…`, {
        ...this.turnMeta(space, currentMemberId, turn),
        prevParticipantId: prevMemberId,
        prevSessionId: prevMemberId ? space.sessions.get(prevMemberId) : undefined,
      });

      let result: { output: string; cancelled: boolean };
      try {
        result = await this.promptMember({
          ctx,
          space,
          memberId: currentMemberId,
          promptText: currentPrompt,
          artifactId: `${ctx.taskId}-reply-${turn}`,
          metadata: {
            turn,
            prevParticipantId: prevMemberId,
            prevSessionId: prevMemberId ? space.sessions.get(prevMemberId) : undefined,
            ...pendingMeta,
          },
        });
      } catch (error) {
        const message =
          error instanceof BridgeTimeoutError
            ? `调用 ${label} 超时（${this.timeoutMs}ms）`
            : (error as Error).message;
        logger.error(`[A2A Collab] Pipeline task ${ctx.taskId} failed at turn ${turn}:`, error);
        setStatus(TaskState.TASK_STATE_FAILED, `第 ${turn} 轮 ${label} 调用失败：${message}`);
        return;
      }
      if (result.cancelled || runState.cancelled) {
        setStatus(TaskState.TASK_STATE_CANCELED, `第 ${turn} 轮已取消`);
        return;
      }

      const finishedMemberId = currentMemberId;
      prevMemberId = finishedMemberId;
      pendingMeta = {};

      // Decide the next session.
      let nextMemberId: string | undefined;
      if (pipeline.mode === 'static') {
        const idx = order.indexOf(finishedMemberId);
        nextMemberId = idx >= 0 ? order[idx + 1] : undefined;
      } else {
        nextMemberId = await this.decideNextViaOrchestrator(ctx, space, pipeline, finishedMemberId, result.output);
        if (runState.cancelled) {
          setStatus(TaskState.TASK_STATE_CANCELED, '任务已取消');
          return;
        }
      }

      if (!nextMemberId) break;

      setStatus(TaskState.TASK_STATE_WORKING, `第 ${turn} 轮完成，交由 ${memberLabel(space, nextMemberId)} 接棒…`, {
        turn,
        prevParticipantId: finishedMemberId,
        prevSessionId: space.sessions.get(finishedMemberId),
      });
      currentMemberId = nextMemberId;
      currentPrompt = buildHandoffPrompt(role, result.output);
    }

    setStatus(TaskState.TASK_STATE_COMPLETED, '流水线协作任务已结束');
  }

  /** Asks the pipeline orchestrator which session should run next. */
  private async decideNextViaOrchestrator(
    ctx: RunContext,
    space: CollabSpace,
    pipeline: CollabPipelineConfig,
    currentMemberId: string,
    priorOutput: string,
  ): Promise<string | undefined> {
    const orchestratorId =
      resolveMemberId(space, pipeline.orchestratorAgentId) ?? space.orchestratorId;
    const candidates = memberIds(space).filter(id => id !== currentMemberId);
    if (candidates.length === 0) return undefined;

    if (!orchestratorId) {
      // No orchestrator configured: fall back to declaration order.
      return candidates[0];
    }
    const sessionId = space.sessions.get(orchestratorId);
    if (!sessionId) return candidates[0];

    ctx.setStatus(TaskState.TASK_STATE_WORKING, 'Orchestrator 正在决定下一个 Session…');
    const reply = await this.askRaw(
      ctx.runState,
      sessionId,
      buildPipelineDecisionPrompt(space, currentMemberId, truncate(priorOutput)),
      this.routeTimeoutMs,
    );
    if (reply === undefined) return candidates[0];

    const next = parsePipelineDecision(reply, candidates);
    if (!next) {
      logger.log(`[A2A Collab] Pipeline orchestrator ended the flow (space: ${space.id})`);
    }
    return next;
  }

  // ==========================================================================
  // 03 — parallel division of labour
  // ==========================================================================

  private async runParallel(
    ctx: RunContext,
    collab: CollabMetadata,
    space: CollabSpace,
  ): Promise<void> {
    const parallel = collab.parallel!;
    const { setStatus, runState } = ctx;
    const subTasks = (parallel.subTasks ?? []).filter(subTask => String(subTask?.prompt ?? '').trim());
    if (subTasks.length === 0) {
      setStatus(TaskState.TASK_STATE_FAILED, '并行分工缺少有效的子任务（parallel.subTasks）。');
      return;
    }
    const maxConcurrency = clampConcurrency(parallel.maxConcurrency);

    setStatus(TaskState.TASK_STATE_WORKING, `并行分发 ${subTasks.length} 个子任务（并发上限 ${maxConcurrency}）…`);

    const results: SubTaskResult[] = [];
    const record = (result: SubTaskResult): void => {
      results.push(result);
    };

    await runWithConcurrency(subTasks, maxConcurrency, async subTask => {
      const memberId =
        resolveMemberId(space, subTask.targetAgentId) ??
        roleTarget(space, subTask.targetRole) ??
        keywordTarget(space, subTask.prompt);
      if (!memberId) {
        record({ subTaskId: subTask.id, memberId: '', output: '', ok: false, error: '无法确定目标 Session' });
        return;
      }
      const label = memberLabel(space, memberId);
      try {
        const { output, cancelled } = await this.promptMember({
          ctx,
          space,
          memberId,
          promptText: subTask.prompt,
          artifactId: `${ctx.taskId}-sub-${subTask.id}`,
          metadata: { turn: 1, subTaskId: subTask.id },
        });
        if (cancelled || runState.cancelled) {
          record({ subTaskId: subTask.id, memberId, output, ok: false, error: 'canceled' });
          return;
        }
        record({ subTaskId: subTask.id, memberId, output, ok: true });
      } catch (error) {
        const message =
          error instanceof BridgeTimeoutError
            ? `${label} 超时（${this.timeoutMs}ms）`
            : (error as Error).message;
        logger.error(`[A2A Collab] Parallel sub-task ${subTask.id} failed:`, error);
        record({ subTaskId: subTask.id, memberId, output: '', ok: false, error: message });
      }
    });

    if (runState.cancelled) {
      setStatus(TaskState.TASK_STATE_CANCELED, '并行任务已取消');
      return;
    }

    // Preserve the declaration order for a stable summary.
    const order = new Map(subTasks.map((subTask, index) => [subTask.id, index]));
    results.sort((a, b) => (order.get(a.subTaskId) ?? 0) - (order.get(b.subTaskId) ?? 0));

    const aggregatorMemberId = resolveMemberId(space, parallel.aggregatorAgentId);
    if (aggregatorMemberId) {
      const aggLabel = memberLabel(space, aggregatorMemberId);
      setStatus(TaskState.TASK_STATE_WORKING, `${aggLabel} 正在汇总子任务结果…`, {
        turn: 2,
        ...this.turnMeta(space, aggregatorMemberId, 2),
      });
      try {
        const { cancelled } = await this.promptMember({
          ctx,
          space,
          memberId: aggregatorMemberId,
          promptText: buildSummaryPrompt(space, results),
          artifactId: `${ctx.taskId}-summary`,
          metadata: { turn: 2, subTaskId: 'summary' },
        });
        if (cancelled || runState.cancelled) {
          setStatus(TaskState.TASK_STATE_CANCELED, '汇总已取消');
          return;
        }
      } catch (error) {
        const message =
          error instanceof BridgeTimeoutError
            ? `${aggLabel} 汇总超时（${this.timeoutMs}ms）`
            : (error as Error).message;
        logger.error(`[A2A Collab] Parallel aggregator failed:`, error);
        setStatus(TaskState.TASK_STATE_FAILED, `汇总失败：${message}`);
        return;
      }
    }

    const failed = results.filter(result => !result.ok).length;
    setStatus(
      TaskState.TASK_STATE_COMPLETED,
      failed > 0 ? `并行分工任务已结束（${failed} 个子任务失败）` : '并行分工任务已结束',
    );
  }

  // ==========================================================================
  // 04 — voluntary claim / competitive handoff
  // ==========================================================================

  private async runVoluntary(
    ctx: RunContext,
    collab: CollabMetadata,
    space: CollabSpace,
    promptText: string,
    forcedAgentId?: string,
  ): Promise<void> {
    const voluntary = collab.voluntary!;
    const { setStatus, runState } = ctx;
    const maxTurns = clampTurns(voluntary.maxTurns);
    const resolution = voluntary.conflictResolution ?? 'first-come';

    // Resolve the first session. With an orchestrator (or an explicit
    // target/role) the first executor is decided up-front; otherwise the user
    // prompt is broadcast to every member, each making an initial claim
    // judgement (instead of routing it to a single session).
    let pendingMeta: Record<string, any> = {};
    let currentMemberId = explicitTarget(space, collab, forcedAgentId) ?? roleTarget(space, collab.targetRole);

    if (!currentMemberId && space.orchestratorId) {
      const routed = await this.routeViaOrchestrator(ctx, space, promptText);
      if (runState.cancelled) {
        setStatus(TaskState.TASK_STATE_CANCELED, '任务已取消');
        return;
      }
      currentMemberId = routed;
    }

    if (!currentMemberId) {
      setStatus(TaskState.TASK_STATE_WORKING, '初始阶段：向所有 Session 广播用户任务，判断是否认领…');
      const initial = await this.collectClaims(ctx, memberIds(space), candidateId =>
        this.askClaim(ctx, space, candidateId, `用户任务：\n${truncate(promptText)}`),
      );
      if (initial.cancelled) {
        setStatus(TaskState.TASK_STATE_CANCELED, '任务已取消');
        return;
      }
      if (initial.claims.length > 0) {
        const winner = this.pickClaim(space, initial.claims, resolution, voluntary.priorityOrder);
        currentMemberId = winner.memberId;
        pendingMeta = { claimReason: winner.reason, relinquishedBy: initial.relinquished };
        setStatus(
          TaskState.TASK_STATE_WORKING,
          `初始任务：${memberLabel(space, winner.memberId)} 认领${initial.claims.length > 1 ? `（${initial.claims.length} 人竞争）` : ''}…`,
        );
      } else {
        // Nobody claimed the initial task: fall back to the first session so the
        // user prompt is still handled.
        currentMemberId = memberIds(space)[0];
        setStatus(TaskState.TASK_STATE_WORKING, '初始阶段无人认领，回退到首个 Session 处理。');
      }
    }

    if (!currentMemberId) {
      setStatus(TaskState.TASK_STATE_FAILED, '协作空间没有可执行的 Session。');
      return;
    }

    let currentPrompt = promptText;
    let prevMemberId: string | undefined;
    let turn = 0;

    while (currentMemberId && turn < maxTurns) {
      turn++;
      const label = memberLabel(space, currentMemberId);
      const role = space.members.get(currentMemberId)?.role;
      setStatus(TaskState.TASK_STATE_WORKING, `第 ${turn} 轮：${label} 处理中…`, {
        ...this.turnMeta(space, currentMemberId, turn),
        prevParticipantId: prevMemberId,
        prevSessionId: prevMemberId ? space.sessions.get(prevMemberId) : undefined,
      });

      let result: { output: string; cancelled: boolean };
      try {
        result = await this.promptMember({
          ctx,
          space,
          memberId: currentMemberId,
          promptText: currentPrompt,
          artifactId: `${ctx.taskId}-reply-${turn}`,
          metadata: {
            turn,
            prevParticipantId: prevMemberId,
            prevSessionId: prevMemberId ? space.sessions.get(prevMemberId) : undefined,
            ...pendingMeta,
          },
        });
      } catch (error) {
        const message =
          error instanceof BridgeTimeoutError
            ? `调用 ${label} 超时（${this.timeoutMs}ms）`
            : (error as Error).message;
        logger.error(`[A2A Collab] Voluntary task ${ctx.taskId} failed at turn ${turn}:`, error);
        setStatus(TaskState.TASK_STATE_FAILED, `第 ${turn} 轮 ${label} 调用失败：${message}`);
        return;
      }
      if (result.cancelled || runState.cancelled) {
        setStatus(TaskState.TASK_STATE_CANCELED, `第 ${turn} 轮已取消`);
        return;
      }

      const finishedMemberId = currentMemberId;
      prevMemberId = finishedMemberId;
      pendingMeta = {};

      const candidates = memberIds(space).filter(id => id !== finishedMemberId);
      if (candidates.length === 0) break;

      setStatus(TaskState.TASK_STATE_WORKING, `第 ${turn} 轮完成，其余成员判断是否认领…`, {
        turn,
        prevParticipantId: finishedMemberId,
        prevSessionId: space.sessions.get(finishedMemberId),
      });

      const collect = await this.collectClaims(ctx, candidates, candidateId =>
        this.askShouldTakeOver(ctx, space, candidateId, result.output, label, role),
      );
      const claims = collect.claims;
      const relinquished = collect.relinquished;
      if (collect.cancelled) {
        setStatus(TaskState.TASK_STATE_CANCELED, '任务已取消');
        return;
      }

      if (claims.length === 0) {
        setStatus(TaskState.TASK_STATE_WORKING, '无人认领，协作结束。');
        break;
      }

      const next = this.pickClaim(space, claims, resolution, voluntary.priorityOrder);
      setStatus(
        TaskState.TASK_STATE_WORKING,
        `第 ${turn} 轮：${memberLabel(space, next.memberId)} 认领${claims.length > 1 ? `（${claims.length} 人竞争）` : ''}…`,
        { turn, ...this.turnMeta(space, next.memberId, turn) },
      );

      currentMemberId = next.memberId;
      currentPrompt = buildHandoffPrompt(role, result.output, next.reason);
      pendingMeta = { claimReason: next.reason, relinquishedBy: relinquished };
    }

    setStatus(TaskState.TASK_STATE_COMPLETED, '自愿认领协作任务已结束');
  }

  /**
   * Runs the claim-judgement prompt for one candidate and returns its claim
   * reason, or `undefined` when it passes. `taskSection` is the material the
   * candidate judges against.
   */
  private async askClaim(
    ctx: RunContext,
    space: CollabSpace,
    candidateId: string,
    taskSection: string,
  ): Promise<string | undefined> {
    const sessionId = space.sessions.get(candidateId);
    if (!sessionId) return undefined;
    const info = space.members.get(candidateId);
    const role = info?.role ?? '协作者';
    const responsibility = info?.responsibility ?? '按你的职责判断';
    const prompt = [
      `你是“${role}”，职责是：${responsibility}。`,
      '',
      taskSection,
      '',
      '请判断：是否需要你继续处理？',
      '- 如果是，只回复：认领：<理由>',
      '- 如果不是，只回复：放弃',
    ].join('\n');

    const reply = await this.askRaw(ctx.runState, sessionId, prompt, this.routeTimeoutMs);
    return parseClaimVerdict(reply);
  }

  /**
   * Asks one candidate whether it wants to take over the previous session's
   * output. Returns the claim reason, or `undefined` to pass.
   */
  private async askShouldTakeOver(
    ctx: RunContext,
    space: CollabSpace,
    candidateId: string,
    priorOutput: string,
    priorLabel: string,
    priorRole?: string,
  ): Promise<string | undefined> {
    const priorDescription = priorRole ? `${priorLabel} ${priorRole}` : priorLabel;
    return this.askClaim(ctx, space, candidateId, `以下是${priorDescription} 的输出：\n${truncate(priorOutput)}`);
  }

  /**
   * Polls every candidate in declaration order and collects claims / passes.
   * `judge` returns the claim reason, or `undefined` when the candidate passes.
   */
  private async collectClaims(
    ctx: RunContext,
    candidateIds: string[],
    judge: (candidateId: string) => Promise<string | undefined>,
  ): Promise<{ claims: MemberClaim[]; relinquished: string[]; cancelled: boolean }> {
    const claims: MemberClaim[] = [];
    const relinquished: string[] = [];
    for (const candidateId of candidateIds) {
      const reason = await judge(candidateId);
      if (ctx.runState.cancelled) return { claims, relinquished, cancelled: true };
      if (reason) claims.push({ memberId: candidateId, reason });
      else relinquished.push(candidateId);
    }
    return { claims, relinquished, cancelled: false };
  }

  /** Applies the configured conflict-resolution rule to pick one claimer. */
  private pickClaim(
    space: CollabSpace,
    claims: MemberClaim[],
    resolution: 'first-come' | 'priority' | 'random',
    priorityOrder?: string[],
  ): MemberClaim {
    if (resolution === 'priority' && priorityOrder?.length) {
      for (const ref of priorityOrder) {
        const wanted = resolveMemberId(space, ref);
        if (!wanted) continue;
        const hit = claims.find(claim => claim.memberId === wanted);
        if (hit) return hit;
      }
    }
    if (resolution === 'random') {
      return claims[Math.floor(Math.random() * claims.length)];
    }
    // first-come: candidates were polled in member order, so the first claim wins.
    return claims[0];
  }

  // ==========================================================================
  // Shared ACP plumbing
  // ==========================================================================

  /**
   * Builds the artifact/status metadata identifying the producing session:
   * `participantId` (primary), `agentId` (bound implementation), `sessionId`
   * and the session role.
   */
  private turnMeta(space: CollabSpace, memberId: string, turn: number): Record<string, any> {
    const info = space.members.get(memberId);
    return {
      turn,
      participantId: memberId,
      agentId: info?.agentId,
      sessionId: space.sessions.get(memberId),
      role: info?.role,
    };
  }

  /**
   * Runs one member prompt, streaming `agent_message_chunk` deltas as appending
   * artifact updates and returning the accumulated assistant text.
   */
  private async promptMember(params: {
    ctx: RunContext;
    space: CollabSpace;
    memberId: string;
    promptText: string;
    artifactId: string;
    metadata: Record<string, any>;
  }): Promise<{ output: string; cancelled: boolean }> {
    const { ctx, space, memberId, promptText, artifactId, metadata } = params;
    const { taskId, contextId, eventBus, runState } = ctx;
    const sessionId = space.sessions.get(memberId);
    if (!sessionId) return { output: '', cancelled: false };

    const info = space.members.get(memberId);
    const label = info ? agentLabel(info.agentId) : memberId;
    const artifactMeta = {
      ...metadata,
      participantId: memberId,
      agentId: info?.agentId,
      sessionId,
      role: info?.role,
    };
    let output = '';
    let cancelled = false;

    const closeArtifact = (append: boolean): void => {
      eventBus.publish(
        AgentEvent.artifactUpdate({
          taskId,
          contextId,
          artifact: {
            artifactId,
            name: 'AgentReply',
            description: `${label} 的回复`,
            parts: [],
            metadata: artifactMeta,
            extensions: [],
          },
          append,
          lastChunk: true,
          metadata: undefined,
        }),
      );
    };

    await this.withLock(sessionId, async () => {
      if (runState.cancelled) {
        cancelled = true;
        return;
      }
      runState.sessionId = sessionId;

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
              metadata: artifactMeta,
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
        await this.sessionManager.ensureAgentSession(sessionId);

        const result = await withTimeout(
          this.sessionManager.promptAndWait(
            sessionId,
            [{ type: 'text', text: promptText }] as acp.ContentBlock[],
            event => {
              const delta = extractAgentChunk(event);
              if (delta) {
                output += delta;
                publishChunk(delta);
              }
            },
          ),
          this.timeoutMs,
          () => this.sessionManager.cancelPrompt(sessionId),
        );

        if (runState.cancelled || result.stopReason === 'cancelled') {
          cancelled = true;
          return;
        }
        if (chunkPublished) {
          closeArtifact(true);
        }
      } finally {
        runState.sessionId = undefined;
      }
    });

    return { output, cancelled };
  }

  /**
   * Runs an internal (non-streamed) prompt, e.g. orchestrator routing or a
   * voluntary-claim judgement. Returns the accumulated text, or `undefined`
   * on failure / cancel so callers fall back to rules.
   */
  private async askRaw(
    runState: ActiveRun,
    sessionId: string,
    promptText: string,
    timeoutMs: number,
  ): Promise<string | undefined> {
    let reply = '';
    try {
      await this.withLock(sessionId, async () => {
        if (runState.cancelled) return;
        runState.sessionId = sessionId;
        try {
          await this.sessionManager.ensureAgentSession(sessionId);
          await withTimeout(
            this.sessionManager.promptAndWait(
              sessionId,
              [{ type: 'text', text: promptText }] as acp.ContentBlock[],
              event => {
                const delta = extractAgentChunk(event);
                if (delta) reply += delta;
              },
            ),
            timeoutMs,
            () => this.sessionManager.cancelPrompt(sessionId),
          );
        } finally {
          runState.sessionId = undefined;
        }
      });
    } catch (error) {
      logger.warn(`[A2A Collab] Internal prompt failed (session: ${sessionId}):`, error);
      return undefined;
    }
    if (runState.cancelled) return undefined;
    return reply;
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

/** Builds the aggregator prompt for parallel mode. */
function buildSummaryPrompt(space: CollabSpace, results: SubTaskResult[]): string {
  const sections = results.map(result => {
    const label = result.memberId ? memberLabel(space, result.memberId) : '未知 Session';
    return result.ok
      ? `## 子任务 ${result.subTaskId}（Session：${result.memberId} / ${label}）\n${truncate(result.output)}`
      : `## 子任务 ${result.subTaskId}（Session：${result.memberId} / ${label}）\n[失败] ${result.error ?? '未知错误'}`;
  });
  return [
    '以下是由多个 Session 并行完成的子任务结果，请汇总为一份完整、条理清晰的结论。',
    '保留各结果的关键信息，指出冲突之处，并给出最终建议。',
    '',
    ...sections,
  ].join('\n\n');
}
