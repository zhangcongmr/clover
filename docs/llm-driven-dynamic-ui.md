# 文件图标功能方案文档

## 目标

在 ast-tree 组件中根据文件扩展名动态生成文件类型图标，包括 LLM 驱动的图标生成、localStorage 持久化以及主题切换时的清理。

## 核心流程

```
用户输入主题描述
    ↓
LLM 在 content 开头输出统一 JSON 代码块（colors → themeIcon → fileIcons）
    ↓
parseUnifiedThemeContent() 从 content 解析 JSON 代码块
   -> 正则 /```json\s*({[\s\S]*?})\s*```/g 提取/解析
   -> 提取 fileIcons → 创建 SVG symbol
   -> 提取 colors → 映射 CSS 变量
   -> 提取 themeIcon → 设置主题图标
    ↓
addDynamicFileIconSymbol(ext, svgPath) 创建 <symbol> 注入 SVG sprite
    ↓
customFileIcons[ext] = symbolId（运行时查找表）
customFileIconPaths[ext] = svgPath（持久化用）
    ↓
computeFileIcons() 遍历树节点，为 file 类型节点设置 fileIcon
    ↓
saveFileIcons() 写入 localStorage('vscode-file-icons')
    ↓
模板 <use [attr.href]="'#' + (item.fileIcon || 'icon-file')"> 渲染图标
```

## 数据结构

### AstTreeNode 接口（model.ts）

```typescript
interface AstTreeNode {
  fileIcon?: string; // 图标 symbol ID，如 'icon-file-js'
  // ... 其他字段
}
```

### 运行时查找表（ast-tree.component.ts）

```typescript
const customFileIcons: Record<string, string> = {};      // ext → symbolId
const customFileIconPaths: Record<string, string> = {};   // ext → svgPath
```

### localStorage 持久化

- **Key**: `vscode-file-icons`
- **Value**: `JSON.stringify({ ext: svgPath, ... })`
- 存储 SVG path 数据而非 symbol ID（symbol 每次页面加载重新创建）

## 文件结构

| 文件 | 职责 |
|------|------|
| `packages/assistant/src/svg-sprite.const.ts` | 静态 SVG sprite 定义 + `addDynamicFileIconSymbol()` 运行时注入 |
| `packages/assistant/src/app/shared/model.ts` | `fileIcon` 字段声明 |
| `packages/assistant/src/app/shared/ast-tree/ast-tree.component.ts` | `FILE_ICON_MAP`、`getFileIcon()`、`computeFileIcons()`、`customFileIcons`/`customFileIconPaths` |
| `packages/assistant/src/app/shared/ast-tree/ast-tree.component.html` | 两处 `<use>` 绑定 `item.fileIcon` |
| `packages/assistant/src/app/app.component.ts` | Tool 定义、`getThemeSystemPrompt()`、`generateThemeFromPrompt()` 处理、`saveFileIcons()`/`loadSavedFileIcons()`、`toggleTheme()` 清理 |

## 关键函数

### addDynamicFileIconSymbol(ext: string, svgPath: string): string

在 `svg-sprite.const.ts` 中 — 查找已有 `<svg>` sprite 容器或创建新元素，插入 `<symbol id="icon-file-theme-{ext}" viewBox="0 0 24 24" fill="currentColor"><path d="{svgPath}"/></symbol>`，返回 `icon-file-theme-{ext}`。

### getFileIcon(ext: string): string

查找优先级：
1. `customFileIcons[ext]`（LLM 动态生成）
2. `FILE_ICON_MAP[ext]`（静态预定义）
3. 兜底 `'icon-file'`

### computeFileIcons(data: AstTreeNode[]): void

递归遍历节点，对 `nodeType === 'file'` 的节点调用 `getFileIcon()` 设置 `fileIcon`。

### saveFileIcons() / loadSavedFileIcons()

- `saveFileIcons`: 将 `customFileIconPaths` 序列化写入 `localStorage`
- `loadSavedFileIcons`: 从 localStorage 读取 paths，为每个 path 调用 `addDynamicFileIconSymbol` 重建 symbol，同时填充 `customFileIcons` 和 `customFileIconPaths`

### parseUnifiedThemeContent(text: string): Record\<string, string\> | null

在 `generateThemeFromPrompt()` 中使用 — 用正则 `/```json\s*(\{[\s\S]*?\})\s*```/g` 从 LLM 响应的 content 中提取统一 JSON 代码块，分别处理 `colors`（返回颜色 map）、`themeIcon`（设主题图标）、`fileIcons`（创建 symbol + 持久化）。返回颜色 map，解析失败返回 `null`。

