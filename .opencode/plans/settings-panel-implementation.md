# 设置面板实现计划

## 概述

将 `packages/assistant/src/app/luxio/settings/` 从占位组件改造为功能完整的设置面板。分 4 轮迭代实现 **15 项功能**，每轮交付一个可用版本。

> 状态标注：✅ 已实现 &nbsp; ⚡ 部分实现 &nbsp; ❌ 未实现

---

## 第一轮：P0 — 核心连接配置（预估工时：~2h）

**状态：✅ 已完成**

**目标**：让设置面板有实际功能，覆盖用户最刚需的配置项。

### 功能 1：Agent URL 配置 ✅
- **文件**：`settings.component.html` / `.ts` / `.css`
- **实现**：单行文本输入框 + 保存按钮
- **逻辑**：读取/写入 `localStorage['assistant_agentUrl']`，通过 `LocalAgentService.setAgentUrl()` 通知重连
- **状态**：保存后显示 "Saved" 提示（2秒自动消失）

### 功能 2：文件夹读写模式 ✅
- **实现**：单选按钮组（只读 / 读写）
- **逻辑**：通过 `SettingsService.folderReadWriteMode` 信号共享，`ContentComponent` 移除本地属性改为从 Service 读取
- **方案**：将 `folderReadWriteMode` 移入 `SettingsService`

### 功能 3：本地 Agent 状态面板 ✅
- **实现**：显示连接状态（绿色/红色指示灯）+ Agent URL + "Test Connection" 按钮
- **逻辑**：调用 `LocalAgentService.checkAgentAvailable()`，展示 `agentStatus` 信号

### UI 设计
- 左侧分类导航（列表式，类似 VS Code 设置）
- 第一轮只有 "General" 分类，三项配置按垂直排列
- 样式复用项目现有 CSS 变量体系

---

## 第二轮：P1 — 主题与外观（预估工时：~3h）

**状态：✅ 已完成**

**目标**：将散落的主题/外观设置集中到设置面板。

### 功能 4：主题模式切换 ✅
- **实现**：主题卡片列表（Light / Dark），色块预览
- **逻辑**：复用 `ThemeService.setTheme()`、`getCurrentTheme()`
- **额外**："重置为默认主题" 按钮（未添加，可通过选择 Light 达到同样效果）

### 功能 5：自动刷新开关 ✅
- **实现**：开关 toggle
- **逻辑**：`ContentComponent.autoRefreshEnabled` 由 `SettingsService.autoRefreshEnabled` 信号替代

### 功能 6：终端字体设置 ✅
- **实现**：字体族文本输入 + 字号数字输入
- **逻辑**：写入 `localStorage['vscode-theme-vars']` 中 `--vscode-terminal-font-family` 和 `--vscode-terminal-font-size`

### UI 设计
- 新增分类 "Appearance"，包含主题选择 + 字体设置
- 主题选择使用卡片式布局（色块预览）

---

## 第三轮：P2 — 编辑器与数据（预估工时：~3h）

**状态：✅ 已完成**

**目标**：覆盖编辑器偏好 + 数据管理能力。

### 功能 7：UI 字体设置 ✅
- 字体族（输入框）、字号（数字输入）、行高（数字输入）
- 写入 CSS 变量 `--vscode-font-family`、`--vscode-font-size`、`--vscode-line-height`

### 功能 8：OPFS 数据管理 ✅
- 显示各数据项的存储状态（项目树、标签页列表、服务器列表、微服务列表）+ 总用量
- "Clear All Data" 按钮（带 loading 状态，无二次确认弹窗）
- **逻辑**：读取 OPFS `/dir/` 文件列表和 `navigator.storage.estimate()` API

### 功能 9：通知首选项 ✅
- 数字输入（秒），0 = 永不自动关闭
- **逻辑**：`NotificationService.autoCloseDuration` 可配置，持久化到 localStorage `luxio_notification_duration`

### UI 设计
- 新增分类 "Editor" + "Data"

---

## 第四轮：P3 — 高级功能（预估工时：~4h）

