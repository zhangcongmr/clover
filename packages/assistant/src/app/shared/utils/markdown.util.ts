import { marked, Marked } from 'marked';
import { renderToString } from 'katex';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

marked.setOptions({
  breaks: true,
  gfm: true,
});

/** Escape an HTML fragment so it is displayed as literal text. */
function escapeHtml(raw: string): string {
  return raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Escape custom tags that should be displayed as text, not rendered as HTML elements.
 * Custom tags are identified by containing a hyphen (e.g., a2ui-json, my-component).
 */
function escapeCustomTags(content: string): string {
  // Match opening and closing custom tags (tags containing hyphens)
  return content.replace(/<\/?[a-zA-Z][a-zA-Z0-9]*-[a-zA-Z0-9-]*[^>]*>/g, (match) => {
    return match.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  });
}

/* ------------------------------------------------------------------ */
/* KaTeX math support                                                 */
/*                                                                    */
/* Mirrors packages/test/web_ai/static/index.html:874-915             ("Markdown + 数学公式渲染"): */
/*   1. isolate math spans so marked never sees `\_`, `*`, `|`, etc.  */
/*   2. run markdown on the remaining text                            */
/*   3. render each math span with KaTeX                              */
/*                                                                    */
/* Implementation differences vs. the page's original script:         */
/*   * marked *extensions* do the isolation at tokenizer level, so    */
/*     there are no `<!--MATH:n-->` HTML comments (which Angular's    */
/*     html renderer would escape into visible text) and no           */
/*     `String.replace` `$`-placeholder pitfalls.                     */
/*   * Code spans / fences are processed by marked's own tokenizers,  */
/*     so `$` / backslashes inside code are never mistaken for math.  */
/*   * KaTeX renders to a string (`renderToString`), so this works    */
/*     under Angular SSR with no DOM and no `renderMathInElement`.    */
/*   * Output is `htmlAndMathml`: inline layout styles plus a MathML    */
/*     fallback; consumers bind through `FormatMessagePipe`, which    */
/*     marks the result trusted via `DomSanitizer.bypassSecurityTrustHtml`. */
/* ------------------------------------------------------------------ */

const KATEX_OPTIONS = { throwOnError: false, output: 'htmlAndMathml' as const };

/** Render a single TeX span to HTML+MathML (cached, pure function). */
const mathCache = new Map<string, string>();
function renderMath(tex: string, display: boolean): string {
  const key = (display ? '\\[\\]' : '\\(\\)') + tex;
  const cached = mathCache.get(key);
  if (cached) return cached;
  const html = renderToString(tex, { ...KATEX_OPTIONS, displayMode: display });
  mathCache.set(key, html);
  return html;
}

// Regex sources are built with explicit concatenation so every backslash
// survives both the TS scanner and the RegExp constructor intact:
//   \\\\  -> engine \\  (matches one literal backslash)
//   \\[   -> engine \[  (matches one literal bracket)
const openBr = '\\\\' + '\\[';    // engine: \\ \[  -> matches input \[
const closeBr = '\\\\' + '\\]';   // engine: \\ \]  -> matches input \]
const openDelim = '\\\\' + '\\('; // engine: \\ \(  -> matches input \(
const closeDelim = '\\\\' + '\\)'; // engine: \\ \)  -> matches input \)

/** Beginning of a block math span: `\[...\]` or `$$...$$`. */
const BLOCK_MATH_START = new RegExp('^(?:' + openBr + '|\\$\\$)');
const BLOCK_MATH = new RegExp(
  '^(?:' + openBr + '([\\s\\S]*?)' + closeBr + '|\\$\\$([\\s\\S]*?)\\$\\$)',
);

/** Beginning of an inline math span: `\(...\)` or `$...$`. */
const INLINE_MATH_START = new RegExp('^(' + openDelim + '|\\$)');
const INLINE_MATH = new RegExp(
  '^' + openDelim + '([\\s\\S]*?)' + closeDelim + '|^\\$([^`$]+?)\\$',
);

const mathBlockExtension = {
  name: 'mathBlock',
  level: 'block' as const,
  start(src: string): boolean {
    return BLOCK_MATH_START.test(src);
  },
  tokenizer(src: string): any {
    const m = src.match(BLOCK_MATH);
    if (!m) return null;
    const tex = (m[1] ?? m[2] ?? '').trim();
    return { type: 'mathBlock', raw: m[0], text: tex, display: true };
  },
  renderer(token: any): string {
    return renderMath(token.text ?? '', true);
  },
};

const mathInlineExtension = {
  name: 'mathInline',
  level: 'inline' as const,
  start(src: string): boolean {
    return INLINE_MATH_START.test(src);
  },
  tokenizer(src: string): any {
    const m = src.match(INLINE_MATH);
    if (!m) return null;
    const tex = (m[1] ?? m[2] ?? '').trim();
    return { type: 'mathInline', raw: m[0], text: tex, display: false };
  },
  renderer(token: any): string {
    return renderMath(token.text ?? '', false);
  },
};

/**
 * Renderer for chat messages: every raw HTML fragment the model writes (tags,
 * comments, custom elements) is escaped so it stays visible as text instead of
 * becoming markup. Angular's `[innerHTML]` binding sanitizes against a fixed
 * allow-list, so anything outside it - e.g. `<style>`, `<script>`, `<svg>`,
 * `style="..."` - would be stripped, dropping the fragment and its content and
 * logging "sanitizing HTML stripped some content". Escaping here keeps the
 * model's output intact and the console clean. Markdown-generated markup and
 * code spans/blocks are unaffected.
 *
 * KaTeX output produced by the math extensions bypasses this renderer entirely
 * (it is emitted by `mathBlock`/`mathInline` renderers), so the model's raw
 * HTML is still escaped while math renders.
 */
const chatMarked = new Marked({ breaks: true, gfm: true });
chatMarked.use({ extensions: [mathBlockExtension, mathInlineExtension] });
chatMarked.use({
  renderer: {
    html(token: any): string {
      const raw = typeof token === 'string' ? token : token.raw ?? token.text ?? '';
      return escapeHtml(raw);
    },
  },
});

/** Marked instance for the async render path, with the same math extensions. */
const asyncMarked = new Marked({ breaks: true, gfm: true });
asyncMarked.use({ extensions: [mathBlockExtension, mathInlineExtension] });

/**
 * Render markdown to HTML (sync).
 *
 * The returned HTML contains KaTeX-generated markup (spans with inline styles
 * plus a MathML annotation). Because Angular's built-in sanitizer would strip
 * KaTeX's inline styles, consumers that bind this through `[innerHTML]` should
 * mark it trusted (see `FormatMessagePipe`, which uses
 * `DomSanitizer.bypassSecurityTrustHtml`).
 */
export function renderMarkdownSync(content: string): string {
  if (!content) return '';
  try {
    return chatMarked.parse(content, { async: false }) as string;
  } catch (error) {
    console.error('Error parsing markdown:', error);
    return content;
  }
}

/**
 * Render markdown to HTML (async)
 */
export async function renderMarkdown(content: string): Promise<string> {
  if (!content) return '';
  try {
    return (await asyncMarked.parse(escapeCustomTags(content), { async: true })) || '';
  } catch (error) {
    console.error('Error parsing markdown:', error);
    return content;
  }
}
