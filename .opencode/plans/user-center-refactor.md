# User Center 组件重构计划

## 目标

将电商风格的 user-center 组件改造为面向开发者的 Profile/Dashboard 面板，同时修复菜单中未登录状态下用户相关菜单项可见的逻辑问题。

## 涉及文件

| # | 文件 | 操作 |
|---|------|------|
| 1 | `packages/assistant/src/app/luxio/user-center/user-center.component.ts` | 重写 |
| 2 | `packages/assistant/src/app/luxio/user-center/user-center.component.html` | 重写 |
| 3 | `packages/assistant/src/app/luxio/user-center/user-center.component.css` | 重写 |
| 4 | `packages/assistant/src/app/app.component.html` | 修改菜单结构 & 文案 |
| 5 | `packages/assistant/src/app/app.component.ts` | 更新引用标识 |

## 变更详解

### 1. user-center.component.ts

**删除：**
- `menuItems`、`products` 硬编码 mock 数据数组
- `checkin()` 方法
- `statistics` 属性
- `fetch('/user/info/${userId}')` 调用（改用 coreService.userData）

**新增：**
- `DashboardCategory` 接口和类别数组
- `selectedCategory` 信号
- 开发者统计数据（连接服务器数、API 接口数等）

### 2. user-center.component.html

删除全部电商 HTML，采用 SettingsComponent 风格的分栏布局：

```
.profile-container
  .profile-sidebar (200px, border-right)
    .profile-header (头像 + 用户名 + 邮箱)
    .profile-nav (4 个分类导航项)
  .profile-content (flex: 1)
    @if profile → 用户详情 + 退出
    @if overview → 统计卡片网格
    @if activity → Coming Soon 占位
    @if account → 登录状态 + 退出
```

### 3. user-center.component.css

- 删除 `*` 全局重置
- 删除所有硬编码色值
- 全部使用 `var(--vscode-*)` 设计令牌

### 4. app.component.html

菜单结构调整（去掉 Settings Group，根据 auth 状态拆分）：

**未登录：** `File | View | Theme Prompt | Settings | Sign In`
**已登录：** `File | View | Theme Prompt | Settings | Profile | Sign Out`

Separator 放置在 Profile 与 Sign Out 之间。

### 5. app.component.ts

所有 `'user-center'` 标识更新为 `'profile'`（共 4 处：line 993, 1056, 1057, 1168）。
tab 标题 `'User Center'` → `'Profile'`。

## 验证

```bash
pnpm --filter ./packages/assistant build
```
