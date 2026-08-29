# Clover Monorepo

A universal development solution combining a browser web app with a local proxy Agent, built on the ACP protocol.

## Repo Structure

```
clover-monorepo/
├── packages/
│   ├── agent/                  # Local proxy agent (@julyware/clover-agent)
│   │                           # Express + WebSocket + ACP + node-pty + Redis
│   │                           # Redis is optional, runs in memory mode by default
│   ├── assistant/              # Main app (clover): Angular 21 + SSR
│   │                           # Editor / terminal / ACP client UI
│   ├── common/                 # Shared TypeScript library (@julyware/common)
│   ├── community-widget/       # Community widget
│   ├── editor/                 # Editor
│   ├── forgotpassword/         # Forgot password flow
│   ├── home/                   # Homepage
│   ├── official-site/          # Official website
│   ├── resetpassword/          # Reset password flow
│   ├── signin/                 # Sign in
│   └── signup/                 # Sign up
├── docs/                       # Design documents
├── .opencode/plans/            # Feature plan documents
├── scripts/                    # Build scripts (build-with-timer.mjs)
├── static/                     # Static assets
├── nginx-conf/                 # Nginx configuration
├── supabase/                   # Supabase Edge Functions
├── nginx-containerization.md   # Nginx containerization plan
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

# agent local proxy
pnpm --filter ./packages/agent build            # tsup build
pnpm --filter ./packages/agent dev              # Watch build
```

## Root Scripts

| Command | Description |
|---------|-------------|
| `pnpm build` | Build all packages (with timer) |
| `pnpm build:agent` | Build @julyware/clover-agent only |
| `pnpm dev` | Start all packages' dev servers in parallel |
| `pnpm test` | Run all packages' tests in parallel |
