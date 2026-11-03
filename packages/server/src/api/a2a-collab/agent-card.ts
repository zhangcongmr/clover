import { A2A_PROTOCOL_VERSION, type AgentCard, type AgentSkill } from '@a2a-js/sdk';

export interface CollabCardInput {
  name: string;
  description: string;
  /** Absolute JSON-RPC dial URL. Must end with `/` so clients resolve the card path relative to it. */
  dialUrl: string;
  skill: AgentSkill;
}

/**
 * Builds an A2A v1.0 AgentCard for a collaboration endpoint (orchestrator or
 * a single agent bridge). Only the JSONRPC binding is advertised.
 */
export function buildCollabAgentCard(input: CollabCardInput): AgentCard {
  return {
    name: input.name,
    description: input.description,
    supportedInterfaces: [
      {
        url: input.dialUrl,
        protocolBinding: 'JSONRPC',
        tenant: '',
        protocolVersion: A2A_PROTOCOL_VERSION,
      },
    ],
    provider: {
      organization: 'Clover',
      url: 'https://github.com/zhangcongmr/clover',
    },
    version: '1.0.0',
    documentationUrl: '',
    capabilities: {
      streaming: true,
      pushNotifications: false,
      extensions: [],
      extendedAgentCard: false,
    },
    securitySchemes: {},
    securityRequirements: [],
    defaultInputModes: ['text'],
    defaultOutputModes: ['text', 'task-status'],
    skills: [input.skill],
    signatures: [],
  };
}
