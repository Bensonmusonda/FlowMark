import { EditorState, RangeSetBuilder, Compartment } from '@codemirror/state';
import { EditorView, keymap, drawSelection, dropCursor, Decoration, ViewPlugin } from '@codemirror/view';
import { EditorSelection } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { languages } from '@codemirror/language-data';
import { syntaxHighlighting } from '@codemirror/language';
import { HighlightStyle } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

// ── Highlight style — theme-aware via Compartment ─────────────────────────────
const highlightCompartment = new Compartment();

function makeHighlight(isDark, accentColor) {
  const accent = accentColor || (isDark ? '#7cb8f0' : '#3a7bd5');
  const h1   = isDark ? '#f0f0f0' : '#111111';
  const h2   = isDark ? '#ebebeb' : '#1a1a1a';
  const h3   = isDark ? '#e0e0e0' : '#222222';
  const bold = isDark ? '#f0f0f0' : '#111111';
  const em   = isDark ? '#c8b8f8' : '#5a4fcf';
  const quot = isDark ? '#7a7a7a' : '#888866';
  const sep  = isDark ? '#444'    : '#cccccc';
  const url  = isDark ? '#555'    : '#aaaaaa';
  return syntaxHighlighting(HighlightStyle.define([
    { tag: t.heading1, fontSize: '2em',   fontWeight: '700', color: h1, textDecoration: 'none' },
    { tag: t.heading2, fontSize: '1.5em', fontWeight: '700', color: h2, textDecoration: 'none' },
    { tag: t.heading3, fontSize: '1.2em', fontWeight: '700', color: h3, textDecoration: 'none' },
    { tag: t.strong,   fontWeight: '700', color: bold },
    { tag: t.emphasis, fontStyle: 'italic', color: em },
    { tag: t.monospace, fontFamily: "'Cascadia Code','Fira Code','Consolas',monospace", fontSize: '0.87em', color: '#f0a97c' },
    { tag: t.link, color: accent, textDecoration: 'underline' },
    { tag: t.url,  color: url, fontSize: '0.85em' },
    { tag: t.quote, color: quot, fontStyle: 'italic' },
    { tag: t.keyword,     color: '#c678dd', fontFamily: "'Cascadia Code','Consolas',monospace" },
    { tag: t.string,      color: '#98c379' },
    { tag: t.comment,     color: '#5c6370', fontStyle: 'italic' },
    { tag: t.variableName,color: '#61afef' },
    { tag: t.contentSeparator, color: sep },
  ]));
}

const bulletPlugin = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = this.compute(view); }
  update(update) {
    if (update.docChanged || update.selectionSet || update.focusChanged) {
      this.decorations = this.compute(update.view);
    }
  }
  compute(view) {
    const builder = new RangeSetBuilder();
    const tree = ensureSyntaxTree(view.state, view.state.doc.length, 50)
              || syntaxTree(view.state);
    if (!tree) return builder.finish();
    const doc = view.state.doc;
    const activeLines = new Set(
      view.state.selection.ranges.map(r => doc.lineAt(r.head).number)
    );
    // Find task lines to exclude
    const taskLines = new Set();
    tree.iterate({ enter(node) {
      if (node.type.name === 'TaskMarker') taskLines.add(doc.lineAt(node.from).number);
    }});
    const marks = [];
    tree.iterate({ enter(node) {
      if (node.type.name !== 'ListMark') return;
      if (taskLines.has(doc.lineAt(node.from).number)) return;
      marks.push({ from: node.from, to: node.to,
        text: doc.sliceString(node.from, node.to),
        line: doc.lineAt(node.from).number });
    }});
    marks.sort((a, b) => a.from - b.from);
    for (const m of marks) {
      const visible = activeLines.has(m.line);
      builder.add(m.from, m.to, Decoration.replace({
        widget: new BulletWidget(m.text, visible)
      }));
    }
    return builder.finish();
  }
}, { decorations: v => v.decorations });
// EmphasisMark, HeaderMark, LinkMark, QuoteMark have no lezer highlight tags
// so CM never creates spans for them — Decoration.mark can't attach.
// Solution: replace them with widget spans we fully control.

