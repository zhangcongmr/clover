import type { Stream } from '@agentclientprotocol/sdk';
import type { WebSocket } from 'ws';

const SOCKET_OPEN = 1;

/**
 * Creates an ACP Stream from an existing `ws` WebSocket connection.
 *
 * This is the server-side counterpart of the SDK's `createWebSocketStream`,
 * which creates a client-side WebSocket. Here we adapt an incoming server
 * WebSocket into the ACP Stream interface.
 *
 * Messages are sent/received as JSON text frames.
 */
export function createWsStream(ws: WebSocket): Stream {
  let readableController: ReadableStreamDefaultController;
  let isClosed = false;
  const detachListeners: Array<() => void> = [];

  const readable = new ReadableStream({
    start(controller) {
      readableController = controller;

      const onMessage = (...args: unknown[]) => {
        if (isClosed) return;
        const data = args[0];
        const text = typeof data === 'string'
          ? data
          : Buffer.isBuffer(data)
            ? data.toString('utf-8')
            : undefined;

        if (text === undefined) return;

        let value: unknown;
        try {
          value = JSON.parse(text);
        } catch {
          console.warn('[ACP ws-stream] Ignoring malformed JSON message');
          return;
        }

        if (typeof value !== 'object' || value === null) {
          console.warn('[ACP ws-stream] Ignoring non-object message:', value);
          return;
        }

        controller.enqueue(value);
      };

      const onClose = () => {
        closeReadable();
      };

      const onError = (error: Error) => {
        errorReadable(error);
      };

      ws.on('message', onMessage);
      ws.on('close', onClose);
      ws.on('error', onError);

      detachListeners.push(
        () => ws.off('message', onMessage),
        () => ws.off('close', onClose),
        () => ws.off('error', onError),
      );
    },
    cancel() {
      close();
    },
  });

  const writable = new WritableStream({
    async write(message) {
      if (isClosed) {
        throw new Error('ACP WebSocket stream is closed');
      }
      if (ws.readyState === SOCKET_OPEN) {
        ws.send(JSON.stringify(message));
      }
    },
    close() {
      close();
    },
    abort() {
      close();
    },
  });

  function close() {
    closeSocket();
    closeReadable();
  }

  function closeSocket() {
    try {
      ws.close();
    } catch {
      // Ignore close errors
    }
  }

  function closeReadable() {
    if (isClosed) return;
    isClosed = true;
    for (const detach of detachListeners.splice(0)) {
      detach();
    }
    try {
      readableController?.close();
    } catch {
      // Stream may already be closed/cancelled
    }
  }

  function errorReadable(error: unknown) {
    if (isClosed) return;
    isClosed = true;
    for (const detach of detachListeners.splice(0)) {
      detach();
    }
    try {
      readableController?.error(error);
    } catch {
      // Stream may already be closed/cancelled
    }
  }

  return { readable, writable };
}
