# clover-server (Rust)

A pure-Rust implementation of the Clover local server, replacing `packages/server-legacy` (the old
TypeScript implementation, kept for one release cycle).
It **does not depend on Tauri**, so it can either be started in-process by the desktop app
(`packages/desktop/src-tauri`) or packaged and shipped as a standalone CLI.

## Artifacts

| Artifact | Description |
|---|---|
| `libclover_server` | All server logic (HTTP/WS, ACP engine, files/PTY/MCP/Skills) |
| `clover` (bin) | Standalone CLI: `clover serve` / `clover run` |

The desktop app is a separate binary (`Clover64`, see `packages/desktop/src-tauri`); the two are packaged separately.

### Embedded Web UI

`clover` can serve both the API and the Angular UI on the same port, with no Node and no extra static directory:

```bash
pnpm build:web                    # build the frontend (production, no source maps)
pnpm stage:web                    # copy it to packages/server-rust/web/
cargo build --release -p clover-server --features web-ui
target/release/clover serve       # open http://127.0.0.1:4200 in a browser
```

- `web-ui` is an optional feature, off by default: the desktop app depends on this crate as a library, so it does not carry an extra copy of the frontend.
- Assets are embedded at compile time via `rust-embed`; `scripts/build-npm.mjs` runs `stage-web.mjs` automatically.
- `clover serve --static-dir <dir>` still prefers an external directory, which is convenient for frontend debugging.
- `clover run` does not start an HTTP server; its behavior is unchanged.

## Commands

```bash
# Run from the repo root (Cargo workspace)
cargo run -p clover-server --features web-ui -- serve   # API + embedded Web UI
cargo run -p clover-server -- serve -p 4321
cargo run -p clover-server -- serve --readonly
cargo run -p clover-server -- serve --static-dir dist/clover/browser
cargo run -p clover-server -- run "summarise this repo" --agent codex
cargo test -p clover-server
cargo build --release -p clover-server --features web-ui   # target/release/clover
```

Running `clover` with no arguments is equivalent to `clover serve`; `-h/--help`, `-v/--version` and `-p/--port` behave as in the old CLI.
Exit codes: `0` success, `1` usage/ACP error, `130` interrupted.

## npm release (binary distribution)

The same Rust build output is published as npm packages, so no Rust toolchain is needed after installation:

```bash
npm i -g @julyware/clover-cli
clover serve -p 4321
```

| Package | Contents |
|---|---|
| `@julyware/clover-cli` | Main package: only the `bin/clover.js` launcher, which picks the sub-package for the platform |
| `@julyware/clover-cli-win32-x64` | Windows x64 `clover.exe` |
| `@julyware/clover-cli-darwin-x64` / `-darwin-arm64` | macOS Intel / Apple Silicon |
| `@julyware/clover-cli-linux-x64-gnu` / `-linux-arm64-gnu` | Linux glibc |

The sub-packages are `optionalDependencies` of the main package, so npm downloads only the one for the current platform (the same approach as esbuild / codex).
The launcher can also point directly at any binary via `CLOVER_CLI_BIN=/path/to/clover` (for local debugging).

### Build

```bash
# Current platform (release build, output written to packages/server-rust/npm/<platform>/)
# Builds the frontend and stages it to packages/server-rust/web/ first, then compiles with --features web-ui
pnpm build:cli:npm

# Frontend only / staging only
pnpm build:web
pnpm stage:web

# Specific target (requires the matching toolchain / cross linker locally)
node packages/server-rust/scripts/build-npm.mjs --target aarch64-apple-darwin

# Reuse an already-built binary and skip cargo build
node packages/server-rust/scripts/build-npm.mjs --binary target/release/clover.exe

# web/ was already staged by another job (used by CI), skip copying again
node packages/server-rust/scripts/build-npm.mjs --web-prebuilt

# Specific version (defaults to the version in packages/server-rust/package.json)
node packages/server-rust/scripts/build-npm.mjs --version 0.1.6
```

Supported targets: `x86_64-pc-windows-msvc`, `aarch64-pc-windows-msvc`, `x86_64-apple-darwin`,
`aarch64-apple-darwin`, `x86_64-unknown-linux-gnu`, `aarch64-unknown-linux-gnu`,
`x86_64-unknown-linux-musl`, `aarch64-unknown-linux-musl`.
`npm/` is a generated directory and is listed in `.gitignore`.

`packages/server-rust` is a regular pnpm workspace member, but its `package.json` in the repo
**does not** declare `optionalDependencies`: the platform sub-packages only exist after a build, and
declaring them would make `pnpm install` resolve unpublished versions and pull roughly 5 MiB of
platform binaries into development and into `pnpm-lock.yaml`.
`publish-npm.mjs` injects these dependencies into the manifest temporarily when publishing the main
package and restores it right after publishing finishes.