import { syntaxTree, ensureSyntaxTree } from '@codemirror/language';
import { WidgetType } from '@codemirror/view';

const PUNCT = new Set(['HeaderMark','EmphasisMark','LinkMark','QuoteMark','URL','CodeMark']);

// ── Checkbox widget ───────────────────────────────────────────────────────────
class HiddenWidget extends WidgetType {
  toDOM() { const s = document.createElement('span'); s.style.display = 'none'; return s; }
  eq() { return true; }
  ignoreEvent() { return false; }
}
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
    // Apply current accent color via CSS variable (already set on :root)
    box.style.setProperty('--cb-accent', 'var(--accent)');
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
    const tree = ensureSyntaxTree(view.state, view.state.doc.length, 50)
              || syntaxTree(view.state);
    if (!tree) return builder.finish();
    const doc = view.state.doc;
    const marks = [];
    const taskLineMarks = new Map(); // lineNum -> ListMark range

    tree.iterate({
      enter(node) {
        if (node.type.name === 'ListMark') {
          taskLineMarks.set(doc.lineAt(node.from).number, { from: node.from, to: node.to });
        }
        if (node.type.name !== 'TaskMarker') return;
        const text = doc.sliceString(node.from, node.to);
        const lineNum = doc.lineAt(node.from).number;
        marks.push({ from: node.from, to: node.to, checked: text.toLowerCase() === '[x]', lineNum });
      }
    });

    // Collect all ranges: hide the ListMark dash, replace TaskMarker with checkbox
    const allRanges = [];
    for (const m of marks) {
      // Hide the accompanying '-'
      const listMark = taskLineMarks.get(m.lineNum);
      if (listMark) allRanges.push({ from: listMark.from, to: listMark.to, widget: new HiddenWidget() });
      allRanges.push({ from: m.from, to: m.to, widget: new CheckboxWidget(m.checked, m.from) });
    }
    allRanges.sort((a, b) => a.from - b.from);
    for (const r of allRanges) {
      builder.add(r.from, r.to, Decoration.replace({ widget: r.widget }));
    }
    return builder.finish();
  }
}, { decorations: v => v.decorations });

// ── Note linking — [[filename]] ───────────────────────────────────────────────
const noteLinkMark = Decoration.mark({ class: 'cm-note-link' });

class NoteBracketWidget extends WidgetType {
  constructor(text, visible) { super(); this.text = text; this.visible = visible; }
  eq(other) { return other.text === this.text && other.visible === this.visible; }
  toDOM() {
    const span = document.createElement('span');
    span.textContent = this.visible ? this.text : '';
    span.style.display = this.visible ? '' : 'none';
    span.style.color = 'var(--muted)';
    span.style.opacity = '0.5';
    return span;
  }
  ignoreEvent() { return false; }
}

const noteLinkPlugin = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = this.compute(view); }
  update(update) {
    if (update.docChanged || update.viewportChanged || update.selectionSet) {
      this.decorations = this.compute(update.view);
    }
  }
  compute(view) {
    const builder = new RangeSetBuilder();
    const re = /\[\[([^\]]+)\]\]/g;
    const doc = view.state.doc;
    const activeLines = new Set(
      view.state.selection.ranges.map(r => doc.lineAt(r.head).number)
    );
    const ranges = [];
    for (const { from, to } of view.visibleRanges) {
      const text = view.state.doc.sliceString(from, to);
      let m;
      re.lastIndex = 0;
      while ((m = re.exec(text)) !== null) {
        const start   = from + m.index;
        const end     = start + m[0].length;
        const lineNum = doc.lineAt(start).number;
        const visible = activeLines.has(lineNum);
        ranges.push(
          { from: start,     to: start + 2, type: 'bracket', visible },
          { from: start + 2, to: end - 2,   type: 'link'             },
          { from: end - 2,   to: end,        type: 'bracket', visible },
        );
      }
    }
    ranges.sort((a, b) => a.from - b.from);
    for (const r of ranges) {
      if (r.type === 'link') {
        builder.add(r.from, r.to, noteLinkMark);
      } else {
        builder.add(r.from, r.to, Decoration.replace({
          widget: new NoteBracketWidget(r.from < r.to ? view.state.doc.sliceString(r.from, r.to) : '[[', r.visible)
        }));
      }
    }
    return builder.finish();
  }
}, { decorations: v => v.decorations });

