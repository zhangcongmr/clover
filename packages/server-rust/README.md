# clover-server (Rust)

纯 Rust 实现的 Clover 本地服务，替代 `packages/server-legacy`（旧 TypeScript 实现，保留一个发布周期）。
**不依赖 Tauri**，因此既能被桌面端（`packages/assistant/src-tauri`）以进程内方式启动，
也能作为独立 CLI 打包分发。

## 产物

| 产物 | 说明 |
|---|---|
| `libclover_server` | 全部服务逻辑（HTTP/WS、ACP 引擎、文件/PTY/MCP/Skills） |
| `clover` (bin) | 独立 CLI：`clover serve` / `clover run` |

桌面端是另一个二进制（`Clover64`，见 `packages/assistant/src-tauri`），两者分开打包。

## 命令

```bash
# 从仓库根执行（Cargo workspace）
cargo run -p clover-server -- serve                 # 默认 127.0.0.1:4200
cargo run -p clover-server -- serve -p 4321
cargo run -p clover-server -- serve --readonly
cargo run -p clover-server -- serve --static-dir dist/clover/browser
cargo run -p clover-server -- run "summarise this repo" --agent codex
cargo test -p clover-server
cargo build --release -p clover-server              # target/release/clover
```

`clover` 无参数等价于 `clover serve`；`-h/--help`、`-v/--version`、`-p/--port` 与旧 CLI 一致。
退出码：`0` 正常、`1` 用法/ACP 错误、`130` 中断。

## npm 发布（二进制分发）

同一份 Rust 构建产物会以 npm 包的形式发布，安装后不需要 Rust 工具链：

```bash
npm i -g @julyware/clover-cli
clover serve -p 4321
```

| 包 | 内容 |
|---|---|
| `@julyware/clover-cli` | 主包：只有 `bin/clover.js` 启动器，按平台挑选下面的子包 |
| `@julyware/clover-cli-win32-x64` | Windows x64 `clover.exe` |
| `@julyware/clover-cli-darwin-x64` / `-darwin-arm64` | macOS Intel / Apple Silicon |
| `@julyware/clover-cli-linux-x64-gnu` / `-linux-arm64-gnu` | Linux glibc |

子包是主包的 `optionalDependencies`，npm 只会下载当前平台的那一个（与 esbuild / codex 的做法一致）。
启动器也可以用 `CLOVER_CLI_BIN=/path/to/clover` 直接指向任意二进制（本地调试用）。

### 构建

```bash
# 当前平台（release 编译，产物写入 packages/server-rust/npm/<platform>/）
pnpm build:cli:npm

# 指定目标（需要本机有对应 toolchain / 交叉链接器）
node packages/server-rust/scripts/build-npm.mjs --target aarch64-apple-darwin

# 复用已经编译好的二进制，跳过 cargo build
node packages/server-rust/scripts/build-npm.mjs --binary target/release/clover.exe

# 指定版本（默认取 packages/server-rust/package.json 的 version）
node packages/server-rust/scripts/build-npm.mjs --version 0.1.6
```

支持的目标：`x86_64-pc-windows-msvc`、`aarch64-pc-windows-msvc`、`x86_64-apple-darwin`、
`aarch64-apple-darwin`、`x86_64-unknown-linux-gnu`、`aarch64-unknown-linux-gnu`、
`x86_64-unknown-linux-musl`、`aarch64-unknown-linux-musl`。
`npm/` 是生成目录，已加入 `.gitignore`。

`packages/server-rust` 是 pnpm workspace 的普通成员，但仓库里的 `package.json`
**不写** `optionalDependencies`：平台子包只有构建后才存在，写进去会让 `pnpm install`
去解析尚未发布的版本，并给开发和 `pnpm-lock.yaml` 带进约 5 MiB 的平台二进制。
这些依赖在发布主包时由 `publish-npm.mjs` 临时注入清单，发布结束立即还原。

### 版本与发布

版本号只有 changesets 一个来源：

1. `pnpm changeset` 记录改动（`@julyware/clover-cli` 会像其它包一样出现在列表里）；
2. `pnpm release`（根脚本）执行 `changeset version`，`@julyware/*` 一起升版本；
3. 同一条命令用 `pnpm -r publish` 发布 JS 包（CLI 不在这个列表里）；
4. 提交版本变更后打 tag，CI 构建 5 个平台并发布 CLI。

