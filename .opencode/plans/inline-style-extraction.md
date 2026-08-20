# Angular 内联样式提取方案

## 项目概述

- **项目路径**: `packages/assistant`
- **目标**: 将所有静态的、硬编码的内联 `style` 属性提取到组件的 CSS 文件中
- **Class 命名规范**: 使用 `ast-` 作为前缀
- **总统计**: 74 个可提取的静态内联样式 + 39 个需要保留的动态绑定样式

---

## 组件统计

| 组件 | 可提取样式数 | 动态绑定样式数 |
|------|-------------|---------------|
| privacy-error-dialog | 1 | 0 |
| ast-api | 18 | 7 |
| add-project | 3 | 0 |
| app.component | 3 | 11 |
| service-manager | 5 | 0 |
| content.component | 16 | 2 |
| file-input | 1 | 0 |
| server-tree | 7 | 0 |
| api-notebook | 1 | 0 |
| ast-tree | 5 | 8 |
| ast-table | 2 | 1 |
| authorize | 1 | 0 |
| explorer | 2 | 2 |
| editor | 1 | 2 |
| server-manager | 4 | 0 |
| ast-tab-group | 3 | 6 |
| ast-modal | 1 | 0 |
| **总计** | **74** | **39** |

---

## 详细方案

### 1. privacy-error-dialog.component

**组件路径**: `src/app/shared/privacy-error-dialog/`
**样式文件**: `privacy-error-dialog.component.css`

#### 新增 CSS
```css
.ast-privacy-dialog-body {
  display: flex;
  height: 100%;
}
```

#### HTML 修改
```html
<!-- 第8行: 替换 style="display: flex;height: 100%;" -->
<div class="ast-privacy-dialog-body">
```

#### 无法提取的样式
无

---

### 2. ast-api.component

**组件路径**: `src/app/shared/ast-api/`
**样式文件**: `ast-api.component.css`

#### 新增 CSS
```css
.ast-api-overlay {
  position: absolute;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.ast-api-url-bar {
  display: flex;
  flex-wrap: nowrap;
  margin-top: 0.5rem;
}

.ast-api-url-input {
  flex-grow: 1;
  display: inline;
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
}

.ast-api-main-content {
  position: relative;
  text-align: left;
  margin-top: 0.5rem;
  background-color: white;
  border-top-left-radius: 0.25rem;
  border-top-right-radius: 0.25rem;
  display: flex;
  flex-direction: column;
  flex: 1 1 0;
}

.ast-api-drag-container {
  position: absolute;
  width: 100%;
  height: 100%;
}

.ast-api-split-handle {
  height: 4px;
  width: 100%;
  position: absolute;
  z-index: 100;
}

.ast-api-request-section {
  position: relative;
  height: 60%;
  background-color: white;
}

.ast-api-content-type-label {
  margin: 0 1rem;
}

.ast-api-editor-container {
  overflow: hidden;
  height: 100%;
}

.ast-api-response-section {
  position: relative;
  height: 40%;
  border-top: 0.8px solid rgb(240, 240, 240);
  border-radius: 0;
  display: inline-flex;
  flex-direction: column;
}

.ast-api-sending-text {
  margin: 50px 40%;
}

.ast-api-cancel-wrapper {
  margin-top: 0px;
  margin-left: 40%;
  margin-right: 40%;
}

.ast-api-cancel-btn {
  height: 2rem;
  width: 80px;
  border: 0;
}

.ast-api-response-textarea {
  border: 0px solid lightgrey;
  width: 100%;
  resize: none;
  padding: 0;
  flex: 1 1 0;
}

.ast-api-toolbar {
  height: 1.5rem;
  line-height: 1.5rem;
  display: flex;
  justify-content: center;
  gap: 3px;
  margin-top: 0.5rem;
}

.ast-api-toolbar-btns {
  cursor: pointer;
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
}

.ast-api-toolbar-btn {
  width: 4rem;
  text-align: center;
  display: inline-block;
}
```