### toggleTheme()

清除 `customFileIcons` 和 `customFileIconPaths`，删除 localStorage key。

## SVG 图标设计规范（系统提示词）

### 静态图标（svg-sprite.const.ts）

42 个预定义文件类型图标使用 `<text>` 元素 + 文档基础形状：
- `viewBox="0 0 24 24"`
- 文档背景矩形（`<rect>`，opacity 0.06）
- 文本元素使用 `Arial,sans-serif`，字号 10-14，居中
- `fill="currentColor"` 适配主题色

### 动态图标（LLM 生成，系统提示词约束）

LLM 在响应 content 开头输出 JSON 代码块，格式如下：

```json
{
  "colors": {
    "background": "#1e1e1e",
    "primary": "#007acc",
    "text": "#cccccc",
    "surface": "#252526",
    "accent": "#0097fb",
    "border": "#3c3c3c"
  },
  "themeIcon": "M12 2C6.48 2...",
  "fileIcons": [
    {
      "extension": "js",
      "iconId": "icon-file-js",
      "svgPath": "M...Z"
    }
  ]
}
```

每个 entry 必须包含：
- `extension`: 不带点的扩展名
- `iconId`: 对应静态图标 ID
- `svgPath`: 24×24 图标的 SVG path `d` 属性

**svgPath 设计约束**（按优先级）：
1. 使用扩展名字符串本身（如 "JS"、"TS"、"PY"）
2. 使用扩展名缩写
3. 使用文件类型特征符号（如 `{ }` 对 JSON、`#` 对 CSS、`</>` 对 HTML/XML）
4. 必要时结合形状示例（数据库圆柱对 SQL、齿轮对 YAML、锁对 ENV/LOCK、分支对 GIT、文档对 PDF、存档对 ZIP、图像对图片文件）
5. `fill="currentColor"`
6. 简单清晰的几何路径，形成可识别的文本或符号
7. 同时反映文件类型和主题情绪

## Tool 定义（已废弃）

原先的 tool call 方式（`ui_theme_colors`、`ui_theme_icon`、`ui_file_icon`）已全部废除，统一合并为 content JSON 代码块输出。

详见上方"核心流程"节中的统一 JSON 格式。

## 集成点

| 位置 | 操作 |
|------|------|
| `ngOnInit` | 调用 `loadSavedFileIcons()` 恢复持久化图标 |
| `ngAfterViewInit` | `afterNextRender` 中若存在已加载图标，调用 `computeFileIcons()` 刷新树 |
| `ngOnChanges` | `computeFileIcons()` 调用在 `assignDeepLevel()` 之后 |
| `generateThemeFromPrompt()` | 从 `assistantText` 解析统一 JSON 代码块（`parseUnifiedThemeContent`），提取 colors → 设 CSS 变量、themeIcon → 设主题图标、fileIcons → 创建 symbol + 持久化 |
| `toggleTheme()` | 清除所有自定义图标状态和 localStorage |

## 关键决策记录

1. **全部合并为 content JSON**：将 `ui_theme_colors`、`ui_theme_icon`、`ui_file_icon` 三个 tool 全部废除，统一合并到 content 开头的 JSON 代码块中。文件图标（28 个 svgPath，~2000 tokens）占主体，6 个色值 + 1 个主题图标（~200 tokens）开销极小，合并后零 tool call、零失败率
2. **统一 JSON schema**：`{ colors: { ... }, themeIcon: "M...", fileIcons: [...] }` — colors 和 themeIcon 放在前面优先输出，文件图标在后，确保核心主题数据先到达
3. **系统提示词简化为单步**：不再分 STEP 1/2/3，直接要求模型在 content 开头输出统一 JSON 代码块
4. **扩展名列表精简**：从 ~40 个低频扩展名（swift, kt, dart, svelte, gradle, lua, hs, ex, graphql, sol 等）减至 ~25 个最常用扩展名，减少约 40% token 压力，低频类型靠静态 sprite 兜底
5. **持久化格式**：存储 SVG path 数据而非 symbol ID — symbol 是运行时 ephemeral 的，每次页面加载需从 path 重建
6. **存储方案**：localStorage 而非 IndexedDB — 数据量 2-8 KB，localStorage 5 MB 限制足够且 API 更简单
7. **图标设计**：文本缩写（JS、TS、CPP）+ 简单几何形状 — 16×16 尺寸下可识别度最高
8. **文档背景**：使用 opacity 0.06 的矩形提供微妙上下文，前景/符号使用完全透明