```bash
pnpm release                          # changeset version + pnpm -r publish
git tag clover-cli-v0.1.6             # tag 必须与 packages/server-rust/package.json 一致
git push origin clover-cli-v0.1.6
```

`.github/workflows/publish-clover-cli.yml` 会先校验 tag 与 `package.json` 的版本，不一致直接失败，
所以不存在“独立改版本号”的第二条路径。发布脚本本身只是把已构建好的包传上去：

```bash
pnpm publish:cli                      # 用 pnpm publish 发布当前版本（先子包、后主包）
pnpm publish:cli -- --dry-run         # 只打包不推送
pnpm publish:cli -- --tag next        # 发到 dist-tag
pnpm publish:cli -- --allow-partial   # 只发布了部分平台时显式放行
```

主包发布时的 `optionalDependencies` 由脚本按**实际构建出的平台**生成（`--allow-partial`
时只引用已发布的子包）。发布前会执行 `scripts/guard-publish.mjs`：只允许在 `main`
分支或打了 tag 的提交上发布。`build-npm.mjs --version` 只影响本地生成的子包清单，
发布时若与 `package.json` 不一致会报错，CI 因此不再传 `--version`。需要仓库 secret `NPM_TOKEN`。

## A2A

| 端点 | 说明 |
|---|---|
| `POST /api/a2a/collab/spaces` | 创建协作空间（每个 participant 一个 ACP 会话） |
| `DELETE /api/a2a/collab/spaces/{spaceId}` | 关闭空间并释放会话 |
| `GET /api/a2a/orchestrator/.well-known/agent-card.json` | 编排器 agent card |
| `POST /api/a2a/orchestrator/` | 编排器 JSON-RPC（`SendMessage` / `SendStreamingMessage` / `GetTask` / `CancelTask`） |
| `GET /api/a2a/agents/{agentId}/.well-known/agent-card.json` | 单 agent bridge card |
| `POST /api/a2a/agents/{agentId}/` | 单 agent JSON-RPC（强制路由到该 agent） |
| `POST /a2a` | 免鉴权代理：转发到外部 A2A agent（A2UI 演示客户端） |

- 四种协作模式由 `message.metadata.collab` 驱动：`single`（显式/角色/编排器/关键词路由）、`pipeline`（静态顺序或编排器决定）、`parallel`（子任务 + 可选汇总）、`voluntary`（广播认领 + 冲突策略）。
- 流式响应沿用 SDK 线格式：SSE 帧的 `data:` 是 `{"jsonrpc":"2.0","id":…,"result":{"task"|"statusUpdate"|"artifactUpdate"}}`。
- 成员的 `agent_message_chunk` 会作为 `append` 的 artifact 增量推送，结束时补一条 `lastChunk`。

## `clover run`

- agent 只从 `~/.clover/acp.json` 读取；CLI 不安装、不注册、不写任何配置。
- stdout 只放 agent 的文本输出（`--json` 时是 NDJSON 事件流），提示/权限/错误一律走 stderr。
- 选项可以写在提示词前或后；`--` 之后的参数一律当提示词。
- 权限请求由 CLI 代答：默认选中 `reject_once`，`--approve` 时选中 `allow_once`（没有对应选项时回 `cancelled`）。
- Ctrl-C 会取消当前回合，最多等 5s 收尾，退出码 `130`。

## 环境变量

| 变量 | 作用 |
|---|---|
| `PORT` | 监听端口（默认 4200） |
| `CLOVER_READONLY` | `true` 时拒绝写文件 |
| `CLOVER_STATE_DIR` | 状态根目录（默认 `~/.clover`；测试/便携安装用） |
| `CLOVER_HOME_DIR` | 覆盖用户主目录（`~` 展开、全局 skill 来源；parity 沙箱用） |
| `CLOVER_TOKEN_SECRET` | 鉴权令牌密钥（缺省随机，仅本进程有效） |
| `CLOVER_LOG_DIR` | 日志目录（默认 `~/.clover/logs`） |
| `CLOVER_LOG_TO_FILE` | `false` 关闭文件日志 |
| `CLOVER_LOG_PREFIX` | 日志文件名前缀（默认 `agent`） |
| `CLOVER_LOG_MAX_FILES` | 保留日志文件数（默认 10） |
| `A2A_BASE_URL` | 写进 agent card 的绝对地址（默认按请求 Host 推导） |
| `A2A_AGENT_CARD_URL` | `/a2a` 代理的上游 agent card（默认 `http://localhost:10002/.well-known/agent-card.json`） |
| `A2A_BRIDGE_TIMEOUT_MS` | 单次成员 prompt 超时（默认 600000） |
| `A2A_ROUTE_TIMEOUT_MS` | 编排/认领判定的内部 prompt 超时（默认 30000） |
| `RUST_LOG` | 控制台日志级别（默认 `info`） |

