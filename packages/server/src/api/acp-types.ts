import type * as acp from '@agentclientprotocol/sdk';

/** 统一的 ACP 错误响应，所有端点的错误返回均可兼容此结构。 */
export interface AcpErrorResponse {
  error: string;
  code?: string;
}

/** 成功响应基础 */
export interface AcpBaseSuccessResponse {
  success: boolean;
}

/* ========================================================================
   SSE 流端点
   ======================================================================== */

/** POST /api/acp/stream/:sessionId 命令通道请求体 */
export interface StreamCommandRequest {
  id?: string;
  method: 'prompt' | 'cancel' | 'permission';
  params?: any;
}

/** POST /api/acp/stream/:sessionId 命令通道响应体 */
export interface StreamCommandResponse {
  accepted: boolean;
  id: string | null;
}

/* ========================================================================
   会话管理
   ======================================================================== */

/** GET /api/acp/session/:sessionId 响应体 */
export interface AcpSessionStatusResponse {
  sessionId: string;
  status: string;
  createdAt: number;
  lastActivity: number;
  hasConnection: boolean;
}

/** DELETE /api/acp/session/:sessionId 响应体 */
export interface DeleteAcpSessionResponse extends AcpBaseSuccessResponse {
  message: string;
}

/** POST /api/acp/session/create 请求体 */
export interface CreateAcpSessionRequest {
  agentId: string;
  cwd?: string;
  mcpServers?: string[] | acp.McpServer[];
}

/** POST /api/acp/session/create 响应体 */
export interface CreateAcpSessionResponse extends AcpBaseSuccessResponse {
  agentId: string;
  sessionId: string;
  status?: string;
  createdAt?: number;
}

/** POST /api/acp/session/list 请求体 */
export interface ListAcpSessionsRequest {
  agentId: string;
  cwd?: string;
  cursor?: string;
}

/** POST /api/acp/session/list 响应体 */
export interface ListAcpSessionsResponse extends AcpBaseSuccessResponse {
  sessions: any[];
  nextCursor?: string;
}

