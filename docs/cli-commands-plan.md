# Clover CLI 子命令实施方案（已落地）

> 目标文件：`C:\Users\zhang\clover\packages\server\src\cli.ts`（命令入口）
> 输入清单：`C:\Users\zhang\clover-site\packages\official-site\design\DOCS-COMMANDS-CONFIG.md` §1.6 的 21 条去重命令
> 参考源码：`C:\Users\zhang\clover`（Clover 本体，**不是** clover-site 官网）
> 状态：**已实现**。整理日期：2026-11-15；第四十一轮：`init` 不做；第四十二轮：移除预置 agent 列表表述；第四十三轮：`connect`（含 `agent add`）、`config`、`changelog` 不做；第四十四轮：`open` 不做，CLI 只剩 `run` / `serve`，无变体；第四十七轮：Ardot 画布已按本方案同步；第四十八轮：核实源码后确认 `clover.toml` 与三条 `CLOVER_*` 在源码中并不存在，画布配置页已整体改写为 `~/.clover/acp.json` + 真实 env（`PORT` / `EDITOR_TOKEN_SECRET` / `CLOVER_READONLY`），本方案随之取消 `config.ts` 内部配置层；**第四十九轮：按本方案在 `packages/server` 与 `packages/clover` 落地 `clover run` / `clover serve` 两条命令（含 39 个单元测试），站点源码 `DocsPage.tsx` / `MarketingPages.tsx` 的旧文案仍待另开一轮对齐**
> 统计口径（与清单 §1.6 一致）：✅ **3 条**有价值 / ⚠️ 0 条 / ❌ **18 条**无实现价值
> **agent 数据来源**：仅 `~/.clover/acp.json`（由服务端 / Web UI 安装维护），CLI 不注册、不改写；不引用任何「内置模板 / 预置 agent」概念。
> **配置策略**：没有 `clover config` 子命令；**第四十八轮起连内部配置层都不需要**——`run` / `serve` 直接复用源码现成 env key（`PORT` / `EDITOR_TOKEN_SECRET` / `CLOVER_READONLY`），不新增 `CLOVER_*` 配置键、不引入配置文件、不引入 TOML 解析。`~/.clover/acp.json` 只读。
>
> **第四十九轮落地结果**（实测通过）：
> | 命令 | 行为 |
> |---|---|
> | `clover run "<prompt>"` | 脱离 Express / Vite，进程内直接驱动 ACP 会话；stdout 只有 agent 输出，库日志走 stderr；退出码 0 / 1 / 130 |
> | `clover run --agent codex` | agent 只能来自 `~/.clover/acp.json`；未安装 → 报错并指去 Web UI 安装 |
> | `clover serve` | 与「无参数」走**同一条**启动路径，只额外支持 `--port` / `--readonly`（落到既有 `PORT` / `CLOVER_READONLY`） |
>
> 其它选项：`--root <dir>`（workspace 根目录）、`--json`（NDJSON 事件流）、`--approve`（自动同意权限请求，默认拒绝）。

---

## 0. 结论先行

21 条清单里，最终值得在 `cli.ts` 新增的只有 **2 条主命令**（`run` / `serve`），**没有别名、没有变体**。`init`、`connect`（含 `agent add`）、`config`、`changelog`、`open` 均已按用户决定判为无价值：Clover 开箱即用、agent 由服务端或 Web UI 安装、配置解析内部化、升级说明放文档站、不提供打开会话 / 浏览器的变体。其余 14 条是包管理器命令、第三方工具命令、ACP 协议内部方法或环境变量形式。

现状有两个硬约束：

1. `cli.ts` 只有 52 行，手写解析 `-h` / `-v` / `-p`，**没有任何子命令**，全仓也没有 commander / yargs 之类的解析库。
2. `packages/clover/src/server.ts:19-34` 跑完 `processCliArgs` 后**无条件** `createServer()` 启动 Express + Vite。所以新增子命令必须同时给它加「执行完就退出」的分支，否则 `clover run` 会顺手把 Web 服务拉起来。

好消息是：会话、prompt 流式执行的能力在 `packages/server/src/acp/` 里已经齐备，`run` **可以完全不启动 HTTP 服务**（`AcpSessionManager.promptAndWait` + 进程内 `EventSink` 即可）。经过四轮收敛，CLI 是**只读 + 两件事**：不写 `acp.json`、不写配置、不注册 agent、不安装任何东西，只负责「跑一次任务」和「起服务」。

---

