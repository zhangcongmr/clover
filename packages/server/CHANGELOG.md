# @julyware/clover-server

## 0.1.5

### Patch Changes

- 57c52a3: Rename the local-host layer from `agent` to `local` and align its identifiers.
  
  The `src/agent/` directory never held AI agents — it holds the local host's
  capabilities (file system access, PTY terminal, token auth, path validation).
  The real AI agents live in `src/acp/`. The old name was a leftover from when
  this package was named `@luxio/agent`, and it collided with the ACP agent
  vocabulary used throughout the UI.
  
  **Breaking — public exports of `@julyware/clover-server` were renamed:**
  
  | Before | After |
  | --- | --- |
  | `setupAgentMiddleware()` | `setupServerMiddleware()` |
  | `AgentMiddlewareOptions` | `ServerMiddlewareOptions` |
  | `setupAgentRoutes()` | `setupLocalRoutes()` |
  | `AgentServices` | `LocalServices` |
  | `AgentMessage` | `LocalMessage` |
  | `AgentConfig` | `LocalServerConfig` |
  
  `AgentConfig` was additionally renamed to `LocalServerConfig` because the local
  layer already exported an unrelated `AgentConfig` (port/host/tokenSecret), and
  the ACP layer exports a different `AgentConfig` (id/name/command) under the
  same name from the same entry point.
  
  Update call sites accordingly:
  
  ```ts
  import { createServer, setupServerMiddleware } from '@julyware/clover-server';
  ```
  
  ACP agent names (`AgentRegistry`, `AgentStatusInfo`, `AgentRuntimeStatus`,
  `AgentConfig` under `@julyware/clover-server/acp`) are unchanged.

## 0.1.3

### Patch Changes

- Release v0.1.3: accumulated changes since 0.1.2.
  
  - ACP agents: install/uninstall from the registry, persisted `~/.clover/acp.json`, status pushed over a global SSE stream, and typed request/response interfaces for all agent endpoints.
  - Multi-agent collaboration: session-primary collaboration space with four modes, role presets, and per-agent mode/model settings.
  - Assistant UI: content-first dock layout, unified chat input, tool-call rendering (shell/edit/search), and virtual-scroll chat history.
  - Knowledge base: RAG MCP server with manager dialog and result cards, plus KaTeX math rendering and the A2UI JSON renderer.
  - Skills and MCP management: local skills store, HTTP catalogs, aggregated official MCP registry.
  - Themes: theme library with SVG previews, built-in presets, and IndexedDB persistence.
  - Fixes: agent status column alignment, ACP agent warmup deferred until first request, and a CJS build warning in the pty module.

## 0.1.2

### Patch Changes

- Release v0.1.2.

## 0.1.1

### Patch Changes

- Log all IPv4 addresses alongside localhost on server startup. Add Changesets release tooling and a publish-branch guard to prevent accidental publishes off `main`.
