---
"@julyware/clover-server": patch
---

Rename the local-host layer from `agent` to `local` and align its identifiers.

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