#### HTML 修改
| 行号 | 原始内联样式 | 新 Class |
|------|-------------|----------|
| 2 | `style="position: absolute;width: 100%;height: 100%;pointer-events: none;"` | `ast-api-overlay` |
| 14 | `style="display: flex;flex-wrap: nowrap;margin-top: 0.5rem;"` | `ast-api-url-bar` |
| 17 | `style="flex-grow: 1;display: inline;border-top-left-radius: 0;border-bottom-left-radius: 0;"` | `ast-api-url-input` |
| 22-23 | `style="position: relative;text-align:left; margin-top: 0.5rem;background-color: white;..."` | `ast-api-main-content` |
| 26 | `style="position: absolute;width: 100%;height: 100%;"` | `ast-api-drag-container` |
| 27 | `style="height: 4px;width: 100%;position: absolute;z-index: 100;"` | `ast-api-split-handle` |
| 31 | `style="position: relative;height: 60%;background-color: white;"` | `ast-api-request-section` |
| 305 | `style="margin: 0 1rem;"` | `ast-api-content-type-label` |
| 310 | `style="overflow: hidden;height: 100%;"` | `ast-api-editor-container` |
| 326 | `style="position: relative;height: 40%;border-top: 0.8px solid rgb(240, 240, 240);..."` | `ast-api-response-section` |
| 330 | `style="margin: 50px 40%;"` | `ast-api-sending-text` |
| 331 | `style="margin-top: 0px;margin-left: 40%;margin-right: 40%;"` | `ast-api-cancel-wrapper` |
| 332 | `style="height: 2rem;width: 80px;border: 0;"` | `ast-api-cancel-btn` |
| 348 | `style="border: 0px solid lightgrey;width: 100%;resize: none;padding: 0;flex: 1 1 0;"` | `ast-api-response-textarea` |
| 352 | `style="height: 1.5rem;line-height: 1.5rem;display: flex;justify-content: center;..."` | `ast-api-toolbar` |
| 353 | `style="cursor: pointer;box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);"` | `ast-api-toolbar-btns` |
| 354-355 | `style="width: 4rem;text-align: center;display: inline-block;"` | `ast-api-toolbar-btn` |
| 359 | `style="overflow: hidden;height: 100%;"` | `ast-api-editor-container` |

#### 保留内联的动态绑定
- `[style.clip-path]="showEditBtn"` - 动态 clip-path 动画
- `[style.display]="!editApiSourceCodeEnable?'inline-flex':'none'"` - 条件显示
- `[style.top]="topPct * 100 + '%'"` - 动态拖拽百分比
- `[style.height]="topPct * 100 + '%'"` - 动态拖拽百分比
- `[style.height]="(1 - topPct) * 100 + '%'"` - 动态拖拽百分比
- `[style.display]="ifSendingRequest?'block':'none'"` - 条件显示
- `[style.display]="showEscHint ? 'block' : 'none'"` - 条件显示

---

### 3. add-project.component

**组件路径**: `src/app/luxio/add-project/`
**样式文件**: `add-project.component.css`

#### 新增 CSS
```css
.ast-add-project-import-section {
  flex: none;
}

.ast-add-project-file-row {
  display: flex;
  max-height: 300px;
  gap: 0.5rem;
}

.ast-add-project-tree-wrapper {
  overflow: auto;
  border: 1px solid #ccc;
  padding: 4px;
  width: 300px;
}
```

#### HTML 修改
| 行号 | 原始内联样式 | 新 Class |
|------|-------------|----------|
| 66 | `style="flex:none"` | `ast-add-project-import-section` |
| 68 | `style="display: flex;max-height: 300px;gap: 0.5rem;"` | `ast-add-project-file-row` |
| 74 | `style="overflow:auto; border:1px solid #ccc;padding:4px;width: 300px;"` | `ast-add-project-tree-wrapper` |

#### 无法提取的样式
无

---

### 4. app.component

**组件路径**: `src/app/`
**样式文件**: `app.component.css`

