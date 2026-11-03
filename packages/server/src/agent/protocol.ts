export type FileAction =
  | 'listDir'
  | 'readFile'
  | 'writeFile'
  | 'deleteFile'
  | 'createFile'
  | 'createDir'
  | 'rename'
  | 'stat'
  | 'exists'
  | 'scan'
  | 'openInFileExplorer';

export interface LocalFileRequest {
  type: 'file-request';
  action: FileAction;
  path: string;
  content?: string;
  newName?: string;
  requestId?: string;
}

export interface LocalFileResponse {
  type: 'file-service';
  success: boolean;
  requestId?: string;
  data?: any;
  message?: string;
}

export interface PtyInitMessage {
  type: 'pty';
  cols: number;
  rows: number;
  cwd?: string;
}

export interface PtyResizeMessage {
  type: 'resize';
  cols: number;
  rows: number;
}

export interface FileServiceInitMessage {
  type: 'file-service';
}

export interface FileWatchStartMessage {
  type: 'file-watch-start';
  path: string;
  requestId?: string;
}

export interface FileWatchStopMessage {
  type: 'file-watch-stop';
  path: string;
}

export interface FileWatchEvent {
  type: 'file-watch-event';
  path: string;
  eventType: 'change' | 'rename';
  requestId?: string;
}

export type AgentMessage = PtyInitMessage | PtyResizeMessage | FileServiceInitMessage | LocalFileRequest | FileWatchStartMessage | FileWatchStopMessage;

export interface TokenResponse {
  token: string;
  expiresIn: number;
}

export interface AgentConfig {
  port: number;
  host: string;
  allowedOrigins?: string[];
  tokenSecret?: string;
  tokenTTL?: number;
  readonly?: boolean;
}
