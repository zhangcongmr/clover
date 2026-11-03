import type { RequestHandler } from 'express';
import type { AgentCard } from '@a2a-js/sdk';
import {
  DefaultRequestHandler,
  InMemoryTaskStore,
  type AgentExecutor,
  type TaskStore,
} from '@a2a-js/sdk/server';
import { agentCardHandler, jsonRpcHandler, UserBuilder } from '@a2a-js/sdk/server/express';

export interface A2aBundle {
  /** Updates the absolute base URL baked into served agent cards. */
  setBaseUrl(baseUrl: string): void;
  /** Serves `GET /` (mount at the card path). */
  readonly cardRouter: RequestHandler;
  /** Handles `POST /` JSON-RPC (mount at the dial path). */
  readonly rpcRouter: RequestHandler;
}

export interface CreateA2aBundleOptions {
  initialBaseUrl: string;
  /** Builds an absolute-URL agent card for the given base URL. */
  buildCard: (baseUrl: string) => AgentCard;
  executor: AgentExecutor;
  /** Defaults to a per-bundle in-memory task store. */
  taskStore?: TaskStore;
}

/**
 * Wires one AgentCard + JSON-RPC endpoint pair around an executor.
 *
 * `requestHandler`'s own card copy is built once (only its capabilities and
 * protocol versions matter server-side); the card served over HTTP is rebuilt
 * per request so the dial URL tracks the current host.
 */
export function createA2aBundle(options: CreateA2aBundleOptions): A2aBundle {
  let baseUrl = options.initialBaseUrl;

  const requestHandler = new DefaultRequestHandler(
    options.buildCard(baseUrl),
    options.taskStore ?? new InMemoryTaskStore(),
    options.executor,
  );

  const cardRouter = agentCardHandler({
    agentCardProvider: {
      getAgentCard: async () => options.buildCard(baseUrl),
    },
  });

  const rpcRouter = jsonRpcHandler({
    requestHandler,
    userBuilder: UserBuilder.noAuthentication,
  });

  return {
    setBaseUrl: (next: string) => {
      baseUrl = next;
    },
    cardRouter,
    rpcRouter,
  };
}