**状态：⚡ 部分完成（10/15 已完成，5 项跳过的需更多基础设施）**

**目标**：更深入的控制项，部分需新增基础设施。

### 功能 10：AI 模型选择 ✅
- 下拉选择器：deepseek-v4-flash / deepseek-v3 / gpt-4o / gpt-4o-mini
- 持久化到 localStorage `luxio_selected_model`

### 功能 11：AI 主题生成器入口 ❌
- **跳过原因**：需要迁移或嵌入当前的主题生成弹出逻辑（`themePromptOpen` 在 `AppComponent` 中），涉及跨组件通信，需后续迭代处理

### 功能 12：服务器/微服务管理快捷入口 ❌
- **跳过原因**：现有 `server-manager` / `service-manager` 是独立的 ast-modal 弹窗组件，目前通过 ConfigService 的 dialog ID 触发。需要评估是嵌入引用还是提供导航链接

### 功能 13：自定义文件图标管理 ❌
- **跳过原因**：需要图标预览 UI 组件，当前图标 SVG 存储在 `vscode-file-icons` localStorage 中，需新建图标预览面板

### 功能 14：语言/区域设置 ❌
- **跳过原因**：项目无 i18n 基础设施，预留了 Advanced 分类位置，待后续补充

### 功能 15：插件视图开关 ✅
- toggle 开关，持久化到 localStorage `luxio_plugins_enabled`
- 注：当前仅持久化状态，`app.component.html` 中视图 ID 3 的分支已被注释掉，需外部代码放开渲染条件

---

## 架构决策

### 状态管理方案
- 新建 `SettingsService`（`settings.service.ts`），集中管理所有可配置项
- 使用 Angular Signals 作为反应式状态基元
- `SettingsService` 负责 localStorage 读写 + 通知各消费方

### 设置分类数据结构
```typescript
interface SettingsCategory {
  id: string;       // 'general' | 'appearance' | 'editor' | 'ai' | 'data' | 'advanced'
  label: string;    // 中文/英文显示名
  icon?: string;    // SVG 图标
}
```

### UI 布局
- 左右分栏：左栏为分类列表，右栏为内容区
- 使用 `@for` 循环渲染分类条目
- 使用表单 + `[(ngModel)]` 或响应式表单绑定

### 持久化策略
- **现状**：设置散落各处（localStorage / OPFS / IndexedDB）
- **目标**：统一通过 `SettingsService` 读写，下层存储保持现状不变
- **迁移路径**：为每个设置项定义读/写函数，逐步将直接 `localStorage` 调用替换为通过 Service 访问

---

## 实际文件变更清单

| 文件 | 操作 | 说明 |
|---|---|---|
| `luxio/settings/settings.component.ts` | ✅ 修改 | 完整设置面板组件，5 个分类的处理逻辑 |
| `luxio/settings/settings.component.html` | ✅ 重写 | 完整设置面板模板（General / Appearance / Editor / Data / Advanced） |
| `luxio/settings/settings.component.css` | ✅ 重写 | 设置面板样式（含主题选择器、toggle、OPFS 信息、select、danger 按钮等） |
| `luxio/settings/settings.service.ts` | ✅ **新建** | 设置状态管理服务（Angular Signals + localStorage 持久化） |
| `core.service.ts` | ❌ 无需改动 | folderReadWriteMode 移入 SettingsService，未修改 core.service.ts |
| `content/content.component.ts` | ✅ 修改 | 注入 SettingsService，移除本地 folderReadWriteMode，autoRefreshEnabled 改为委派到 Service |
| `theme.service.ts` | ❌ 无需改动 | 直接复用现有 API |
| `shared/notification/notification.service.ts` | ✅ 修改 | 新增可配置 `autoCloseDuration` 属性 |

---

## 测试策略

- 每轮开发后执行 `pnpm --filter ./packages/assistant build` 验证编译
- 手动测试场景：各设置项保存后刷新页面、切换分类、重置操作
- SettingsService 可编写单元测试