#### 新增 CSS
```css
.ast-split-handle-ew {
  height: 100%;
  width: 4px;
  position: absolute;
  z-index: 100;
}

.ast-split-handle-ns {
  height: 4px;
  width: 100%;
  position: absolute;
  z-index: 100;
}

.ast-terminal-tab-container {
  position: relative;
}
```

#### HTML 修改
| 行号 | 原始内联样式 | 新 Class |
|------|-------------|----------|
| 253 | `style="height: 100%;width: 4px;position: absolute;z-index: 100;"` | `ast-split-handle-ew` |
| 259 | `style="height: 4px;width: 100%;position: absolute;z-index: 100;"` | `ast-split-handle-ns` |
| 268 | `style="position: relative;"` | `ast-terminal-tab-container` |

#### 保留内联的动态绑定
- `[style.display]="agentPanelOpen ? 'block' : 'none'"` - 条件显示
- `[style.left]="leftPct * 100 + '%'"` - 动态拖拽百分比
- `[style.width]="agentPanelOpen ? (leftPct * 100 + '%') : '100%'"` - 动态宽度
- `[style.display]="terminalPanelShow ? 'block' : 'none'"` - 条件显示
- `[style.top]="topPct * 100 + '%'"` - 动态拖拽百分比
- `[style.height]="topPct * 100 + '%'"` - 动态拖拽百分比
- `[style.display]="terminalPanelShow ? '' : 'none'"` - 条件显示
- `[style.height]="(1 - topPct) * 100 + '%'"` - 动态拖拽百分比
- `[style.width]="((1 - leftPct) * 100 + '%')"` - 动态宽度
- `[style.width.%]="coreService.totalProgress() * 100"` - 动态进度条宽度
- `[style.background]="coreService.totalProgress() === 1 ? '#4ade80' : '#3b82f6'"` - 动态进度条颜色

---

### 5. service-manager.component

**组件路径**: `src/app/shared/service-manager/`
**样式文件**: `service-manager.component.css`

#### 新增 CSS
```css
.ast-service-list {
  overflow: auto;
}

.ast-service-name {
  margin-right: 1rem;
}

.ast-service-delete-btn {
  border: 0;
  background-color: white;
  color: mediumvioletred;
}
```

#### HTML 修改
| 行号 | 原始内联样式 | 新 Class |
|------|-------------|----------|
| 41 | `style="overflow: auto;"` | `ast-service-list` |
| 42 | `style="margin-right: 1rem;"` | `ast-service-name` |
| 42 | `style="border: 0px;background-color: white;color: mediumvioletred;"` | `ast-service-delete-btn` |
| 65 | `style="overflow: auto;"` | `ast-service-list` |
| 66 | `style="margin-right: 1rem;"` | `ast-service-name` |

#### 无法提取的样式
无

---

### 6. content.component

**组件路径**: `src/app/luxio/content/`
**样式文件**: `content.component.css`

