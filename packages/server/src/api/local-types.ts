import type { LocalFileResponse } from '../local/protocol.js';

/** 统一的本地文件操作错误响应 */
export interface LocalFileErrorResponse {
  success: false;
  message: string;
}

/** 统一的本地文件操作成功响应 */
export interface LocalFileSuccessResponse {
  success: true;
  message?: string;
}

/** POST /api/local/scan 请求体 */
export interface ScanRequest {
  path: string;
  depth?: number;
  ignore?: string[];
}

/** POST /api/local/scan 响应体 */
export interface ScanResponse extends LocalFileSuccessResponse {
  data: any; // ScanNode 树
}

/** POST /api/local/listDir 请求体 */
export interface ListDirRequest {
  path: string;
}

/** POST /api/local/listDir 响应体 */
export interface ListDirResponse extends LocalFileSuccessResponse {
  data: string[];
}

/** POST /api/local/readFile 请求体 */
export interface ReadFileRequest {
  path: string;
}

/** POST /api/local/readFile 响应体 */
export interface ReadFileResponse extends LocalFileSuccessResponse {
  data: string;
}

/** POST /api/local/writeFile 请求体 */
export interface WriteFileRequest {
  path: string;
  content: string;
}

/** POST /api/local/writeFile 响应体 */
export interface WriteFileResponse extends LocalFileSuccessResponse {
  data: unknown;
}

/** POST /api/local/deleteFile 请求体 */
export interface DeleteFileRequest {
  path: string;
}

/** POST /api/local/deleteFile 响应体 */
export interface DeleteFileResponse extends LocalFileSuccessResponse {
  data: unknown;
}

/** POST /api/local/createFile 请求体 */
export interface CreateFileRequest {
  path: string;
}

/** POST /api/local/createFile 响应体 */
export interface CreateFileResponse extends LocalFileSuccessResponse {
  data: unknown;
}

/** POST /api/local/createDir 请求体 */
export interface CreateDirRequest {
  path: string;
}

/** POST /api/local/createDir 响应体 */
export interface CreateDirResponse extends LocalFileSuccessResponse {
  data: unknown;
}

/** POST /api/local/rename 请求体 */
export interface RenameRequest {
  path: string;
  newName: string;
}

/** POST /api/local/rename 响应体 */
export interface RenameResponse extends LocalFileSuccessResponse {
  data: unknown;
}

/** POST /api/local/stat 请求体 */
export interface StatRequest {
  path: string;
}

/** POST /api/local/stat 响应体 */
export interface StatResponse extends LocalFileSuccessResponse {
  data: any; // fs.Stats
}

/** POST /api/local/exists 请求体 */
export interface ExistsRequest {
  path: string;
}

/** POST /api/local/exists 响应体 */
export interface ExistsResponse extends LocalFileSuccessResponse {
  data: boolean;
}

/** POST /api/local/openInFileExplorer 请求体 */
export interface OpenInFileExplorerRequest {
  path: string;
}

/** POST /api/local/openInFileExplorer 响应体 */
export interface OpenInFileExplorerResponse extends LocalFileSuccessResponse {
  data: unknown;
}

/** GET /api/local/auth/token 响应体 */
export interface TokenResponse {
  token: string;
  expiresIn: number;
}

/** GET /api/local/health 响应体 */
export interface HealthResponse {
  status: string;
  readonly: boolean;
}

/** 联合类型：任意本地文件端点的成功响应 */
export type LocalFileAnySuccessResponse =
  | ScanResponse
  | ListDirResponse
  | ReadFileResponse
  | WriteFileResponse
  | DeleteFileResponse
  | CreateFileResponse
  | CreateDirResponse
  | RenameResponse
  | StatResponse
  | ExistsResponse
  | OpenInFileExplorerResponse;

/** 联合类型：任意本地文件端点的响应（成功或错误） */
export type LocalFileAnyResponse = LocalFileAnySuccessResponse | LocalFileErrorResponse;

/** 通用的文件操作请求体联合（用于需要泛型 ReqBody 但各接口字段不同的场景） */
export type LocalFileAnyRequest =
  | ScanRequest
  | ListDirRequest
  | ReadFileRequest
  | WriteFileRequest
  | DeleteFileRequest
  | CreateFileRequest
  | CreateDirRequest
  | RenameRequest
  | StatRequest
  | ExistsRequest
  | OpenInFileExplorerRequest;
