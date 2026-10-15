import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import * as ort from 'onnxruntime-node';

interface AddedToken {
  id: number;
  content: string;
  special?: boolean;
}

interface TokenizerJson {
  added_tokens?: AddedToken[];
  model?: {
    vocab?: Record<string, number>;
    unk_token?: string;
    continuing_subword_prefix?: string;
  };
  normalizer?: {
    lowercase?: boolean;
    handle_chinese_chars?: boolean;
  };
}

const DEFAULT_MODEL_PATH = join('models', 'Xenova', 'all-MiniLM-L6-v2');
const CLS_TOKEN = '[CLS]';
const SEP_TOKEN = '[SEP]';
const UNK_TOKEN = '[UNK]';
const PAD_TOKEN_ID = 0;
const CLS_TOKEN_ID = 101;
const SEP_TOKEN_ID = 102;
const MAX_LENGTH = 512;

class BertTokenizer {
  private readonly vocab = new Map<string, number>();
  private readonly unkToken: string;
  private readonly prefix: string;
  private readonly lowercase: boolean;
  private readonly handleChineseChars: boolean;

  constructor(tokenizerPath: string) {
    const raw = readFileSync(tokenizerPath, 'utf-8');
    const tokenizer = JSON.parse(raw) as TokenizerJson;
    const modelVocab = tokenizer.model?.vocab || {};
    for (const [token, id] of Object.entries(modelVocab)) {
      this.vocab.set(token, id);
    }
    for (const token of tokenizer.added_tokens || []) {
      this.vocab.set(token.content, token.id);
    }
    this.unkToken = tokenizer.model?.unk_token || UNK_TOKEN;
    this.prefix = tokenizer.model?.continuing_subword_prefix || '##';
    this.lowercase = tokenizer.normalizer?.lowercase ?? true;
    this.handleChineseChars = tokenizer.normalizer?.handle_chinese_chars ?? true;
  }

  private normalize(text: string): string {
    let output = text.normalize('NFD').replace(/\p{Diacritic}/gu, '');
    if (this.lowercase) {
      output = output.toLowerCase();
    }
    return output;
  }

  private basicTokenize(text: string): string[] {
    const normalized = this.normalize(text);
    const tokens: string[] = [];
    const pattern = /\p{L}+(?:\p{L}'\p{L})*|\p{N}+(?:[.,:]\p{N}+)*|[^\s\p{L}\p{N}]/gu;
    const matches = normalized.match(pattern) || [];

    for (const match of matches) {
      if (this.handleChineseChars) {
        const chars = Array.from(match);
        const hasChinese = chars.some((char) => /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u.test(char));
        if (hasChinese && chars.every((char) => /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u.test(char))) {
          tokens.push(...chars);
          continue;
        }
      }
      tokens.push(match);
    }

    return tokens;
  }

  private wordPieceTokenize(word: string): string[] {
    const directId = this.vocab.get(word);
    if (directId !== undefined) {
      return [word];
    }

    const subwords: string[] = [];
    let remaining = word;

    while (remaining) {
      let matched = false;
      for (let end = remaining.length; end > 0; end -= 1) {
        const prefix = end === remaining.length ? remaining : `${this.prefix}${remaining.slice(0, end)}`;
        const id = this.vocab.get(prefix);
        if (id !== undefined) {
          subwords.push(prefix);
          remaining = remaining.slice(end);
          matched = true;
          break;
        }
      }

      if (!matched) {
        subwords.push(this.unkToken);
        break;
      }
    }

    return subwords;
  }

  encode(text: string): { inputIds: bigint[]; attentionMask: number[] } {
    const basicTokens = this.basicTokenize(text);
    const tokenIds: string[] = [CLS_TOKEN];

    for (const token of basicTokens) {
      for (const subword of this.wordPieceTokenize(token)) {
        tokenIds.push(subword);
        if (tokenIds.length >= MAX_LENGTH - 1) {
          break;
        }
      }
      if (tokenIds.length >= MAX_LENGTH - 1) {
        break;
      }
    }

    tokenIds.push(SEP_TOKEN);
    const ids = tokenIds.map((token) => this.vocab.get(token) ?? this.vocab.get(this.unkToken) ?? 0);

    return {
      inputIds: ids.map(BigInt),
      attentionMask: ids.map((id) => (id === PAD_TOKEN_ID ? 0 : 1)),
    };
  }
}

export class EmbeddingEngine {
  private session: ort.InferenceSession | null = null;
  private tokenizer: BertTokenizer | null = null;
  private readonly modelPath: string;
  private initializing: Promise<void> | null = null;