## 状态目录

全部沿用旧布局，旧安装不需要迁移：`~/.clover/{acp.json,agent-config.json,projects.json,tasks.json,selected-project.json,mcp-servers.json,skills.json,skills/,agents/,logs/}`。

## 二进制 agent 安装

`binary` 分发包在进程内解包（`zip` / `tar.gz`；`tar.bz2` 借用系统 `tar`），不依赖 PowerShell 或 `unzip`。
下载走 `reqwest`，TLS 后端按平台选择：Windows/macOS 用系统栈（不需要 C 工具链），Linux 用 rustls（不需要 OpenSSL 头文件）。
安装目录为 `<state_dir>/agents/<agentId>/`，默认即 `~/.clover/agents/<agentId>/`。

## 已实现 / 待实现

| 批次 | 内容 | 状态 |
|---|---|---|
| P0 | workspace、服务骨架、CORS、HMAC 令牌、`/api/local/health`、`/api/local/auth/token`、CLI `serve` | ✅ |
| P0.5 | Tauri 进程内启动 + `server_info` + 前端 base URL 注入 | ✅ |
| P1 | `/api/local/*` 文件操作 12 个 + `roots`、`notify` 文件监听、`portable-pty`、`/ws/terminal`、`/ws/file-watch` | ✅ |
| P2 | `/api/mcp/servers` 5 个 + `~/.clover/mcp-servers.json`（含 `${VAR}` 展开） | ✅ |
| P3 | `/api/skills*` 7 个 + 多来源发现（front matter / JSONC / 只读判定 / 附属文件） | ✅ |
| P4 | ACP 基础：JSON-RPC、子进程、探活、`acp.json`、AgentRegistry + 状态 SSE | ✅ |
| P5 | ACP 会话：会话管理、会话 SSE（续传/所有权）、prompt/cancel/permission、activity 流 | ✅ |
| P6 | agent 安装/卸载/更新（npx/uvx/binary + sha256 + 解包）、install job 轮询、projects/tasks 8 个 | ✅ |
| P7 | `clover run` 完整实现（stdout 只留 agent 输出、权限自动应答、退出码） | ✅ |
| P8 | A2A：协作空间、编排/流水线/并行/认领四种模式、agent card、`/a2a` 代理 | ✅ |
| P9 | parity 对比（23 用例，含 SSE/WS）、旧实现改名 `packages/server-legacy`、文档收口 | ✅ |

完整方案见 `docs/rust-server-migration-plan.md`。

## 与旧实现对比

```bash
node scripts/parity.mjs                 # 全部阶段（http + ws + acp）
node scripts/parity.mjs --stage http    # 只跑 HTTP（快）
node scripts/parity.mjs --only local    # 只跑名字含 local 的用例
node scripts/parity.mjs --list          # 列出用例
```

脚本会自己构建旧版 `packages/server-legacy/dist` 与 `target/debug/clover`，为两边各准备一份
home + workspace，用同一组请求逐字段 diff（状态码、JSON、SSE 事件、WS 帧）。有差异退出码为 1；
`--keep` 保留沙箱与服务日志。沙箱默认放在 `target/parity/`（`PARITY_TMPDIR` 可覆盖）。

## 约定

- 路由、状态码、JSON 字段与旧实现（`packages/server-legacy`）保持一致；前端不需要为新后端改调用代码。
- 令牌格式与旧实现字节兼容：`base64url_nopad("<expiresAtMs>:<nonceHex>:<hmacSha256Hex>")`。
- Windows 上所有控制台子进程（agent 启动、探活、安装/解包、`taskkill`）都经 `HideConsole` 以 `CREATE_NO_WINDOW` 启动：桌面端是 GUI 子系统、自身没有控制台，否则每个子进程都会弹出独立窗口。
- 库内不初始化全局 `tracing` 订阅者，也不使用任何 Tauri API。