/** POST /api/acp/list-all-sessions 请求体 */
export interface ListAllSessionsAgent {
  id: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface ListAllSessionsRequest {
  cwd: string;
  agents: ListAllSessionsAgent[];
}

export interface ListAllSessionsSession {
  agentId: string;
  [key: string]: any;
}

export interface ListAllSessionsFailure {
  agentId: string;
  error: string;
}

export interface ListAllSessionsResponse extends AcpBaseSuccessResponse {
  sessions: ListAllSessionsSession[];
  failures: ListAllSessionsFailure[];
}

/** POST /api/acp/session/load | /api/acp/session/resume 请求体 */
export interface AcpSessionLoadRequest {
  sessionId: string;
  agentId?: string;
  cwd?: string;
  mcpServers?: string[] | acp.McpServer[];
}

/** POST /api/acp/session/load | /api/acp/session/resume 响应体 */
export interface AcpSessionLoadResponse extends AcpBaseSuccessResponse {
  sessionId?: string;
  [key: string]: unknown;
}

/** POST /api/acp/session/delete 请求体 */
export interface DeleteAcpSessionRequest {
  sessionId: string;
  agentId?: string;
}

/* ========================================================================
   配置
   ======================================================================== */

/** POST /api/acp/config 请求体 */
export interface SetAcpConfigRequest {
  sessionId: string;
  configId: string;
  type: string;
  value: unknown;
}

/** POST /api/acp/config 响应体 */
export interface SetAcpConfigResponse extends AcpBaseSuccessResponse {}

/** GET /api/acp/agent-config 响应体 */
export interface GetAgentConfigResponse {
  success: true;
  configOptions: acp.SessionConfigOption[] | null;
}

/** POST /api/acp/agent-config 请求体 */
export interface SaveAgentConfigRequest {
  agentId: string;
  configOptions: acp.SessionConfigOption[];
}

/** POST /api/acp/agent-config 响应体 */
export interface SaveAgentConfigResponse extends AcpBaseSuccessResponse {
  unchanged?: boolean;
}

/* ========================================================================
   其他
   ======================================================================== */

/** POST /api/acp/ping 请求体 */
export interface PingRequest {
  sessionId: string;
}

/** POST /api/acp/ping 响应体 */
export interface PingResponse extends AcpBaseSuccessResponse {
  pong: boolean;
  timestamp: number;
}

/** GET /api/acp/status 响应体 */
export interface AcpStatusResponse {
  sessions: number;
  activeSessions: number;
  connections: number;
  eventSink: string;
}

/** GET /api/acp/health 响应体 */
export interface AcpHealthResponse {
  status: string;
  eventSink: string;
  timestamp: number;
}

/** GET /api/acp/agents 响应体 */
export interface ListAgentsResponse {
  agents: any[];
}

/** POST /api/acp/agents/:id/check 响应体 */
export interface CheckAgentResponse {
  agent: any;
}

/** POST /api/acp/agents/install 响应体 */
export interface InstallAgentResponse {
  job: any;
}

/** GET /api/acp/agents/install/:jobId 响应体 */
export interface GetInstallJobResponse {
  job: any;
}

/** POST /api/acp/agents/:id/update 响应体 */
export interface UpdateAgentResponse {
  success: boolean;
  agent: any | null;
}

/* ========================================================================
   项目管理（与 routes.ts /api/local 并列，但仍挂在 acp-routes 上）
   ======================================================================== */

export interface ProjectSession {
  sessionId: string;
  agentId: string;
  title?: string;
  updatedAt?: string;
}

export interface ProjectInfo {
  name: string;
  path: string;
  type: 'project' | 'task';
  sessions: ProjectSession[];
  id?: string;
  createdAt?: string;
}

/** POST /api/projects 响应体 */
export interface ListProjectsResponse {
  success: true;
  projects: ProjectInfo[];
}

/** POST /api/tasks 响应体 */
export interface ListTasksResponse {
  success: true;
  tasks: ProjectInfo[];
}

/** POST /api/projects/add 请求体 */
export interface AddProjectRequest {
  name: string;
  path: string;
  type: 'project' | 'task';
  sessions?: ProjectSession[];
  id?: string;
  createdAt?: string;
}

/** POST /api/projects/add 响应体 */
export interface AddProjectResponse {
  success: true;
  task?: ProjectInfo;
  projects?: ProjectInfo[];
}

/** POST /api/projects/delete 请求体 */
export interface DeleteProjectRequest {
  name?: string;
  type?: 'project' | 'task';
  id?: string;
}

/** POST /api/projects/delete 响应体 */
export interface DeleteProjectResponse {
  success: true;
}

/** POST /api/projects/save-session 请求体 */
export interface SaveSessionRequest {
  projectPath: string;
  session: ProjectSession;
}

/** POST /api/projects/save-session 响应体 */
export interface SaveSessionResponse {
  success: true;
  project?: ProjectInfo;
  task?: ProjectInfo;
}

/** POST /api/projects/delete-session 请求体 */
export interface DeleteSessionFromProjectRequest {
  projectPath: string;
  sessionId: string;
}

/** POST /api/projects/delete-session 响应体 */
export interface DeleteSessionFromProjectResponse {
  success: true;
}

/** GET /api/projects/selected 响应体 */
export interface GetSelectedProjectResponse {
  success: true;
  selectedProject: string | null;
  selectedSessionId: string | null;
}

/** POST /api/projects/selected 请求体 */
export interface SetSelectedProjectRequest {
  selectedProject: string | null;
  selectedSessionId: string | null;
}

/** POST /api/projects/selected 响应体 */
export interface SetSelectedProjectResponse {
  success: true;
}

/** Agent 配置持久化条目：按 agentId 保存 configOptions（mode/model 选择器）。 */
export interface AgentConfigEntry {
  configOptions: acp.SessionConfigOption[];
  updatedAt?: string;
}

export type AgentConfigFile = Record<string, AgentConfigEntry>;
