import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { VectorRecord, VectorStoreData } from './types.js';

const DEFAULT_DATA_DIR = join(
  process.env.USERPROFILE || process.env.HOME || '.',
  '.clover',
  'rag-data',
);

export class VectorStore {
  private readonly filePath: string;
  private data: VectorStoreData = { records: [] };

  constructor(dataDir?: string) {
    const baseDir = dataDir || process.env.RAG_DATA_DIR || DEFAULT_DATA_DIR;
    this.filePath = join(baseDir, 'vector-store.json');
    this.load();
  }

  private load(): void {
    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw) as VectorStoreData;
        this.data = {
          records: Array.isArray(parsed.records) ? parsed.records : [],
        };
      }
    } catch (error) {
      console.error('[RAG Store] Failed to load vector store:', error);
      this.data = { records: [] };
    }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
    } catch (error) {
      console.error('[RAG Store] Failed to save vector store:', error);
    }
  }

  add(record: Omit<VectorRecord, 'id' | 'createdAt'>): VectorRecord {
    const created: VectorRecord = {
      ...record,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    this.data.records.push(created);
    this.save();
    return created;
  }

  search(queryEmbedding: number[], limit: number, documentId?: string): VectorRecord[] {
    const candidates = documentId
      ? this.data.records.filter((record) => record.documentId === documentId)
      : this.data.records;

    return candidates
      .map((record) => ({
        record,
        score: cosineSimilarity(queryEmbedding, record.embedding),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, limit))
      .map(({ record }) => record);
  }

  listDocuments(): Array<{ documentId: string; chunkCount: number; metadata: Record<string, string> }> {
    const grouped = new Map<string, { chunkCount: number; metadata: Record<string, string> }>();

    for (const record of this.data.records) {
      const entry = grouped.get(record.documentId) || {
        chunkCount: 0,
        metadata: record.metadata,
      };
      entry.chunkCount += 1;
      grouped.set(record.documentId, entry);
    }

    return Array.from(grouped.entries()).map(([documentId, value]) => ({
      documentId,
      ...value,
    }));
  }

  getDocument(documentId: string): VectorRecord[] {
    return this.data.records
      .filter((record) => record.documentId === documentId)
      .sort((a, b) => a.chunkIndex - b.chunkIndex);
  }

  deleteDocument(documentId: string): boolean {
    const before = this.data.records.length;
    this.data.records = this.data.records.filter((record) => record.documentId !== documentId);
    const changed = this.data.records.length !== before;
    if (changed) {
      this.save();
    }
    return changed;
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  if (length === 0) {
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < length; index += 1) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dot / denominator;
}
