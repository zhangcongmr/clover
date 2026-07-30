# ACP Config Endpoint - Implementation Plan

## Goal
Add an HTTP endpoint to dynamically set ACP agent config (`agentCommand`, `agentArgs`), and defer `setupAcpWebSocket` until config is received from frontend.

## Architecture

```
Server startup
  ├── setupAgentMiddleware(app, options)
  │     └── setupAgentRoutes(app, services)  → includes POST /api/local/acp/config
  ├── create httpServer
  ├── setupWebSocket(httpServer, services, sslConfig)
  └── return (no setupAcp call)

Frontend init
  ├── POST /api/local/acp/config { command: "opencode", args: ["acp"] }
  │     └── stores config, calls setupAcpWebSocket(httpServer, sslConfig, config)
  └── WebSocket /ws/acp → AcpClient
```

## Changes

### 1. `packages/agent/src/api/routes.ts`
- Add `AcpConfigState` interface: `{ command?: string; args?: string[] }`
- Add `POST /api/local/acp/config` endpoint (no auth required)
  - Request body: `{ command: string; args?: string[] }`
  - Stores config in module-level variable
  - Returns: `{ success: true, config: AcpConfigState }`
- Export `getAcpConfig()` and `setAcpConfig()` functions

### 2. `packages/agent/src/acp/index.ts`
- Add `acpConfig` module-level state: `{ command?: string; args?: string[]; httpServer?: HttpServer; sslConfig?: SslConfig }`
- Export `setAcpConfig(config)` — stores config, calls `setupAcpWebSocket` if httpServer is ready
- Export `setAcpHttpServer(httpServer, sslConfig)` — stores server reference, calls `setupAcpWebSocket` if config is ready
- Export `getAcpConfig()` — returns current config
- Modify `setupAcpWebSocket` to guard against duplicate calls

### 3. `packages/agent/src/server.ts`
- Remove `setupAcp(httpServer, sslConfig)` call from `createServer`
- After creating httpServer, call `setAcpHttpServer(httpServer, sslConfig)`
- Remove `agentCommand`/`agentArgs` from `AgentMiddlewareOptions` and `ServerConfig` (no longer needed)
- Keep the `setupAcp` closure in `setupAgentMiddleware` but it's now only a fallback

### 4. `packages/agent/src/index.ts`
- Export new `setAcpConfig`, `getAcpConfig`, `setAcpHttpServer` functions

### 5. `packages/assistant/src/app/shared/acp/acp.service.ts`
- In `connect()` method, after connection is established, call `POST /api/local/acp/config` with selected agent
- Or better: call it before connect, and also when agent changes

### 6. `packages/assistant/src/app/shared/acp/acp-chat-input.component.ts`
- In `selectAgent()`, after setting the signal, call `acpService.setAcpConfig(agent)`
- On component init (or on connect), call `acpService.setAcpConfig(acpService.selectedAgent())`

## Files to Modify

| File | Changes |
|------|---------|
| `packages/agent/src/acp/index.ts` | Add lazy setup logic, `setAcpConfig`, `setAcpHttpServer` |
| `packages/agent/src/api/routes.ts` | Add `POST /api/local/acp/config` endpoint |
| `packages/agent/src/server.ts` | Remove startup `setupAcp` call, add `setAcpHttpServer` call |
| `packages/agent/src/index.ts` | Export new functions |
| `packages/assistant/src/app/shared/acp/acp.service.ts` | Add `setAcpConfig()` method |
| `packages/assistant/src/app/shared/acp/acp-chat-input.component.ts` | Call `setAcpConfig` on init and agent change |

## Verification

1. `npx tsc --noEmit` in packages/agent
2. `pnpm run build` in packages/agent and packages/assistant
3. Test: server starts → no ACP WebSocket yet → frontend calls config endpoint → ACP WebSocket becomes available → frontend connects to `/ws/acp`
