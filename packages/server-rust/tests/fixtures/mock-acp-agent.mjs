// Mock ACP agent used by the integration tests.
//
// Speaks newline-delimited JSON-RPC 2.0 over stdio and implements enough of the
// protocol to exercise the client: initialize, session lifecycle, prompts
// (including a permission round trip and a slow prompt for cancellation).
//
// Usage: node tests/fixtures/mock-acp-agent.mjs

import readline from 'node:readline';

const SESSION_ID = 'mock-session';
let nextRequestId = 9000;
const pendingAgentRequests = new Map();

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function notify(method, params) {
  send({ jsonrpc: '2.0', method, params });
}

function request(method, params) {
  const id = nextRequestId++;
  return new Promise((resolve) => {
    pendingAgentRequests.set(id, resolve);
    send({ jsonrpc: '2.0', id, method, params });
  });
}

function textOf(prompt) {
  return (prompt ?? [])
    .map((block) => (typeof block?.text === 'string' ? block.text : ''))
    .join(' ');
}

const rl = readline.createInterface({ input: process.stdin });

rl.on('line', async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    return;
  }

  const { id, method, params } = message;

  // Response to an agent→client request (permission).
  if (method === undefined && id !== undefined) {
    const resolve = pendingAgentRequests.get(id);
    if (resolve) {
      pendingAgentRequests.delete(id);
      resolve(message.result ?? message.error ?? null);
    }
    return;
  }

  switch (method) {
    case 'initialize':
      send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: 1,
          agentInfo: { name: 'mock-agent', version: '9.9.9' },
          agentCapabilities: {
            sessionCapabilities: { resume: {}, delete: {} },
            promptCapabilities: { image: false, audio: false },
          },
        },
      });
      return;

    case 'session/new':
      send({ jsonrpc: '2.0', id, result: { sessionId: SESSION_ID, configOptions: [] } });
      notify('session/update', {
        sessionId: SESSION_ID,
        update: {
          sessionUpdate: 'available_commands_update',
          availableCommands: [{ name: 'mock-command', description: 'mock' }],
        },
      });
      return;

    case 'session/load':
    case 'session/resume':
      send({ jsonrpc: '2.0', id, result: { sessionId: SESSION_ID, configOptions: [] } });
      return;

    case 'session/delete':
      send({ jsonrpc: '2.0', id, result: {} });
      return;

    case 'session/list':
      send({
        jsonrpc: '2.0',
        id,
        result: { sessions: [{ sessionId: SESSION_ID, cwd: params?.cwd ?? '' }] },
      });
      return;

    case 'session/set_config_option':
      send({
        jsonrpc: '2.0',
        id,
        result: {
          configOptions: [
            { id: params?.configId ?? 'model', currentValue: params?.value ?? '' },
          ],
        },
      });
      return;

    case 'session/prompt': {
      const sessionId = params?.sessionId ?? SESSION_ID;
      const text = textOf(params?.prompt);

      if (text.includes('slow')) {
        // Leave the prompt in flight so the test can cancel it.
        setTimeout(() => {
          notify('session/update', {
            sessionId,
            update: {
              sessionUpdate: 'agent_message_chunk',
              content: { type: 'text', text: 'slow response' },
            },
          });
          send({ jsonrpc: '2.0', id, result: { stopReason: 'cancelled' } });
        }, 400);
        return;
      }

      if (text.includes('permission')) {
        const response = await request('session/request_permission', {
          sessionId,
          toolCall: { toolCallId: 'tc-1', title: 'Run the tests' },
          options: [
            { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
            { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
          ],
        });
        const outcome = response?.outcome ?? {};
        notify('session/update', {
          sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: {
              type: 'text',
              text: `permission:${outcome.outcome ?? 'none'}:${outcome.optionId ?? ''}`,
            },
          },
        });
        send({ jsonrpc: '2.0', id, result: { stopReason: 'end_turn' } });
        return;
      }

      notify('session/update', {
        sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'hello from mock' },
        },
      });
      send({ jsonrpc: '2.0', id, result: { stopReason: 'end_turn' } });
      return;
    }

    case 'session/cancel':
      // Notification: no response.
      return;

    default:
      if (id !== undefined) {
        send({
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `unknown method: ${method}` },
        });
      }
  }
});

process.on('SIGTERM', () => process.exit(0));