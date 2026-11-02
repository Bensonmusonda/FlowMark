/**
 * Inline Markdown renderer for embedded widgets (callouts, table cells).
 * Parses and renders:
 * - Code: `code`
 * - Bold: **strong** or __strong__
 * - Strikethrough: ~~strikethrough~~
 * - Links: [text](url)
 * - Italic: *em* or _em_
 */

export const INLINE_MARKDOWN_SOURCE =
  '(`[^`]+`|\\*\\*[^*]+\\*\\*|__[^_]+__|~~[^~]+~~|\\[[^\\]]+\\]\\([^)]+\\)|\\*[^*]+\\*|_[^_]+_)';

/**
 * Appends rendered inline Markdown elements to a parent DOM node.
 * Uses a fresh regex instance per call to guarantee safe re-entrancy / recursion.
 *
 * @param {HTMLElement} parent - Target container DOM element
 * @param {string} text - Raw Markdown text
 */
export function appendInlineMarkdown(parent, text) {
  if (!text) return;

  const re = new RegExp(INLINE_MARKDOWN_SOURCE, 'g');
  let last = 0;
  let match;

  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      parent.appendChild(document.createTextNode(text.slice(last, match.index)));
    }

    const token = match[0];

    if (token.startsWith('`')) {
      const code = document.createElement('code');
      code.textContent = token.slice(1, -1);
      parent.appendChild(code);
    } else if (token.startsWith('**') || token.startsWith('__')) {
      const strong = document.createElement('strong');
      appendInlineMarkdown(strong, token.slice(2, -2));
      parent.appendChild(strong);
    } else if (token.startsWith('~~')) {
      const del = document.createElement('del');
      appendInlineMarkdown(del, token.slice(2, -2));
      parent.appendChild(del);
    } else if (token.startsWith('[')) {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (linkMatch) {
        const a = document.createElement('a');
        a.href = linkMatch[2];
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        appendInlineMarkdown(a, linkMatch[1]);
        parent.appendChild(a);
      } else {
        parent.appendChild(document.createTextNode(token));
      }
    } else {
      const em = document.createElement('em');
      appendInlineMarkdown(em, token.slice(1, -1));
      parent.appendChild(em);
    }

    last = match.index + token.length;
  }

  if (last < text.length) {
    parent.appendChild(document.createTextNode(text.slice(last)));
  }
}

export default {
  appendInlineMarkdown,
  INLINE_MARKDOWN_SOURCE,
};