## 1. 清单筛选：21 条逐类判定

| 类别 | 清单中的命令 | 是否实现 | 理由 |
|---|---|---|---|
| **A · 分发 / 系统命令** | `npm i -g @julyware/clover`、`brew install --cask clover`、`shasum -a 256 <file>`、带 `--registry/--no-audit/--no-fund/--ignore-scripts` 的长版 npm、`node --version` | ❌ | 属于 npm / Homebrew / shasum / Node，不是 Clover CLI 职责；长版只是 A10「命令不可截断」的版式示意值。版本信息已由 `-v/--version` 覆盖 |
| **B · 第三方工具链** | `git clone github.com/julyware/clover`、`npm install && npm test`、`gh pr create --fill` | ❌ | `/community` 画板里的贡献流程，是给贡献者看的 git/npm/gh 命令，与 CLI 无关 |
| **C · ACP 协议方法** | `initialize` / `session/new` / `session/prompt` | ❌ | ACP SDK 内部方法，由 `SseAcpClient` 调用，不该暴露成 CLI |
| **D · 环境变量形式** | `CLOVER_AGENT=codex clover run`、`CLOVER_THEME=nightshift clover`、`CLOVER_ROOT=~/site clover init` | ❌ 不单列 | 不是独立命令；**第四十八轮核实：这三个 env 在源码中同样零命中**，既不单列命令也不提供内部读取 |
| **E · 命令写法** | `clover init` / `npx @julyware/clover init` | ❌ **不做** | 不需要初始化工作（第四十一轮） |
| | `clover connect` / `clover agent add claude` | ❌ **不做** | 第四十三轮决定：CLI 不做 agent 注册 / 连接；agent 由服务端 / Web UI 安装维护 |
| | `clover run "summarise the open PRs"`、`clover run --agent codex` | ✅ **P0** | `run <prompt> [--agent <id>]`；`--agent` 是参数不是独立命令 |
| | `clover serve` | ✅ **P0** | 把「无参数即启动服务」显式化，复用现有 `createServer` |
| | `clover open .` | ❌ **不做** | 第四十四轮决定：不做「打开会话 / 拉起浏览器」的变体命令 |
| | `clover changelog --breaking` | ❌ **不做** | 第四十三轮决定：升级说明放文档站，不做 CLI 命令 |

**去重后挑选结果**：✅ 3 条清单项 → 收敛为 **2 条 CLI 主命令**（`run` / `serve`），**无别名、无变体**；❌ 18 条；配套命令 `agent list|remove` 因 `connect` 取消而失去注册闭环，暂缓；`config` 本不在 21 条清单内，由 D 类派生，一并取消。

### 1.1 两套命令体系 → 只保留执行侧

设计稿里营销页族和 Docs 族对同一批动作各写了一套命令。经过四轮收敛，CLI 只保留「执行任务」与「起服务」两件事：

| 规范命令 | 统一语义 |
|---|---|
| `clover run <prompt> [--agent id]` | 非交互执行单次任务 |
| `clover serve` | 启动本地服务 |

> **不在表内的命令**：`init`（不初始化）、`connect` / `agent add`（不注册 agent）、`config`（不暴露配置子命令）、`changelog`（不打变更日志）、`open`（不打开会话 / 不拉起浏览器），以及暂缓的 `agent list|remove`。CLI 误输入这些命令时按「未知子命令」报错并提示可用命令，不要静默启动服务。

> **agent 候选从哪来**：只从 `~/.clover/acp.json`（已安装列表）读取，由服务端 / Web UI 安装维护。源码中原有的预置 agent 常量已整段注释、不参与任何合并，**方案不引用、也不复刻任何预置列表**。设计稿里的 `claude` / `codex` 只是命名示例，不表示存在预置 agent，也不表示 CLI 能安装它们。

---

## 2. 架构改造（仅规划）

### 2.1 `cli.ts` 分派模型

- **保持 `processCliArgs(args, options)` 签名兼容**，扩展 `CliResult`：在 `{ shouldExit: true, exitCode }` 之外增加 `command?: ParsedCommand`；`server.ts` 按「有无 command」决定「执行后退出」还是「启动服务」。
- 解析顺序建议：
  1. `args[0]` 是已知子命令（**仅 `run` / `serve`**）→ 切出 `[command, ...rest]`，交给该命令的解析器；
  2. 否则若以 `-` 开头 → 走现有 `-h/-v/-p` 逻辑（**行为一字不变**）；
  3. 无参数 → 默认等价 `serve`（保持向后兼容）。
