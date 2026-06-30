# 文件图标功能方案文档

## 目标

在 ast-tree 组件中根据文件扩展名动态生成文件类型图标，包括 LLM 驱动的图标生成、localStorage 持久化以及主题切换时的清理。

## 核心流程

```
用户输入主题描述
    ↓
LLM 调用 ui_file_icon tool（含 extension, iconId, svgPath 数组）
    ↓
generateThemeFromPrompt() 解析 tool calls
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

每个 `ui_file_icon` tool 调用的 icon entry 必须包含：
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

## LLM Tool 定义

3 个 tool，合并后避免模型单次 tool call 超出限制：

### 1. ui_theme_colors
- 参数：`background`, `primary`, `text`, `surface`, `accent`, `border`（均为 hex string）
- 单次调用返回全部 6 个颜色

### 2. ui_theme_icon
- 参数：`svgPath` — 表示主题情绪/感觉的 SVG path

### 3. ui_file_icon
- 参数：`icons` — 对象数组，每项含 `extension`, `iconId`, `svgPath`

## 集成点

| 位置 | 操作 |
|------|------|
| `ngOnInit` | 调用 `loadSavedFileIcons()` 恢复持久化图标 |
| `ngAfterViewInit` | `afterNextRender` 中若存在已加载图标，调用 `computeFileIcons()` 刷新树 |
| `ngOnChanges` | `computeFileIcons()` 调用在 `assignDeepLevel()` 之后 |
| `generateThemeFromPrompt()` | 解析 `ui_file_icon` tool calls，创建 symbol，更新树，保存持久化 |
| `toggleTheme()` | 清除所有自定义图标状态和 localStorage |

## 关键决策记录

1. **Tool 合并**：将 6 个独立颜色 tool 合并为 1 个 `ui_theme_colors`，总 tools 从 8 降为 3，适配 deepseek-v4-flash 模型 tool call 限制（~6 calls）
2. **持久化格式**：存储 SVG path 数据而非 symbol ID — symbol 是运行时 ephemeral 的，每次页面加载需从 path 重建
3. **存储方案**：localStorage 而非 IndexedDB — 数据量 2-8 KB，localStorage 5 MB 限制足够且 API 更简单
4. **图标设计**：文本缩写（JS、TS、CPP）+ 简单几何形状 — 16×16 尺寸下可识别度最高
5. **文档背景**：使用 opacity 0.06 的矩形提供微妙上下文，前景/符号使用完全透明
