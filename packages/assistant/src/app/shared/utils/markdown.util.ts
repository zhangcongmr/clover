import { marked } from 'marked';

marked.setOptions({
  breaks: true,
  gfm: true,
});

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
 * Render markdown to HTML (sync)
 */
export function renderMarkdownSync(content: string): string {
  if (!content) return '';
  try {
    return marked.parse(escapeCustomTags(content), { async: false }) as string;
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