### Versions and releases

The version number has exactly one source of truth: changesets.

1. `pnpm changeset` records the change (`@julyware/clover-cli` appears in the list like any other package);
2. `pnpm release` (root script) runs `changeset version`, bumping all `@julyware/*` packages together and
   syncing `[workspace.package] version` in `Cargo.toml` to the same version (this is what `clover -v` prints);
3. The same command publishes the JS packages with `pnpm -r publish` (the CLI is not in that list);
4. After committing the version change, tag the commit; CI builds 5 platforms and publishes the CLI.

```bash
pnpm release                          # changeset version + pnpm -r publish
git tag clover-cli-v0.1.6             # the tag must match packages/server-rust/package.json
git push origin clover-cli-v0.1.6
```

`.github/workflows/publish-clover-cli.yml` first checks that the tag matches the version in `package.json`
and fails immediately otherwise, so there is no second path that "bumps the version independently".
The frontend is built only once, in a separate `web` job, and passed to the 5 platforms as an artifact;
the binaries embed those assets via `--features web-ui` (about 6 MiB more).
The publish script itself only uploads already-built packages:

```bash
pnpm publish:cli                      # publish the current version with pnpm publish (sub-packages first, then the main package)
pnpm publish:cli -- --dry-run         # pack only, do not push
pnpm publish:cli -- --tag next        # publish to a dist-tag
pnpm publish:cli -- --allow-partial   # explicitly allow publishing when only some platforms were built
```

When the main package is published, its `optionalDependencies` are generated by the script from the
platforms **actually built** (with `--allow-partial`, only the already-published sub-packages are referenced).
Before publishing, `scripts/guard-publish.mjs` runs: publishing is only allowed from the `main`
branch or from a tagged commit. `build-npm.mjs --version` only affects the locally generated sub-package
manifests; publishing fails if it does not match `package.json`, so CI no longer passes `--version`.
The repository secret `NPM_TOKEN` is required.

## A2A

| Endpoint | Description |
|---|---|
| `POST /api/a2a/collab/spaces` | Create a collaboration space (one ACP session per participant) |
| `DELETE /api/a2a/collab/spaces/{spaceId}` | Close the space and release its sessions |
| `GET /api/a2a/orchestrator/.well-known/agent-card.json` | Orchestrator agent card |
| `POST /api/a2a/orchestrator/` | Orchestrator JSON-RPC (`SendMessage` / `SendStreamingMessage` / `GetTask` / `CancelTask`) |
| `GET /api/a2a/agents/{agentId}/.well-known/agent-card.json` | Single-agent bridge card |
| `POST /api/a2a/agents/{agentId}/` | Single-agent JSON-RPC (routing forced to that agent) |
| `POST /a2a` | Unauthenticated proxy: forwards to an external A2A agent (A2UI demo client) |

- Four collaboration modes are driven by `message.metadata.collab`: `single` (explicit/role/orchestrator/keyword routing), `pipeline` (fixed order or decided by the orchestrator), `parallel` (subtasks + optional aggregation), `voluntary` (broadcast and claim + conflict policy).
- Streaming responses follow the SDK wire format: the `data:` of each SSE frame is `{"jsonrpc":"2.0","id":…,"result":{"task"|"statusUpdate"|"artifactUpdate"}}`.
- A member's `agent_message_chunk` is pushed as an `append` artifact delta, with a `lastChunk` sent when it finishes.

## `clover run`

- The agent is read only from `~/.clover/acp.json`; the CLI does not install, register, or write any configuration.
- stdout carries only the agent's text output (an NDJSON event stream with `--json`); prompts/permissions/errors all go to stderr.
- Options may be written before or after the prompt; anything after `--` is always treated as the prompt.
- Permission requests are answered by the CLI: `reject_once` is selected by default, `allow_once` with `--approve` (if the corresponding option is missing, it answers `cancelled`).
- Ctrl-C cancels the current turn, waits up to 5s for cleanup, and exits with code `130`.

## Environment variables

