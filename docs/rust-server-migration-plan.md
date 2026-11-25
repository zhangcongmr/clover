# packages/server → packages/server-rust 迁移方案（已确认）

> 目标：把 `packages/server`（TypeScript）的 66 个 HTTP 端点、2 个 WebSocket 端点、3 个 SSE 流与 `clover` CLI，用 Rust 重写进独立 crate `packages/server-rust`，并让桌面端 `packages/assistant/src-tauri` 依赖它。
> 状态：P0–P9 全部落地（P9 收口：parity 脚本 + 旧实现改名 `packages/server-legacy`）。整理日期：2026-11-24。

## 0. 已确认的决策

| 决策 | 结论 |
|---|---|
| 传输层 | Rust 内置 axum，**保持现有 HTTP/WS 契约**（不改 Tauri IPC） |
| A2A | 放到最后（P8，可单独砍掉） |
| CLI 产物 | 与 GUI 分离打包：`clover`（CLI）与 `clover-app`（GUI）两个二进制 |
| 旧实现 | `packages/server` 改名 `packages/server-legacy`，保留一个版本周期 |
| Cargo 组织 | 仓库根单一 workspace，`target/` 与 `Cargo.lock` 上移到根 |
| crate 数量 | **保持一个 crate**（lib + bin），不拆分 |

## 1. 清点口径

### 1.1 HTTP 端点：66

| 分组 | 数量 | 说明 |
|---|---|---|
| `local` | 14 | token、health、12 个文件操作 |
| `acp` | 33 | 含 3 个 SSE；8 个 agent 管理；8 个 projects/tasks |
| `mcp` | 5 | servers CRUD |
| `skills` | 7 | catalog 与附属文件 CRUD |
| `a2a-collab` | 6 | 2 个 space REST + 2 套（card + JSON-RPC） |
| `a2a` 代理 | 1 | `POST /a2a` |
| 合计 | **66** | SSE 3 个 |

### 1.2 WebSocket：2

`/ws/terminal`（`?token=`，首帧 `{type:'pty',cols,rows,cwd}`）、`/ws/file-watch`（`file-watch-start/stop`）。

### 1.3 CLI：2 个子命令

`clover run <prompt> [--agent --root --json --approve]`、`clover serve [-p --readonly]`；顶层 `-h/-v/-p`，无参数等价 `serve`。退出码 0 / 1 / 130。

### 1.4 源码规模（非测试）

`api` 4671 行、`acp` 3771、`skills` 940、`local` 542、`helpers` 438、`events` 248、`cli` 548、`ws` 125、`mcp` 129，合计约 11.7k 行。

> 说明：前端另有 `/api/chat`、`/api/auth/*`、`/api/cmn/*`、`/api/storage/ws` 等调用，来自外部业务后端，**不在本次迁移范围**。

## 2. 架构

```
packages/
├─ server-rust/            # crate `clover-server`（lib + bin `clover`），无 tauri 依赖
│  ├─ src/lib.rs           # Config / bind / start / start_with_listener / run
│  ├─ src/main.rs          # clap 入口
│  ├─ src/{paths,logging}.rs
│  ├─ src/server/{mod,state,auth,cors,error}.rs
│  ├─ src/routes/{local,...}.rs
│  ├─ src/acp/…            # P4/P5
│  ├─ src/local/…          # P1
│  ├─ src/{mcp,skills,events}/…
│  └─ src/cli/{mod,run,serve}.rs
├─ server-legacy/          # 旧 TS 实现（由 server 改名，包名不变）
└─ assistant/src-tauri/    # crate `clover-app`：仅 GUI 胶水
```

依赖方向单向：`clover-app` → `clover-server`。库内禁止出现 tauri API，`openInFileExplorer` 由库直接调系统命令，保证 `clover serve` 可无 GUI 运行。

### 2.1 关键 API

```rust
pub struct Config { host, port, port_policy, readonly, cors, static_dir, state_dir, home_dir, warmup_agents }
pub struct Handle { addr, port, base_url, shutdown() }

pub fn bind(host, preferred, policy) -> io::Result<std::net::TcpListener>;
pub async fn start_with_listener(listener, config) -> anyhow::Result<Handle>;
pub async fn start(config) -> anyhow::Result<Handle>;
pub async fn run(config) -> anyhow::Result<()>;   // 阻塞到 Ctrl-C（serve）
```

GUI 在 `setup` 中**先同步 bind 再启动**，因此端口在窗口加载前就已知，前端通过 `server_info` 命令取回，避免竞态。