- **现存坑**：`cli.ts:39` 用 `args.findIndex(arg => arg === '-p')` 全局扫描，子命令参数里出现 `-p` 会被误吞。必须先切出子命令边界，剩余参数再交给选项解析。
- **零依赖**：继续手写解析，不引入 commander / yargs（避免改 `package.json` 与 `pnpm-lock.yaml`、避免发布包体积变化）。
- **文件组织**：`cli.ts` 只留分派 + help 文本 + 未知子命令报错；命令实现只放 `packages/server/src/cli/commands/{run,serve}.ts`。**第四十八轮决定不需要 `config.ts`** —— `run` / `serve` 直接复用源码现成 env key（`PORT` / `EDITOR_TOKEN_SECRET` / `CLOVER_READONLY`），不引入新配置层、不引入配置文件、不引入 TOML 解析。`index.ts` 只需按需导出一个 `runCliCommand`，不必把 acp 内部模块补进 public exports——同包内用相对路径 `./acp/...` 导入即可，tsup / esbuild 都会打进产物。

### 2.2 `packages/clover/src/server.ts` 的退出分支

- 在 `cliResult.shouldExit` 判断之后、`:40` 的 `isDev` / `createViteServer` **之前**插入：若带 `command` → `await runCliCommand(command)` → `process.exit(code)`。
- 必须早于 Vite 分支：子命令不该触发 dev server 的 HTTPS 证书探测与中间件装配。
- 构建侧不用改：`packages/clover/scripts/build-server.mjs` 用 esbuild `bundle: true` 从 `src/server.ts` 打包成 `dist-server/server.js`（即 `bin.clover`），新增模块会被自动打进去；`@julyware/clover-server` 侧 tsup 以 `src/index.ts` 为入口同理。

### 2.3 可直接复用的现成能力（零改动）

| 能力 | 位置 | 用途 |
|---|---|---|
| `AgentConfig` / `AgentStatusInfo` | `acp/acp-agent.types.ts:5-58` | `acp.json` 条目结构与运行时状态的类型定义 |
| `readAcpConfigFile` | `acp/acp-config-store.ts:25` | **只读**加载 `~/.clover/acp.json`，文件不存在 / 损坏时降级为空列表 |
| `AgentRegistry`：`getStatus` / `getOrCreate` / `warmupAll` / `destroy` | `acp/agent-registry.ts` | 用 `acp.json` 初始化 Registry，供 `run` 创建会话 |
| `AcpSessionManager.createAcpSession` / `promptAndWait` / `destroy` | `acp/session-manager.ts:525/339/836` | `run` 的核心链路 |
| `getSharedEventSink` / `InProcessEventSink.attach` | `events/in-process-event-sink.ts` | 流式事件出口 |
| `createServer` / `setupServerMiddleware` | `server.ts:143/88` | `serve` 直接复用，**不要重拼路由** |
| `logger` / `toIsoTimestamp` / `toPathTimestamp` | `helpers/` | 输出格式与耗时 |

> **不再复用**：`writeAcpConfigFile` / `upsertAcpAgent` / `removeAcpAgent`、`startInstall` / `startDiskInstall`、`probePathCommand` / `probePackageVersion` —— 这些只服务于 agent 安装 / 注册，第四十三轮后 CLI 不碰。
>
> `createAcpSession` 会走 `registry.getConfigById(agentId)`，只认 Registry 里的 id；`server.ts:123-125` 把 `acp.json` 的已安装 agent 传给 Registry。因此 `run` 用到的 agent 必须**已在 `acp.json` 中**，否则抛 `Unknown agent`；CLI 没有注册入口，只能提示用户去服务端 / Web UI 安装。

---

## 3. 逐命令实现方案

### 3.1 ~~`clover init [path]`~~（不做）

**第四十一轮决定：不实现任何初始化命令。** 保留节号避免引用错位：不生成 workspace 配置、不预置任何 agent 条目、不复刻设计稿的 `✓ workspace ~/.clover` / `✓ agents …` 输出；`~/.clover/` 由服务端 / Web UI 在装 agent 时创建，CLI 只读。误输入 `init` 按未知子命令报错。

### 3.2 ~~`clover connect [agent-id]`~~（不做）

**第四十三轮决定：不实现 `connect` 及其别名 `agent add <id>`。** 保留节号记录影响：

