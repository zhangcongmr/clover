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

// ACP routes (SSE + Redis)
export { setupAcpRoutes } from './api/acp-routes.js';
export type { AcpRouteOptions } from './api/acp-routes.js';

// A2A handler
export { setupA2ARoute } from './api/a2a.js';
export type { A2AOptions } from './api/a2a.js';

// Middleware
export { createCORSMiddleware, createRequireAuth } from './api/middleware.js';

// WebSocket
export { setupWebSocket } from './ws/index.js';
export type { WebSocketServices, WebSocketOptions } from './ws/index.js';

// Redis
export { RedisClient } from './redis/client.js';
export type { RedisConfig } from './redis/client.js';

// Helpers
export { loadSslConfig, isJson } from './helpers/index.js';
export type { SslConfig } from './helpers/index.js';

// Server
export { createServer, setupAgentMiddleware } from './server.js';
export type { ServerConfig, ServerInstance, AgentMiddlewareOptions } from './server.js';

// ACP Client (WebSocket)
export { setupAcpWebSocket, setAcpConfig, getAcpConfig, setAcpHttpServer, storeAcpHttpServer, isAcpHttpServerReady } from './acp/index.js';
export type { AcpWebSocketOptions, AcpConfig } from './acp/index.js';
export { AcpClient } from './acp/client.js';
export type { AcpClientConfig } from './acp/client.js';
export { AgentProcess } from './acp/agent-process.js';
export type { AgentProcessConfig } from './acp/agent-process.js';
export type {
  AcpWsMessage,
  AcpWsResponse,
  PendingPermission,
} from './acp/types.js';

// ACP SSE + Redis
export { SseManager } from './acp/sse-manager.js';
export type { SseConnection, ServerEvent } from './acp/sse-manager.js';
export { AcpSessionManager } from './acp/session-manager.js';
export type { AcpSession, SessionCreateOptions, SessionMessage } from './acp/session-manager.js';
export { SseAcpClient } from './acp/sse-client.js';
export type { SseAcpClientConfig } from './acp/sse-client.js';