### 2.2 端口策略

- `clover serve`：显式 `--port` / `PORT` → `Strict`（占用即失败，与 Express 一致）；未显式指定 → `NextFree`。
- 桌面端：`CLOVER_PORT` 或 4200 起，`NextFree` 探测。开发构建会读取 `devUrl`（`http://localhost:4200`）并主动跳过该端口（落到 4201），保证 `ng serve` 与 API 各占一个固定端口——否则内嵌服务会抢先绑定 4200，窗口加载 `devUrl` 时看到的就是 API 自己的 404/401 JSON。

### 2.3 一致性红线

- 路由路径、方法、状态码、JSON 字段、错误体（`{error}` 与 `{success:false,message}` 两种）逐条对齐。
- 令牌字节兼容：`base64url_nopad("<expiresAtMs>:<nonceHex>:<hmacSha256Hex>")`。
- CORS 语义对齐：无 `Origin` → `*`；`AllowAny` → 回显 + `Vary`；白名单 → host×port 前缀匹配；`OPTIONS` 直接 204；允许头包含 `Last-Event-ID`/`X-Client-Id`/`X-Epoch`/`X-Takeover`/`A2A-Version`/`A2A-Extensions`。
- 状态目录不变：`~/.clover/*.json`、`skills/`、`agents/`、`logs/`。

## 3. 分批计划

| 批次 | 内容 | 状态 |
|---|---|---|
| P0 | workspace、crate 骨架、CORS、HMAC 鉴权、`/api/local/health`、`/api/local/auth/token`、CLI `serve`、静态文件 | ✅ |
| P0.5 | `clover-app` 改名与路径依赖、`setup` 进程内启服、`server_info`、前端 base URL 注入、退出时优雅停机 | ✅ |
| P1 | 14 个 `/api/local/*`（12 个文件操作 + roots + token/health 已先行）、`FileService`、`notify` 监听、`portable-pty` 终端、2 个 WS | ✅ |
| P2 | MCP 5 个端点 + `~/.clover/mcp-servers.json`（含 `${VAR}` 展开、ACP 解析） | ✅ |
| P3 | Skills 7 个端点 + 多来源发现（JSONC 解析、只读判定、前端 matter、附属文件） | ✅ |
| P4 | ACP 基础：ndjson JSON-RPC、子进程（进程树 kill）、探活、`acp.json`、AgentRegistry + 状态事件 | ✅ |
| P5 | ACP 会话：EventSink（seq+ring）、SessionManager、SseManager、11 个会话端点、`Last-Event-ID` 续传、epoch 所有权 | ✅ |
| P6 | agent 安装（npx/uvx/binary + sha256 + 解包）、install job 轮询、卸载/更新、agent-config、projects/tasks 8 个 | ✅ |
| P7 | `clover run` 完整实现（stdout 只留 agent 输出、权限自动应答、退出码） | ✅ |
| P8 | A2A collab（6）+ `/a2a` 代理（1） | ✅ |
| P9 | parity 对比脚本、`packages/server` → `server-legacy`、脚本/文档收口 | ✅ |

每批完成定义：路由逐条对齐；`cargo clippy -- -D warnings` 与 `cargo test` 通过；前端对应功能冒烟；旧 TS 实现保持可用以便回退。

## 4. 构建与打包

| 目标 | 命令 | 产物 |
|---|---|---|
| CLI | `cargo build --release -p clover-server` | `target/release/clover(.exe)` |
| CLI 运行 | `cargo run -p clover-server -- serve` | 同一套 axum，可选静态目录 |
| GUI 开发 | `pnpm --filter ./packages/assistant tauri:dev` | `clover-app` + 内嵌服务器（前端由 `ng serve` 提供） |
| GUI 打包 | `pnpm --filter ./packages/assistant tauri:build` | 安装包（productName `Clover`） |
| GUI 单文件 | `cargo build --release -p clover-app --features custom-protocol` | `target/release/clover-app.exe`（`frontendDist` 内嵌） |
| 测试 | `cargo test --workspace` | — |

注意：`src-tauri` 包名由 `clover` 改为 `clover-app`，因为 workspace 内不允许两个同名 bin；GUI 的安装包名仍由 `tauri.conf.json` 的 `productName` 决定。

判定构建类型看 `tauri` crate 的 `custom-protocol` feature：不启用（普通 `cargo build`）即为**开发构建**，窗口加载 `devUrl`（`http://localhost:4200`），必须先跑 `ng serve`（`tauri:dev` 会代劳）；启用后才是自带前端资源的发布构建，单独双击 exe 就能显示界面。

