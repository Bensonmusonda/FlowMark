/**
 * Markdown-aware autocompletion sources for FlowMark.
 *
 * Provides context-sensitive completions for:
 * - Callout types (after `> [!`)
 * - Fenced code block languages (after ``` on the same line)
 * - Emoji shortcodes (after `:`)
 */

// ── Callout completions ─────────────────────────────────────────────────────

export const CALLOUT_TYPES = [
  { label: 'NOTE',      detail: 'ℹ️  Informational note',      type: 'keyword' },
  { label: 'TIP',       detail: '💡 Helpful tip',              type: 'keyword' },
  { label: 'IMPORTANT', detail: '❗ Important information',     type: 'keyword' },
  { label: 'WARNING',   detail: '⚠️  Warning notice',           type: 'keyword' },
  { label: 'CAUTION',   detail: '🔴 Dangerous action',         type: 'keyword' },
  { label: 'ABSTRACT',  detail: '📋 Summary / TLDR',           type: 'keyword' },
  { label: 'TODO',      detail: '✅ Task / to-do',             type: 'keyword' },
  { label: 'SUCCESS',   detail: '✔️  Success message',           type: 'keyword' },
  { label: 'QUESTION',  detail: '❓ Question',                 type: 'keyword' },
  { label: 'FAILURE',   detail: '❌ Failure message',           type: 'keyword' },
  { label: 'DANGER',    detail: '⚡ Danger notice',            type: 'keyword' },
  { label: 'BUG',       detail: '🐛 Bug report',               type: 'keyword' },
  { label: 'EXAMPLE',   detail: '📝 Example',                  type: 'keyword' },
  { label: 'QUOTE',     detail: '💬 Quote / citation',         type: 'keyword' },
  { label: 'INFO',      detail: 'ℹ️  Information',              type: 'keyword' },
];

/**
 * Completes callout types after `> [!`.
 * Triggers when the line matches `> [!` followed by partial text.
 */