---

# 动态字体（Typography）方案

## 目标

通过 LLM 驱动 `submitThemePrompt()` 流程，在生成颜色的同时动态生成整套 UI 字体样式（font-family、font-size、font-weight），支持 Google Fonts 动态加载与持久化。

## 字体 CSS 变量全集

| 类别 | 变量名 | 默认值 |
|------|--------|--------|
| Base | `--vscode-font-family` | `'Segoe UI', Tahoma, Geneva, Verdana, sans-serif` |
| Base | `--vscode-font-size` | `14px` |
| Base | `--vscode-font-weight` | `400` |
| Base | `--vscode-line-height` | `1.5` |
| Mono | `--vscode-font-mono` | `'Courier New', monospace` |
| Mono | `--vscode-code-font-size` | `13px` |
| Heading | `--vscode-heading-font-family` | `var(--vscode-font-family)` |
| Heading | `--vscode-heading-font-weight` | `600` |
| UI | `--vscode-label-font-size` | `13px` |
| UI | `--vscode-label-font-weight` | `400` |
| UI | `--vscode-input-font-size` | `14px` |
| UI | `--vscode-button-font-size` | `14px` |
| UI | `--vscode-button-font-weight` | `500` |
| UI | `--vscode-menu-font-size` | `13px` |
| UI | `--vscode-tab-font-size` | `13px` |
| UI | `--vscode-tree-font-size` | `13px` |
| UI | `--vscode-badge-font-size` | `11px` |
| UI | `--vscode-small-font-size` | `12px` |

所有变量在 `:root` 和 `[data-theme="dark"]` 中定义相同默认值。

## JSON Schema 扩展

LLM 响应 JSON 新增 `typography` 和 `googleFonts` 字段：

```json
{
  "colors": { "...": "..." },
  "themeIcon": "...",
  "fileIcons": [...],
  "typography": {
    "fontFamily": "'Inter', 'Segoe UI', sans-serif",
    "fontSize": "14px",
    "fontWeight": "400",
    "lineHeight": "1.6",
    "monoFont": "'JetBrains Mono', 'Fira Code', monospace",
    "codeFontSize": "13px",
    "headingFont": "'Inter', 'Segoe UI', sans-serif",
    "headingWeight": "600",
    "labelSize": "13px",
    "inputSize": "14px",
    "buttonSize": "14px",
    "buttonWeight": "500",
    "menuSize": "13px",
    "tabSize": "13px",
    "treeSize": "13px",
    "badgeSize": "11px",
    "smallSize": "12px"
  },
  "googleFonts": ["Inter", "JetBrains Mono"]
}
```

system prompt 约束：
- 推荐非系统字体时，必须将字体名加入 `googleFonts` 数组（只写具体字体名，不含 fallback）
- `typography` 中的所有字体值必须使用 web-safe family 或 `googleFonts` 中列出的字体名作为首选
- UI 字号以 `fontSize` 为基准，根据用途语义化调整

## Google Fonts 动态加载

### localStorage 键

| 键 | 值 | 来源 |
|---|-----|------|
| `vscode-google-fonts` | `string[]` 字体名数组 | 新增 |

### 加载流程 `loadGoogleFonts(fontNames: string[])`

```
1. 每个字体名 → URL: https://fonts.googleapis.com/css2?family=FONT:wght@400;500;600;700&display=swap
2. 检查 <head> 是否已有相同 href 的 <link>，避免重复
3. 无则创建 <link rel="stylesheet" href="URL" data-vscode-font="true">
4. 序列化写入 localStorage vscode-google-fonts
```

### 清理流程 `removeGoogleFonts()`

```
1. 查找 <link[data-vscode-font]> 全部移除
2. 清除 localStorage vscode-google-fonts
```

### 页面启动恢复

```
ThemeService 构造器 / AppComponent.ngOnInit 中：
  1. 加载 vscode-theme-vars（恢复所有 CSS 变量，含字体）
  2. 读取 vscode-google-fonts，存在则调用 loadGoogleFonts()
```

## 映射函数 mapTypographyToCss()

