import type { AgentExecutor, ExecutionEventBus, RequestContext } from '@a2a-js/sdk/server';
import type { BridgeRunner, RunTaskInput } from './bridge-runner.js';

function baseInput(requestContext: RequestContext, eventBus: ExecutionEventBus): RunTaskInput {
  return {
    taskId: requestContext.taskId,
    contextId: requestContext.contextId,
    snapshot: requestContext.task,
    userMessage: requestContext.userMessage,
    requestMetadata: requestContext.request.metadata,
    eventBus,
  };
}

/**
 * Executor for a single agent's A2A server: every message is forced to that
 * agent (routing metadata is still required to locate the collab space).
 */
export class BridgeExecutor implements AgentExecutor {
  constructor(
    private readonly agentId: string,
    private readonly runner: BridgeRunner,
  ) {}

  execute = (requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> =>
    this.runner.run({ ...baseInput(requestContext, eventBus), forcedAgentId: this.agentId });

  cancelTask = (taskId: string, _eventBus: ExecutionEventBus): Promise<void> =>
    this.runner.cancel(taskId);
}

/**
 * Executor for the orchestrator A2A server: routes each message to a target
 * agent of the collaboration space via {@link BridgeRunner}.
 */
export class OrchestratorExecutor implements AgentExecutor {
  constructor(private readonly runner: BridgeRunner) {}

  execute = (requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> =>
    this.runner.run(baseInput(requestContext, eventBus));

  cancelTask = (taskId: string, _eventBus: ExecutionEventBus): Promise<void> =>
    this.runner.cancel(taskId);
}
