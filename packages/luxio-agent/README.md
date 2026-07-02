# @luxio/agent

Local proxy agent for Luxio Web App. Provides file system access and PTY terminal services via WebSocket.

## Installation

```bash
# From monorepo root
pnpm --filter @luxio/agent build

# Or globally (when published)
npm install -g @luxio/agent
```

## Usage

```bash
# Start the agent with default settings (port 9120, current directory as workspace)
luxio-agent

# Custom workspace and port
luxio-agent --workspace "C:\Users\me\my-project" --port 9200

# Read-only mode (no file writes)
luxio-agent --workspace /path/to/project --readonly
```

## CLI Options

| Option | Description | Default |
|--------|-------------|---------|
| `-p, --port` | Port to listen on | `9120` |
| `-w, --workspace` | Workspace root path | `cwd` |
| `--host` | Host to bind | `127.0.0.1` |
| `--readonly` | Enable read-only mode | `false` |
| `--token-secret` | Secret for token signing | random |
| `--token-ttl` | Token TTL in seconds | `30` |
| `--allowed-origins` | Comma-separated allowed origins | auto |

## API

### HTTP Endpoints

- `GET /health` - Health check
- `GET /token` - Get authentication token

### WebSocket Protocol

Connect to `ws://127.0.0.1:9120?token=<token>` and send one of:

#### File Service

```json
{ "type": "file-service" }
```

Then send file requests:

```json
{
  "type": "file-request",
  "action": "readFile",
  "path": "src/index.ts",
  "requestId": "req-1"
}
```

Available actions: `listDir`, `readFile`, `writeFile`, `deleteFile`, `createFile`, `createDir`, `rename`, `stat`, `exists`

#### PTY Terminal

```json
{ "type": "pty", "cols": 80, "rows": 24, "cwd": "src" }
```

Then send raw input/output data (xterm.js AttachAddon compatible).

## Security

- Token-based authentication (HMAC-SHA256, one-time use)
- Binds to `127.0.0.1` only (no network access)
- Origin header validation
- Path traversal protection
