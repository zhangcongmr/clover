# Agent Selection Feature - Implementation Plan

## Goal
Allow users to select an ACP agent from a dropdown menu in the chat input bar, instead of hardcoding the agent command in the server.

## Available Agents (from chrome-acp docs)

| Agent | Command | Args | Description |
|-------|---------|------|-------------|
| OpenCode | `opencode` | `['acp']` | Open-source terminal AI assistant |
| Claude Code | `acp-proxy` | `['--no-auth', 'claude-code-acp']` | Anthropic's coding agent |
| Codex CLI | `acp-proxy` | `['--no-auth', 'codex-acp']` | OpenAI's coding agent |
| Gemini CLI | `gemini` | `['--', '--experimental-acp']` | Google's AI agent |
| Qwen Code | `qwen` | `['--', '--acp']` | Free coding agent |
| Augment Code | `auggie` | `['--', '--acp']` | Augment's AI coding agent |

## Architecture Changes

### 1. Frontend: Agent Configuration

**File: `acp-chat-input.component.ts`**

Add an `AgentConfig` interface and predefined agent list:

```typescript
interface AgentConfig {
  id: string;
  name: string;
  command: string;
  args?: string[];
  description?: string;
}

const AVAILABLE_AGENTS: AgentConfig[] = [
  { id: 'opencode', name: 'OpenCode', command: 'opencode', args: ['acp'] },
  { id: 'claude', name: 'Claude Code', command: 'acp-proxy', args: ['--no-auth', 'claude-code-acp'] },
  { id: 'codex', name: 'Codex CLI', command: 'acp-proxy', args: ['--no-auth', 'codex-acp'] },
  { id: 'gemini', name: 'Gemini CLI', command: 'gemini', args: ['--', '--experimental-acp'] },
  { id: 'qwen', name: 'Qwen Code', command: 'qwen', args: ['--', '--acp'] },
  { id: 'augment', name: 'Augment Code', command: 'auggie', args: ['--', '--acp'] },
];
```

### 2. Frontend: Agent Selection State

**File: `acp.service.ts`**

Add `selectedAgent` signal to `AcpSessionState`:

```typescript
export interface AcpSessionState {
  // ... existing fields
  selectedAgent: AgentConfig | null;
}
```

### 3. Frontend: Modify Connect Message

**File: `acp-websocket.service.ts`**

Update the `ProxyMessage` type to include optional agent info:

```typescript
| { type: 'connect'; payload?: { command?: string; args?: string[] } }
```

Update the `connect()` method to accept and send agent config:

```typescript
connect(url: string, agent?: AgentConfig): Promise<void> {
  // ... existing code
  this.ws.onopen = () => {
    this.send({
      type: 'connect',
      payload: agent ? { command: agent.command, args: agent.args } : undefined,
    });
  };
}
```

### 4. Frontend: Agent Dropdown UI

**File: `acp-chat-input.component.ts`**

Add dropdown menu to the "Agent" button:

```html
<div class="agent-selector">
  <button class="toolbar-tag-btn" (click)="toggleAgentDropdown($event)" title="Agent">
    <svg ...><!-- crosshair icon --></svg>
    <span>{{ selectedAgent()?.name || 'Agent' }}</span>
  </button>
  @if (showAgentDropdown()) {
    <div class="agent-dropdown">
      @for (agent of agents; track agent.id) {
        <button class="agent-option" (click)="selectAgent(agent)"
          [class.active]="selectedAgent()?.id === agent.id">
          <span class="agent-name">{{ agent.name }}</span>
          @if (agent.description) {
            <span class="agent-desc">{{ agent.description }}</span>
          }
        </button>
      }
    </div>
  }
</div>
```

### 5. Backend: Accept Agent from Frontend

**File: `packages/agent/src/acp/client.ts`**

The `connect()` method already supports optional `command` and `args`:

```typescript
private async connect(params: { command?: string; args?: string[]; cwd?: string }): Promise<void> {
  const command = params.command || this.config.agentCommand;
  const args = params.args || this.config.agentArgs;
  // ... rest of the logic
}
```

**No backend changes needed** - it already handles the case where frontend sends command.

### 6. Backend: Fallback to Server Config

**File: `packages/agent/src/server.ts`**

Keep `agentCommand` and `agentArgs` in `ServerConfig` as fallback defaults:

```typescript
createServer({
  // ... existing config
  agentCommand: 'opencode',  // fallback if frontend doesn't specify
  agentArgs: ['acp'],
});
```

## Implementation Steps

1. **Add AgentConfig type and AVAILABLE_AGENTS list** to `acp-chat-input.component.ts`
2. **Add `selectedAgent` signal** to `AcpSessionState` in `acp.service.ts`
3. **Update ProxyMessage type** in `acp-websocket.service.ts` to include optional payload
4. **Update `connect()` method** in `acp-websocket.service.ts` to send agent config
5. **Update `AcpService.connect()`** to pass agent config to WebSocket service
6. **Add dropdown UI** to `acp-chat-input.component.ts`
7. **Add CSS styles** for dropdown menu
8. **Test** the full flow: select agent → connect → send message → receive response

## Files to Modify

| File | Changes |
|------|---------|
| `packages/assistant/src/app/shared/acp/acp-chat-input.component.ts` | Add dropdown UI, agent list, selection logic |
| `packages/assistant/src/app/shared/acp/acp.service.ts` | Add `selectedAgent` signal to state |
| `packages/assistant/src/app/shared/acp/acp-websocket.service.ts` | Update `connect()` to send agent config |
| `packages/agent/src/acp/client.ts` | Already handles optional command (no changes needed) |

## Verification

1. Build: `pnpm --filter ./packages/assistant build`
2. Test WebSocket connection with agent selection
3. Verify agent command is sent in connect message
4. Verify agent process spawns correctly