  constructor(modelPath?: string) {
    const configuredPath = modelPath || process.env.RAG_MODEL_PATH || DEFAULT_MODEL_PATH;
    this.modelPath = resolve(configuredPath);
  }

  async init(): Promise<void> {
    if (this.session && this.tokenizer) {
      return;
    }
    if (this.initializing) {
      return this.initializing;
    }

    this.initializing = this.load();
    return this.initializing;
  }

  private async load(): Promise<void> {
    if (!existsSync(this.modelPath)) {
      throw new Error(`RAG model not found at ${this.modelPath}. Set RAG_MODEL_PATH or pass modelPath.`);
    }

    const tokenizerPath = join(this.modelPath, 'tokenizer.json');
    if (!existsSync(tokenizerPath)) {
      throw new Error(`Tokenizer not found at ${tokenizerPath}`);
    }

    const sessionOptions: ort.InferenceSession.SessionOptions = {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all',
    };
    this.session = await ort.InferenceSession.create(
      join(this.modelPath, 'onnx', 'model.onnx'),
      sessionOptions,
    );
    this.tokenizer = new BertTokenizer(tokenizerPath);
  }

  async embed(text: string): Promise<number[]> {
    await this.init();
    if (!this.session || !this.tokenizer) {
      throw new Error('RAG embedding engine is not initialized');
    }

    const { inputIds, attentionMask } = this.tokenizer.encode(text);
    const inputTensor = new ort.Tensor('int64', BigInt64Array.from(inputIds), [1, inputIds.length]);
    const maskTensor = new ort.Tensor('int64', BigInt64Array.from(attentionMask.map(BigInt)), [1, attentionMask.length]);
    const tokenTypeTensor = new ort.Tensor('int64', BigInt64Array.from(new Array<bigint>(inputIds.length).fill(0n)), [1, inputIds.length]);
    const feeds: Record<string, ort.Tensor> = {
      input_ids: inputTensor,
      attention_mask: maskTensor,
    };
    if (this.session.inputNames.includes('token_type_ids')) {
      feeds.token_type_ids = tokenTypeTensor;
    }
    const outputs = await this.session.run(feeds);

    const outputName = this.session.outputNames[0];
    const output = outputs[outputName];
    const [batchSize, sequenceLength, hiddenSize] = output.dims as [number, number, number];
    const values = output.data as Float32Array;
    const embedding = new Array<number>(hiddenSize).fill(0);
    let tokenCount = 0;

    for (let tokenIndex = 0; tokenIndex < sequenceLength; tokenIndex += 1) {
      if (attentionMask[tokenIndex] === 0) {
        continue;
      }
      const offset = tokenIndex * hiddenSize;
      for (let hiddenIndex = 0; hiddenIndex < hiddenSize; hiddenIndex += 1) {
        embedding[hiddenIndex] += values[offset + hiddenIndex] ?? 0;
      }
      tokenCount += 1;
    }

    if (tokenCount === 0) {
      throw new Error('RAG embedding produced an empty sequence');
    }

    let norm = 0;
    for (let index = 0; index < hiddenSize; index += 1) {
      embedding[index] /= tokenCount;
      norm += embedding[index] * embedding[index];
    }

    const denominator = Math.sqrt(norm);
    if (denominator > 0) {
      for (let index = 0; index < hiddenSize; index += 1) {
        embedding[index] /= denominator;
      }
    }

    return embedding;
  }
}

export function resolveModelPath(modelPath?: string): string {
  return resolve(modelPath || process.env.RAG_MODEL_PATH || DEFAULT_MODEL_PATH);
}

export function getModelDirectory(modelPath?: string): string {
  return dirname(resolveModelPath(modelPath));
}
