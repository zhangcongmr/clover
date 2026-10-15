export interface VectorRecord {
  id: string;
  documentId: string;
  chunkIndex: number;
  text: string;
  embedding: number[];
  metadata: Record<string, string>;
  createdAt: string;
}

export interface VectorStoreData {
  records: VectorRecord[];
}

export interface RagServerOptions {
  modelPath?: string;
  dataDir?: string;
  maxTokens?: number;
  overlap?: number;
}
