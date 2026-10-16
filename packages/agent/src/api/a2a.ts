import { logger } from '../helpers/logger.js';
import type express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { Client, ClientFactory } from '@a2a-js/sdk/client';
import { Role } from '@a2a-js/sdk';
import type { Message, Part, SendMessageRequest, Task } from '@a2a-js/sdk';

export interface A2AOptions {
  enableStreaming?: boolean;
  agentCardUrl?: string;
}

export function setupA2ARoute(app: express.Application, options: A2AOptions = {}): void {
  const enableStreaming = options.enableStreaming !== false;
  const agentCardUrl = options.agentCardUrl || 'http://localhost:10002/.well-known/agent-card.json';

  app.post('/a2a', (req, res) => {
    let originalBody = '';

    req.on('data', chunk => {
      originalBody += chunk.toString();
    });

    req.on('end', async () => {
      const reqId = uuidv4();
      let sendParams: SendMessageRequest;

      if (isJson(originalBody)) {
        const requestData = JSON.parse(originalBody);
        const contextId = requestData.contextId;

        if (requestData.event) {
          logger.log(`[a2a-middleware] Received JSON UI event (req: ${reqId}):`, requestData.event);
          sendParams = createSendMessageRequest(
            [
              {
                content: { $case: 'data', value: requestData.event },
                metadata: { mimeType: 'application/a2ui+json' },
                filename: '',
                mediaType: 'application/a2ui+json',
              },
            ],
            contextId,
          );
        } else if (requestData.query) {
          logger.log(`[a2a-middleware] Received text query (req: ${reqId}):`, requestData.query);
          sendParams = createSendMessageRequest(
            [
              {
                content: { $case: 'text', value: requestData.query },
                metadata: undefined,
                filename: '',
                mediaType: 'text/plain',
              },
            ],
            contextId,
          );
        } else {
          logger.log(`[a2a-middleware] Received legacy JSON event (req: ${reqId}):`, originalBody);
          sendParams = createSendMessageRequest(
            [
              {
                content: { $case: 'data', value: requestData },
                metadata: { mimeType: 'application/a2ui+json' },
                filename: '',
                mediaType: 'application/a2ui+json',
              },
            ],
            contextId,
          );
        }
      } else {
        logger.log(`[a2a-middleware] Received plain text query (req: ${reqId}):`, originalBody);
        sendParams = createSendMessageRequest([
          {
            content: { $case: 'text', value: originalBody },
            metadata: undefined,
            filename: '',
            mediaType: 'text/plain',
          },
        ]);
      }

      try {
        const a2aClient = await createOrGetClient(agentCardUrl);
        if (enableStreaming) {
          await handleStreamingResponse(a2aClient, sendParams, res, reqId);
        } else {
          await handleNonStreamingResponse(a2aClient, sendParams, res, reqId);
        }
      } catch (error: any) {
        logger.error(`Request error (req: ${reqId}):`, error.message);
        if (!res.headersSent) {
          res.status(500).json({ error: error.message });
        } else if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
          res.end();
        }
      }
    });
  });
}

function createSendMessageRequest(parts: Part[], contextId?: string): SendMessageRequest {
  const message: Message = {
    messageId: uuidv4(),
    contextId: contextId ?? '',
    taskId: '',
    role: Role.ROLE_USER,
    parts,
    metadata: undefined,
    extensions: [],
    referenceTaskIds: [],
  };
  return {
    tenant: '',
    message,
    configuration: undefined,
    metadata: undefined,
  };
}

async function handleStreamingResponse(
  client: Client,
  sendParams: SendMessageRequest,
  res: express.Response,
  reqId: string,
) {
  logger.log(`[server] Streaming mode enabled (req: ${reqId})`);
  const stream = client.sendMessageStream(sendParams);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.status(200);

  for await (const event of stream) {
    const payload = event.payload;
    logger.log(`[server] Received event from agent: ${payload?.$case} (req: ${reqId})`);
    let parts: Part[] = [];
    let contextId: string | undefined;

    switch (payload?.$case) {
      case 'task': {
        parts = payload.value.status?.message?.parts || [];
        contextId = payload.value.contextId;
        break;
      }
      case 'message': {
        parts = payload.value.parts || [];
        contextId = payload.value.contextId;
        break;
      }
      case 'statusUpdate': {
        parts = payload.value.status?.message?.parts || [];
        contextId = payload.value.contextId;
        break;
      }
      case 'artifactUpdate': {
        parts = payload.value.artifact?.parts || [];
        contextId = payload.value.contextId;
        break;
      }
    }

    if (parts.length > 0) {
      logger.log(`[server] Streaming ${parts.length} parts to client (req: ${reqId})`);
      logger.log(`[server] Streaming parts (req: ${reqId}): ${JSON.stringify(parts)}`);
      const responseData = {
        parts,
        contextId,
      };
      res.write(`data: ${JSON.stringify(responseData)}\n\n`);
    }
  }
  res.end();
  logger.log(`[server] Stream finished (req: ${reqId})`);
}

async function handleNonStreamingResponse(
  client: Client,
  sendParams: SendMessageRequest,
  res: express.Response,
  reqId: string,
) {
  logger.log(`[server] Streaming mode disabled (req: ${reqId})`);
  const result = await client.sendMessage(sendParams);
  res.set('Cache-Control', 'no-store');

  if ('status' in result) {
    const task = result as Task;
    res.json({
      parts: task.status?.message?.parts || [],
      contextId: task.contextId,
    });
    return;
  }

  const message = result as Message;
  res.json({
    parts: message.parts || [],
    contextId: message.contextId,
  });
}

async function createOrGetClient(agentCardUrl: string) {
  const factory = new ClientFactory();
  return factory.createFromUrl(agentCardUrl, '');
}

function isJson(str: string): boolean {
  try {
    const parsed = JSON.parse(str);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
  } catch (err) {
    logger.warn(err);
    return false;
  }
}
