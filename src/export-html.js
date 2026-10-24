'use strict';

// Builds the standalone document used for PDF/HTML export. Kept free of
// Electron imports so it can be exercised from Node (see the export probe in
// the release checklist).

const { marked } = require('marked');

const THEMES = {
  'theme-light': {
    bg: '#ffffff',
    text: '#222222',
    heading: '#000000',
    muted: '#6f6f6f',
    border: '#dcdcdc',
    accent: '#2f6fd0',
    codeBg: 'rgba(0, 0, 0, 0.055)',
  },
  'theme-sepia': {
    bg: '#f4efe4',
    text: '#3b3020',
    heading: '#1e1812',
    muted: '#7d6d55',
    border: '#ddd5c0',
    accent: '#8a6620',
    codeBg: 'rgba(100, 70, 20, 0.08)',
  },
  dark: {
    bg: '#1a1a1a',
    text: '#d4d4d4',
    heading: '#f0f0f0',
    muted: '#9a9a9a',
    border: '#333333',
    accent: '#7cb8f0',
    codeBg: 'rgba(255, 255, 255, 0.07)',
  },
};

function themeOf(className) {
  const classes = String(className || '').split(/\s+/);
  if (classes.includes('theme-light')) return THEMES['theme-light'];
  if (classes.includes('theme-sepia')) return THEMES['theme-sepia'];
  return THEMES.dark;
}

/**
 * Obsidian callout headers are not markdown. Turn `> [!NOTE] rest` into a
 * highlighted blockquote header so exports show a labelled quote instead of
 * the literal `[!NOTE]` marker.
 */
function preprocessCallouts(markdown) {
  return String(markdown).split('\n').map((line) => {
    const match = line.match(/^(\s*>\s*)\[!([A-Za-z]+)\]\s*(.*)$/);
    if (!match) return line;
    const label = match[2].charAt(0).toUpperCase() + match[2].slice(1).toLowerCase();
    const rest = match[3].trim();
    return match[1] + '**' + label + '**' + (rest ? ' — ' + rest : '');
  }).join('\n');
}

function buildExportDocument(markdown, themeClassName) {
  const theme = themeOf(themeClassName);
  const html = marked.parse(preprocessCallouts(markdown), { gfm: true, breaks: false });

  return `<!DOCTYPE html>
<html lang="en" style="background:${theme.bg}">
<head>
<meta charset="UTF-8">
<title>FlowMark export</title>
<style>
  :root { color-scheme: ${theme === THEMES.dark ? 'dark' : 'light'}; }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: ${theme.bg};
    color: ${theme.text};
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  body {
    font-family: 'Merriweather', Georgia, 'Times New Roman', serif;
    font-size: 11.5pt;
    line-height: 1.7;
  }
  .export-content {
    max-width: 720px;
    margin: 0 auto;
    padding: 36px 24px 48px;
  }
  h1, h2, h3, h4 {
    color: ${theme.heading};
    font-weight: 700;
    line-height: 1.25;
    margin: 1.5em 0 0.55em;
    break-after: avoid;
    page-break-after: avoid;
  }
  h1 { font-size: 2em; }
  h2 { font-size: 1.5em; }
  h3 { font-size: 1.2em; }
  p { margin: 0 0 0.85em; }
  a { color: ${theme.accent}; text-decoration: underline; }
  strong { color: ${theme.heading}; }
  em { font-style: italic; }
  del { text-decoration: line-through; opacity: 0.75; }

  code, pre, kbd {
    font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
    font-size: 0.9em;
  }
  code {
    background: ${theme.codeBg};
    padding: 1px 5px;
    border-radius: 4px;
  }
  pre {
    background: ${theme.codeBg};
    padding: 12px 14px;
    border-radius: 8px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  pre code { background: none; padding: 0; }

  blockquote {
    margin: 1em 0;
    padding: 2px 0 2px 14px;
    border-left: 3px solid ${theme.border};
    color: ${theme.muted};
    break-inside: avoid;
    page-break-inside: avoid;
  }
  blockquote p:last-child { margin-bottom: 0; }

  ul, ol { margin: 0 0 0.9em; padding-left: 1.6em; }
  li { margin: 0.18em 0; }
  li > ul, li > ol { margin: 0.2em 0 0.2em; }

  hr {
    border: 0;
    border-top: 1px solid ${theme.border};
    margin: 1.6em 0;
  }

  img { max-width: 100%; height: auto; break-inside: avoid; }

  table {
    width: 100%;
    border-collapse: collapse;
    margin: 1em 0;
    font-size: 0.92em;
    break-inside: auto;
  }
  thead { display: table-header-group; }
  th, td {
    border: 1px solid ${theme.border};
    padding: 6px 9px;
    vertical-align: top;
    text-align: left;
  }
  th { background: ${theme.codeBg}; color: ${theme.heading}; font-weight: 600; }
  tr { break-inside: avoid; page-break-inside: avoid; }

  @page { size: A4; margin: 18mm 16mm; }
</style>
</head>
<body>
<div class="export-content">${html}</div>
</body>
</html>`;
}

module.exports = { buildExportDocument, preprocessCallouts, themeOf };
