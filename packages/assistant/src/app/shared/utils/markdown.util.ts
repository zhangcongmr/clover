import { marked } from 'marked';

marked.setOptions({
  breaks: true,
  gfm: true,
});

/**
 * Render markdown to HTML (sync)
 */
export function renderMarkdownSync(content: string): string {
  if (!content) return '';
  try {
    return marked.parse(content, { async: false }) as string;
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
    return (await marked.parse(content)) || '';
  } catch (error) {
    console.error('Error parsing markdown:', error);
    return content;
  }
}
