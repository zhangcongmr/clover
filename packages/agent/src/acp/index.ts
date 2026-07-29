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
  sslConfig?: { cert: Buffer; key: Buffer } | null,
  options: AcpWebSocketOptions = {},
): void {
  const { logPrefix = '[ACP]', defaultCwd = process.cwd(), agentCommand, agentArgs } = options;
  const protocol = sslConfig ? 'https' : 'http';

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

    const client = new AcpClient(ws, { defaultCwd, agentCommand, agentArgs });

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