| LLM key | CSS 变量 |
|---------|----------|
| fontFamily | `--vscode-font-family` |
| fontSize | `--vscode-font-size` |
| fontWeight | `--vscode-font-weight` |
| lineHeight | `--vscode-line-height` |
| monoFont | `--vscode-font-mono`, `--vscode-terminal-font-family` |
| codeFontSize | `--vscode-code-font-size`, `--vscode-terminal-font-size` |
| headingFont | `--vscode-heading-font-family` |
| headingWeight | `--vscode-heading-font-weight` |
| labelSize | `--vscode-label-font-size` |
| labelWeight | `--vscode-label-font-weight` |
| inputSize | `--vscode-input-font-size` |
| buttonSize | `--vscode-button-font-size` |
| buttonWeight | `--vscode-button-font-weight` |
| menuSize | `--vscode-menu-font-size` |
| tabSize | `--vscode-tab-font-size` |
| treeSize | `--vscode-tree-font-size` |
| badgeSize | `--vscode-badge-font-size` |
| smallSize | `--vscode-small-font-size` |

## 集成点

| 位置 | 操作 |
|------|------|
| `styles.css :root` | 添加所有字体变量默认值；body 改用 `var()` |
| `styles.css [data-theme="dark"]` | 添加所有字体变量默认值 |
| `ThemeService.setThemeVariables()` | 无需修改（颜色/字体统一注入） |
| `ThemeService` | 新增 `loadGoogleFonts()` / `removeGoogleFonts()` |
| `AppComponent.getThemeSystemPrompt()` | 更新 JSON schema 增加 typography 说明 |
| `AppComponent.parseUnifiedThemeContent()` | 解析 `typography` 和 `googleFonts` |
| `AppComponent.generateThemeFromPrompt()` | 成功后调用字体加载 |
| `AppComponent.toggleTheme()` | 调用 `removeGoogleFonts()` |
| 核心组件 CSS | 用 `var(--vscode-xxx)` 替换硬编码 |

## Phase 1 范围

只改全局 body 和核心布局组件，不包括编辑器（notebook Shadow DOM 字体）、feature 组件（user-center、settings）。

| 文件 | 改动 |
|------|------|
| `styles.css` | 字体变量 + body 使用 var() |
| `theme.service.ts` | Google Fonts 加载/清理/持久化 |
| `app.component.ts` | typography 解析/映射 + system prompt 更新 |
| `app.component.css` | 布局元素用 var() |
| `ast-tab-group/*.css` | tab 标签 `font-size` |
| `ast-menu/*.css` | 菜单项 `font-size` |
| `explorer/*.css` | 树项/标签 `font-size` |
| `ast-tree/*.css` | 树标签 `font-size` |
| `terminal/*.css` | `font-family` + `font-size` |

---

# 动态圆角（Border-Radius）方案

## 目标

通过 LLM 驱动 `submitThemePrompt()` 流程，在生成颜色和字体的同时动态生成 UI 圆角风格，支持尖锐/圆润/现代等不同风格。

## 圆角 CSS 变量

| 变量名 | 默认值 | 适用范围 |
|--------|--------|----------|
| `--vscode-radius-sm` | `4px` | 滚动条滑块、徽章、树节点、菜单、进度条、tab 拖拽预览、小按钮 |
| `--vscode-radius-md` | `10px` | 按钮、输入框、文本区、select 菜单、弹窗 |
| `--vscode-radius-lg` | `16px` | 面板、对话框、大卡片 |
| `--vscode-radius-pill` | `9999px` | 胶囊/药丸形元素（搜索输入框、标签） |

## JSON Schema 扩展

LLM 响应 JSON 新增 `radius` 字段：

```json
{
  "radius": {
    "sm": "4px",
    "md": "8px",
    "lg": "16px"
  }
}
```

system prompt 约束：
- `sm`: 小圆角，范围 2px-8px
- `md`: 中圆角，范围 4px-16px
- `lg`: 大圆角，范围 8px-24px
- `pill`（9999px）固定，无需生成
- 风格映射：
  - 尖锐/科技感 → sm:2px, md:4px, lg:8px
  - 柔和/圆润 → sm:6px, md:12px, lg:20px
  - 现代/简洁 → sm:4px, md:8px, lg:16px

## 映射函数 mapRadiusToCss()

| LLM key | CSS 变量 |
|---------|----------|
| sm | `--vscode-radius-sm` |
| md | `--vscode-radius-md` |
| lg | `--vscode-radius-lg` |
| pill | `--vscode-radius-pill` |

## 集成点

