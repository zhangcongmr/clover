import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { EmbeddingEngine } from './embedding.js';
import { chunkText } from './chunker.js';
import { VectorStore } from './store.js';
import type { RagServerOptions } from './types.js';

export function createRagServer(options: RagServerOptions = {}): McpServer {
  const server = new McpServer({
    name: 'clover-rag',
    version: '0.1.0',
  });
  const embeddings = new EmbeddingEngine(options.modelPath);
  const store = new VectorStore(options.dataDir);
  const maxTokens = options.maxTokens;
  const overlap = options.overlap;

  server.registerTool(
    'index_document',
    {
      description: 'Index a text document for later semantic search. The document is chunked, embedded, and persisted locally.',
      inputSchema: z.object({
        content: z.string().describe('Full text content to index'),
        documentId: z.string().optional().describe('Stable document ID. Generated when omitted. Existing IDs are replaced.'),
        metadata: z.record(z.string(), z.string()).optional().describe('Optional document metadata'),
      }),
    },
    async ({ content, documentId, metadata }) => {
      const id = documentId?.trim() || randomUUID();
      const chunks = chunkText(content, { maxTokens, overlap });

      if (chunks.length === 0) {
        return {
          content: [{ type: 'text', text: 'Error: content produced no indexable chunks.' }],
          isError: true,
        };
      }

      store.deleteDocument(id);
      for (const chunk of chunks) {
        const embedding = await embeddings.embed(chunk.text);
        store.add({
          documentId: id,
          chunkIndex: chunk.index,
          text: chunk.text,
          embedding,
          metadata: metadata || {},
        });
      }

      return {
        content: [{ type: 'text', text: JSON.stringify({ documentId: id, chunksCount: chunks.length }) }],
      };
    },
  );

  server.registerTool(
    'search',
    {
      description: 'Search indexed documents by semantic similarity and return the most relevant text chunks.',
      inputSchema: z.object({
        query: z.string().describe('Natural-language search query'),
        limit: z.number().int().min(1).max(50).optional().describe('Maximum number of results (default: 5)'),
        documentId: z.string().optional().describe('Restrict search to one document ID'),
      }),
    },
    async ({ query, limit = 5, documentId }) => {
      if (!query.trim()) {
        return {
          content: [{ type: 'text', text: 'Error: query must not be empty.' }],
          isError: true,
        };
      }

      const embedding = await embeddings.embed(query);
      const results = store.search(embedding, limit, documentId?.trim() || undefined);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            results: results.map((record) => ({
              text: record.text,
              score: cosine(record.embedding, embedding),
              documentId: record.documentId,
              chunkIndex: record.chunkIndex,
              metadata: record.metadata,
            })),
          }),
        }],
      };
    },
  );

  server.registerTool(
    'list_documents',
    {
      description: 'List all indexed documents with chunk counts and metadata.',
    },
    async () => ({
      content: [{ type: 'text', text: JSON.stringify({ documents: store.listDocuments() }) }],
    }),
  );

  server.registerTool(
    'delete_document',
    {
      description: 'Delete an indexed document and all of its chunks.',
      inputSchema: z.object({
        documentId: z.string().describe('Document ID to delete'),
      }),
    },
    async ({ documentId }) => {
      const success = store.deleteDocument(documentId);
      return {
        content: [{ type: 'text', text: JSON.stringify({ success }) }],
      };
    },
  );

  server.registerTool(
    'get_document',
    {
      description: 'Retrieve all chunks and metadata for one indexed document in chunk order.',
      inputSchema: z.object({
        documentId: z.string().describe('Document ID to retrieve'),
      }),
    },
    async ({ documentId }) => {
      const chunks = store.getDocument(documentId);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            documentId,
            chunks: chunks.map((record) => ({
              index: record.chunkIndex,
              text: record.text,
              metadata: record.metadata,
            })),
          }),
        }],
      };
    },
  );

  return server;
}

function cosine(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let left = 0;
  let right = 0;
  for (let index = 0; index < length; index += 1) {
    dot += a[index] * b[index];
    left += a[index] * a[index];
    right += b[index] * b[index];
  }
  const denominator = Math.sqrt(left) * Math.sqrt(right);
  return denominator === 0 ? 0 : dot / denominator;
}
