# Luxio Monorepo

浏览器 Web 应用与本地代理 Agent 的通用开发方案（基于 ACP 协议）。

A universal development solution combining a browser web app with a local proxy Agent, built on the ACP protocol.

## 仓库结构 / Repo Structure

```
luxio-monorepo/
├── packages/
│   ├── agent/                  # 本地代理 Agent（@luxio/agent）
│   │                           # Local proxy agent: Express + WebSocket + ACP + node-pty + Redis
│   │                           # Redis 需独立部署，默认走内存模式（不订阅 Redis）
│   ├── assistant/              # 主应用（luxio）: Angular 21 + SSR
│   │                           # Main app: editor / terminal / ACP client UI
│   ├── common/                 # 共享 TypeScript 库（@luxio/common）
│   ├── community-widget/       # 社区挂件
│   ├── editor/                 # 编辑器
│   ├── forgotpassword/         # 忘记密码流程
│   ├── home/                   # 首页
│   ├── official-site/          # 官方网站
│   ├── resetpassword/          # 重置密码流程
│   ├── signin/                 # 登录
│   └── signup/                 # 注册
├── docs/                       # 设计文档
├── .opencode/plans/            # 功能方案文档
├── scripts/                    # 构建脚本（build-with-timer.mjs）
├── static/                     # 静态资源
├── nginx-conf/                 # Nginx 配置
├── supabase/                   # Supabase Edge Functions
├── nginx-containerization.md   # Nginx 容器化方案
├── pnpm-workspace.yaml         # pnpm workspace 配置
├── package.json                # 根 package.json
└── README.md
```

## 技术栈 / Tech Stack

- **包管理**: pnpm workspace
- **运行时**: Node.js >= 22
- **前端**: Angular 21（SSR）、TypeScript、Tailwind CSS
- **代理 Agent**: Express、WebSocket、ACP（Agent Client Protocol）、node-pty、Redis
- **构建**: tsup、Angular CLI

> **Redis 说明**: Redis 为可选依赖，需独立部署 Redis 服务组件。默认情况下应用运行在内存模式，不走 Redis 订阅；如需启用 Redis，请设置环境变量 `REDIS_USE_MEMORY_FALLBACK=false`。

## 快速开始 / Getting Started

```bash
# 安装依赖
pnpm install

# 启动所有包的开发服务
pnpm dev

# 构建本地代理 Agent
pnpm build:agent

# 构建全部
pnpm build
```

### 关键子包命令 / Key package commands

```bash
# assistant 主应用
pnpm --filter ./packages/assistant start        # 开发服务器（HTTPS）
pnpm --filter ./packages/assistant build        # 构建 + 样式内联 + 类型声明
pnpm --filter ./packages/assistant serve:ssr:luxio  # 运行 SSR 服务

# agent 本地代理
pnpm --filter ./packages/agent build            # tsup 构建
pnpm --filter ./packages/agent dev              # 监听构建
```

## 根脚本 / Root Scripts

| 命令 | 说明 |
|------|------|
| `pnpm build` | 构建全部（带计时） |
| `pnpm build:agent` | 仅构建 @luxio/agent |
| `pnpm dev` | 并行启动所有包的开发服务 |
| `pnpm test` | 并行运行所有包的测试 |