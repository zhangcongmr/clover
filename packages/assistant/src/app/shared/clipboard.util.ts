/**
 * 复制文本到剪贴板，返回是否成功。
 *
 * `navigator.clipboard` 与 `crypto.randomUUID` / `crypto.subtle` 一样只在
 * **安全上下文**（HTTPS 或 localhost）暴露。用局域网 IP 以纯 HTTP 打开页面时
 * 它是 `undefined`，原来直接调用会静默失败（按钮点了没反应）。这里退回
 * 「隐藏 textarea + `document.execCommand('copy')`」的老办法：虽然该命令已废弃，
 * 但它没有安全上下文限制，是当前唯一的降级路径。
 */
export async function copyText(text: string): Promise<boolean> {
  const clipboard = (globalThis.navigator as Navigator | undefined)?.clipboard;
  if (typeof clipboard?.writeText === 'function') {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // 权限被拒、文档未聚焦（如刚关掉 devtools 的弹窗）→ 继续走降级。
    }
  }
  return legacyCopy(text);
}

/** `execCommand('copy')` 兜底。选中区域会被临时替换，结束后还原。 */
function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined') return false;

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  // 定位到视口外但保留在文档流里：`display:none` / `visibility:hidden` 会让
  // 选区失效，`opacity:0` + 1px 是唯一既能选中又不可见的方式。
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '0';
  textarea.style.width = '1px';
  textarea.style.height = '1px';
  textarea.style.padding = '0';
  textarea.style.border = 'none';
  textarea.style.outline = 'none';
  textarea.style.boxShadow = 'none';
  textarea.style.background = 'transparent';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);

  const selection = document.getSelection();
  const previousRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

  let ok = false;
  try {
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  } finally {
    document.body.removeChild(textarea);
    // 还原用户原来的高亮，避免「复制」把正文选中区清掉。
    if (previousRange && selection) {
      selection.removeAllRanges();
      selection.addRange(previousRange);
    }
  }

  return ok;
}