- CLI 不注册、不连接、不卸载 agent；`upsertAcpAgent` / `startInstall` / `startDiskInstall` / `probePathCommand` 全部不进入 CLI 依赖路径。
- `clover agent list` / `remove <id>` 原本是 `connect` 的配套，失去注册闭环后**暂缓实施**；需要查看 agent 时用服务端 API `GET /api/acp/agents` 或 Web UI。
- 误输入 `connect` / `agent add` 按未知子命令报错，并在帮助里说明「agent 请在 Web UI / 服务端安装」。
- `run` 遇到未注册 agent 时给出同一指引（§3.3）。

### 3.3 `clover run "<prompt>" [--agent <id>]`（P0）

**完全脱离 Express / Vite**，这是与 Web 端最大的架构差异，也是这个命令最有价值的地方。

```text
sink = getSharedEventSink()
registry = new AgentRegistry(readAcpConfigFile().agents, sink)   // 只读 acp.json
sessions = new AcpSessionManager(registry, sink)
try {
  { sessionId } = await sessions.createAcpSession(agentId, cwd)
  result = await sessions.promptAndWait(
    sessionId,
    [{ type: 'text', text: prompt }],
    onEvent,  // → stdout
  )
} finally {
  sessions.destroy(); registry.destroy();  // 必须执行，否则 warm 子进程阻止退出
}
```

- `cwd` 默认 `process.cwd()`；**第四十八轮决定不引入 `CLOVER_ROOT`**（源码无此 env），如需覆盖用 `--root` 参数（`run` 专用）。
- agent 未在 `acp.json` / Registry 中 → 报错 `Unknown agent: x，请先在 Web UI / 服务端安装该 agent`；**不再有 `--auto-install`**（CLI 不安装 agent）。
- 输出：默认人类可读，`--json` 输出 NDJSON（`AcpSessionEvent` 逐行）；复刻设计稿的 `→ agent …` / `→ workspace …` / `✓ … in 42s`（用 `helpers/time.ts` 计时）。
- 退出码：正常 `stopReason` → 0；ACP 错误 / 超时 → 1；Ctrl-C → 清理子进程后 130。
- **必须在方案里定策略的风险**：Web 端的权限请求（`permission`）由 UI 应答，CLI 没有 UI。建议默认「拒绝并打印原因」，另给 `--approve` 显式允许；否则 `promptAndWait` 会挂住。
- `run --agent <id>` 是参数，不单独建命令；**`CLOVER_AGENT` 在源码中不存在**，不提供该环境变量形式——agent 只能由 `--agent` 显式指定（须先在 Web UI 注册）。

### 3.4 `clover serve`（P0）｜ ~~`clover open [path]`~~（不做）

- `serve` 与「无参数」都走现有 `createServer({...})`，**不复制任何装配逻辑**；只把 `--port/-p`、`--host`、`--readonly` 转发成 `PORT` / `CLOVER_READONLY` 等既有 env。
- **第四十四轮：`open [path]` 不实现。** 保留节号记录影响：不做目录校验 + 启服务 + 跨平台拉浏览器的组合动作；不调用 `start` / `open` / `xdg-open`；无 GUI 环境的兼容逻辑也不再需要。误输入 `open` 按未知子命令报错。
- 设计稿原先写 `http://localhost:7717`，**第四十八轮已按源码改为 `5178`**（发布包 `defaultPort`，见 `packages/clover/src/server.ts:29`）；`--port` 仍可覆盖。发布包 5178 与 server 包 4200 的不一致仍待产品决策，见 §7 风险 7。

### 3.5 ~~`clover config …`~~（不做）

**第四十三轮决定：不暴露 `config path|get|set|list` 子命令。** 保留节号记录影响：

- **第四十八轮决定：连内部配置层都不需要** —— `config.ts` 整个删除。`run` / `serve` 直接读源码现成 env key（`PORT` / `EDITOR_TOKEN_SECRET` / `CLOVER_READONLY`），不新增 `CLOVER_*` 配置键、不引入任何配置文件。
- CLI 不创建、不修改 `config.json`、不写任何配置键；`acp.json` 由服务端 / Web UI 维护，CLI 只读。
- 设计稿里的 `clover.toml` / `[workspace]` / `theme` 等配置项**在源码中并不存在**，第四十八轮已把 Ardot 画布整体改写为 `~/.clover/acp.json` + `agents[].id` / `.command` / `.env`（见 `DOCS-COMMANDS-CONFIG.md` §5.4），不再作为「设计口径记录」保留。
- 误输入 `config` 按未知子命令报错。

### 3.6 ~~`clover changelog --breaking`~~（不做）