async function handleNoteLinkClick(e, view) {
  if (!e.ctrlKey) return;
  const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
  if (pos == null) return;
  const text = view.state.doc.toString();
  const before = text.lastIndexOf('[[', pos);
  const after  = text.indexOf(']]', pos);
  if (before === -1 || after === -1 || after < before) return;
  const name = text.slice(before + 2, after).trim();
  if (!name) return;
  e.preventDefault();
  const target = name.endsWith('.md') ? name : name + '.md';
  const result = await window.fileAPI.openPath(target);
  if (!result.canceled) {
    if (!await confirmDiscard()) { view.focus(); return; }
    setContent(result.content);
    isDirty = false;
    markClean(result.filePath);
    updatePlaceholder();
    updateWordCount();
    view.focus();
    return;
  }
  // File not found — offer to create
  const shouldCreate = await showConfirm(`"${target}" doesn't exist. Create it?`, 'Create');
  if (!shouldCreate) return;
  if (!await confirmDiscard()) { view.focus(); return; }
  const created = await window.fileAPI.createAndOpen(target);
  if (!created.canceled) {
    setContent('');
    isDirty = false;
    markClean(created.filePath);
    updatePlaceholder();
    updateWordCount();
    view.focus();
  }
}

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
          isList: false,
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
const themeCompartment = new Compartment();

function makeTheme(accentColor) {
  const sel = accentColor + '30'; // 30 = ~19% opacity in hex
  return EditorView.theme({
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
      caretColor: accentColor,
      wordBreak: 'break-word',
    },
    '.cm-line': { padding: '0' },
    '.cm-gutters': { display: 'none' },
    '.cm-selectionBackground': { background: `${accentColor}30 !important` },
    '&.cm-focused .cm-selectionBackground': { background: `${accentColor}40 !important` },
    '.cm-cursor': { borderLeftColor: accentColor, borderLeftWidth: '2px' },
    '.cm-syntax-show': { color: accentColor, opacity: '0.6' },
  }, { dark: true });
}

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

// ── Custom confirm dialog ─────────────────────────────────────────────────────
function showConfirm(message, okLabel = 'OK') {
  return new Promise(resolve => {
    const overlay = document.getElementById('confirm-overlay');
    document.getElementById('confirm-message').textContent = message;
    document.getElementById('confirm-ok').textContent = okLabel;
    overlay.classList.remove('hidden');

    const ok     = document.getElementById('confirm-ok');
    const cancel = document.getElementById('confirm-cancel');

    function finish(result) {
      overlay.classList.add('hidden');
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      view.focus();
      resolve(result);
    }
    function onOk()     { finish(true);  }
    function onCancel() { finish(false); }

    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
    ok.focus();
  });
}

// ── File ops ──────────────────────────────────────────────────────────────────
function getContent() { return view.state.doc.toString(); }

function setContent(text) {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
}

async function confirmDiscard() {
  if (!isDirty) return true;
  return await showConfirm('You have unsaved changes. Discard them?', 'Discard');
}

async function newFile() {
  if (!await confirmDiscard()) return;
  hideWelcome();
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
  hideWelcome();
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
        { key: 'Ctrl-n', run: () => { newFile();       return true; } },
        { key: 'Ctrl-o', run: () => { openFile();      return true; } },
        { key: 'Ctrl-s', run: () => { saveFile();      return true; } },
        { key: 'Ctrl-Shift-s', run: () => { saveAsFile();  return true; } },
        { key: 'Ctrl-p', run: () => { showQuickOpen(); return true; } },
      ]),
      markdown({ base: markdownLanguage, codeLanguages: languages, extensions: [GFM], addKeymap: true }),
      highlightCompartment.of(makeHighlight(true)),
      checkboxPlugin,
      bulletPlugin,
      noteLinkPlugin,
      activeSyntaxPlugin,
      themeCompartment.of(makeTheme('#7cb8f0')),
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
    case 'new':       newFile();       break;
    case 'open':      openFile();      break;
    case 'save':      saveFile();      break;
    case 'saveAs':    saveAsFile();    break;
    case 'quickOpen': showQuickOpen(); break;
    case 'settings':  showSettings();  break;
    case 'zen':    document.body.classList.toggle('zen'); break;
  }
});

