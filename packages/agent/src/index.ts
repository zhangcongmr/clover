// Agent services
export { TokenManager } from './agent/auth.js';
export { FileService } from './agent/file-service.js';
export type { ScanNode } from './agent/file-service.js';
export { PtyManager } from './agent/pty-manager.js';
export type { PtyInstance, IPty } from './agent/pty-manager.js';
export { validatePath, isPathInside } from './agent/security.js';
export type {
  FileAction,
  LocalFileRequest,
  LocalFileResponse,
  PtyInitMessage,
  PtyResizeMessage,
  FileWatchStartMessage,
  FileWatchStopMessage,
  FileWatchEvent,
  AgentMessage,
  TokenResponse,
  AgentConfig,
} from './agent/protocol.js';

// API routes
export { setupAgentRoutes } from './api/routes.js';
export type { AgentServices } from './api/routes.js';

// A2A handler
export { setupA2ARoute } from './api/a2a.js';
export type { A2AOptions } from './api/a2a.js';

// Middleware
export { createCORSMiddleware, createRequireAuth } from './api/middleware.js';

// WebSocket
export { setupWebSocket } from './ws/index.js';
export type { WebSocketServices, WebSocketOptions } from './ws/index.js';

// Helpers
export { loadSslConfig, isJson } from './helpers/index.js';
export type { SslConfig } from './helpers/index.js';

// Server
export { createServer } from './server.js';
export type { ServerConfig, ServerInstance } from './server.js';
