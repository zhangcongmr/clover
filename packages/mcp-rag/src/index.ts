export { createRagServer } from './server.js';
export { EmbeddingEngine } from './embedding.js';
export { VectorStore } from './store.js';
export { chunkText } from './chunker.js';
export type { RagServerOptions, VectorRecord, VectorStoreData } from './types.js';

import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createRagServer } from './server.js';

const isMainModule = process.argv[1]?.includes('index') || process.argv[1]?.includes('rag');

if (isMainModule) {
  console.error('[RAG MCP] Starting in stdio mode...');
  void serveStdio(() => createRagServer());
}