#### 新增 CSS
```css
.ast-content-drag-overlay {
  position: absolute;
  width: 100%;
  height: 100%;
  left: 0;
  top: 0;
}

.ast-content-split-handle {
  height: 100%;
  width: 4px;
  position: absolute;
  z-index: 100;
}

.ast-content-new-file-popup {
  width: 20%;
  height: 3rem;
  position: absolute;
  z-index: 100;
  top: 30%;
  left: 50%;
  padding-left: 5px;
  padding-right: 5px;
  align-content: center;
  background-color: aliceblue;
  box-shadow: 0px 8px 16px 0px rgba(0,0,0,0.2);
}

.ast-content-main {
  position: relative;
  display: flex;
  flex: 1;
  height: 100%;
}

.ast-content-empty-state {
  text-align: center;
  color: var(--vscode-foreground);
}

.ast-content-empty-card {
  border: 1px solid var(--vscode-statusBar-background);
  padding: 1.25rem;
  border-radius: 4px;
  background: var(--vscode-background);
  display: inline-block;
}

.ast-content-empty-title {
  font-weight: 600;
  margin-bottom: 0.5rem;
}

.ast-content-empty-desc {
  margin-bottom: 1rem;
  color: var(--vscode-textSeparator-foreground);
}

.ast-content-empty-actions {
  display: flex;
  gap: 0.5rem;
  justify-content: center;
  align-items: center;
  margin-bottom: 0.6rem;
}

.ast-content-empty-primary-btn {
  background: var(--primary-color, rgb(103, 137, 186));
  color: #fff;
  border: none;
  padding: 0.6rem 1.25rem;
  border-radius: 4px;
  cursor: pointer;
}

.ast-content-empty-secondary-btn {
  background: #e1e1e1;
  color: #222;
  border: none;
  padding: 0.6rem 1.25rem;
  border-radius: 4px;
  cursor: pointer;
}

.ast-content-empty-hint {
  margin-top: 0.2rem;
  color: var(--vscode-textSeparator-foreground);
  font-size: 0.9rem;
}

.ast-content-forking-text {
  margin-left: 0.5rem;
  color: var(--vscode-foreground);
}

.ast-content-tree {
  flex: 1 1 0;
  overflow: auto;
}

.ast-content-tabs-wrapper {
  display: flex;
  flex: 1;
}
```

#### HTML 修改
| 行号 | 原始内联样式 | 新 Class |
|------|-------------|----------|
| 2 | `style="position: absolute;width: 100%;height: 100%;left: 0;top: 0;"` | `ast-content-drag-overlay` |
| 3 | `style="height: 100%;width: 4px;position: absolute;z-index: 100;"` | `ast-content-split-handle` |
| 7 | `style="position: absolute;width: 100%;height: 100%;left: 0;top: 0;"` | `ast-content-drag-overlay` |
| 9 | `style="width: 20%;;height: 3rem;position: absolute;z-index: 100;..."` | `ast-content-new-file-popup` |
| 15 | `style="position: relative;display: flex;flex: 1;height: 100%;"` | `ast-content-main` |
| 20 | `style="text-align:center; color: var(--vscode-foreground);"` | `ast-content-empty-state` |
| 21 | `style="border:1px solid var(--vscode-statusBar-background); padding:1.25rem;..."` | `ast-content-empty-card` |
| 22 | `style="font-weight:600; margin-bottom:0.5rem;"` | `ast-content-empty-title` |
| 23 | `style="margin-bottom:1rem; color:var(--vscode-textSeparator-foreground);"` | `ast-content-empty-desc` |
| 24 | `style="display:flex;gap:0.5rem;justify-content:center;align-items:center;margin-bottom:0.6rem;"` | `ast-content-empty-actions` |
| 25 | `style="background:var(--primary-color, rgb(103, 137, 186));color:#fff;border:none;..."` | `ast-content-empty-primary-btn` |
| 26 | `style="background:#e1e1e1;color:#222;border:none;padding:0.6rem 1.25rem;..."` | `ast-content-empty-secondary-btn` |
| 28 | `style="margin-top:0.2rem; color:var(--vscode-textSeparator-foreground); font-size:0.9rem;"` | `ast-content-empty-hint` |
| 63 | `style="margin-left: 0.5rem; color: var(--vscode-foreground);"` | `ast-content-forking-text` |
| 100 | `style="flex: 1 1 0;overflow: auto;"` | `ast-content-tree` |
| 154 | `style="display: flex; flex: 1;"` | `ast-content-tabs-wrapper` |

#### 保留内联的动态绑定
- `[style.left]="sideOpen() ? 'calc(...)' : '0'"` - 动态计算位置
- `[style.display]="addMarkFile?'block': 'none'"` - 条件显示

---

### 7. file-input.component

**组件路径**: `src/app/shared/file-input/`
**样式文件**: `file-input.component.css`

#### 新增 CSS
```css
.ast-file-input-open-folder {
  margin-right: 2rem;
}
```

#### HTML 修改
| 行号 | 原始内联样式 | 新 Class |
|------|-------------|----------|
| 5 | `style="margin-right: 2rem;"` | `ast-file-input-open-folder` |

