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