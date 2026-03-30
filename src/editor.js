import { EditorState, RangeSetBuilder } from '@codemirror/state';
import { EditorView, keymap, drawSelection, dropCursor, Decoration, ViewPlugin } from '@codemirror/view';
import { EditorSelection } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { languages } from '@codemirror/language-data';
import { syntaxHighlighting } from '@codemirror/language';
import { HighlightStyle } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

// ── Highlight style — applied via CM's own scoped class system ────────────────
const flowHighlight = HighlightStyle.define([
  // Headings — size + weight, no underline
  { tag: t.heading1, fontSize: '2em',   fontWeight: '700', color: '#f0f0f0', textDecoration: 'none' },
  { tag: t.heading2, fontSize: '1.5em', fontWeight: '700', color: '#ebebeb', textDecoration: 'none' },
  { tag: t.heading3, fontSize: '1.2em', fontWeight: '700', color: '#e0e0e0', textDecoration: 'none' },

  // Inline formatting
  { tag: t.strong,   fontWeight: '700', color: '#f0f0f0' },
  { tag: t.emphasis, fontStyle: 'italic', color: '#c8b8f8' },
  { tag: t.monospace, fontFamily: "'Cascadia Code','Fira Code','Consolas',monospace", fontSize: '0.87em', color: '#f0a97c' },

  // Links
  { tag: t.link, color: '#7cb8f0', textDecoration: 'underline' },
  { tag: t.url,  color: '#555', fontSize: '0.85em' },

  // Blockquote
  { tag: t.quote, color: '#7a7a7a', fontStyle: 'italic' },

  // Code block contents
  { tag: t.keyword,  color: '#c678dd', fontFamily: "'Cascadia Code','Consolas',monospace" },
  { tag: t.string,   color: '#98c379' },
  { tag: t.comment,  color: '#5c6370', fontStyle: 'italic' },
  { tag: t.variableName, color: '#61afef' },

  // HR
  { tag: t.contentSeparator, color: '#444' },
]);

// ── Active-line syntax reveal ─────────────────────────────────────────────────
// EmphasisMark, HeaderMark, LinkMark, QuoteMark have no lezer highlight tags
// so CM never creates spans for them — Decoration.mark can't attach.
// Solution: replace them with widget spans we fully control.

import { syntaxTree, ensureSyntaxTree } from '@codemirror/language';
import { WidgetType } from '@codemirror/view';

const PUNCT = new Set(['HeaderMark','EmphasisMark','LinkMark','QuoteMark','URL','CodeMark','ListMark']);

// ── Checkbox widget ───────────────────────────────────────────────────────────
class CheckboxWidget extends WidgetType {
  constructor(checked, from) { super(); this.checked = checked; this.from = from; }
  eq(other) { return other.checked === this.checked; }
  toDOM(view) {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = this.checked;
    box.className = 'cm-checkbox';
    box.addEventListener('mousedown', e => {
      e.preventDefault();
      const pos = this.from;
      const text = view.state.doc.sliceString(pos, pos + 3);
      const replacement = text === '[ ]' ? '[x]' : '[ ]';
      view.dispatch({ changes: { from: pos, to: pos + 3, insert: replacement } });
    });
    return box;
  }
  ignoreEvent() { return false; }
}

const checkboxPlugin = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = this.compute(view); }
  update(update) {
    if (update.docChanged || update.viewportChanged) {
      this.decorations = this.compute(update.view);
    }
  }
  compute(view) {
    const builder = new RangeSetBuilder();
    const tree = ensureSyntaxTree(view.state, view.state.doc.length, 50);
    if (!tree) return builder.finish();
    const marks = [];
    tree.iterate({
      enter(node) {
        if (node.type.name !== 'TaskMarker') return;
        const text = view.state.doc.sliceString(node.from, node.to);
        marks.push({ from: node.from, to: node.to, checked: text.toLowerCase() === '[x]' });
      }
    });
    marks.sort((a, b) => a.from - b.from);
    for (const m of marks) {
      builder.add(m.from, m.to, Decoration.replace({
        widget: new CheckboxWidget(m.checked, m.from),
      }));
    }
    return builder.finish();
  }
}, { decorations: v => v.decorations });