#### 无法提取的样式
无

---

### 8. server-tree.component

**组件路径**: `src/app/shared/server-tree/`
**样式文件**: `server.tree.component.css`

#### 新增 CSS
```css
.ast-server-tree {
  margin-top: 0.5rem;
}

.ast-server-auth-panel {
  padding: 3px;
  border: 1px solid #96a5b4;
}

.ast-server-auth-form {
  font-size: 0.7rem;
}

.ast-server-auth-input {
  height: 1.5rem;
  margin-top: 0.5rem;
  border: 1px solid #96a5b4;
  width: 100%;
}

.ast-server-auth-actions {
  margin-top: 0.5rem;
  font-size: 0.7rem;
}

.ast-server-auth-btn {
  width: 100%;
  text-align: center;
  color: white;
  background-color: #5a98de;
}
```

#### HTML 修改
| 行号 | 原始内联样式 | 新 Class |
|------|-------------|----------|
| 37 | `style="margin-top: 0.5rem;"` | `ast-server-tree` |
| 40 | `style="padding: 3px; border: 1px solid #96a5b4;"` | `ast-server-auth-panel` |
| 41 | `style="font-size: 0.7rem;"` | `ast-server-auth-form` |
| 44 | `style="height: 1.5rem; margin-top:0.5rem; border: 1px solid #96a5b4;width: 100%;"` | `ast-server-auth-input` |
| 47 | `style="height: 1.5rem; margin-top:0.5rem; border: 1px solid #96a5b4;width: 100%;"` | `ast-server-auth-input` |
| 49 | `style="margin-top: 0.5rem;font-size: 0.7rem;"` | `ast-server-auth-actions` |
| 51 | `style="width: 100%;text-align: center;color: white;background-color: #5a98de;width: 100%;"` | `ast-server-auth-btn` |

#### 无法提取的样式
无

---

### 9. api-notebook.component

**组件路径**: `src/app/shared/notebook/openapi/`
**样式文件**: `api-notebook.component.css`

#### 新增 CSS
```css
.ast-api-notebook-container {
  overflow-y: auto;
  align-self: stretch;
  align-items: center;
  flex: 1 1 0;
}
```

#### HTML 修改
| 行号 | 原始内联样式 | 新 Class |
|------|-------------|----------|
| 1 | `style="overflow-y: auto;align-self: stretch;align-items: center;flex: 1 1 0;"` | `ast-api-notebook-container` |

#### 无法提取的样式
无

---

### 10. ast-tree.component

**组件路径**: `src/app/shared/ast-tree/`
**样式文件**: `ast-tree.component.css`

#### 新增 CSS
```css
.ast-tree-search-wrapper {
  margin-bottom: 0.5rem;
}

.ast-tree-api-symbol {
  text-align: left;
  font-size: 10px;
}

.ast-tree-folder-icon {
  color: #6b7280;
}
```

#### HTML 修改
| 行号 | 原始内联样式 | 新 Class |
|------|-------------|----------|
| 2 | `style="margin-bottom: 0.5rem;"` | `ast-tree-search-wrapper` |
| 24 | `style="text-align: left;font-size: 10px;"` | `ast-tree-api-symbol` |
| 28 | `style="color: #6b7280;"` | `ast-tree-folder-icon` |
| 61 | `style="text-align: left;font-size: 10px;"` | `ast-tree-api-symbol` |
| 65 | `style="color: #6b7280;"` | `ast-tree-folder-icon` |

#### 保留内联的动态绑定
- `[style.width.px]="5 + (item.deepLevel || 0) * 10"` - 动态计算缩进宽度
- `[style.flex]="item.nodeType == 'api' ? '0 0 2rem':''"` - 条件 flex
- `[style.text-decoration]="item.isDeleted?'line-through':''"` - 条件删除线
- `[style.display]="item.isExpanded?'flex':'none'"` - 条件显示
- `[style.width.px]="5 + (childItem.deepLevel || 0) * 10"` - 动态计算缩进宽度
- `[style.flex]="childItem.nodeType == 'api' ? '0 0 2rem':''"` - 条件 flex
- `[style.text-decoration]="childItem.isDeleted?'line-through':''"` - 条件删除线
- `[style.display]="(item.isExpanded && childItem.isExpanded)?'block':'none'"` - 条件显示