**第四十三轮决定：不做。** 升级说明放文档站；不读 CHANGELOG.md、不提供 `--breaking` 参数。误输入按未知子命令报错。

---

## 4. 配置层口径（只读内部能力 · 第四十八轮已对齐设计稿）

**第四十八轮结论：设计稿已按源码实况改写，本节的口径随之收敛。**

核实 Clover 本体（`C:\Users\zhang\clover`）后的源码事实：

| 项 | 源码实况 | 位置 |
|---|---|---|
| 持久化配置 | **只有 `~/.clover/acp.json`**（JSON，`{ version, agents[] }`），仅存已安装 agent | `packages/server/src/acp/acp-config-store.ts` |
| `clover.toml` | **全仓零命中** —— 无 TOML 解析、无读写、无任何引用 | — |
| `CLOVER_AGENT` / `CLOVER_THEME` / `CLOVER_ROOT` | **全仓零命中** | — |
| 真实 env | `PORT`、`EDITOR_TOKEN_SECRET` / `CLOVER_TOKEN_SECRET`、`CLOVER_READONLY`、`CLOVER_LOG_*`、`CLOVER_ENFORCE_*` | `packages/server/src/server.ts`、`packages/clover/src/server.ts`、`helpers/log-file.ts` |
| 端口默认值 | `5178`（clover 发布包）/ `4200`（server 包），env key 均为 `PORT` | `packages/clover/src/server.ts:29` |
| 鉴权 | `TokenManager` 签发短期令牌（`Authorization: Bearer` 或 `?token=`），密钥来自 `EDITOR_TOKEN_SECRET` | `packages/server/src/local/auth.ts`、`api/middleware.ts` |

**因此 CLI 不需要新增配置层**：

- `config.ts` **可以删掉**。`run` / `serve` 直接复用现成 env key：`PORT`（端口）、`EDITOR_TOKEN_SECRET`（鉴权密钥）、`CLOVER_READONLY`（只读），不引入 `CLOVER_ROOT` / `CLOVER_AGENT` / `CLOVER_THEME`，也不引入任何配置文件或 TOML 解析库。
- `run` 的 agent 来源只有一个：`~/.clover/acp.json`（只读，缺失或损坏时降级为空列表）。`--agent <id>` 必须是该文件里已存在的 id。
- `serve` 的端口与鉴权全部透传给现成的 `createServer({ portEnvKey: 'PORT', defaultPort, tokenSecretEnvKey: 'EDITOR_TOKEN_SECRET' })`，**不重拼路由、不重复解析 env**。
- 优先级即源码既有语义：**命令行 flags > 环境变量 > 内置默认值**；`acp.json` 不参与这层覆盖（它是 agent 清单，被原样读取）。

> **连带约束（不变）**：CLI 不初始化、不注册 agent、不写 `acp.json`、不写任何配置文件。`acp.json` 由服务端 / Web UI 创建，CLI 只读。任何路径都不得出现「请先运行 clover init」或「请用 clover config 设置」的提示。

**设计稿侧已同步**（Ardot 画布 `745566579563408`）：Configuration 页由 `clover.toml` 改为 `~/.clover/acp.json`（`agents[].id` / `.command` / `.env`），环境变量示例改为 `PORT` / `EDITOR_TOKEN_SECRET` / `CLOVER_READONLY`；Self-hosting 页端口 7717 → 5178、SECURITY 提示改为令牌鉴权口径。详见 `DOCS-COMMANDS-CONFIG.md` §2 / §5.4 / §5.5。

> **仍待拍板**：`packages/clover/src/server.ts` 的 `defaultPort` 是 `5178`、`packages/server` 是 `4200`，两者不一致（发布包与内嵌 server 包）。设计稿按发布包口径写 5178；是否统一为单一默认值需产品决策，见 §7 风险 7。

---

## 5. 改动清单（文件级 · **第四十九轮已执行**）