export function calloutCompletion(context) {
  // Match `> [!` at start of line, optionally followed by partial text
  const match = context.matchBefore(/>\s*\[!(\w*)$/);
  if (!match && !context.explicit) return null;
  if (!match) return null;

  // The completion replaces the text after `[!`
  const bangPos = match.text.indexOf('[!');
  const from = match.from + bangPos + 2;

  return {
    from,
    options: CALLOUT_TYPES,
    validFor: /^\w*$/,
  };
}

// ── Fence language completions ──────────────────────────────────────────────

export const FENCE_LANGUAGES = [
  // Popular / web
  { label: 'javascript', detail: 'JavaScript',     type: 'type' },
  { label: 'typescript', detail: 'TypeScript',     type: 'type' },
  { label: 'jsx',        detail: 'JSX',            type: 'type' },
  { label: 'tsx',        detail: 'TSX',            type: 'type' },
  { label: 'html',       detail: 'HTML',           type: 'type' },
  { label: 'css',        detail: 'CSS',            type: 'type' },
  { label: 'scss',       detail: 'SCSS',           type: 'type' },
  { label: 'less',       detail: 'Less',           type: 'type' },
  { label: 'json',       detail: 'JSON',           type: 'type' },
  { label: 'xml',        detail: 'XML',            type: 'type' },
  { label: 'svg',        detail: 'SVG',            type: 'type' },
  { label: 'yaml',       detail: 'YAML',           type: 'type' },
  { label: 'toml',       detail: 'TOML',           type: 'type' },
  { label: 'markdown',   detail: 'Markdown',       type: 'type' },
  // Systems
  { label: 'python',     detail: 'Python',         type: 'type' },
  { label: 'rust',       detail: 'Rust',           type: 'type' },
  { label: 'go',         detail: 'Go',             type: 'type' },
  { label: 'c',          detail: 'C',              type: 'type' },
  { label: 'cpp',        detail: 'C++',            type: 'type' },
  { label: 'java',       detail: 'Java',           type: 'type' },
  { label: 'kotlin',     detail: 'Kotlin',         type: 'type' },
  { label: 'swift',      detail: 'Swift',          type: 'type' },
  { label: 'csharp',     detail: 'C#',             type: 'type' },
  // Scripting & config
  { label: 'bash',       detail: 'Bash / Shell',   type: 'type' },
  { label: 'shell',      detail: 'Shell',          type: 'type' },
  { label: 'powershell', detail: 'PowerShell',     type: 'type' },
  { label: 'sql',        detail: 'SQL',            type: 'type' },
  { label: 'graphql',    detail: 'GraphQL',        type: 'type' },
  { label: 'php',        detail: 'PHP',            type: 'type' },
  { label: 'ruby',       detail: 'Ruby',           type: 'type' },
  { label: 'lua',        detail: 'Lua',            type: 'type' },
  { label: 'perl',       detail: 'Perl',           type: 'type' },
  { label: 'r',          detail: 'R',              type: 'type' },
  // Data / markup
  { label: 'latex',      detail: 'LaTeX',          type: 'type' },
  { label: 'dockerfile', detail: 'Dockerfile',     type: 'type' },
  { label: 'makefile',   detail: 'Makefile',       type: 'type' },
  { label: 'diff',       detail: 'Diff / Patch',   type: 'type' },
  { label: 'csv',        detail: 'CSV',            type: 'type' },
  { label: 'ini',        detail: 'INI',            type: 'type' },
  // Other
  { label: 'plaintext',  detail: 'Plain Text',     type: 'type' },
  { label: 'mermaid',    detail: 'Mermaid diagram', type: 'type' },
  { label: 'math',       detail: 'Math / KaTeX',   type: 'type' },
];

/**
 * Completes fence language after opening ``` at line start.
 * Triggers when the line is just backticks + optional partial language name.
 */
export function fenceLanguageCompletion(context) {
  // Match ``` optionally followed by partial language name, at the line start
  const match = context.matchBefore(/^`{3,}(\w*)$/m);
  if (!match && !context.explicit) return null;
  if (!match) return null;

  // The backticks portion length
  const backtickMatch = match.text.match(/^`{3,}/);
  if (!backtickMatch) return null;

  const from = match.from + backtickMatch[0].length;

  return {
    from,
    options: FENCE_LANGUAGES,
    validFor: /^\w*$/,
  };
}

// ── Emoji shortcode completions ─────────────────────────────────────────────

export const COMMON_EMOJIS = [
  { label: ':smile:',          apply: '😄', detail: '😄', type: 'text' },
  { label: ':laughing:',       apply: '😆', detail: '😆', type: 'text' },
  { label: ':blush:',          apply: '😊', detail: '😊', type: 'text' },
  { label: ':heart_eyes:',     apply: '😍', detail: '😍', type: 'text' },
  { label: ':thumbsup:',       apply: '👍', detail: '👍', type: 'text' },
  { label: ':thumbsdown:',     apply: '👎', detail: '👎', type: 'text' },
  { label: ':clap:',           apply: '👏', detail: '👏', type: 'text' },
  { label: ':fire:',           apply: '🔥', detail: '🔥', type: 'text' },
  { label: ':rocket:',         apply: '🚀', detail: '🚀', type: 'text' },
  { label: ':star:',           apply: '⭐', detail: '⭐', type: 'text' },
  { label: ':sparkles:',       apply: '✨', detail: '✨', type: 'text' },
  { label: ':tada:',           apply: '🎉', detail: '🎉', type: 'text' },
  { label: ':100:',            apply: '💯', detail: '💯', type: 'text' },
  { label: ':thinking:',       apply: '🤔', detail: '🤔', type: 'text' },
  { label: ':eyes:',           apply: '👀', detail: '👀', type: 'text' },
  { label: ':wave:',           apply: '👋', detail: '👋', type: 'text' },
  { label: ':pray:',           apply: '🙏', detail: '🙏', type: 'text' },
  { label: ':muscle:',         apply: '💪', detail: '💪', type: 'text' },
  { label: ':warning:',        apply: '⚠️', detail: '⚠️', type: 'text' },
  { label: ':bulb:',           apply: '💡', detail: '💡', type: 'text' },
  { label: ':memo:',           apply: '📝', detail: '📝', type: 'text' },
  { label: ':bug:',            apply: '🐛', detail: '🐛', type: 'text' },
  { label: ':white_check_mark:', apply: '✅', detail: '✅', type: 'text' },
  { label: ':x:',              apply: '❌', detail: '❌', type: 'text' },
  { label: ':question:',       apply: '❓', detail: '❓', type: 'text' },
  { label: ':exclamation:',    apply: '❗', detail: '❗', type: 'text' },
  { label: ':link:',           apply: '🔗', detail: '🔗', type: 'text' },
  { label: ':gear:',           apply: '⚙️', detail: '⚙️', type: 'text' },
  { label: ':lock:',           apply: '🔒', detail: '🔒', type: 'text' },
  { label: ':key:',            apply: '🔑', detail: '🔑', type: 'text' },
  { label: ':calendar:',       apply: '📅', detail: '📅', type: 'text' },
  { label: ':clock:',          apply: '🕐', detail: '🕐', type: 'text' },
  { label: ':zap:',            apply: '⚡', detail: '⚡', type: 'text' },
  { label: ':heart:',          apply: '❤️', detail: '❤️', type: 'text' },
  { label: ':coffee:',         apply: '☕', detail: '☕', type: 'text' },
  { label: ':package:',        apply: '📦', detail: '📦', type: 'text' },
  { label: ':arrow_right:',    apply: '➡️', detail: '➡️', type: 'text' },
  { label: ':arrow_left:',     apply: '⬅️', detail: '⬅️', type: 'text' },
  { label: ':heavy_plus_sign:', apply: '➕', detail: '➕', type: 'text' },
  { label: ':heavy_minus_sign:', apply: '➖', detail: '➖', type: 'text' },
];

/**
 * Completes emoji shortcodes after `:`.
 * Triggers when typing `:` followed by 2+ characters (to avoid noise).
 */
export function emojiCompletion(context) {
  const match = context.matchBefore(/:[a-zA-Z_][a-zA-Z0-9_]*$/);
  if (!match && !context.explicit) return null;
  if (!match) return null;

  // Require at least `:xx` (colon + 2 chars) for implicit activation
  if (!context.explicit && match.text.length < 3) return null;

  return {
    from: match.from,
    options: COMMON_EMOJIS,
    validFor: /^:[a-zA-Z0-9_]*$/,
  };
}

export default {
  calloutCompletion,
  fenceLanguageCompletion,
  emojiCompletion,
  CALLOUT_TYPES,
  FENCE_LANGUAGES,
  COMMON_EMOJIS,
};