## 5. 风险与对策

| 风险 | 对策 |
|---|---|
| ACP 行为细节（generation、权限延后应答、`session/update` 路由） | 逐行对照 `sse-client.ts`，P4/P5 各一条端到端测试 |
| `notify` 与 `fs.watch` 语义差异 | 统一映射 `change`/`rename` + 50ms 去抖；rename 后立刻重建 watcher |
| `portable-pty` 在 Windows 的 resize/exit | P1 已用真实 ConPTY 验证（自动化测试发 `echo` 并收到回显） |
| skills 多来源路径归一 | `walkdir` + 显式 label，双平台用例 |
| binary 安装包格式 | `zip` / `tar.gz` 进程内解包；`tar.bz2` 走系统 `tar`；裸二进制按原文件名落盘 | 不依赖 PowerShell/unzip；旧实现给裸二进制加了临时文件前缀，导致声明的 `cmd` 找不到 |
| 一次迁移面过大 | 严格分批，TS 版始终在线 |

### 5.1 已知的实现差异（有意为之）

| 项 | 旧实现 | Rust 实现 | 原因 |
|---|---|---|---|
| PTY 输出帧 | 文本帧 | **二进制帧** | 避免多字节 UTF-8 被帧边界截断；xterm 原生解码 |
| 同一文件被多个客户端监听 | 只有第一个收到事件（`Map` 去重） | 每个连接独立 watcher，都收到 | 修掉旧实现的隐性 bug |
| `openInFileExplorer` | 等待 `explorer.exe` 退出码 | 只 spawn 不等待 | explorer 复用窗口时返回 1，会被误判成失败 |
| `scan` 排序 | `localeCompare` | 大小写不敏感序（稳定） | 与 locale 解耦、跨平台可复现 |
| `/api/mcp/*`、`/api/skills/*` 鉴权 | 无鉴权 | 保持无鉴权 | 前端设置页不带 token 调用，加鉴权会直接 401 |
| MCP store 写入 | `writeFileSync` 直接覆盖 | 临时文件 + rename | 避免写一半的 JSON 损坏配置 |
| MCP 名称空白 | 仅判空后 trim 存储 | trim 后判空 | 避免存出空 key |
| Skills front matter | 手写浅解析（无 YAML 依赖） | 同样手写浅解析 | 行为一致，不引入 YAML 依赖 |
| Skills JSONC | 手写去注释/去尾逗号 | 同逻辑移植（未用 json5） | 报错文案与容错边界保持一致 |
| Skills 目录遍历顺序 | `readdir` 原始顺序 | 同（不额外排序） | 列表顺序与旧实现一致 |
| 会话 SSE 心跳 | 无（只有全局流有心跳） | 每 25s 发 SSE 注释行 | 注释不会被任何 SSE 解析器当成事件，纯保活 |
| 会话所有权栅栏 | 默认关闭（`CLOVER_ENFORCE_OWNERSHIP`） | 同样默认关闭，release/isOwner 逻辑保留 | 与旧实现一致，避免升级即 409 |
| 归档解包 | `tar` / `unzip` / `Expand-Archive` 子进程 | `zip` / `flate2+tar` 进程内解压 | 无外部工具依赖，失败信息统一 |
| 裸二进制分发 | 以临时文件名落盘（`clover-agent-<id>-<name>`） | 保留归档原始文件名 | 旧实现的 `cmd` 永远匹配不上，实际不可用 |
| binary 安装根目录 | `homedir()/.clover/agents` | `<state_dir>/agents` | 默认完全一致；测试可用独立 `state_dir` 隔离 |
| 下载 TLS 后端 | Node 内置 TLS | Windows/macOS 用系统栈，Linux 用 rustls | 避开 C 工具链与 OpenSSL 头文件依赖 |
| projects/tasks 端点 | 无鉴权 | 保持无鉴权 | 前端 `postNoAuth` 调用，加鉴权会 401 |
| 权限请求登记顺序 | 先发事件、后登记 pending，CLI 需 `setTimeout(0)` 规避竞态 | 先登记 pending、再发事件 | 进程内消费者（CLI/A2A）可在事件回调里直接应答，不再有丢应答的窗口 |
| 状态目录覆盖 | 仅 `homedir()` | 额外支持 `CLOVER_STATE_DIR` | 不设时路径完全一致；便于 CLI 测试与便携安装 |
| 配置文件 BOM | `JSON.parse` 遇 BOM 直接失败 | 读取时剥掉 UTF-8 BOM | Notepad/PowerShell 编辑过的 `*.json` 不再导致配置整体失效 |
| A2A JSON-RPC 服务端 | `@a2a-js/sdk`（Express 中间件 + 事件总线） | 在 crate 内实现同线格式的 JSON-RPC/SSE 子集 | 不引 Node 依赖；只实现前端实际使用的 `SendMessage`/`SendStreamingMessage`/`GetTask`/`CancelTask` |
| `SubscribeToTask`（已知任务） | 重新订阅事件流 | 返回 `-32004`；未知任务仍返回 `-32001` | 前端不重新订阅；事件流不重放 |
| `GetExtendedAgentCard` | 未配置扩展卡时返回 `-32004` + `UNSUPPORTED_OPERATION` | 同样 `-32004` / 同文案 | 卡片声明 `extendedAgentCard: false` |
| `/a2a` 上游 | SDK client（`ClientFactory`） | `reqwest` 拉 card → 取 `supportedInterfaces[0].url` → 调 `SendStreamingMessage` | 行为一致；上游返回非 SSE 时直接转 JSON |
| A2A 协议版本 | SDK 检查 `A2A-Version` 头；缺失按 0.3 拒绝（`-32009`） | 同样检查 `A2A-Version`，缺失/非 `1.0` 返回同样的 `-32009` 与 `ErrorInfo` | 协议层一致，老客户端会得到明确报错而不是静默错解 |
| A2A 错误体 | SDK 生成 `code`/`message`/`data(ErrorInfo)` | 同码同文案；`Invalid JSON-RPC Request.` 使用 `-32602`（SDK 行为），`Task not found: <id>` 带 id | 逐字段对齐（parity `http.a2a.rpc`） |
| `SubscribeToTask`（已知任务） | 重新订阅事件流 | 返回 `-32004`；未知任务仍返回 `-32001` | 前端不重新订阅；事件流不重放 |
| `GetExtendedAgentCard` | 未配置扩展卡时返回 `-32004` + `UNSUPPORTED_OPERATION` | 同样 `-32004` / 同文案 | 卡片声明 `extendedAgentCard: false` |
| 文件系统错误文案 | Node/libuv：`ENOENT: no such file or directory, open '…'` | 同格式（`scandir`/`open`/`stat`/`mkdir`/`rm`/`rename`，含 `EISDIR`、`ENOTDIR`） | 旧实现把错误直接显示在 toast；Windows 的本地化 OS 文案不可移植 |
| 未注册路由的 404 | Express 默认 HTML `Cannot GET /path` | 空 body 404 | 仅 `/api/acp/agents/:id` 这类 TS 根本没注册的路径；前端不调用 |
| 用户主目录覆盖 | 仅 `homedir()` | 额外支持 `CLOVER_HOME_DIR`（`~` 与全局 skill 来源跟随） | 默认真实 home；供 parity 沙箱与便携安装 |
| 旧实现位置 | `packages/server` | 改名为 `packages/server-legacy`（包名不变） | 保留一个发布周期；`workspace:*` 与发布脚本无需改动 |

