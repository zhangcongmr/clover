# Clover Monorepo

A universal development solution combining a browser web app with a local proxy Agent, built on the ACP protocol.

## Screenshots

| | |
|:---:|:---:|
| <img src="docs/screenshots/welcome.png" alt="Clover welcome screen with one-click starters" width="100%"><br><sub>Welcome screen with one-click starters</sub> | <img src="docs/screenshots/external-agents.png" alt="Agent and model picker for external agents" width="100%"><br><sub>Bring your own agent — OpenCode, Claude Code, Codex CLI, Gemini CLI, Qwen Code, Augment Code</sub> |
| <img src="docs/screenshots/AI-driven-theme-generate.png" alt="AI-driven theme generation with live preview" width="100%"><br><sub>AI-driven theme generation with live preview</sub> | <img src="docs/screenshots/agent-first-main.png" alt="ACP chat with visible tool calls" width="100%"><br><sub>ACP chat with visible tool calls</sub> |
| <img src="docs/screenshots/content-first-sessions.png" alt="Editor, file tree and project sessions side by side" width="100%"><br><sub>Editor, file tree and project sessions side by side</sub> | <img src="docs/screenshots/multi-agent-collaboration.png" alt="Multi-agent collaboration with pipeline, parallel and voluntary-claim orchestration" width="100%"><br><sub>Multi-agent collaboration — pipeline, parallel and voluntary-claim orchestration</sub> |

## Repo Structure

```
clover-monorepo/
├── packages/
│   ├── server/                 # Local proxy server (@julyware/clover-server)
│   │                           # Express + WebSocket + ACP + node-pty + Redis
│   │                           # Redis is optional, runs in memory mode by default
│   ├── assistant/              # Main app (clover): Angular 21 + SSR
│   │                           # Editor / terminal / ACP client UI
│   ├── common/                 # Shared TypeScript library (@julyware/common)
│   ├── community-widget/       # Community widget
│   ├── clover/                 # Clover
├── docs/                       # Design documents
├── .opencode/plans/            # Feature plan documents
├── scripts/                    # Build scripts (build-with-timer.mjs)
├── static/                     # Static assets
├── pnpm-workspace.yaml         # pnpm workspace config
├── package.json                # Root package.json
└── README.md
```

## Tech Stack

- **Package Manager**: pnpm workspace
- **Runtime**: Node.js >= 22
- **Frontend**: Angular 21 (SSR), TypeScript, Tailwind CSS
- **Proxy Agent**: Express, WebSocket, ACP (Agent Client Protocol), node-pty, Redis
- **Build Tools**: tsup, Angular CLI

> **Redis Note**: Redis is an optional dependency that requires a separate Redis service deployment. By default, the application runs in memory mode without Redis subscriptions. To enable Redis, set the environment variable `REDIS_USE_MEMORY_FALLBACK=false`.

## Getting Started

```bash
# Install dependencies
pnpm install

# Start dev servers for all packages
pnpm dev

# Build the local proxy agent
pnpm build:agent

# Build everything
pnpm build
```

### Key Package Commands

```bash
# assistant main app
pnpm --filter ./packages/assistant start        # Dev server (HTTPS)
pnpm --filter ./packages/assistant build        # Build + style inlining + type declarations
pnpm --filter ./packages/assistant serve:ssr:clover  # Run SSR server

# server local proxy
pnpm --filter ./packages/server build            # tsup build
pnpm --filter ./packages/server dev              # Watch build
pnpm --filter ./packages/server test             # vitest run (CLI tests)
```

## CLI

The published `clover` binary exposes two commands:

```bash
clover run "summarise the open PRs"   # Run one task with an installed agent, then exit
clover run --agent codex "…"           # Pick a specific agent
clover serve                           # Start the local server (same as no arguments)
```

`clover run` drives the ACP session in-process — it never starts the web
server. Agent output goes to stdout (so it can be piped), library logs go to
stderr. Agents come from `~/.clover/acp.json`, which the web UI maintains; the
CLI never installs or modifies them.

| Option | Applies to | Description |
|--------|------------|-------------|
| `--agent <id>` | `run` | Run with this agent id (it must be installed) |
| `--root <dir>` | `run` | Workspace directory (default: current directory) |
| `--json` | `run` | Print raw session events as NDJSON |
| `--approve` | `run` | Approve permission requests automatically (default: deny) |
| `-p, --port N` | `serve` | Set the server port |
| `--readonly` | `serve` | Serve in read-only mode (no file writes) |

## Root Scripts

| Command | Description |
|---------|-------------|
| `pnpm build` | Build all packages (with timer) |
| `pnpm build:server` | Build @julyware/clover-server only |
| `pnpm dev` | Start all packages' dev servers in parallel |
| `pnpm test` | Run all packages' tests in parallel |