// ── Settings panel ────────────────────────────────────────────────────────────
const settingsPanel = document.getElementById('settings-panel');

function showSettings() {
  // Mark active theme and accent
  document.querySelectorAll('.theme-opt').forEach(b => {
    b.classList.toggle('active', b.dataset.theme === currentTheme ||
      (currentTheme === 'theme-dark' && b.dataset.theme === 'theme-dark'));
  });
  document.querySelectorAll('.accent-opt').forEach(b => {
    b.classList.toggle('active', b.dataset.accent === currentAccent);
  });
  settingsPanel.classList.remove('hidden');
}

function hideSettings() {
  settingsPanel.classList.add('hidden');
  view.focus();
}

settingsPanel.addEventListener('click', e => {
  if (e.target === settingsPanel) { hideSettings(); return; }
  const theme = e.target.closest('[data-theme]')?.dataset.theme;
  if (theme) { applyTheme(theme); showSettings(); return; }
  const accent = e.target.closest('[data-accent]')?.dataset.accent;
  if (accent) { applyAccent(accent); showSettings(); }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !settingsPanel.classList.contains('hidden')) hideSettings();
});

// ── Welcome screen ────────────────────────────────────────────────────────────
const welcome = document.getElementById('welcome');

async function showWelcome() {
  const recents = await window.fileAPI.getRecents();
  const list  = document.getElementById('welcome-recents-list');
  const empty = document.getElementById('welcome-recents-empty');
  list.innerHTML = '';

  if (recents.length === 0) {
    empty.classList.remove('hidden');
  } else {
    empty.classList.add('hidden');
    recents.forEach(filePath => {
      const name = filePath.split(/[\\/]/).pop();
      const dir  = filePath.split(/[\\/]/).slice(0, -1).join('\\');
      const li = document.createElement('li');
      li.innerHTML = `<span class="wr-name">${name}</span><span class="wr-path">${dir}</span>`;
      li.addEventListener('click', () => openRecentFile(filePath));
      list.appendChild(li);
    });
  }
  welcome.classList.remove('hidden');
}

function hideWelcome() {
  welcome.classList.add('hidden');
}

document.getElementById('welcome-actions').addEventListener('click', e => {
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (!action) return;
  hideWelcome();
  if (action === 'new')  newFile();
  if (action === 'open') openFile();
});

// ── Quick open ────────────────────────────────────────────────────────────────
const quickOpen = document.getElementById('quick-open');
let focusedRecentIndex = -1;

async function showQuickOpen() {
  const recents = await window.fileAPI.getRecents();
  const list = document.getElementById('recents-list');
  const empty = document.getElementById('recents-empty');
  list.innerHTML = '';
  focusedRecentIndex = -1;

  if (recents.length === 0) {
    empty.classList.remove('hidden');
  } else {
    empty.classList.add('hidden');
    recents.forEach((filePath, i) => {
      const name = filePath.split(/[\\/]/).pop();
      const dir  = filePath.split(/[\\/]/).slice(0, -1).join('/');
      const li = document.createElement('li');
      li.innerHTML = `<span class="recent-name">${name}</span><span class="recent-path">${dir}</span>`;
      li.addEventListener('click', () => openRecentFile(filePath));
      list.appendChild(li);
    });
  }

  quickOpen.classList.remove('hidden');
}

function hideQuickOpen() {
  quickOpen.classList.add('hidden');
  view.focus();
}

async function openRecentFile(filePath) {
  hideWelcome();
  hideQuickOpen();
  if (!await confirmDiscard()) return;
  const result = await window.fileAPI.openPath(filePath);
  if (result.canceled) return;
  setContent(result.content);
  isDirty = false;
  markClean(result.filePath);
  updatePlaceholder();
  updateWordCount();
}

