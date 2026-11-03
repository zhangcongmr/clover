import type { McpServerConfig } from '../mcp/types.js';

/** 统一的 MCP 错误响应 */
export interface McpErrorResponse {
  error: string;
}

/** GET /api/mcp/servers 响应体 */
export interface ListMcpServersResponse {
  servers: McpServerConfig[];
}

/** GET /api/mcp/servers/:name 响应体 */
export interface GetMcpServerResponse {
  server: McpServerConfig;
}

/** POST /api/mcp/servers 请求体 */
export type CreateMcpServerRequest = {
  name: string;
  type: 'stdio' | 'http';
  description?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
};

/** POST /api/mcp/servers 响应体 */
export interface CreateMcpServerResponse {
  success: boolean;
  name: string;
}

/** PUT /api/mcp/servers/:name 请求体 */
export type UpdateMcpServerRequest = {
  name?: string;
  type?: 'stdio' | 'http';
  description?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
};

/** PUT /api/mcp/servers/:name 响应体 */
export interface UpdateMcpServerResponse {
  success: boolean;
  name: string;
}

/** DELETE /api/mcp/servers/:name 响应体 */
export interface DeleteMcpServerResponse {
  success: boolean;
}

/** 联合类型：任意 MCP 服务器端点的响应（成功或错误） */
export type McpServerAnyResponse =
  | ListMcpServersResponse
  | GetMcpServerResponse
  | CreateMcpServerResponse
  | UpdateMcpServerResponse
  | DeleteMcpServerResponse
  | McpErrorResponse;

/** 联合类型：任意 MCP 服务器端点的请求体 */
export type McpServerAnyRequest = CreateMcpServerRequest | UpdateMcpServerRequest;