| 文件 | 改动性质 | 状态 |
|---|---|---|
| `packages/server/src/cli.ts` | 重写为分派器：仅识别 `run` / `serve`，help 文本、`CliResult` 扩展；`-h/-v/-p` 行为保持不变；`init` / `connect` / `agent` / `config` / `changelog` / `open` 均按未知子命令报错 | ✅ 已改 |
| `packages/server/src/cli/errors.ts`（新增） | `CliUsageError`：用法错误与运行期错误区分 | ✅ 已加 |
| `packages/server/src/cli/commands/run.ts`（新增） | `run` 实现（脱离 HTTP 服务）：参数解析 + agent 解析 + 权限应答 + 事件输出 | ✅ 已加 |
| `packages/server/src/cli/commands/serve.ts`（新增） | `serve` 实现（选项落到既有 env），**不含 `open`** | ✅ 已加 |
| ~~`packages/server/src/cli/config.ts`~~ | **第四十八轮取消**：不新增配置层，直接复用现成 env key | — 取消 |
| `packages/server/src/index.ts` | 导出 `runCliCommand` / `processCliArgs` 及命令选项类型 | ✅ 已改 |
| `packages/server/src/helpers/logger.ts` | 新增 `setLoggerConsoleTarget`：CLI 把库日志挪到 stderr，stdout 只留 agent 输出 | ✅ 已加 |
| `packages/clover/src/server.ts` | 子命令在 Vite / Express 之前分流：`run` 执行完退出，`serve` 继续走默认启动路径 | ✅ 已改 |
| `packages/server/src/cli/cli.test.ts` + `commands/{run,serve}.test.ts` + `test/setup.ts`（新增） | 单元测试（§6），共 39 个用例 | ✅ 已加 |
| `packages/server/vitest.config.ts`（新增） | `environment: 'node'`，只收 `src/cli/**/*.test.ts` | ✅ 已加 |
| `packages/server/package.json` | 补 `test` / `test:watch` 脚本与 vitest devDep（`4.1.12`） | ✅ 已改 |
| `packages/clover/package.json` | 未改：`clover` bin 继续复用 `dist-server/server.js` | — 无需 |
| `README.md` / `README.zh.md` | 补 CLI 命令文档（只有 `run` / `serve`） | ⬜ 待办 |
| 本文件 `docs/cli-commands-plan.md` | 方案（第四十一至四十九轮修订） | ✅ 已更新 |

---

## 6. 测试方案（**第四十九轮已落地** · 39 个用例全绿）

### 6.1 现状与目标

- **第四十九轮之前**：`packages/server` 与 `packages/clover` 都没有 test 脚本；全仓 17 个 `*.spec.ts` 全在 `packages/assistant`（Angular TestBed + vitest `^4.1.10`），且无 `vitest.config.*`。
- **第四十九轮已落地**：`packages/server` 补上 vitest 基建与 39 个 CLI 用例；`packages/assistant` 的既有测试不受影响。
- 测试对象只有两块：**分派器**、**`run` / `serve` 两条命令**（第四十八轮起不再有独立的配置解析测试——没有 `config.ts` 了）。被判无价值的 18 条不写专门用例，也不测功能。
- 硬约束：不启动真实服务、不监听端口、不 spawn 真实 agent 子进程、**不读写真实 `~/.clover`**、不依赖网络。

### 6.2 基础设施（已建）

- `packages/server/package.json` 加 `"test": "vitest run"` / `"test:watch": "vitest"`，devDependencies 加 `vitest@4.1.12`（与 store 中既有版本一致，避免额外下载）。
- `packages/server/vitest.config.ts`：`environment: 'node'`，`include: ['src/cli/**/*.test.ts']`，`setupFiles: ['src/cli/test/setup.ts']`。
- 文件结构（与 §5 改动清单一一对应）：

```text
packages/server/src/cli/
├── cli.ts            cli.test.ts          # 分派 / 旧参数
├── errors.ts                              # CliUsageError
├── test/setup.ts                          # 临时 HOME + env 隔离
└── commands/
    ├── run.ts        run.test.ts          # 单次任务
    └── serve.ts      serve.test.ts        # 起服务
```

- **隔离钩子（`test/setup.ts`）**：
  - `beforeEach`：`mkdtempSync(join(tmpdir(), 'clover-cli-test-'))` 建临时 HOME，覆盖 `process.env.HOME` / `USERPROFILE`；保存需要改写的 env 原值。
  - `afterEach`：恢复 env、`rmSync(tempDir, { recursive: true, force: true })`。
  - 测试期间 `CLOVER_LOG_TO_FILE=false`，不在用户目录留下 `~/.clover/logs`。
  - 断言兜底：测试只读临时 HOME 下的 `acp.json`；真实 `~/.clover` 始终不被触碰（已实测确认）。

### 6.3 用例清单（**已实现**）

#### A. 分派器 `cli.test.ts`（12 个用例）