// Action buttons inside overlay
document.getElementById('quick-open-actions').addEventListener('click', e => {
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (!action) return;
  hideQuickOpen();
  if (action === 'new')  newFile();
  if (action === 'open') openFile();
});

// Dismiss on backdrop click
quickOpen.addEventListener('click', e => {
  if (e.target === quickOpen) hideQuickOpen();
});

// Keyboard nav inside overlay
quickOpen.addEventListener('keydown', e => {
  const items = [...document.querySelectorAll('#recents-list li')];
  if (e.key === 'Escape') { hideQuickOpen(); return; }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    focusedRecentIndex = Math.min(focusedRecentIndex + 1, items.length - 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    focusedRecentIndex = Math.max(focusedRecentIndex - 1, 0);
  } else if (e.key === 'Enter' && focusedRecentIndex >= 0) {
    items[focusedRecentIndex]?.click();
    return;
  }
  items.forEach((li, i) => li.classList.toggle('focused', i === focusedRecentIndex));
  items[focusedRecentIndex]?.scrollIntoView({ block: 'nearest' });
});

// ── Theme & Accent ───────────────────────────────────────────────────────────
const THEMES = ['theme-dark', 'theme-light', 'theme-sepia'];
let currentTheme = localStorage.getItem('fm-theme') || 'theme-dark';

const ACCENTS = {
  // Blues
  blue:       { dark: '#7cb8f0', light: '#2970c8' },
  steel:      { dark: '#90aac8', light: '#3a5878' },
  sky:        { dark: '#80d0e8', light: '#1888a8' },
  // Greens
  sage:       { dark: '#90c8a0', light: '#2a7a48' },
  mint:       { dark: '#80e0c0', light: '#0a8060' },
  olive:      { dark: '#b0c880', light: '#506820' },
  // Reds / Pinks
  rose:       { dark: '#f0a0b0', light: '#b83050' },
  coral:      { dark: '#f0907a', light: '#c04030' },
  blush:      { dark: '#e8b0c8', light: '#a03870' },
  // Purples
  lavender:   { dark: '#b8a8f0', light: '#5040b8' },
  mauve:      { dark: '#d0a0d0', light: '#883888' },
  violet:     { dark: '#c0a0e8', light: '#6030b0' },
  // Warm neutrals
  peach:      { dark: '#f0b890', light: '#b05820' },
  sand:       { dark: '#d4b896', light: '#7a5030' },
  amber:      { dark: '#e8c870', light: '#987010' },
  // Cool neutral
  slate:      { dark: '#a0b8c8', light: '#305068' },
};

let currentAccent = localStorage.getItem('fm-accent') || 'blue';

function applyAccent(name) {
  const isLight = currentTheme !== 'theme-dark';
  const color = ACCENTS[name]?.[isLight ? 'light' : 'dark'] || ACCENTS.blue.dark;
  document.documentElement.style.setProperty('--accent', color);
  currentAccent = name;
  localStorage.setItem('fm-accent', name);
  if (typeof view !== 'undefined') {
    view.dispatch({ effects: [
      themeCompartment.reconfigure(makeTheme(color)),
      highlightCompartment.reconfigure(makeHighlight(!isLight, color)),
    ]});
  }
}

function applyTheme(theme) {
  document.body.classList.remove(...THEMES);
  if (theme !== 'theme-dark') document.body.classList.add(theme);
  currentTheme = theme;
  localStorage.setItem('fm-theme', theme);
  applyAccent(currentAccent);
}

// ── Zen mode ──────────────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'F11') { e.preventDefault(); document.body.classList.toggle('zen'); }
});

// ── Click-to-focus / note link ────────────────────────────────────────────────
document.getElementById('editor-wrap').addEventListener('click', e => {
  if (e.ctrlKey) { handleNoteLinkClick(e, view); return; }
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
// Re-apply theme now that view exists (fixes highlight on non-dark startup)
applyTheme(currentTheme);
showWelcome();
view.focus();