| Variable | Purpose |
|---|---|
| `PORT` | Listen port (default 4200) |
| `CLOVER_READONLY` | When `true`, refuse to write files |
| `CLOVER_STATE_DIR` | State root directory (default `~/.clover`; used by tests/portable installs) |
| `CLOVER_HOME_DIR` | Overrides the user home directory (`~` expansion, global skill source; used by the parity sandbox) |
| `CLOVER_TOKEN_SECRET` | Auth token secret (random if unset, valid only for this process) |
| `CLOVER_LOG_DIR` | Log directory (default `~/.clover/logs`) |
| `CLOVER_LOG_TO_FILE` | `false` disables file logging |
| `CLOVER_LOG_PREFIX` | Log file name prefix (default `agent`) |
| `CLOVER_LOG_MAX_FILES` | Number of log files to keep (default 10) |
| `A2A_BASE_URL` | Absolute URL written into agent cards (default: derived from the request Host) |
| `A2A_AGENT_CARD_URL` | Upstream agent card for the `/a2a` proxy (default `http://localhost:10002/.well-known/agent-card.json`) |
| `A2A_BRIDGE_TIMEOUT_MS` | Timeout for a single member prompt (default 600000) |
| `A2A_ROUTE_TIMEOUT_MS` | Timeout for internal prompts used by orchestration/claim decisions (default 30000) |
| `RUST_LOG` | Console log level (default `info`) |

## State directory

Everything keeps the old layout, so existing installs need no migration: `~/.clover/{acp.json,agent-config.json,projects.json,tasks.json,selected-project.json,mcp-servers.json,skills.json,skills/,agents/,logs/}`.

## Binary agent installation

`binary` distributions are unpacked in-process (`zip` / `tar.gz`; `tar.bz2` uses the system `tar`), with no dependency on PowerShell or `unzip`.
Downloads go through `reqwest`, with the TLS backend chosen per platform: the system stack on Windows/macOS (no C toolchain needed), rustls on Linux (no OpenSSL headers needed).
The install directory is `<state_dir>/agents/<agentId>/`, i.e. `~/.clover/agents/<agentId>/` by default.

## Implemented / Planned

| Phase | Scope | Status |
|---|---|---|
| P0 | Workspace, server skeleton, CORS, HMAC tokens, `/api/local/health`, `/api/local/auth/token`, CLI `serve` | ✅ |
| P0.5 | In-process Tauri startup + `server_info` + frontend base URL injection | ✅ |
| P1 | 12 `/api/local/*` file operations + `roots`, `notify` file watching, `portable-pty`, `/ws/terminal`, `/ws/file-watch` | ✅ |
| P2 | 5 `/api/mcp/servers` endpoints + `~/.clover/mcp-servers.json` (including `${VAR}` expansion) | ✅ |
| P3 | 7 `/api/skills*` endpoints + multi-source discovery (front matter / JSONC / readonly detection / companion files) | ✅ |
| P4 | ACP basics: JSON-RPC, subprocess, liveness probing, `acp.json`, AgentRegistry + status SSE | ✅ |
| P5 | ACP sessions: session management, session SSE (resume/ownership), prompt/cancel/permission, activity stream | ✅ |
| P6 | Agent install/uninstall/update (npx/uvx/binary + sha256 + unpacking), install job polling, 8 projects/tasks endpoints | ✅ |
| P7 | Full `clover run` implementation (stdout keeps only agent output, automatic permission answers, exit codes) | ✅ |
| P8 | A2A: collaboration spaces, orchestrator/pipeline/parallel/claim modes, agent cards, `/a2a` proxy | ✅ |
| P9 | Parity comparison (23 cases, including SSE/WS), old implementation renamed to `packages/server-legacy`, docs finalized | ✅ |

See `docs/rust-server-migration-plan.md` for the full plan.

## Comparison with the old implementation

```bash
node scripts/parity.mjs                 # all stages (http + ws + acp)
node scripts/parity.mjs --stage http    # HTTP only (fast)
node scripts/parity.mjs --only local    # only cases whose name contains local
node scripts/parity.mjs --list          # list cases
```

The script builds the old `packages/server-legacy/dist` and `target/debug/clover` itself, prepares one
home + workspace for each side, and diffs field by field using the same set of requests (status codes, JSON, SSE events, WS frames). Any difference yields exit code 1;
`--keep` preserves the sandboxes and server logs. Sandboxes go to `target/parity/` by default (`PARITY_TMPDIR` overrides it).

## Conventions

- Routes, status codes, and JSON fields match the old implementation (`packages/server-legacy`); the frontend does not need to change any call sites for the new backend.
- The token format is byte-compatible with the old implementation: `base64url_nopad("<expiresAtMs>:<nonceHex>:<hmacSha256Hex>")`.
- On Windows, every console subprocess (agent launch, liveness probing, install/unpack, `taskkill`) is started through `HideConsole` with `CREATE_NO_WINDOW`: the desktop app is a GUI subsystem process with no console of its own, so otherwise every subprocess would pop up its own window.
- The library does not initialize a global `tracing` subscriber and does not use any Tauri API.