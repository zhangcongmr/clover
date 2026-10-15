import { Injectable } from '@angular/core';

/**
 * Official MCP Registry（https://registry.modelcontextprotocol.io）v0.1 API 客户端。
 *
 * 作为 MCP Servers 管理器的聚合数据源：从官方注册中心检索 server 条目，
 * 并把 registry 条目归一化为本地可保存的 MCP server 配置（stdio / http）。
 *
 * API 参考：https://registry.modelcontextprotocol.io/docs（OpenAPI `openapi.json`）
 * - GET /v0.1/servers?cursor&limit&search&version   → 分页 + 名称子串搜索
 * - 响应 `{ servers: ServerResponse[], metadata: { count, nextCursor? } }`
 * - `ServerResponse = { server: ServerJSON, _meta }`
 *
 * 官方 registry 已开启 CORS（默认 `Access-Control-Allow-Origin: *`），
 * 浏览器可直连，无需后端代理。
 */

/** 官方注册中心基础地址（未来聚合其它注册中心时按数据源区分）。 */
export const OFFICIAL_REGISTRY_BASE_URL = 'https://registry.modelcontextprotocol.io';

/** registry 扩展元数据键（`_meta` 中官方注册中心的命名空间）。 */
const OFFICIAL_META_KEY = 'io.modelcontextprotocol.registry/official';

/** 单页最大条目数（API 上限 100，默认 30）。 */
const DEFAULT_PAGE_SIZE = 30;

/* -------------------------------------------------------------------------- */
/* Registry v0.1 响应类型（按 OpenAPI 精简，仅保留消费到的字段）                 */
/* -------------------------------------------------------------------------- */

export interface RegistryKeyValueInput {
  name: string;
  value?: string;
  description?: string;
  isRequired?: boolean;
  isSecret?: boolean;
  default?: string;
}

export interface RegistryArgument {
  /** `positional` 或 `named`。 */
  type: string;
  /** named 参数的旗标（含前导短横线，如 `--port`）。 */
  name?: string;
  value?: string;
}

export interface RegistryTransport {
  /** `stdio` | `streamable-http` | `sse`。 */
  type: string;
  url?: string;
  headers?: RegistryKeyValueInput[];
}

export interface RegistryPackage {
  /** `npm` | `pypi` | `cargo` | `oci` | `nuget` | `mcpb` 等。 */
  registryType: string;
  identifier: string;
  version?: string;
  /** 运行时提示，如 `npx`、`uvx`。 */
  runtimeHint?: string;
  runtimeArguments?: RegistryArgument[];
  packageArguments?: RegistryArgument[];
  environmentVariables?: RegistryKeyValueInput[];
  transport?: RegistryTransport;
}

export interface RegistryRepository {
  url?: string;
  source?: string;
  subfolder?: string;
}

export interface RegistryServerJSON {
  name: string;
  title?: string;
  description?: string;
  version?: string;
  websiteUrl?: string;
  repository?: RegistryRepository;
  packages?: RegistryPackage[];
  remotes?: RegistryTransport[];
}

export interface RegistryExtensions {
  status: 'active' | 'deprecated' | 'deleted' | string;
  statusChangedAt?: string;
  publishedAt?: string;
  updatedAt?: string;
  isLatest?: boolean;
  statusMessage?: string;
}

export interface RegistryServerResponse {
  server: RegistryServerJSON;
  _meta?: {
    [OFFICIAL_META_KEY]?: RegistryExtensions;
  };
}

export interface RegistryListResponse {
  servers?: RegistryServerResponse[] | null;
  metadata?: { count?: number; nextCursor?: string } | null;
}

/** 归一化后的 registry 列表条目。 */
export interface RegistryListItem {
  /** 去重键：`name@version`。 */
  key: string;
  server: RegistryServerJSON;
  /** 生命周期状态：`active` / `deprecated` / `deleted`。 */
  status: string;
  isLatest: boolean;
}

/** 归一化后的一页数据。 */
export interface RegistryPage {
  items: RegistryListItem[];
  nextCursor: string | null;
  count: number;
}

export interface RegistryListOptions {
  /** 名称子串搜索（API `search`）。 */
  search?: string;
  /** 上一页返回的游标（API `cursor`）。 */
  cursor?: string | null;
  /** 每页条数，1–100，默认 30。 */
  limit?: number;
  /** `latest`（默认，去重版本）或精确版本号。 */
  version?: string;
}

/* -------------------------------------------------------------------------- */
/* 本地配置形状（与 mcp-manager / packages·agent POST body 对齐）               */
/* -------------------------------------------------------------------------- */

/** 本地已保存的 MCP server 配置，与 `packages/agent/src/mcp/types.ts` 的
 *  `McpServerConfig` 一一对应（后端持久化在 `~/.clover/mcp-servers.json`）。 */