### 5.2 环境注意

桌面端 `clover-app.exe` 在本机需要**管理员账户**启动（WebView2 用户数据目录权限），否则创建 webview 时报 `0x800700AA`。这是环境约束，不是代码缺陷；构建与服务器逻辑不受影响。

## 6. 验证手法

### 6.1 parity：可执行规格

`scripts/parity.mjs` 同时起两套服务（旧版 `packages/server-legacy/dist` + 新版 `target/debug/clover serve`），用同一份脚本请求两边并逐字段 diff：

```bash
pnpm parity                 # 全部阶段（http + ws + acp）
node scripts/parity.mjs --stage http
node scripts/parity.mjs --only mcp --verbose
node scripts/parity.mjs --list
node scripts/parity.mjs --keep          # 保留沙箱与服务日志
```

- **沙箱**：每个服务一份 home + workspace（内容完全一致），通过 `USERPROFILE`（Node）/ `CLOVER_HOME_DIR` + `CLOVER_STATE_DIR`（Rust）隔离。两者共享同一个 `CLOVER_TOKEN_SECRET`，令牌也各自从 `/api/local/auth/token` 现场申请。
- **归一化**：路径 → `<workspace>` / `<home>`、端口 → `<port>`、UUID / `perm_*` / 时间戳 / token / `mtime` / `lastChecked` 等易变字段统一占位；其余字段逐字比较。
- **阶段**（23 个用例）：
  - `http`（19）：鉴权与 CORS、12 个文件操作 + `roots`/`scan`、MCP CRUD、skills 发现/读写/只读/复制、projects/tasks 全流程、ACP agent 列表/探活/配置/安装校验、A2A card 与 JSON-RPC 错误码/文案、协作空间校验。
  - `ws`（2）：`/ws/terminal`（真实 PowerShell，回 `ESC[6n` 光标查询后 `echo` 标记）与 `/ws/file-watch` 帧序列。
  - `acp`（2）：用 `tests/fixtures/mock-acp-agent.mjs` 跑完 create → prompt → permission → cancel → release → delete，逐条比较 SSE 事件类型与 payload；另加一个“创建协作空间 + card + GetTask + 关闭”用例。
