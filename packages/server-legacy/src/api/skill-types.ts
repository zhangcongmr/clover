import type { Skill, SkillDiscovery } from '../skills/index.js';

/** 统一的 Skills 错误响应 */
export interface SkillErrorResponse {
  error: string;
  detail?: string;
}

/** 统一的 Skills 成功响应基础 */
export interface SkillBaseSuccessResponse {
  success: boolean;
}

/** GET /api/skills 响应体 */
export interface ListSkillsResponse extends SkillBaseSuccessResponse {
  skills: Skill[];
  sources: string[];
  configFiles: string[];
  catalogs: string[];
}

/** GET /api/skills/:name 响应体 */
export interface GetSkillResponse {
  skill: Skill;
  writable: boolean;
  files: Record<string, string>;
}

/** POST /api/skills 请求体 */
export interface CreateSkillRequest {
  name: string;
  description?: string;
  content: string;
  files?: Record<string, string>;
}

/** POST /api/skills 响应体 */
export interface CreateSkillResponse extends SkillBaseSuccessResponse {
  name: string;
}

/** PUT /api/skills/:name 请求体 */
export interface UpdateSkillRequest {
  description?: string;
  content?: string;
}

/** PUT /api/skills/:name 响应体 */
export interface UpdateSkillResponse extends SkillBaseSuccessResponse {
  name: string;
}

/** POST /api/skills/reload 响应体 */
export interface ReloadSkillsResponse extends SkillBaseSuccessResponse {
  count: number;
  sources: string[];
  configFiles: string[];
  catalogs: string[];
  errors: string[];
}

/** POST /api/skills/:name/duplicate 响应体 */
export interface DuplicateSkillResponse extends SkillBaseSuccessResponse {
  skill: Skill;
}

/** DELETE /api/skills/:name 响应体 */
export interface DeleteSkillResponse extends SkillBaseSuccessResponse {}

/** 联合类型：任意 Skills 端点的响应（成功或错误） */
export type SkillAnyResponse =
  | ListSkillsResponse
  | GetSkillResponse
  | CreateSkillResponse
  | UpdateSkillResponse
  | ReloadSkillsResponse
  | DuplicateSkillResponse
  | DeleteSkillResponse
  | SkillErrorResponse;

/** 联合类型：任意 Skills 端点的请求体 */
export type SkillAnyRequest = CreateSkillRequest | UpdateSkillRequest;

/**
 * 技能发现快照，供前端页面加载时渲染技能列表。
 * 与 ListSkillsResponse 结构一致，但 sources 等来自 SkillDiscovery。
 */
export interface SkillDiscoverySnapshot {
  skills: Skill[];
  sources: string[];
  configFiles: string[];
  catalogs: string[];
  errors: string[];
}