---

### 11. ast-table.component

**组件路径**: `src/app/shared/ast-table/`
**样式文件**: `ast-table.component.css`

#### 新增 CSS
```css
.ast-table-checkbox {
  margin: 0;
}
```

#### HTML 修改
| 行号 | 原始内联样式 | 新 Class |
|------|-------------|----------|
| 5 | `style="margin: 0;"` | `ast-table-checkbox` |
| 16 | `style="margin: 0;"` | `ast-table-checkbox` |

#### 保留内联的动态绑定
- `[style.backgroundColor]="item.selected?'#c4bdbd':''"` - 条件背景色

---

### 12. authorize.component

**组件路径**: `src/app/shared/authorize/`
**样式文件**: `authorize.component.css`

#### 新增 CSS
```css
.ast-authorize-tip-body {
  display: flex;
  height: 100%;
}
```

#### HTML 修改
| 行号 | 原始内联样式 | 新 Class |
|------|-------------|----------|
| 26 | `style="display: flex;height: 100%;"` | `ast-authorize-tip-body` |

#### 无法提取的样式
无

---

### 13. explorer.component

**组件路径**: `src/app/shared/explorer/`
**样式文件**: `explorer.component.css`

#### 新增 CSS
```css
.ast-explorer-table {
  overflow-y: auto;
  width: 100%;
}

.ast-explorer-code-container {
  flex: 1 1 0;
  overflow: hidden;
  border: 1px solid gainsboro;
  width: 100%;
}
```

#### HTML 修改
| 行号 | 原始内联样式 | 新 Class |
|------|-------------|----------|
| 30 | `style="overflow-y: auto;width: 100%;"` | `ast-explorer-table` |
| 34 | `style="flex: 1 1 0;overflow: hidden;border: 1px solid gainsboro;width: 100%;"` | `ast-explorer-code-container` |

#### 保留内联的动态绑定
- `[style.display]="showPreviewOrCode?'flex':'none'"` - 条件显示
- `[style.display]="!showPreviewOrCode?'flex':'none'"` - 条件显示

---

### 14. editor.component

**组件路径**: `src/app/shared/notebook/editor/`
**样式文件**: `editor.component.css`

#### 新增 CSS
```css
.ast-editor-textarea {
  overflow: hidden;
  height: 100%;
  width: 100%;
}
```

#### HTML 修改
| 行号 | 原始内联样式 | 新 Class |
|------|-------------|----------|
| 53 | `style="overflow: hidden;height: 100%;width: 100%;"` | `ast-editor-textarea` |

#### 保留内联的动态绑定
- `[style.display]="isPreviewMode() ? 'none' : 'block'"` - 条件显示
- `[style.display]="isPreviewMode() ? 'block' : 'none'"` - 条件显示

---

### 15. server-manager.component

**组件路径**: `src/app/shared/server-manager/`
**样式文件**: `server-manager.component.css`

#### 新增 CSS
```css
.ast-server-manager-delete-body {
  display: flex;
  height: 100%;
}

.ast-server-manager-list {
  overflow: auto;
}

.ast-server-manager-name {
  margin-right: 1rem;
}

.ast-server-manager-delete-btn {
  border: 0;
  background-color: white;
  color: mediumvioletred;
}
```

#### HTML 修改
| 行号 | 原始内联样式 | 新 Class |
|------|-------------|----------|
| 28 | `style="display: flex;height: 100%;"` | `ast-server-manager-delete-body` |
| 31 | `style="overflow: auto;"` | `ast-server-manager-list` |
| 32 | `style="margin-right: 1rem;"` | `ast-server-manager-name` |
| 32 | `style="border: 0px;background-color: white;color: mediumvioletred;"` | `ast-server-manager-delete-btn` |