| # | 用例 | 输入 | 期望 | 状态 |
|---|---|---|---|---|
| 1 | 帮助 | `-h` / `--help` | 输出含 `Usage`、`run`、`serve`；**不含** `init` / `connect` / `open` / `config` / `changelog`；exit 0 | ✅ |
| 2 | 版本 | `-v` / `--version` | 输出版本字符串（与 package.json 一致）；exit 0 | ✅ |
| 3 | 端口设置 | `-p 8080` / `--port 8080` | `process.env.PORT === '8080'`；不启动服务 | ✅ |
| 4 | 非法端口 | `--port abc`、`--port 0`、`--port 65536` | stderr 含 `Invalid port`；exit 1 | ✅ |
| 5 | 无参数 | `[]` | 返回默认 `serve` 意图；不执行 `run`；向后兼容 | ✅ |
| 6 | 子命令切分 | `['run', 'prompt text', '--json']` | 得到 `command.name === 'run'` 与未污染的剩余参数 | ✅ |
| 7 | 子命令切分 | `['serve']` | 得到 `command.name === 'serve'` | ✅ |
| 8 | `-p` 误吞回归 | `['run', 'prompt', '-p', '9000']` | `-p` 不被顶层 `findIndex` 写进 `process.env.PORT`；由子命令解析器处理 | ✅ |
| 9 | 未知命令 | `['init']` | stderr 含 `Unknown command: init` + 可用命令；exit 1；**不静默启动服务** | ✅ |
| 10 | 被砍命令全走未知分支 | `init` / `connect` / `agent` / `config` / `changelog` / `open` | 一律 exit 1 | ✅ |
| 11 | 帮助文本不含被砍命令 | `buildHelpText()` | 不含上述 6 个词 | ✅ |
| 12 | `isCliCommand` | — | 只认 `run` / `serve` | ✅ |

#### B. `run` `run.test.ts`（19 个用例）

| # | 用例 | 期望 | 状态 |
|---|---|---|---|
| 1 | 参数解析 | 提示词 / `--agent` / `--root` / `--json` / `--approve` 均正确解析；选项前后皆可 | ✅ |
| 2 | 多段位置参数 | 拼成一句话（`summarise the open PRs`） | ✅ |
| 3 | `--` 之后 | 全部按提示词处理 | ✅ |
| 4 | 缺值 / 缺提示词 / 未知选项 | 抛 `CliUsageError` | ✅ |
| 5 | agent 解析 | 未安装 → 报错；只有一个 → 直接用；多个且未指定 → 报错并列出 id；指定未安装 → 报错 | ✅ |
| 6 | cwd 解析 | 缺省用 `process.cwd()`；`--root` 解析成绝对路径 | ✅ |
| 7 | 权限选项 | allow 优先 `allow_once`；deny 优先 `reject_once`；无可选项 → `cancelled` | ✅ |
| 8 | 正常路径 | stdout 含 `→ agent …` / `→ workspace …` / `✓ done in …`；exit 0 | ✅ 实测 |
| 9 | `--json` | 输出逐行 NDJSON，每行可 `JSON.parse`，顺序与 `onEvent` 一致 | ✅ 实测 |
| 10 | agent 未注册 | stderr 提示去 Web UI 安装；exit 1；不调用 `promptAndWait` | ✅ |
| 11 | ACP 错误 | exit 1，stderr 含原因 | ✅ |
| 12 | 权限默认拒绝 | 默认拒绝策略下发出拒绝，不挂住；`--approve` 放行 | ✅ |
| 13 | 异常清理 | `sessions.destroy()` 与 `registry.destroy()` 均被调用（`finally`） | ✅ |
| 14 | Ctrl-C | exit 130，清理子进程 | ✅ |
| 15 | **不启动 HTTP** | `express()` / `createServer()` / `listen()` 均未被调用 | ✅ 实测 |

#### C. `serve` `serve.test.ts`（8 个用例）

| # | 用例 | 期望 | 状态 |
|---|---|---|---|
| 1 | 默认 | 无额外选项，不污染 env | ✅ |
| 2 | `--port` / `-p` / `--port=` | 正确解析端口 | ✅ |
| 3 | `--readonly` | 解析为只读模式 | ✅ |
| 4 | 非法端口 | `Invalid port` 报错 | ✅ |
| 5 | 未知选项 / 多余参数 | 报错 | ✅ |
| 6 | env 转发 | `PORT` / `CLOVER_READONLY` | ✅ |
| 7 | 只写源码里存在的键 | 不写入 `HOST` 等不存在的键 | ✅ |
| 8 | 显式 `serve` 与无参数 | 二者走同一路径、行为一致 | ✅ 实测 |