| 位置 | 操作 |
|------|------|
| `styles.css :root` | 添加 4 个 `--vscode-radius-*` 变量默认值 |
| `styles.css [data-theme="dark"]` | 添加相同默认值 |
| `AppComponent.getThemeSystemPrompt()` | JSON schema 增加 `radius` + 生成规则 |
| `AppComponent.parseUnifiedThemeContent()` | 解析 `radius` → 调用 `mapRadiusToCss()` 合并到 cssVars |
| `ThemeService` | 无改动（color/typography/radius 统一通过 cssVars 走 set/clear/save/load） |

## Phase 1 范围

与字体 Phase 1 的文件集一致，共 18 处替换。

### 替换原则

所有替换遵循：`border-radius: Xpx` → `border-radius: var(--vscode-radius-YY, Xpx)`，其中 fallback 严格等于原值，保证变量失效时 UI 不变。按当前值就近归类语义变量：

| 原值 | 语义变量 | 典型元素 |
|------|----------|----------|
| 2px | `--vscode-radius-sm` | 树标签徽章 |
| 4px | `--vscode-radius-sm` | 滚动条、菜单、tab 拖拽、树过滤框、终端按钮、弹窗提交按钮 |
| 10px | `--vscode-radius-md` | 主题提示按钮、进度条容器 |
| 12px | `--vscode-radius-md` | 主题提示文本区 |
| 16px | `--vscode-radius-lg` | 通知面板、主题提示面板、测试面板 |
| 32px | `--vscode-radius-pill` | 搜索输入框和按钮 |
| 50% | 保持不动 | 圆形图标 |

### 改动文件清单

| 文件 | 替换数 | 说明 |
|------|--------|------|
| `styles.css` | 1 | `.custom-scroll::-webkit-scrollbar-thumb` |
| `app.component.css` | 9 | 面板/按钮/输入框/进度条/搜索 |
| `ast-menu.component.css` | 1 | 菜单容器 |
| `ast-tab-group.component.css` | 1 | 拖拽预览 |
| `ast-tree.component.css` | 3 | 过滤输入框 + 2 个徽章 |
| `terminal.component.css` | 1 | 控制按钮 |
| `ast-modal.component.css` | 1 | 提交按钮 |

---

# 动态阴影（Box-Shadow / Elevation）方案

## 目标

通过 LLM 驱动 `submitThemePrompt()` 流程，在生成颜色/字体/圆角的同时动态生成 UI 阴影/提升感，支持扁平/适中/深邃等不同风格。

## 阴影 CSS 变量

| 变量名 | 默认值 | 适用范围 |
|--------|--------|----------|
| `--vscode-shadow-sm` | `0 2px 8px rgba(0,0,0,0.1)` | 小弹出层、菜单、下拉框、卡片悬停 |
| `--vscode-shadow-md` | `0 8px 24px rgba(0,0,0,0.15)` | 模态框、浮动窗口 |
| `--vscode-shadow-lg` | `0 18px 50px rgba(0,0,0,0.22)` | 大型面板、对话框、覆盖层 |

## JSON Schema 扩展

LLM 响应 JSON 新增 `shadow` 字段：

```json
{
  "shadow": {
    "sm": "0 2px 8px rgba(0,0,0,0.1)",
    "md": "0 8px 24px rgba(0,0,0,0.15)",
    "lg": "0 18px 50px rgba(0,0,0,0.22)"
  }
}
```

system prompt 约束：
- 每个值是完整的 CSS `box-shadow` 值字符串
- `sm` = 小提升（菜单、下拉层），`md` = 中提升（模态框、卡片），`lg` = 大提升（面板、弹窗）
- 情绪映射：`flat/minimal` → 极小或无阴影；`deep/pronounced` → 大偏移+大模糊；`playful` → 可使用有色阴影替代纯黑 rgba
- 默认使用 `rgba(0,0,0,X)` 作为阴影色

## 映射函数 mapShadowToCss()

| LLM key | CSS 变量 |
|---------|----------|
| sm | `--vscode-shadow-sm` |
| md | `--vscode-shadow-md` |
| lg | `--vscode-shadow-lg` |

## 集成点

| 位置 | 操作 |
|------|------|
| `styles.css :root` | 添加 3 个 `--vscode-shadow-*` 变量默认值 |
| `styles.css [data-theme="dark"]` | 添加相同默认值 |
| `AppComponent.getThemeSystemPrompt()` | JSON schema 增加 `shadow` + 生成规则 |
| `AppComponent.parseUnifiedThemeContent()` | 解析 `shadow` → 调用 `mapShadowToCss()` 合并到 cssVars |
| `ThemeService` | 无改动 |