// ── Syntax hide/show widgets ──────────────────────────────────────────────────
class SyntaxWidget extends WidgetType {
  constructor(text, visible) { super(); this.text = text; this.visible = visible; }
  eq(other) { return other.text === this.text && other.visible === this.visible; }
  toDOM() {
    const span = document.createElement('span');
    if (this.visible) {
      span.textContent = this.text;
      span.style.color = '#666';
    } else {
      span.textContent = '';
      span.style.display = 'none';
    }
    return span;
  }
  ignoreEvent() { return false; }
}

class BulletWidget extends WidgetType {
  constructor(text, visible) { super(); this.text = text; this.visible = visible; }
  eq(other) { return other.text === this.text && other.visible === this.visible; }
  toDOM() {
    const span = document.createElement('span');
    if (this.visible) {
      // Active line: show raw mark dimmed
      span.textContent = this.text;
      span.style.color = '#666';
    } else {
      // Inactive: unordered gets bullet, ordered keeps number
      const isOrdered = /^\d/.test(this.text);
      if (isOrdered) {
        span.textContent = this.text;
        span.style.color = '#666';
      } else {
        span.textContent = '•';
        span.style.color = '#888';
        span.style.marginRight = '0.4em';
      }
    }
    return span;
  }
  ignoreEvent() { return false; }
}

const activeSyntaxPlugin = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = this.compute(view); }
  update(update) {
    if (update.docChanged || update.selectionSet || update.focusChanged) {
      this.decorations = this.compute(update.view);
    }
  }
  compute(view) {
    const builder = new RangeSetBuilder();
    const doc = view.state.doc;
    const activeLines = new Set(
      view.state.selection.ranges.map(r => doc.lineAt(r.head).number)
    );
    const tree = ensureSyntaxTree(view.state, view.state.doc.length, 50);
    if (!tree) return builder.finish();
    const marks = [];
    tree.iterate({
      enter(node) {
        if (!PUNCT.has(node.type.name)) return;
        marks.push({
          from: node.from,
          to: node.to,
          text: doc.sliceString(node.from, node.to),
          line: doc.lineAt(node.from).number,
          isList: node.type.name === 'ListMark',
        });
      }
    });
    marks.sort((a, b) => a.from - b.from);
    for (const m of marks) {
      const visible = activeLines.has(m.line);
      const widget = m.isList
        ? new BulletWidget(m.text, visible)
        : new SyntaxWidget(m.text, visible);
      builder.add(m.from, m.to,
        Decoration.replace({ widget })
      );
    }
    return builder.finish();
  }
}, { decorations: v => v.decorations });

// ── Visual theme ──────────────────────────────────────────────────────────────
const flowTheme = EditorView.theme({
  '&': {
    background: 'transparent',
    color: '#d4d4d4',
    fontSize: '17px',
    fontFamily: "'Merriweather', 'Georgia', 'Cambria', serif",
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: "'Merriweather', 'Georgia', 'Cambria', serif",
    lineHeight: '1.9',
    overflow: 'visible',
  },
  '.cm-content': {
    padding: '0',
    caretColor: '#7cb8f0',
    wordBreak: 'break-word',
  },
  '.cm-line': { padding: '0' },
  '.cm-gutters': { display: 'none' },
  '.cm-selectionBackground': { background: 'rgba(124,184,240,0.18) !important' },
  '&.cm-focused .cm-selectionBackground': { background: 'rgba(124,184,240,0.22) !important' },
  '.cm-cursor': { borderLeftColor: '#7cb8f0', borderLeftWidth: '2px' },
}, { dark: true });

// ── State ─────────────────────────────────────────────────────────────────────
let isDirty = false;
let currentFileName = null;

function setFileName(filePath) {
  currentFileName = filePath ? filePath.split(/[\\/]/).pop() : null;
  const label = currentFileName || 'untitled';
  const dot = isDirty ? ' •' : '';
  document.getElementById('app-name').textContent = `FlowMark — ${label}${dot}`;
}

function markDirty() {
  if (!isDirty) { isDirty = true; setFileName(currentFileName); }
}

function markClean(filePath) {
  isDirty = false;
  if (filePath) currentFileName = filePath.split(/[\\/]/).pop();
  setFileName(filePath ? filePath.split(/[\\/]/).pop() : null);
}

// ── File ops ──────────────────────────────────────────────────────────────────
function getContent() { return view.state.doc.toString(); }

function setContent(text) {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
}

async function confirmDiscard() {
  if (!isDirty) return true;
  const ok = window.confirm('You have unsaved changes. Discard them?');
  setTimeout(() => view.focus(), 50);
  return ok;
}