- **已知且已接受**的差异只列在脚本的 `ACCEPTED` 表里（PTY 二进制帧、Express 默认 HTML 404），任何新增差异都会让 `pnpm parity` 以退出码 1 结束。
- 2026-11-24 全量结果：**23/23 通过**（2 条 binary-frame、1 条 HTML 404 为已记录差异）。

本轮 parity 直接修掉的真实缺陷：

1. `cargo build -p clover-server`（不含 dev-deps）缺 `reqwest` 的 `json`/`stream` feature —— 发布构建原本编译失败。
2. A2A 请求缺少 `A2A-Version` 校验，且 `-32600/-32001` 文案与 SDK 不一致。
3. `/api/a2a/agents/{id}/update` 无 body 时返回 415（应返回 400 `command … is required`）。
4. 文件系统错误文案为 Windows 本地化 OS 文本（旧实现是 Node 的 `ENOENT: …` 格式）。
5. agent card 的 skill 描述多了一个 ` bridge`。

2026-11-25 修复（GUI 联调发现）：

6. 鉴权中间件用 `Router::layer` 挂载，连带包住了路由 fallback —— 匿名访问任意未注册路径（含 `/`）返回 `401 Unauthorized` 而不是 404，开发构建的窗口因此显示 API 的 401 JSON。改为 `route_layer`，只保护已注册路由；parity 的 `http.auth.guards` 增加 `/` 与 `/api/unknown` 的 404 断言。
7. GUI 开发构建与 `ng serve` 抢 4200：内嵌服务会先绑定 `devUrl` 的端口。现在开发构建跳过 `devUrl` 端口（4200 → 4201），发布构建不受影响。
8. Windows 发布版（`windows_subsystem = "windows"`，无控制台）在初始化 agent 列表时会为每个 ACP agent 弹出一个独立控制台窗口（`cmd.exe` shim 也算一个）。新增 `crate::subprocess::HideConsole`（`CREATE_NO_WINDOW`），应用于 agent 启动、探活（`where` / `run_capture`）、安装命令、`tar` 解包与 `taskkill`；子进程的子孙进程继承无控制台会话，`cmd.exe → node` 链路也保持隐藏。
9. 跨域访问 A2A 失败（同源正常）：A2A SDK 的 card 与 JSON-RPC 请求都带 `A2A-Version` 头，而 CORS 的 `Access-Control-Allow-Headers` 没列它，浏览器预检直接拒绝。新旧实现的允许头统一补上 `A2A-Version` / `A2A-Extensions`；parity 增加 A2A card 的跨域预检用例。
10. 改完 legacy 包后 `ng serve` 仍返回旧 CORS 头：dev server 把 `@julyware/clover-server` 预打包进 `.angular/cache/<ver>/<project>/vite/deps_ssr/`，Vite 只按 lockfile/config 做缓存键，不跟踪 linked workspace 包的 `dist/` 变化。需要 `ng cache clean` 后重启（见 `packages/server-legacy/README.md`）。

### 6.2 P9 收口清单

| 项 | 结果 |
|---|---|
| `packages/server` → `packages/server-legacy` | 已改名；包名 `@julyware/clover-server` 不变，`workspace:*`、`pnpm -r`、发布脚本继续可用 |
| 发布 | `scripts/release.mjs` 仍发布三个包一个周期；源码位置改为 legacy 目录并加注说明 |
| 文档 | 根 README / README.zh / `packages/server-rust/README.md` / 本方案同步（结构、命令、env、批次状态） |
| 测试 | `cargo test --workspace` 181 通过；`cargo clippy --workspace --all-targets -D warnings` 干净；`pnpm parity` 23/23 |

回退路径：把 `packages/assistant/src-tauri` 的依赖换回 TS server、`pnpm install` 后即回到旧实现；旧包与旧构建在改名后一个周期内保持原样。