### 不纳入替换的阴影类型

以下阴影保持硬编码，不接入 CSS 变量体系：

| 类型 | 原因 |
|------|------|
| `inset` 内阴影（进度条） | 语义特殊，非 elevation |
| 多层 Material 阴影（tab 拖拽预览） | 结构复杂，LLM 难以生成 |
| 有色交互态阴影（file-input focus 蓝色阴影） | 属于焦点反馈而非 elevation |
| feature 组件阴影（user-center、ast-api 等） | 延至后续阶段 |
| `@a2ui` 组件库阴影（restaurant-theme.css） | 组件库自有变量体系 |

## Phase 1 范围

仅替换 body 级浮层面板、菜单、模态框，共 **5 处**。

| 文件 | 替换数 | 位置 |
|------|--------|------|
| `app.component.css` | 3 | `.indicator-panel` / `.theme-prompt-panel` / `.testSurface-panel` |
| `ast-menu.component.css` | 1 | `:host(.codigma-right-menu)` |
| `ast-modal.component.css` | 1 | `.ast-modal-overlay` |

---

# 动态动效（Motion / Animation）方案

## 目标

通过 LLM 驱动 `submitThemePrompt()` 流程，在生成颜色/字体/圆角/阴影的同时动态生成 UI 动效参数（时长和缓动函数），支持极快/标准/缓慢等不同速度风格。

## 动效 CSS 变量

| 变量名 | 默认值 | 适用范围 |
|--------|--------|----------|
| `--vscode-motion-duration` | `0.3s` | 主要过渡/动画时长 |
| `--vscode-motion-easing` | `ease` | 主要缓动函数 |

## JSON Schema 扩展

LLM 响应 JSON 新增 `motion` 字段：

```json
{
  "motion": {
    "duration": "0.3s",
    "easing": "ease"
  }
}
```

system prompt 约束：
- `duration`: 0.1s（极快/干脆）到 0.8s（缓慢/刻意），默认 0.3s
- `easing`: `ease`、`ease-in-out`、`ease-out`、`ease-in`、`linear` 或 `cubic-bezier(...)`
- 情绪映射：
  - 活泼/俏皮 → 0.15s-0.2s + ease-out 或弹跳型 cubic-bezier
  - 平静/专业 → 0.2s-0.3s + ease
  - 戏剧/强调 → 0.4s-0.6s + ease-out

## 映射函数 mapMotionToCss()

| LLM key | CSS 变量 |
|---------|----------|
| duration | `--vscode-motion-duration` |
| easing | `--vscode-motion-easing` |

## 集成点

| 位置 | 操作 |
|------|------|
| `styles.css :root` | 添加 2 个 `--vscode-motion-*` 变量默认值 |
| `styles.css [data-theme="dark"]` | 添加相同默认值 |
| `AppComponent.getThemeSystemPrompt()` | JSON schema 增加 `motion` + 生成规则 |
| `AppComponent.parseUnifiedThemeContent()` | 解析 `motion` → 调用 `mapMotionToCss()` 合并到 cssVars |
| `ThemeService` | 无改动 |

### 不纳入替换的动效

以下动效保持硬编码：

| 类型 | 原因 |
|------|------|
| `cubic-bezier` 过渡（tab 拖拽 `cubic-bezier(0,0,0.2,1)`） | 属于特定 UX 交互行为，非通用泛化 |
| `fadeIn` 含 delay 的组合（`cubic-bezier(0,0,0.3,1) + delay`） | 含 delay 的特殊结构 |
| `spin` 旋转动画（`1s linear infinite`） | 功能型加载指示器 |
| feature 组件动效（file-input、add-project） | 延至后续阶段 |
| `@a2ui` 组件库动效 | 组件库自有变量体系 |

## Phase 1 范围

仅替换使用 `ease` 缓动的通用 transition/animation，共 **6 处**。

| 文件 | 替换数 | 位置 |
|------|--------|------|
| `styles.css` | 1 | `.codigma-menu-every-item` transition |
| `app.component.css` | 4 | 3 个面板动画 + 进度条 transition |
| `ast-api.component.css` | 1 | `transition: clip-path / opacity`（使用 `replaceAll` 为渐进值，`clip-path` 和 `opacity` 值不同故需独立替换） |
