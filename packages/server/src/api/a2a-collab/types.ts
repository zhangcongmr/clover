import type { SessionConfigOption } from '@agentclientprotocol/sdk';

/** 统一的 A2A 协作错误响应 */
export interface A2aCollabErrorResponse {
  success: false;
  message: string;
}

/** 统一的 A2A 协作成功响应基础 */
export interface A2aCollabBaseSuccessResponse {
  success: true;
}

/** POST /api/a2a/collab/spaces 请求体 */
export interface CreateCollabSpaceRequest {
  cwd: string;
  participants: { id: string; agentId: string }[];
  orchestratorId?: string;
}

/** 协作空间成员信息（响应中使用） */
export interface CollabSpaceMember {
  id: string;
  agentId: string;
  sessionId: string;
  configOptions: SessionConfigOption[];
  role: string;
  responsibility: string;
  capabilities: any;
}

/** POST /api/a2a/collab/spaces 响应体 */
export interface CreateCollabSpaceResponse extends A2aCollabBaseSuccessResponse {
  spaceId: string;
  cwd: string;
  orchestratorId: string | null;
  participants: CollabSpaceMember[];
}

/** DELETE /api/a2a/collab/spaces/:spaceId 响应体 */
export interface DeleteCollabSpaceResponse extends A2aCollabBaseSuccessResponse {}

/** 联合类型：任意协作空间端点的响应（成功或错误） */
export type CollabSpaceAnyResponse =
  | CreateCollabSpaceResponse
  | DeleteCollabSpaceResponse
  | A2aCollabErrorResponse;

/** 联合类型：任意协作空间端点的请求体 */
export type CollabSpaceAnyRequest = CreateCollabSpaceRequest;