export interface LocalMcpServerConfig {
  type: 'stdio' | 'http';
  name: string;
  description: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

/* -------------------------------------------------------------------------- */
/* 纯函数：命名 / 映射 / 预览（独立导出，便于单测）                             */
/* -------------------------------------------------------------------------- */

/** 把任意字符串 sanitize 成本地 name 合法片段（`[a-zA-Z0-9_-]`）。 */
function sanitizeNamePart(raw: string): string {
  return raw
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

/**
 * registry name（反向 DNS，如 `io.github.user/weather`）的本地候选名：
 * 1. 最后一段（`weather`）——短、可读；
 * 2. 全名 sanitize（`io.github.user-weather`）——回退用。
 * 结果去重且均非空（最多两个候选）。
 */
export function localNameCandidates(registryName: string): string[] {
  const trimmed = (registryName ?? '').trim();
  const base = trimmed.includes('/')
    ? trimmed.slice(trimmed.lastIndexOf('/') + 1)
    : trimmed;
  const candidates = [sanitizeNamePart(base), sanitizeNamePart(trimmed.replace(/\//g, '-'))];
  return [...new Set(candidates.filter(c => c.length > 0))];
}

/**
 * 为 registry 条目推导一个可用的本地 name：
 * 按候选顺序取第一个未被占用的；全部占用返回 null（安装应被阻止，
 * 因为本地 POST /api/mcp/servers 为 upsert，会覆盖同名配置）。
 */
export function deriveLocalName(
  registryName: string,
  taken: Iterable<string>,
): string | null {
  const takenSet = taken instanceof Set ? taken : new Set(taken);
  for (const candidate of localNameCandidates(registryName)) {
    if (!takenSet.has(candidate)) return candidate;
  }
  return null;
}

/** KeyValueInput[] → Record（跳过空名/空值）。用于 http headers。 */
function kvToRecord(entries?: RegistryKeyValueInput[] | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of entries ?? []) {
    if (!entry || typeof entry.name !== 'string' || !entry.name) continue;
    const value = entry.value ?? entry.default ?? '';
    if (value !== '') out[entry.name] = value;
  }
  return out;
}

/**
 * environmentVariables → env Record：所有声明的变量都保留
 * （无值时留空串），以便用户在配置文件中看到需要补哪些环境变量；
 * 与 headers 不同，空值不丢弃。
 */
function envRecord(entries?: RegistryKeyValueInput[] | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of entries ?? []) {
    if (!entry || typeof entry.name !== 'string' || !entry.name) continue;
    out[entry.name] = entry.value ?? entry.default ?? '';
  }
  return out;
}

/** 展开 runtime/package 参数：named → `--flag value`（旗标缺省补 `--`），positional → `value`。 */
function expandArgs(args?: RegistryArgument[] | null): string[] {
  const out: string[] = [];
  for (const arg of args ?? []) {
    if (!arg) continue;
    if (arg.type === 'named' && arg.name) {
      out.push(arg.name.startsWith('-') ? arg.name : `--${arg.name}`);
      if (arg.value != null && arg.value !== '') out.push(arg.value);
    } else if (arg.value != null && arg.value !== '') {
      out.push(arg.value);
    }
  }
  return out;
}

/** 各 registryType 的默认运行时（runtimeHint 缺失时的回退）。 */
const RUNTIME_BY_REGISTRY: Record<string, string> = {
  npm: 'npx',
  pypi: 'uvx',
  nuget: 'dotnet',
  oci: 'docker',
};

/** 需要 `identifier@version` 形式锁定版本的 registryType。 */
const VERSIONED_IDENTIFIER_TYPES = new Set(['npm', 'pypi', 'nuget']);

/** package 是否可在本地以 stdio 方式直接运行。 */
function isRunnablePackage(pkg: RegistryPackage): boolean {
  if (!pkg || typeof pkg.identifier !== 'string' || !pkg.identifier) return false;
  const transportType = pkg.transport?.type;
  if (transportType && transportType !== 'stdio') return false;
  return Boolean(pkg.runtimeHint) || Boolean(RUNTIME_BY_REGISTRY[pkg.registryType]);
}

/** package 的运行命令（runtimeHint 优先，其次按 registryType 回退）。 */
function runtimeCommand(pkg: RegistryPackage): string | null {
  return pkg.runtimeHint?.trim() || RUNTIME_BY_REGISTRY[pkg.registryType] || null;
}

/** package 的标识参数：npm/pypi/nuget 锁 `identifier@version`，其余用裸 identifier。 */
function identifierArg(pkg: RegistryPackage): string {
  const version = pkg.version?.trim();
  if (version && VERSIONED_IDENTIFIER_TYPES.has(pkg.registryType)) {
    return `${pkg.identifier}@${version}`;
  }
  return pkg.identifier;
}

/** 从 package 生成 stdio 配置的 command/args/env。 */
function buildStdioConfig(
  pkg: RegistryPackage,
  localName: string,
  description: string,
): LocalMcpServerConfig | null {
  const command = runtimeCommand(pkg);
  if (!command) return null;

  const args = [
    ...expandArgs(pkg.runtimeArguments),
    ...expandArgs(pkg.packageArguments),
    identifierArg(pkg),
  ];
  // npx 安装交互确认：registry 条目常自带 `-y`，缺省时补上。
  if (command === 'npx' && !args.includes('-y')) args.unshift('-y');

  return {
    type: 'stdio',
    name: localName,
    description,
    command,
    args,
    env: envRecord(pkg.environmentVariables),
  };
}

/** 从 package 的本地 http transport 生成 http 配置（罕见，但 schema 允许）。 */
function buildHttpConfigFromTransport(
  transport: RegistryTransport,
  localName: string,
  description: string,
): LocalMcpServerConfig | null {
  if (!transport.url) return null;
  return {
    type: 'http',
    name: localName,
    description,
    url: transport.url,
    headers: kvToRecord(transport.headers),
  };
}

/**
 * 把 registry 条目映射为本地 MCP server 配置。
 *
 * 优先级：
 * 1. `remotes[]`（streamable-http / sse）→ 本地 `http`，免运行时；
 * 2. package 内嵌的 http transport → 本地 `http`；
 * 3. 第一个可运行的 package → 本地 `stdio`（command/args/env）。
 *
 * 无法本地运行（如 mcpb 且无 runtimeHint）时返回 null，
 * 调用方应降级为“仅打开外部链接”。
 */
export function buildLocalConfig(
  server: RegistryServerJSON,
  localName: string,
): LocalMcpServerConfig | null {
  if (!server || !localName) return null;
  const description = (server.description || server.title || '').slice(0, 300);

  const remote = (server.remotes ?? []).find(r => r && r.url);
  if (remote) return buildHttpConfigFromTransport(remote, localName, description);

  for (const pkg of server.packages ?? []) {
    if (!pkg) continue;
    if (pkg.transport?.type && pkg.transport.type !== 'stdio' && pkg.transport.url) {
      const http = buildHttpConfigFromTransport(pkg.transport, localName, description);
      if (http) return http;
    }
    if (isRunnablePackage(pkg)) {
      const stdio = buildStdioConfig(pkg, localName, description);
      if (stdio) return stdio;
    }
  }
  return null;
}

/** 列表预览串：`npx -y pkg@1.2.3` 或 remote URL；不可运行时返回 null。 */
export function summarizeServer(server: RegistryServerJSON): string | null {
  const config = buildLocalConfig(server, 'preview');
  if (!config) return null;
  return config.type === 'http' ? config.url! : [config.command, ...(config.args ?? [])].join(' ');
}

/* -------------------------------------------------------------------------- */
/* Service                                                                     */
/* -------------------------------------------------------------------------- */

@Injectable({ providedIn: 'root' })
export class McpRegistryService {
  /** 聚合数据源基础地址；当前仅官方注册中心。 */
  readonly baseUrl = OFFICIAL_REGISTRY_BASE_URL;

  /**
   * 拉取一页 registry server（`GET /v0.1/servers`）。
   * 默认 `version=latest` 去重版本、`limit=30`。
   * 非 2xx 抛出带 registry `ErrorModel.detail` 的 Error。
   */
  async listServers(opts: RegistryListOptions = {}): Promise<RegistryPage> {
    const url = new URL('/v0.1/servers', this.baseUrl);
    const limit = clampLimit(opts.limit);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('version', opts.version || 'latest');
    const search = opts.search?.trim();
    if (search) url.searchParams.set('search', search);
    if (opts.cursor) url.searchParams.set('cursor', opts.cursor);

    let res: Response;
    try {
      res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
    } catch {
      throw new Error(
        `Cannot reach ${new URL(this.baseUrl).host} (network or CORS error)`,
      );
    }

    if (!res.ok) {
      let detail = `Registry request failed (HTTP ${res.status})`;
      try {
        const body = (await res.json()) as { detail?: string; title?: string };
        detail = body?.detail || body?.title || detail;
      } catch {
        // 保留默认信息
      }
      throw new Error(detail);
    }

    const body = (await res.json()) as RegistryListResponse;
    return normalizeListResponse(body, limit);
  }
}

/** limit 钳制到 API 允许的 1–100。 */
function clampLimit(limit?: number): number {
  if (!limit || !Number.isFinite(limit)) return DEFAULT_PAGE_SIZE;
  return Math.min(100, Math.max(1, Math.floor(limit)));
}

/** 把原始响应归一化为 `RegistryPage`（过滤脏数据、按 `name@version` 去重）。 */
export function normalizeListResponse(
  body: RegistryListResponse,
  limit: number,
): RegistryPage {
  const items: RegistryListItem[] = [];
  const seen = new Set<string>();

  for (const entry of body?.servers ?? []) {
    const server = entry?.server;
    if (!server || typeof server.name !== 'string' || !server.name) continue;
    const version = typeof server.version === 'string' ? server.version : '';
    const key = version ? `${server.name}@${version}` : server.name;
    if (seen.has(key)) continue;
    seen.add(key);

    const extensions = entry._meta?.[OFFICIAL_META_KEY];
    items.push({
      key,
      server,
      status: extensions?.status ?? 'active',
      isLatest: extensions?.isLatest ?? false,
    });
    if (items.length >= limit) break;
  }

  return {
    items,
    nextCursor: body?.metadata?.nextCursor || null,
    count: body?.metadata?.count ?? items.length,
  };
}