#### 无法提取的样式
无

---

### 16. ast-tab-group.component

**组件路径**: `src/app/shared/ast-tab/ast-tab-group/`
**样式文件**: `ast-tab-group.component.css`

#### 新增 CSS
```css
.ast-tab-presentation {
  position: absolute;
  height: 3px;
  left: 0px;
  bottom: 0px;
  color: rgb(97, 97, 97);
  z-index: 10;
  display: none;
}

.ast-tab-slider {
  position: absolute;
  top: 0px;
  left: 0px;
  height: 3px;
  transform: translate3d(0px, 0px, 0px);
  z-index: 100;
  contain: strict;
  color: rgb(97, 97, 97);
  background-color: rgba(100, 100, 100, 0.4);
}

.ast-tab-down-menu {
  width: 400px;
}
```

#### HTML 修改
| 行号 | 原始内联样式 | 新 Class |
|------|-------------|----------|
| 61 | `style="position: absolute; height: 3px; left: 0px; bottom: 0px;..."` | `ast-tab-presentation` |
| 62-63 | `style="position: absolute; top: 0px; left: 0px; height: 3px;..."` | `ast-tab-slider` |
| 81 | `style="width: 400px;"` | `ast-tab-down-menu` |

#### 保留内联的动态绑定
- `[style]="ulStyle"` - 动态内联样式字符串
- `[style.min-width]="tab.minWidth"` - 动态最小宽度
- `[style.cursor]="addTabEnable()?'pointer': ''"` - 条件光标
- `[style.border-bottom]="tabType() && (tabType()['type']=='bilateral')?'1px var(--vscode-tabborder-background) solid':''"` - 条件边框
- `[style.width]="computedScrollBarLength"` - 动态滚动条宽度
- `[style.left]="scrollBarLeft + 'px'"` - 动态滚动条位置

---

### 17. ast-modal.component

**组件路径**: `src/app/shared/ast-modal/`
**样式文件**: `ast-modal.component.css`

#### 新增 CSS
```css
.ast-modal-close-icon {
  margin: auto;
}
```

#### HTML 修改
| 行号 | 原始内联样式 | 新 Class |
|------|-------------|----------|
| 8 | `style="margin: auto;"` | `ast-modal-close-icon` |

#### 无法提取的样式
无

---

## 执行计划

### 优先级顺序

1. **ast-api.component** - 内联最多 (18处)，收益最大
2. **content.component** - 内联较多 (16处)
3. **app.component** - 核心组件
4. **server-tree.component** - 7处内联
5. **service-manager.component** - 5处内联
6. **ast-tree.component** - 5处内联
7. **server-manager.component** - 4处内联
8. **add-project.component** - 3处内联
9. **ast-tab-group.component** - 3处内联
10. **ast-table.component** - 2处内联
11. **explorer.component** - 2处内联
12. **privacy-error-dialog.component** - 1处内联
13. **file-input.component** - 1处内联
14. **api-notebook.component** - 1处内联
15. **authorize.component** - 1处内联
16. **editor.component** - 1处内联
17. **ast-modal.component** - 1处内联

### 每个组件的修改步骤

1. 读取现有的 CSS 文件
2. 在 CSS 文件末尾添加新的样式规则
3. 修改 HTML 模板，将 `style="..."` 替换为 `class="..."`
4. 保留所有 `[style.xxx]` 动态绑定
5. 测试组件显示是否正常

### 注意事项

1. **样式隔离**: 使用 Angular 的 ViewEncapsulation，默认是 Emulated，确保样式不会污染其他组件
2. **动态绑定保留**: 所有 `[style.xxx]` 形式的动态绑定必须保留在 HTML 中
3. **Class 命名**: 统一使用 `ast-` 前缀，保持命名一致性
4. **渐进式重构**: 每次只修改一个组件，避免大规模变更引入问题
5. **测试验证**: 每个组件修改后进行视觉测试，确保样式无变化
