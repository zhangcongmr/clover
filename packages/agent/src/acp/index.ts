import type http from 'node:http';
import type https from 'node:https';
import { WebSocketServer, WebSocket } from 'ws';
import { AcpClient } from './client.js';
import type { AcpWsMessage } from './types.js';

export interface AcpWebSocketOptions {
  logPrefix?: string;
  defaultCwd?: string;
  agentCommand?: string;
  agentArgs?: string[];
  agentEnv?: Record<string, string>;
}

export interface AcpConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

// ============================================================================
// Lazy ACP state
// ============================================================================

const acpState = {
  config: null as AcpConfig | null,
  httpServer: null as http.Server | https.Server | null,
  isHttps: false,
  setupDone: false,
};

/**
 * Returns the current ACP config (command + args).
 */
export function getAcpConfig(): AcpConfig | null {
  return acpState.config;
}

/**
 * Returns true if the httpServer has been registered.
 */
export function isAcpHttpServerReady(): boolean {
  return acpState.httpServer !== null;
}

/**
 * Stores the httpServer reference without triggering setup.
 * Use this when you want to set httpServer and config separately.
 */
export function storeAcpHttpServer(
  httpServer: http.Server | https.Server,
  isHttps: boolean = false,
): void {
  acpState.httpServer = httpServer;
  acpState.isHttps = isHttps;
}

/**
 * Stores the ACP config and triggers setupAcpWebSocket if httpServer is ready.
 */
export function setAcpConfig(config: AcpConfig): void {
  acpState.config = config;
  console.log(`[ACP] Config set: command=${config.command}, args=${JSON.stringify(config.args)}`);
  trySetup();
}

/**
 * Stores the httpServer reference and triggers setupAcpWebSocket if config is ready.
 */
export function setAcpHttpServer(
  httpServer: http.Server | https.Server,
  isHttps: boolean = false,
): void {
  acpState.httpServer = httpServer;
  acpState.isHttps = isHttps;
  trySetup();
}

/**
 * Internal: attempts to call setupAcpWebSocket once both config and httpServer are available.
 */
function trySetup(): void {
  if (acpState.setupDone || !acpState.httpServer || !acpState.config) {
    return;
  }
  acpState.setupDone = true;
  setupAcpWebSocket(acpState.httpServer, acpState.isHttps, {
    agentCommand: acpState.config.command,
    agentArgs: acpState.config.args,
    agentEnv: acpState.config.env,
  });
}

/**
 * Sets up the ACP WebSocket endpoint on an HTTP server.
 *
 * Adds a `/ws/acp` WebSocket endpoint that bridges between browser clients
 * and ACP agent processes via stdio.
 *
 * Architecture:
 *   Browser ←→ WebSocket /ws/acp ←→ AcpClient ←→ stdio ←→ Agent Process
 */
export function setupAcpWebSocket(
  httpServer: http.Server | https.Server,
  isHttps: boolean = false,
  options: AcpWebSocketOptions = {},
): void {
  const { logPrefix = '[ACP]', defaultCwd = process.cwd(), agentCommand, agentArgs, agentEnv } = options;
  const protocol = isHttps ? 'https' : 'http';

  const wss = new WebSocketServer({ noServer: true });

  // Handle WebSocket upgrade for /ws/acp
  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '/', `${protocol}://${req.headers.host}`);

    if (url.pathname === '/ws/acp') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    }
    // Other paths are handled by existing WebSocket handlers
  });

  // Handle ACP WebSocket connections
  wss.on('connection', (ws, req) => {
    const clientAddr = req.socket.remoteAddress;
    console.log(`${logPrefix} Client connected from ${clientAddr}`);

    const client = new AcpClient(ws, { defaultCwd, agentCommand, agentArgs, agentEnv });

    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString()) as AcpWsMessage;
        await client.handleMessage(msg);
      } catch (error) {
        console.error(`${logPrefix} Message error:`, error);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'error',
            payload: { message: `Error: ${(error as Error).message}` },
          }));
        }
      }
    });

    ws.on('close', () => {
      console.log(`${logPrefix} Client disconnected: ${clientAddr}`);
      client.disconnect();
    });

    ws.on('error', (err) => {
      console.error(`${logPrefix} WebSocket error:`, err.message);
      client.disconnect();
    });
  });

  console.log(`${logPrefix} ACP WebSocket endpoint ready at /ws/acp`);
}