async function newFile() {
  if (!await confirmDiscard()) return;
  await window.fileAPI.clearPath();
  setContent('');
  isDirty = false;
  currentFileName = null;
  setFileName(null);
  view.focus();
  updatePlaceholder();
}

async function openFile() {
  if (!await confirmDiscard()) return;
  const result = await window.fileAPI.open();
  if (result.canceled) return;
  setContent(result.content);
  isDirty = false;
  currentFileName = result.filePath.split(/[\\/]/).pop();
  markClean(result.filePath);
  updatePlaceholder();
}

async function saveFile() {
  const result = await window.fileAPI.save(getContent());
  if (result.noPath) return saveAsFile();
  markClean(result.filePath);
}

async function saveAsFile() {
  const result = await window.fileAPI.saveAs(getContent());
  if (result.canceled) return;
  markClean(result.filePath);
}

// ── Editor ────────────────────────────────────────────────────────────────────
const startDoc = `# Welcome to FlowMark

Start typing — **bold**, *italic*, \`code\`, and more render as you write.

## A clean space to think

> Blockquotes feel calm and deliberate.

Write some \`inline code\` or a fenced block:

\`\`\`js
const greet = name => \`Hello, \${name}!\`;
\`\`\`

Links work too: [FlowMark](https://github.com)

---

Just start writing.
`;

const view = new EditorView({
  state: EditorState.create({
    doc: startDoc,
    extensions: [
      history(),
      drawSelection(),
      dropCursor(),
      keymap.of([
        ...defaultKeymap,
        ...historyKeymap,
        { key: 'Ctrl-n', run: () => { newFile();    return true; } },
        { key: 'Ctrl-o', run: () => { openFile();   return true; } },
        { key: 'Ctrl-s', run: () => { saveFile();   return true; } },
        { key: 'Ctrl-Shift-s', run: () => { saveAsFile(); return true; } },
      ]),
      markdown({ base: markdownLanguage, codeLanguages: languages, extensions: [GFM], addKeymap: true }),
      syntaxHighlighting(flowHighlight),
      checkboxPlugin,
      activeSyntaxPlugin,
      flowTheme,
      EditorView.lineWrapping,
      EditorView.updateListener.of(update => {
        if (update.docChanged) { markDirty(); updatePlaceholder(); updateWordCount(); }
      }),
    ],
  }),
  parent: document.getElementById('editor'),
});

// ── Placeholder ───────────────────────────────────────────────────────────────
function updatePlaceholder() {
  document.getElementById('editor').classList.toggle('empty', view.state.doc.length === 0);
}

// ── Window controls ───────────────────────────────────────────────────────────
document.getElementById('btn-min').addEventListener('click', () => window.windowAPI.minimize());
document.getElementById('btn-max').addEventListener('click', () => window.windowAPI.maximize());
document.getElementById('btn-close').addEventListener('click', () => window.windowAPI.close());

// ── Dropdown menu ─────────────────────────────────────────────────────────────
const menuBtn  = document.getElementById('menu-btn');
const dropdown = document.getElementById('dropdown');

menuBtn.addEventListener('click', e => {
  e.stopPropagation();
  dropdown.classList.toggle('hidden');
});

document.addEventListener('click', () => dropdown.classList.add('hidden'));

dropdown.addEventListener('click', e => {
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (!action) return;
  dropdown.classList.add('hidden');
  switch (action) {
    case 'new':    newFile();    break;
    case 'open':   openFile();   break;
    case 'save':   saveFile();   break;
    case 'saveAs': saveAsFile(); break;
    case 'zen':    document.body.classList.toggle('zen'); break;
  }
});

// ── Zen mode ──────────────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'F11') { e.preventDefault(); document.body.classList.toggle('zen'); }
});

// ── Click-to-focus ────────────────────────────────────────────────────────────
document.getElementById('editor-wrap').addEventListener('click', e => {
  if (e.target === e.currentTarget || e.target === document.getElementById('editor')) {
    view.focus();
  }
});

// ── Word / reading time count ─────────────────────────────────────────────────
function updateWordCount() {
  const text = view.state.doc.toString();
  const words = text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
  const mins  = Math.ceil(words / 200);
  const label = words === 0 ? '' : `${words.toLocaleString()} words · ${mins} min read`;
  document.getElementById('word-count').textContent = label;
}

setFileName(null);
updatePlaceholder();
updateWordCount();
view.focus();