### 6.4 验收标准（已达成）

- **覆盖**：`cli.ts` 的 `run` / `serve` 分派与 `-h/-v/-p` 分支；`run.ts` / `serve.ts` 主流程 + 错误路径。**第四十八轮起不含独立的配置解析用例**（没有 `config.ts`）。
- **禁止项**：测试不得写真实 `~/.clover`、不得监听端口、不得 spawn 真实 agent 进程、不得联网 —— 已实测确认。
- **CI**：`packages/server` 的 `test` 脚本纳入根 `pnpm test`（`pnpm -r test` 自动纳入）。
- **完成判据**：新增测试全绿（39/39）；`clover -v/-h/-p` 与无参数行为零回归。

### 6.5 与命令清单的一致性

测试覆盖面严格对齐清单 §1.6 的最终判定：**只为 ✅ 的 `run` / `serve` 写测试用例**；❌ 的 18 条（含 `open`）不写专门用例，避免测试把已砍功能「测活」。

---

## 7. 落地顺序与主要风险

| 阶段 | 内容 | 完成判据 |
|---|---|---|
| 1 · 架构 | 分派器 + `server.ts` 退出分支 + 旧选项回归测试 | `clover -v/-h/-p` 与无参数行为零变化 |
| 2 · 命令 | `run` → `serve`（**第四十八轮起无独立配置阶段**，直接复用现成 env） | 两条命令可独立跑通且不拉起 Web 服务 |
| 3 · 收尾 | help 文本、README、changeset | 文档与 help 一致 |

**风险清单**：

1. `run` 的权限请求无 UI 应答 → 必须先定自动拒绝 / `--approve` 策略，否则会挂住。
2. 子命令若没在 `createViteServer` 之前分流，会把 dev server 一起拉起。
3. agent 必须已在 `acp.json` 中才会被 Registry 加载，否则 `run` 抛 `Unknown agent`；CLI 无注册入口，报错必须给出 Web UI / 服务端的明确指引。
4. `sessions.destroy()` / `registry.destroy()` 不执行会留下 agent 子进程，CLI 不退出。
5. Windows 下 `probePathCommand` 的 shim 逻辑虽在源码中，但 CLI 已不探测 agent，此风险不再参与 CLI 路径。
6. esbuild 打包时 `node-pty`、`vite` 是 external，新增代码不要引入 Node 22 之外的 API 或浏览器侧假设。
7. **发布包默认端口 5178 vs server 包 4200 不一致**（`packages/clover/src/server.ts:29` / `packages/server/src/server.ts:146`），属产品口径不是代码问题。设计稿已按发布包写 5178；是否统一为单一默认值需拍板。**原「7717 vs 5178」「`clover.toml` vs `acp.json`」两项已于第四十八轮关闭**——前者按源码改为 5178，后者按源码改为 `acp.json`。
8. 无参数行为必须保持「启动服务」，否则破坏现有用户与 `serve:ssr` 脚本。
9. 被砍掉的 `init` / `connect` / `agent` / `config` / `changelog` / `open` 一律走未知子命令分支，任何路径都不得提示用户去运行它们。
10. 不存在任何预置 agent 候选：CLI 帮助与报错都不得暗示有内置列表可挑或可安装。

---

## 8. 明确不做（18 条清单项 + 1 条派生命令）

不做：`npm i -g @julyware/clover`、`brew install --cask clover`、`shasum -a 256 <file>`、带参长版 npm、`node --version`、`git clone github.com/julyware/clover`、`npm install && npm test`、`gh pr create --fill`、`initialize` / `session/new` / `session/prompt`、三条 `CLOVER_*=…` 环境变量形式（仅作为内部 env 读取，不单列命令）、`clover init` 与 `npx @julyware/clover init`、`clover connect` 与 `clover agent add claude`（含暂缓的 `agent list|remove`）、`clover changelog --breaking`、`clover open .`。

另：**`clover config …` 不在 21 条清单内**（由环境变量形式派生），第四十三轮一并取消；**第四十八轮连内部 `config.ts` 也取消** —— `run` / `serve` 直接复用源码现成 env key，不引入任何新配置层。

按清单 §1.6 计数：❌ 18 条（其中 D 类环境变量形式**第四十八轮起在源码中同样零命中**，连内部 env 读取都不提供）+ ✅ 3 条有价值 = 21 条。CLI 最终只新增 `run` 与 `serve` 两条命令。
