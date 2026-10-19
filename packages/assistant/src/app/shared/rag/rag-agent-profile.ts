import type { RagToolKind } from '../acp/tool-call-info.pipe';

/**
 * RAG Agent profile model.
 *
 * A profile is the "RAG 专用 Agent 配置": it bundles the knowledge-base data
 * sources ({@link serverNames}) with the retrieval strategy and the prompt-level
 * knobs the agent should follow. Profiles are pure data — persisted in
 * localStorage and consumed by {@link RagService}. No backend store is involved.
 */

/** How results from the selected data sources are combined. */
export type RagRetrievalStrategy = 'vector' | 'fanout-rrf' | 'hybrid';

export interface RagStrategyOption {
  id: RagRetrievalStrategy;
  label: string;
  hint: string;
}

export const RAG_STRATEGIES: ReadonlyArray<RagStrategyOption> = [
  { id: 'vector', label: 'Vector', hint: '单一数据源的语义检索（默认）。' },
  { id: 'fanout-rrf', label: 'Fan-out (RRF)', hint: '对每个数据源分别检索，再按 Reciprocal Rank Fusion 合并去重。' },
  { id: 'hybrid', label: 'Hybrid', hint: '向量 + 关键词混合检索；需要 RAG server 支持，否则由 agent 退化为向量检索。' },
];

export const ALL_RAG_TOOLS: ReadonlyArray<RagToolKind> = ['search', 'index', 'list', 'delete'];

export const DEFAULT_CITATION_STYLE = '【{documentId}#{chunkIndex}】';

export const DEFAULT_ANSWER_INSTRUCTION =
  '仅依据检索命中的分块作答；引用处标注来源。若命中内容不足以回答，请明确说明，不要编造。';

/** A named, switchable RAG configuration. */
export interface RagAgentProfile {
  id: string;
  name: string;
  /** MCP server names treated as knowledge bases. Order matters for fan-out. */
  serverNames: string[];
  strategy: RagRetrievalStrategy;
  /** Default number of hits requested from `search`. */
  defaultTopK: number;
  /** Hits below this similarity are ignored by the agent (0 disables the floor). */
  minScore: number;
  /** Citation template using `{documentId}` / `{chunkIndex}` placeholders. */
  citationStyle: string;
  /** Extra instructions appended to every retrieval prompt. */
  answerInstruction: string;
  /** Which knowledge-base tools the agent is allowed to use. */
  toolAllowlist: RagToolKind[];
  /** Attach {@link serverNames} to the session on every submit from this panel. */
  autoAttach: boolean;
}

let profileSeq = 0;

/** Locally-unique profile id (no crypto dependency, works under SSR too). */
export function newProfileId(): string {
  profileSeq += 1;
  return `rag-profile-${Date.now().toString(36)}-${profileSeq}`;
}

export function defaultProfile(overrides: Partial<RagAgentProfile> = {}): RagAgentProfile {
  return {
    id: newProfileId(),
    name: 'Default',
    serverNames: [],
    strategy: 'vector',
    defaultTopK: 5,
    minScore: 0,
    citationStyle: DEFAULT_CITATION_STYLE,
    answerInstruction: DEFAULT_ANSWER_INSTRUCTION,
    toolAllowlist: [...ALL_RAG_TOOLS],
    autoAttach: true,
    ...overrides,
  };
}

function asStrategy(value: unknown): RagRetrievalStrategy {
  return value === 'fanout-rrf' || value === 'hybrid' || value === 'vector' ? value : 'vector';
}

function asTools(value: unknown): RagToolKind[] {
  if (!Array.isArray(value)) return [...ALL_RAG_TOOLS];
  const allowed = value.filter(
    (tool): tool is RagToolKind => (ALL_RAG_TOOLS as ReadonlyArray<string>).includes(tool as string),
  );
  return allowed.length > 0 ? allowed : [...ALL_RAG_TOOLS];
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.round(num * 100) / 100));
}

/** Coerces untrusted (localStorage) data into a valid profile, filling defaults. */
export function normalizeProfile(raw: unknown): RagAgentProfile {
  const source = (raw ?? {}) as Partial<RagAgentProfile>;
  const base = defaultProfile();
  return {
    id: typeof source.id === 'string' && source.id ? source.id : base.id,
    name: typeof source.name === 'string' && source.name.trim() ? source.name.trim() : base.name,
    serverNames: Array.isArray(source.serverNames)
      ? source.serverNames.filter((n): n is string => typeof n === 'string' && n.length > 0)
      : [],
    strategy: asStrategy(source.strategy),
    defaultTopK: clampNumber(source.defaultTopK, base.defaultTopK, 1, 50),
    minScore: clampNumber(source.minScore, base.minScore, 0, 1),
    citationStyle:
      typeof source.citationStyle === 'string' && source.citationStyle.trim()
        ? source.citationStyle
        : base.citationStyle,
    answerInstruction:
      typeof source.answerInstruction === 'string' ? source.answerInstruction : base.answerInstruction,
    toolAllowlist: asTools(source.toolAllowlist),
    autoAttach: source.autoAttach !== false,
  };
}

export function canUseTool(profile: RagAgentProfile, tool: RagToolKind): boolean {
  return profile.toolAllowlist.includes(tool);
}

/** CSV-ish helper used by the settings form to edit document scopes. */
export function parseList(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map(part => part.trim())
    .filter(part => part.length > 0);
}

export function formatList(values: readonly string[]): string {
  return values.join('\n');
}
