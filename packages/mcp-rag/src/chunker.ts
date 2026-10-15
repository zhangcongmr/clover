export interface Chunk {
  index: number;
  text: string;
  startOffset: number;
  endOffset: number;
}

export interface ChunkOptions {
  maxTokens?: number;
  overlap?: number;
}

const CHINESE_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const DEFAULT_MAX_TOKENS = 512;
const DEFAULT_OVERLAP = 50;
const CHINESE_MAX_CHARS = 300;
const CHINESE_OVERLAP_CHARS = 50;

function chineseRatio(text: string): number {
  const sample = text.slice(0, 10000);
  if (!sample) {
    return 0;
  }
  const matches = sample.match(new RegExp(CHINESE_PATTERN, 'g'));
  return matches ? matches.length / sample.length : 0;
}

function tokenize(text: string): string[] {
  return text.match(/[\w'-]+|[^\w\s]/gu) ?? [];
}

function chunkByTokens(text: string, maxTokens: number, overlap: number): Chunk[] {
  const tokens = tokenize(text);
  if (tokens.length === 0) {
    return [];
  }

  const effectiveMax = Math.max(1, maxTokens);
  const effectiveOverlap = Math.min(Math.max(0, overlap), effectiveMax - 1);
  const step = effectiveMax - effectiveOverlap;
  const chunks: Chunk[] = [];

  for (let start = 0; start < tokens.length; start += step) {
    const end = Math.min(tokens.length, start + effectiveMax);
    const chunkTokens = tokens.slice(start, end);
    const chunkText = chunkTokens.join(' ').replace(/\s+([,.;:!?])/g, '$1').trim();
    if (!chunkText) {
      continue;
    }
    chunks.push({
      index: chunks.length,
      text: chunkText,
      startOffset: start,
      endOffset: end,
    });
    if (end === tokens.length) {
      break;
    }
  }

  return chunks;
}

function splitChineseSentences(text: string): string[] {
  const segments = text
    .split(/(?<=[。！？!?；;])|\n+/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  return segments.length > 0 ? segments : [text];
}

function chunkChinese(text: string, maxChars: number, overlap: number): Chunk[] {
  const sentences = splitChineseSentences(text);
  const chunks: Chunk[] = [];
  let current = '';
  let sentenceOffset = 0;

  for (const sentence of sentences) {
    const candidate = current ? `${current}${sentence}` : sentence;
    if (current && candidate.length > maxChars) {
      chunks.push({
        index: chunks.length,
        text: current.trim(),
        startOffset: sentenceOffset,
        endOffset: sentenceOffset + current.length,
      });

      const overlapText = current.slice(-overlap);
      current = overlapText ? `${overlapText}${sentence}` : sentence;
      sentenceOffset += current.length - overlapText.length;
    } else {
      current = candidate;
    }
  }

  if (current.trim()) {
    chunks.push({
      index: chunks.length,
      text: current.trim(),
      startOffset: sentenceOffset,
      endOffset: sentenceOffset + current.length,
    });
  }

  return chunks.map((chunk, index) => ({ ...chunk, index }));
}

export function chunkText(text: string, options: ChunkOptions = {}): Chunk[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return [];
  }

  const maxTokens = Math.max(1, options.maxTokens ?? DEFAULT_MAX_TOKENS);
  const overlap = Math.max(0, options.overlap ?? DEFAULT_OVERLAP);

  if (chineseRatio(normalized) >= 0.2) {
    const maxChars = Math.max(1, Math.round(maxTokens * 0.6));
    const overlapChars = Math.min(Math.round(overlap * 0.6), maxChars - 1);
    return chunkChinese(normalized, maxChars, overlapChars);
  }

  return chunkByTokens(normalized, maxTokens, overlap);
}
