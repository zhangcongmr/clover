import { marked, Marked } from 'marked';

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

/**
 * Renderer for chat messages: every raw HTML fragment the model writes (tags,
 * comments, custom elements) is escaped so it stays visible as text instead of
 * becoming markup. Angular's `[innerHTML]` binding sanitizes against a fixed
 * allow-list, so anything outside it - e.g. `<style>`, `<script>`, `<svg>`,
 * `style="..."` - would be stripped, dropping the fragment and its content and
 * logging "sanitizing HTML stripped some content". Escaping here keeps the
 * model's output intact and the console clean. Markdown-generated markup and
 * code spans/blocks are unaffected.
 */
const chatMarked = new Marked({ breaks: true, gfm: true });
chatMarked.use({
  renderer: {
    html(token: any): string {
      const raw = typeof token === 'string' ? token : token.raw ?? token.text ?? '';
      return escapeHtml(raw);
    },
  },
});

/**
 * Render markdown to HTML (sync)
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
    return (await marked.parse(escapeCustomTags(content))) || '';
  } catch (error) {
    console.error('Error parsing markdown:', error);
    return content;
  }
}
