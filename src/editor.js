import { EditorState, Compartment, StateEffect, StateField } from '@codemirror/state';
import { EditorView, keymap, drawSelection, dropCursor, Decoration, ViewPlugin, WidgetType } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { search, searchKeymap, openSearchPanel, closeSearchPanel, searchPanelOpen } from '@codemirror/search';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { languages } from '@codemirror/language-data';
import { syntaxHighlighting, HighlightStyle, syntaxTree, ensureSyntaxTree } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import katex from 'katex';

// ── Live-preview stability primitives ────────────────────────────────────────
//
// Invariants (derived from obsidian_formatting_blueprint.md §2.1, §2.5, §3):
//
//  1. Concealment is an EMPTY `Decoration.replace({})`. No widget, no DOM node,
//     no `display:none`, no `font-size:0`. A zero-width replace cannot change a
//     line's strut, so hiding `#`/`**`/`>` never resizes the line box.
//  2. Concealment never changes font metrics: sizes, weights and line heights
//     live on spans/line classes that survive concealment.
//  3. Syntax-tree work is bounded to the viewport (`visibleRanges` + a small
//     margin). `ensureSyntaxTree(state, doc.length, …)` is forbidden: on a long
//     document it either blocks for the whole budget or returns a partial tree,
//     and a partial tree produces a different decoration set mid-scroll.
//  4. Rebuilds are frozen while the pointer is down or an IME composition is in
//     flight; decorations are mapped through changes instead, then rebuilt once.
//  5. Every remaining WidgetType is inline and reports `estimatedHeight = 0`,
//     keeping it below CodeMirror's 5px height-relevance threshold so inline
//     widgets can never enter the height map.

const HIDE = Decoration.replace({});          // zero-width, zero-height concealment
const refreshEffect = StateEffect.define();   // force one rebuild after a drag
const interaction = { dragging: false };

const PARSE_MARGIN = 2000;                    // chars past the viewport to parse
const PARSE_BUDGET_MS = 20;                   // hard budget for that parse

function activeRanges(view) {
  // Blurred editor reveals nothing: every range stops being active, exactly as
  // Obsidian does (`e.hasFocus ? selection.ranges : []`).
  return view.hasFocus ? view.state.selection.ranges : [];
}

function rangeTouches(ranges, from, to) {
  for (const r of ranges) if (r.from <= to && r.to >= from) return true;
  return false;
}

/** Inline construct is active when the selection intersects the whole construct. */
function inlineIsActive(view, from, to) {
  return rangeTouches(activeRanges(view), from, to);
}

/** Block construct is active when the selection touches any part of its line. */
function lineIsActive(view, pos) {
  const line = view.state.doc.lineAt(pos);
  return rangeTouches(activeRanges(view), line.from, line.to);
}

/**
 * End of the run of spaces/tabs starting at `pos`, clamped to its line.
 *
 * Lezer emits `HeaderMark`/`QuoteMark`/`ListMark` for the punctuation only —
 * the space after `#`, `>` or `-` belongs to the surrounding text. Hiding just
 * the mark therefore leaves a stray leading space, so concealment always
 * swallows the gap that follows it.
 */
function skipSpaces(doc, pos) {
  const line = doc.lineAt(pos);
  let end = pos;
  while (end < line.to) {
    const ch = doc.sliceString(end, end + 1);
    if (ch !== ' ' && ch !== '\t') break;
    end++;
  }
  return end;
}

/** Length of a leading blockquote prefix (`  > > `) in characters. */
function quotePrefixLength(text) {
  const m = text.match(/^(\s*(?:>\s*)+)?/);
  return m[1] ? m[1].length : 0;
}

/**
 * Parse only as far as the viewport needs, with a hard time budget.
 * Returns the best tree available; never forces a full-document parse.
 */
function viewportTree(view) {
  const target = Math.min(view.state.doc.length, view.viewport.to + PARSE_MARGIN);
  return ensureSyntaxTree(view.state, target, PARSE_BUDGET_MS) || syntaxTree(view.state);
}

/** Iterate the tree strictly inside `view.visibleRanges`. */
function forEachVisibleNode(view, tree, enter) {
  const ranges = view.visibleRanges.length
    ? view.visibleRanges
    : [{ from: 0, to: Math.min(view.state.doc.length, PARSE_MARGIN) }];
  for (const { from, to } of ranges) {
    tree.iterate({ from, to, enter });
  }
}

function wantsRebuild(update) {
  if (update.docChanged || update.selectionSet ||
      update.viewportChanged || update.focusChanged) return true;
  return update.transactions.some(tr => tr.effects.some(e => e.is(refreshEffect)));
}

/** True when the line range overlaps any currently rendered viewport segment. */
function lineIsVisible(view, from, to) {
  if (!view.visibleRanges.length) return true;
  for (const range of view.visibleRanges) {
    if (range.from <= to && range.to >= from) return true;
  }
  return false;
}

/**
 * Shared update policy for every decoration plugin: freeze during composition
 * and pointer drags, otherwise rebuild on the cheap triggers only.
 */
function updateDecorations(plugin, update) {
  if (update.view.composing || interaction.dragging) {
    if (update.docChanged) plugin.decorations = plugin.decorations.map(update.changes);
    return;
  }
  if (wantsRebuild(update)) plugin.decorations = plugin.compute(update.view);
}

// ── Callouts ──────────────────────────────────────────────────────────────────
// A callout is a whole-block replacement widget. CodeMirror rejects block
// decorations that come from a ViewPlugin ("Block decorations may not be
// specified via plugins"), so they are produced by a StateField and exposed
// through `EditorView.decorations.from(field)`.
//
// Un-concealment is "don't emit": when the selection touches the block the
// field produces no decoration and the raw `> [!NOTE]` lines render normally.

const CALLOUT_HEADER_RE = /^\s*>\s*\[!([A-Za-z0-9_-]+)\](?:[ \t]+(.*))?$/;
const CALLOUT_LINE_RE = /^\s*>/;
const IMAGE_RE = /!\[([^\]]*)\]\(([^)]*)\)/g;
const FOOTNOTE_REF_RE = /\[\^([^\]\n]+)\]/g;
const FENCE_RE = /^\s*(```|~~~)/;
const TABLE_DELIM_RE = /^\s*\|?\s*:?-{1,}:?\s*(?:\|\s*:?-{1,}:?\s*)*\|?\s*$/;

/** Split a GFM row on unescaped pipes, dropping the optional border cells. */
function splitTableRow(text) {
  const cells = [];
  let current = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\' && text[i + 1] === '|') { current += '|'; i++; continue; }
    if (ch === '|') { cells.push(current); current = ''; continue; }
    current += ch;
  }
  cells.push(current);
  if (cells.length && cells[0].trim() === '') cells.shift();
  if (cells.length && cells[cells.length - 1].trim() === '') cells.pop();
  return cells.map((cell) => cell.trim());
}

/**
 * Same split, but keeping each cell's trimmed source range so a cell edit is a
 * single replace transaction against the markdown text.
 */
function splitTableRowRanges(text, offset) {
  const bounds = [];
  let cellStart = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\' && text[i + 1] === '|') { i++; continue; }
    if (ch === '|') { bounds.push([cellStart, i]); cellStart = i + 1; }
  }
  bounds.push([cellStart, text.length]);
  if (bounds.length && text.slice(bounds[0][0], bounds[0][1]).trim() === '') bounds.shift();
  if (bounds.length && text.slice(bounds[bounds.length - 1][0], bounds[bounds.length - 1][1]).trim() === '') {
    bounds.pop();
  }
  return bounds.map(([start, end]) => {
    const raw = text.slice(start, end);
    const trimmed = raw.trim();
    // Whitespace-only cell (every cell of a freshly inserted row): trimming
    // lead and trail independently would give from > to, i.e. an invalid
    // change range that makes every commit throw. Cover the raw span instead.
    if (trimmed === '') {
      return { from: offset + start, to: offset + end, text: '' };
    }
    const lead = raw.length - raw.trimStart().length;
    const trail = raw.length - raw.trimEnd().length;
    return {
      from: offset + start + lead,
      to: offset + end - trail,
      text: trimmed,
    };
  });
}

/** Column alignment from the delimiter row (`:---`, `:---:`, `---:`). */
function parseTableAlignments(text) {
  return splitTableRow(text).map((cell) => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    return 'left';
  });
}

const TABLE_INLINE_RE = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_)/g;

/** Minimal inline markdown for table cells (code / strong / em), DOM-only. */
function appendInlineMarkdown(parent, text) {
  let last = 0;
  TABLE_INLINE_RE.lastIndex = 0;
  let match;
  while ((match = TABLE_INLINE_RE.exec(text)) !== null) {
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
      strong.textContent = token.slice(2, -2);
      parent.appendChild(strong);
    } else {
      const em = document.createElement('em');
      em.textContent = token.slice(1, -1);
      parent.appendChild(em);
    }
    last = match.index + token.length;
  }
  if (last < text.length) {
    parent.appendChild(document.createTextNode(text.slice(last)));
  }
}

const CALLOUT_ICON_ALIASES = {
  note: 'info', info: 'info', todo: 'check',
  tip: 'bulb', hint: 'bulb',
  important: 'flame',
  success: 'check', check: 'check', done: 'check',
  warning: 'alert', caution: 'alert', attention: 'alert',
  danger: 'zap', error: 'zap',
  bug: 'bug',
  fail: 'x', failure: 'x',
  question: 'help', help: 'help', faq: 'help',
  example: 'list',
  quote: 'quote', cite: 'quote',
};

const CALLOUT_ICONS = {
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
  bulb: '<path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.1 1 1.9h5c0-.8.4-1.4 1-1.9A6 6 0 0 0 12 3z"/>',
  alert: '<path d="M12 3 2.5 20h19L12 3z"/><path d="M12 9v5"/><path d="M12 17h.01"/>',
  flame: '<path d="M12 3c3 4 5 6.5 5 9.5a5 5 0 0 1-10 0C7 10 8.5 8 10 6c0 3 1.5 4 2 4 0-2 .5-4 0-7z"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.6 2.3c-.7.4-1.1.9-1.1 1.7"/><path d="M12 17h.01"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>',
  quote: '<path d="M7 7h4v4c0 3-1.2 4.8-3.5 6"/><path d="M14 7h4v4c0 3-1.2 4.8-3.5 6"/>',
  zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/>',
  bug: '<circle cx="12" cy="13" r="4"/><path d="M12 9V6"/><path d="m8 11-3-2"/><path d="m16 11 3-2"/><path d="M8 15H5"/><path d="M16 15h3"/><path d="m9 18-2 2"/><path d="m15 18 2 2"/>',
  x: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
};

function calloutIconSvg(type) {
  const key = CALLOUT_ICON_ALIASES[type] || 'info';
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${CALLOUT_ICONS[key] || CALLOUT_ICONS.info}</svg>`;
}

function stripQuotePrefix(text) {
  return text.replace(/^\s*>\s?/, '');
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

class CalloutBlockWidget extends WidgetType {
  constructor(calloutType, title, bodyText, lineCount, from, to) {
    super();
    this.calloutType = calloutType;
    this.title = title;
    this.bodyText = bodyText;
    this.lineCount = lineCount;
    this.from = from;
    this.to = to;
    this._resizeObserver = null;
  }

  get estimatedHeight() {
    return Math.max(48, this.lineCount * 24);
  }

  eq(other) {
    return (
      other instanceof CalloutBlockWidget &&
      this.calloutType === other.calloutType &&
      this.title === other.title &&
      this.bodyText === other.bodyText &&
      this.from === other.from &&
      this.to === other.to
    );
  }

  toDOM(view) {
    // Wrapper carries the block spacing (padding, so it is part of the
    // measured box — a margin would collapse out and desync the height map).
    // The inner card carries the callout chrome.
    const root = document.createElement('div');
    root.className = 'cm-embed-block cm-callout';
    root.tabIndex = -1;

    const card = document.createElement('div');
    card.className = 'callout';
    card.setAttribute('data-callout', this.calloutType);

    // Title bar
    const titleEl = document.createElement('div');
    titleEl.className = 'callout-title';
    const iconEl = document.createElement('div');
    iconEl.className = 'callout-icon';
    iconEl.innerHTML = calloutIconSvg(this.calloutType);
    const innerTitle = document.createElement('div');
    innerTitle.className = 'callout-title-inner';
    innerTitle.textContent = this.title;
    titleEl.appendChild(iconEl);
    titleEl.appendChild(innerTitle);
    card.appendChild(titleEl);

    // Body content: blank lines separate paragraphs, soft wraps join.
    if (this.bodyText.trim().length > 0) {
      const contentEl = document.createElement('div');
      contentEl.className = 'callout-content';
      for (const para of this.bodyText.split(/\n\s*\n/)) {
        const text = para.replace(/\n/g, ' ').trim();
        if (!text) continue;
        const pEl = document.createElement('p');
        pEl.textContent = text;
        contentEl.appendChild(pEl);
      }
      if (contentEl.childNodes.length > 0) card.appendChild(contentEl);
    }

    root.appendChild(card);

    // Click-to-edit: place the caret inside the block, which makes the state
    // field stop emitting the widget and reveals the raw markdown.
    root.addEventListener('click', (e) => {
      e.preventDefault();
      const pos = Math.min(view.state.doc.length, this.from + 2);
      view.dispatch({ selection: { anchor: pos }, scrollIntoView: false });
      view.focus();
    });

    // Late layout changes (fonts, wrapping, images) re-seed the height map.
    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(() => view.requestMeasure());
      this._resizeObserver.observe(root);
    }
    return root;
  }

  destroy() {
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
  }
}

/**
 * Resolve an image target to a URL the renderer can load.
 * Remote/data/file URLs pass through; relative paths are resolved against the
 * open document's directory (the page itself is `src/index.html`, so leaving
 * them relative would resolve against the wrong folder).
 */
function resolveImageUrl(url) {
  if (/^(?:https?|data|blob|file):/i.test(url)) return url;
  if (/^[A-Za-z]:[\\/]/.test(url)) return 'file:///' + url.replace(/\\/g, '/');
  if (url.startsWith('/')) return url;
  if (!currentDocPath) return url;
  const dir = currentDocPath.replace(/[\\/][^\\/]*$/, '');
  const joined = `${dir}/${url}`.replace(/\\/g, '/');
  return 'file:///' + encodeURI(joined);
}

/**
 * `![alt](url)` → <img>. Supports Obsidian's `![alt|300](url)` and
 * `![alt|300x200](url)` dimension suffixes, and renders as a block when the
 * image is alone on its line (matching Obsidian's positional rule).
 */
class ImageWidget extends WidgetType {
  constructor(url, alt, width, height, from, to, block) {
    super();
    this.url = url;
    this.alt = alt;
    this.width = width;
    this.height = height;
    this.from = from;
    this.to = to;
    this.block = block;
    this._resizeObserver = null;
  }

  get estimatedHeight() {
    // A known height is the best estimate; otherwise reserve a few lines
    // before the resource loads (inline images are one text line tall).
    if (this.height) return Math.max(30, this.height);
    return this.block ? 48 : 30;
  }

  eq(other) {
    return (
      other instanceof ImageWidget &&
      this.url === other.url &&
      this.alt === other.alt &&
      this.width === other.width &&
      this.height === other.height &&
      this.from === other.from &&
      this.to === other.to &&
      this.block === other.block
    );
  }

  toDOM(view) {
    const root = document.createElement(this.block ? 'div' : 'span');
    root.className = this.block ? 'cm-image-block' : 'cm-image-inline';
    root.tabIndex = -1;

    const wrap = document.createElement('span');
    wrap.className = 'image-wrapper';

    const img = document.createElement('img');
    img.alt = this.alt;
    img.draggable = false;
    if (this.width) img.setAttribute('width', String(this.width));
    if (this.height) img.setAttribute('height', String(this.height));

    // Broken resources must not collapse the line: replace the <img> with a
    // badge that keeps a minimum box, then let the observer re-measure.
    const fail = () => {
      if (root.classList.contains('is-broken')) return;
      root.classList.add('is-broken');
      img.remove();
      const badge = document.createElement('span');
      badge.className = 'cm-image-fallback';
      badge.textContent = this.alt || 'Image failed to load';
      wrap.appendChild(badge);
      view.requestMeasure();
    };
    img.addEventListener('error', fail, { once: true });
    img.addEventListener('load', () => view.requestMeasure(), { once: true });
    img.src = resolveImageUrl(this.url);

    wrap.appendChild(img);
    root.appendChild(wrap);

    root.addEventListener('click', (e) => {
      e.preventDefault();
      const pos = Math.min(view.state.doc.length, this.from + 2);
      view.dispatch({ selection: { anchor: pos }, scrollIntoView: false });
      view.focus();
    });

    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(() => view.requestMeasure());
      this._resizeObserver.observe(root);
    }
    return root;
  }

  destroy() {
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
  }
}

// Measured line height of the editor, refreshed by `lineHeightProbe` below.
// The height estimate for a table is expressed in source lines, so it tracks
// the editor's font metrics instead of a hardcoded pixel value.
let editorLineHeight = 28;

// In-grid editing state. Cell editing happens in an <input> overlay, so the
// document selection never enters the table range and the widget stays
// rendered. These values live at module scope because they must survive the
// widget rebuild that follows every commit.
let pendingTableCell = null;   // { table, row, col } to focus after a rebuild
let queuedTableCell = null;    // cell clicked while another cell was editing
let activeTableCellEditor = null;
let activeMathEditor = null;   // { item, card, commit, cancel }
let pendingMathOpen = null;    // block `from` to open after a rebuild
let activeTableMenu = null;
let tableMenuCleanup = null;
let activeMathMenu = null;
let mathMenuCleanup = null;

// Horizontal scroll offset per table, restored across widget rebuilds so
// navigating cells does not snap the table back to the left.
const tableScrollPositions = new Map();

// Rebuilds the embed field for UI-only changes (opening a phantom row,
// cancelling an edit) that do not touch the document or the selection.
const tableCellUiEffect = StateEffect.define();

function tableCellAt(spec, row, col) {
  if (row === -1) return spec.header.cells[col];
  const sourceRow = spec.rows[row];
  return sourceRow ? sourceRow.cells[col] : undefined;
}

/** Next cell for a navigation key; `spec.rows.length` is the phantom row. */
function tableResolveNav(spec, row, col, nav) {
  const colCount = Math.max(1, spec.header.cells.length);
  const rowCount = spec.rows.length;
  const phantom = rowCount;
  switch (nav) {
    case 'enter': {
      // Only Enter may reach the phantom row; navigation never creates rows.
      const next = row + 1;
      return next > phantom ? 'exit-below' : { row: next, col };
    }
    case 'down': {
      const next = row + 1;
      return next >= rowCount ? 'exit-below' : { row: next, col };
    }
    case 'up': {
      const next = row - 1;
      return next < -1 ? 'exit-above' : { row: next, col };
    }
    case 'next': {
      let r = row;
      let c = col + 1;
      if (c >= colCount) { r += 1; c = 0; }
      return r >= rowCount ? 'exit-below' : { row: r, col: c };
    }
    case 'prev': {
      let r = row;
      let c = col - 1;
      if (c < 0) { r -= 1; c = colCount - 1; }
      return r < -1 ? 'exit-above' : { row: r, col: c };
    }
    case 'right':
      return col + 1 < colCount ? { row, col: col + 1 } : null;
    case 'left':
      return col > 0 ? { row, col: col - 1 } : null;
    default:
      return null;
  }
}

function tableExitPosition(spec, doc, direction) {
  if (direction === 'exit-above') {
    return doc.lineAt(Math.max(0, spec.from - 1)).from;
  }
  return doc.lineAt(Math.min(doc.length, spec.to + 1)).from;
}

function tableCellElement(root, row, col) {
  const tr = row === -1
    ? root.querySelector('thead tr')
    : root.querySelectorAll('tbody tr')[row];
  return tr && tr.children[col] ? tr.children[col] : null;
}

function applyTableCellCommit(view, root, spec, row, col, value, nav, changed) {
  // A commit computed against a table that no longer exists at these offsets
  // (undo, another edit) must not write into unrelated text.
  const fresh = scanEmbeds(view.state).tables.find((table) => table.from === spec.from);
  if (!fresh || fresh.key !== spec.key) return;

  const doc = view.state.doc;
  const changes = [];
  let pending = null;
  let exit = null;
  const hadPending = pendingTableCell !== null;

  // Consume the queued cell exactly once; a stale queue must not jump the
  // caret on some later commit.
  if (queuedTableCell && queuedTableCell.table === spec.from) {
    pending = queuedTableCell;
  }
  queuedTableCell = null;

  if (row === spec.rows.length) {
    // Phantom row: it only exists once it has content, so an empty one is
    // discarded by simply not writing anything.
    if (value !== '') {
      const colCount = Math.max(spec.header.cells.length, col + 1);
      const cells = new Array(colCount).fill('');
      cells[col] = value;
      const insertAt = spec.rows.length
        ? spec.rows[spec.rows.length - 1].lineTo
        : spec.delimiterLineTo;
      changes.push({ from: insertAt, to: insertAt, insert: '\n| ' + cells.join(' | ') + ' |' });
      const grown = { header: spec.header, rows: spec.rows.concat([{ cells }]) };
      const target = nav === 'none' ? null : tableResolveNav(grown, spec.rows.length, col, nav);
      if (target === 'exit-below' || target === 'exit-above') {
        exit = tableExitPosition(spec, doc, target);
      } else if (target) {
        pending = { table: spec.from, row: target.row, col: target.col };
      }
    } else if (nav !== 'none') {
      exit = tableExitPosition(spec, doc, 'exit-below');
    }
  } else {
    const sourceCell = tableCellAt(spec, row, col);
    if (sourceCell) {
      if (changed) {
        // Empty cells now span their surrounding spaces; pad the value so the
        // row keeps `| value |` spacing instead of collapsing to `|value|`.
        const insert = sourceCell.text === '' && value !== ''
          ? ' ' + value + ' '
          : value;
        changes.push({ from: sourceCell.from, to: sourceCell.to, insert });
      }
    } else if (row >= 0) {
      // Ragged row: adding a cell rewrites that row in a canonical shape.
      const sourceRow = spec.rows[row];
      const colCount = Math.max(spec.header.cells.length, col + 1);
      const cells = sourceRow.cells.map((cell) => cell.text);
      while (cells.length < colCount) cells.push('');
      cells[col] = value;
      changes.push({
        from: sourceRow.lineFrom,
        to: sourceRow.lineTo,
        insert: '| ' + cells.join(' | ') + ' |',
      });
    }
    if (nav !== 'none') {
      const target = tableResolveNav(spec, row, col, nav);
      if (target === 'exit-below' || target === 'exit-above') {
        exit = tableExitPosition(spec, doc, target);
      } else if (target) {
        pending = { table: spec.from, row: target.row, col: target.col };
      }
    }
  }

  if (exit === null && !pending && changes.length === 0 && !hadPending) {
    // Nothing to write and nowhere to go: closing the editor is enough. Not
    // dispatching avoids a pointless widget rebuild (and its scroll jitter).
    pendingTableCell = null;
    return;
  }

  // Moving to an existing cell with no text change needs no document update:
  // move the editor inside the current DOM instead of rebuilding the table.
  if (exit === null && changes.length === 0 && !hadPending && pending &&
      pending.row < spec.rows.length && pending.row >= -1) {
    const targetEl = tableCellElement(root, pending.row, pending.col);
    if (targetEl) {
      pendingTableCell = null;
      startTableCellEditor(view, root, spec, targetEl, pending.row, pending.col);
      return;
    }
  }

  if (exit !== null) pending = null;

  // Record the undo caret *before* publishing the pending cell: the
  // selection-only dispatch rebuilds the widget, and a pending queue set first
  // would be consumed by that throwaway build, losing the cell the user
  // clicked (and its editor).
  parkTableCaret(view, spec);
  pendingTableCell = pending;

  const transaction = { effects: tableCellUiEffect.of(null) };
  if (exit !== null) {
    // The exit position was computed against the old document; map it so a
    // ragged-row rewrite (which can change line length) cannot land the caret
    // inside the table text.
    const changeSet = view.state.changes(changes);
    transaction.changes = changeSet;
    transaction.selection = { anchor: changeSet.mapPos(exit, 1) };
  } else if (changes.length) {
    transaction.changes = changes;
  }
  view.dispatch(transaction);
  if (exit !== null) view.focus();
}

function startTableCellEditor(view, root, spec, cellEl, row, col, clientX) {
  if (!cellEl || activeTableCellEditor) return;
  const sourceCell = tableCellAt(spec, row, col);
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'cm-table-cell-input';
  input.value = sourceCell ? sourceCell.text : '';
  input.spellcheck = false;
  input.setAttribute('aria-label', 'Table cell');

  cellEl.classList.add('is-editing');
  cellEl.appendChild(input);

  let done = false;
  const closeUi = () => {
    cellEl.classList.remove('is-editing');
    if (input.parentNode) input.parentNode.removeChild(input);
    activeTableCellEditor = null;
  };
  const handle = {
    cellEl,
    commit(nav) {
      if (done) return;
      done = true;
      const value = input.value;
      const original = sourceCell ? sourceCell.text : '';
      closeUi();
      applyTableCellCommit(view, root, spec, row, col, value, nav,
        value !== original || (!sourceCell && value !== ''));
    },
  };
  activeTableCellEditor = handle;

  input.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'Backspace' && e.shiftKey) {
      e.preventDefault();
      if (row >= 0 && spec.rows[row]) {
        const rowSource = spec.rows[row];
        const hasContent = input.value.trim() !== '' ||
          rowSource.cells.some((cell) => cell.text.trim() !== '');
        if (!hasContent || window.confirm('Delete this row?')) {
          done = true;
          closeUi();
          // Move the editor to the row that takes the deleted row's place
          // instead of focusing the document (which would scroll to the
          // unrelated text selection).
          const remaining = spec.rows.length - 1;
          const target = remaining === 0 ? 0 : Math.min(row, remaining - 1);
          pendingTableCell = { table: spec.from, row: target, col };
          tableDeleteRow(view, spec, row);
        }
      }
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      handle.commit(e.shiftKey ? 'up' : 'enter');
    } else if (e.key === 'Tab') {
      e.preventDefault();
      handle.commit(e.shiftKey ? 'prev' : 'next');
    } else if (e.key === 'Escape') {
      e.preventDefault();
      done = true;
      closeUi();
      pendingTableCell = null;
      view.dispatch({ effects: tableCellUiEffect.of(null) });
      view.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      handle.commit('down');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      handle.commit('up');
    } else if (e.key === 'ArrowLeft' && input.selectionStart === 0 && input.selectionEnd === 0) {
      e.preventDefault();
      // At the table's edge stay in the cell instead of closing the editor and
      // handing the key to the document (which caused cursor loss + scrolling).
      if (tableResolveNav(spec, row, col, 'left')) handle.commit('left');
    } else if (e.key === 'ArrowRight' &&
               input.selectionStart === input.value.length &&
               input.selectionEnd === input.value.length) {
      e.preventDefault();
      if (tableResolveNav(spec, row, col, 'right')) handle.commit('right');
    }
  });
  input.addEventListener('blur', () => { if (!done) handle.commit('none'); });

  requestAnimationFrame(() => {
    if (!input.isConnected) return;
    input.focus({ preventScroll: true });
    const length = input.value.length;
    let caret = length;
    // Park the caret near the click instead of always at the end.
    if (typeof clientX === 'number') {
      const rect = cellEl.getBoundingClientRect();
      const gutter = 14;
      const usable = Math.max(1, rect.width - gutter * 2);
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left - gutter) / usable));
      caret = Math.round(ratio * length);
    }
    try { input.setSelectionRange(caret, caret); } catch (err) { /* older engines */ }
  });
}

function revealTableSource(view, spec) {
  pendingTableCell = null;
  view.dispatch({
    selection: { anchor: Math.min(view.state.doc.length, spec.from + 2) },
    effects: tableCellUiEffect.of(null),
  });
  view.focus();
}

/**
 * GFM table rendered as one block widget for the whole contiguous table.
 * Cells are edited through an input overlay; the widget itself stays rendered
 * because the document selection never enters the table range.
 * The DOM is built node-by-node (no innerHTML) so cell content cannot inject
 * markup.
 */
function tableRowText(cells) {
  return '| ' + cells.join(' | ') + ' |';
}

function tableNormalizedCells(spec, row) {
  const colCount = Math.max(1, spec.header.cells.length);
  const source = row === -1 ? spec.header.cells : (spec.rows[row] ? spec.rows[row].cells : []);
  const cells = source.map((cell) => cell.text);
  while (cells.length < colCount) cells.push('');
  return cells;
}

/**
 * Re-scan and confirm the table a menu was opened on is still byte-identical.
 * A captured spec holds character offsets; if the document changes while the
 * menu is open (undo, typing elsewhere) those offsets point into the wrong
 * text and a rewrite would corrupt neighbouring lines.
 */
function resolveTableSpec(view, spec) {
  const fresh = scanEmbeds(view.state).tables.find((table) => table.from === spec.from);
  return fresh && fresh.key === spec.key ? fresh : null;
}

/**
 * Nearest caret position outside a replaced range, so focusing the editor
 * never un-conceals the construct and never lands inside it.
 */
function caretAnchorOutside(doc, from, to) {
  if (from > 0) return doc.lineAt(from - 1).from;
  if (to < doc.length) return doc.lineAt(Math.min(doc.length, to + 1)).from;
  return 0;
}

function parkCaretOutside(view, from, to) {
  const anchor = caretAnchorOutside(view.state.doc, from, to);
  const main = view.state.selection.main;
  if (main.empty && main.head === anchor) return;
  view.dispatch({ selection: { anchor }, scrollIntoView: false });
}

/** Focus the editor without scrolling to a caret that may be far away. */
function focusEditorWithoutScroll(view) {
  const scroller = view.scrollDOM;
  const top = scroller.scrollTop;
  if (document.activeElement !== view.contentDOM) {
    view.contentDOM.focus({ preventScroll: true });
  }
  scroller.scrollTop = top;
}

function tableCaretAnchor(doc, spec) {
  return caretAnchorOutside(doc, spec.from, spec.to);
}

/**
 * Move the caret next to the table *before* an edit, in its own selection-only
 * transaction. CodeMirror's history restores the selection recorded before a
 * change, so a caret set inside the change transaction is ignored on undo —
 * which is why undo used to jump to whatever stale position (usually 0) the
 * document selection had. Selection-only transactions are not undo steps.
 */
function parkTableCaret(view, spec) {
  const anchor = tableCaretAnchor(view.state.doc, spec);
  const main = view.state.selection.main;
  if (main.empty && main.head === anchor) return;
  view.dispatch({ selection: { anchor }, scrollIntoView: false });
}

/** Reject out-of-range or overlapping edit sets before CM6 sees them. */
function dispatchTableChanges(view, spec, changes) {
  const length = view.state.doc.length;
  const sorted = changes.slice().sort((a, b) => a.from - b.from);
  let lastTo = -1;
  for (const change of sorted) {
    if (change.from < 0 || change.to > length || change.from > change.to) return;
    if (change.from < lastTo) return;
    lastTo = Math.max(lastTo, change.to);
  }

  parkTableCaret(view, spec);
  const scroller = view.scrollDOM;
  const scrollTop = scroller.scrollTop;
  view.dispatch({
    changes: view.state.changes(sorted),
    scrollIntoView: false,
    userEvent: 'input.table',
  });
  // Put focus back without letting the browser scroll to the new caret.
  if (!view.hasFocus) view.contentDOM.focus({ preventScroll: true });
  scroller.scrollTop = scrollTop;
}

function tableInsertRow(view, spec, row, below) {
  const colCount = Math.max(1, spec.header.cells.length);
  const text = tableRowText(new Array(colCount).fill(''));
  let position;
  if (row === -1) {
    position = spec.delimiter.lineTo;    // header context: first data row
  } else {
    position = below ? spec.rows[row].lineTo : spec.rows[row].lineFrom;
  }
  const insert = (row === -1 || below) ? '\n' + text : text + '\n';
  dispatchTableChanges(view, spec, [{ from: position, to: position, insert }]);
}

function tableDeleteRow(view, spec, row) {
  if (row < 0 || !spec.rows[row]) return;
  const line = spec.rows[row];
  const from = row === 0 ? spec.delimiter.lineTo : line.lineFrom - 1;
  dispatchTableChanges(view, spec, [{ from, to: line.lineTo }]);
}

function tableMutateColumns(view, spec, col, mode) {
  const colCount = Math.max(1, spec.header.cells.length);
  if (mode === 'delete' && colCount <= 1) return;

  const transform = (cells, isDelimiter) => {
    const list = cells.slice();
    if (mode === 'delete') {
      list.splice(col, 1);
    } else {
      const at = mode === 'insert-left' ? col : col + 1;
      list.splice(at, 0, isDelimiter ? '---' : '');
    }
    return tableRowText(list);
  };

  const changes = [
    {
      from: spec.header.lineFrom,
      to: spec.header.lineTo,
      insert: transform(tableNormalizedCells(spec, -1), false),
    },
    {
      from: spec.delimiter.lineFrom,
      to: spec.delimiter.lineTo,
      insert: transform(spec.delimiter.cells.map((cell) => cell.text), true),
    },
  ];
  spec.rows.forEach((rowSource, index) => {
    changes.push({
      from: rowSource.lineFrom,
      to: rowSource.lineTo,
      insert: transform(tableNormalizedCells(spec, index), false),
    });
  });
  dispatchTableChanges(view, spec, changes);
}

function tableSetColumnAlignment(view, spec, col, alignment) {
  const token = alignment === 'center' ? ':---:' : alignment === 'right' ? '---:' : ':---';
  const cells = spec.delimiter.cells.map((cell) => cell.text);
  while (cells.length <= col) cells.push('---');
  cells[col] = token;
  dispatchTableChanges(view, spec, [{
    from: spec.delimiter.lineFrom,
    to: spec.delimiter.lineTo,
    insert: tableRowText(cells),
  }]);
}

function closeTableMenu() {
  if (activeTableMenu) {
    activeTableMenu.remove();
    activeTableMenu = null;
  }
  if (tableMenuCleanup) {
    tableMenuCleanup();
    tableMenuCleanup = null;
  }
}

// An open menu holds character offsets from the document at open time. Any
// document change (undo, typing, another edit) invalidates them, so the menu
// must disappear rather than act on stale positions.
const tableMenuDismiss = EditorView.updateListener.of((update) => {
  if (update.docChanged) {
    closeTableMenu();
    closeMathMenu();
  }
});

function closeMathMenu() {
  if (activeMathMenu) { activeMathMenu.remove(); activeMathMenu = null; }
  if (mathMenuCleanup) { mathMenuCleanup(); mathMenuCleanup = null; }
}

/** Context menu for a rendered equation: raw source access and copy. */
function openMathMenu(view, item, x, y) {
  closeTableMenu();
  closeMathMenu();
  const menu = document.createElement('div');
  menu.className = 'cm-context-menu menu-section';

  const add = (label, action) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('mousedown', (e) => e.preventDefault());
    button.addEventListener('click', () => { closeMathMenu(); action(); });
    menu.appendChild(button);
  };

  add('Edit source', () => {
    const offset = item.kind === 'block' ? 2 : 1;
    view.dispatch({
      selection: { anchor: Math.min(view.state.doc.length, item.from + offset) },
      scrollIntoView: false,
    });
    view.focus();
  });
  add('Copy TeX', () => { copyToClipboard(item.tex.trim()); });

  menu.style.visibility = 'hidden';
  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)) + 'px';
  menu.style.top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)) + 'px';
  menu.style.visibility = '';
  activeMathMenu = menu;

  const onPointerDown = (event) => { if (!menu.contains(event.target)) closeMathMenu(); };
  const onKeyDown = (event) => {
    if (event.key === 'Escape') { event.preventDefault(); closeMathMenu(); }
  };
  const onDismiss = () => closeMathMenu();
  document.addEventListener('mousedown', onPointerDown, true);
  document.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('scroll', onDismiss, true);
  window.addEventListener('resize', onDismiss);
  window.addEventListener('blur', onDismiss);
  mathMenuCleanup = () => {
    document.removeEventListener('mousedown', onPointerDown, true);
    document.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('scroll', onDismiss, true);
    window.removeEventListener('resize', onDismiss);
    window.removeEventListener('blur', onDismiss);
  };
}

function openTableMenu(view, spec, row, col, x, y) {
  closeTableMenu();
  closeMathMenu();
  const menu = document.createElement('div');
  menu.className = 'cm-context-menu menu-section';

  const add = (label, action, options) => {
    const opts = options || {};
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    if (opts.shortcut) {
      const hint = document.createElement('span');
      hint.className = 'shortcut';
      hint.textContent = opts.shortcut;
      button.appendChild(hint);
    }
    if (opts.disabled) button.disabled = true;
    else {
      // Keep focus in the editor: focusing the menu button would blur the
      // contenteditable, and any later view.focus() would scroll the document
      // back to wherever the (unrelated) text selection still is.
      button.addEventListener('mousedown', (e) => e.preventDefault());
      button.addEventListener('click', () => {
        closeTableMenu();
        // Re-scan: if the document changed while the menu was open (undo, typing),
        // the captured offsets are stale and applying them would corrupt the text.
        const fresh = resolveTableSpec(view, spec);
        if (!fresh) return;
        action(fresh);
      });
    }
    menu.appendChild(button);
  };
  const divider = () => {
    const el = document.createElement('div');
    el.className = 'menu-divider';
    menu.appendChild(el);
  };

  add('Insert row above', (s) => tableInsertRow(view, s, row, false));
  add('Insert row below', (s) => tableInsertRow(view, s, row, true));
  add('Insert column left', (s) => tableMutateColumns(view, s, col, 'insert-left'));
  add('Insert column right', (s) => tableMutateColumns(view, s, col, 'insert-right'));
  divider();
  add('Delete row', (s) => tableDeleteRow(view, s, row),
    { disabled: row < 0, shortcut: 'Shift+Backspace' });
  add('Delete column', (s) => tableMutateColumns(view, s, col, 'delete'),
    { disabled: Math.max(1, spec.header.cells.length) <= 1 });
  divider();
  const current = spec.alignments[col] || 'left';
  add('Align left', (s) => tableSetColumnAlignment(view, s, col, 'left'),
    { disabled: current === 'left' });
  add('Align center', (s) => tableSetColumnAlignment(view, s, col, 'center'),
    { disabled: current === 'center' });
  add('Align right', (s) => tableSetColumnAlignment(view, s, col, 'right'),
    { disabled: current === 'right' });
  divider();
  add('Copy table', (s) => { copyToClipboard(s.key); });
  add('Edit source', (s) => revealTableSource(view, s));

  menu.style.visibility = 'hidden';
  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)) + 'px';
  menu.style.top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)) + 'px';
  menu.style.visibility = '';
  activeTableMenu = menu;

  const onPointerDown = (event) => {
    if (!menu.contains(event.target)) closeTableMenu();
  };
  const onKeyDown = (event) => {
    if (event.key === 'Escape') { event.preventDefault(); closeTableMenu(); }
  };
  const onDismiss = () => closeTableMenu();
  document.addEventListener('mousedown', onPointerDown, true);
  document.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('scroll', onDismiss, true);
  window.addEventListener('resize', onDismiss);
  window.addEventListener('blur', onDismiss);
  tableMenuCleanup = () => {
    document.removeEventListener('mousedown', onPointerDown, true);
    document.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('scroll', onDismiss, true);
    window.removeEventListener('resize', onDismiss);
    window.removeEventListener('blur', onDismiss);
  };
}

class TableBlockWidget extends WidgetType {
  constructor(spec, uiKey) {
    super();
    this.spec = spec;
    this.uiKey = uiKey;
    this._resizeObserver = null;
    this._root = null;
  }

  get estimatedHeight() {
    return Math.max(48, this.spec.lineStarts.length * (editorLineHeight || 28));
  }

  eq(other) {
    // `key` covers the raw source, `uiKey` covers phantom/editor state: equal
    // both means the rendered table would be identical, so the DOM is reused.
    return other instanceof TableBlockWidget &&
      this.spec.from === other.spec.from &&
      this.spec.key === other.spec.key &&
      this.uiKey === other.uiKey;
  }

  toDOM(view) {
    const spec = this.spec;
    const root = document.createElement('div');
    root.className = 'cm-embed-block cm-table-widget';
    root.tabIndex = -1;
    this._root = root;

    const table = document.createElement('table');
    table.className = 'fm-table';
    const colCount = Math.max(1, spec.header.cells.length);

    const buildCell = (tag, index, text) => {
      const cellEl = document.createElement(tag);
      cellEl.style.textAlign = spec.alignments[index] || 'left';
      const inner = document.createElement('div');
      inner.className = 'fm-cell';
      appendInlineMarkdown(inner, text);
      cellEl.appendChild(inner);
      return cellEl;
    };

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    for (let i = 0; i < colCount; i++) {
      const cell = spec.header.cells[i];
      headRow.appendChild(buildCell('th', i, cell ? cell.text : ''));
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const sourceRow of spec.rows) {
      const tr = document.createElement('tr');
      for (let i = 0; i < colCount; i++) {
        const cell = sourceRow.cells[i];
        tr.appendChild(buildCell('td', i, cell ? cell.text : ''));
      }
      tbody.appendChild(tr);
    }
    const pending = pendingTableCell;
    if (pending && pending.table === spec.from && pending.row === spec.rows.length) {
      const tr = document.createElement('tr');
      tr.className = 'cm-table-phantom';
      for (let i = 0; i < colCount; i++) tr.appendChild(buildCell('td', i, ''));
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    // The scroll container is a separate element: paint containment on the
    // widget root clips descendants, so the scroller (and its scrollbar) must
    // live inside that clip to stay visible.
    const scroller = document.createElement('div');
    scroller.className = 'cm-table-scroll';
    scroller.appendChild(table);
    root.appendChild(scroller);

    const savedScroll = tableScrollPositions.get(spec.from) || 0;
    if (savedScroll) scroller.scrollLeft = savedScroll;
    scroller.addEventListener('scroll', () => {
      tableScrollPositions.set(spec.from, scroller.scrollLeft);
    }, { passive: true });

    root.addEventListener('mousedown', (e) => {
      const target = e.target;
      const cellEl = target && target.closest ? target.closest('td,th') : null;
      if (!cellEl || (target.closest && target.closest('input'))) return;
      e.preventDefault();
      const row = cellEl.parentElement.rowIndex - 1;   // header row -> -1
      const col = cellEl.cellIndex;
      if (activeTableCellEditor) {
        if (activeTableCellEditor.cellEl === cellEl) return;
        queuedTableCell = { table: spec.from, row, col };
        activeTableCellEditor.commit('none');
        return;
      }
      startTableCellEditor(view, root, spec, cellEl, row, col, e.clientX);
    });

    // Double-clicking the table's padding is the escape hatch to raw source.
    root.addEventListener('dblclick', (e) => {
      const target = e.target;
      if (target && target.closest && target.closest('td,th')) return;
      revealTableSource(view, spec);
    });

    root.addEventListener('contextmenu', (e) => {
      const target = e.target;
      const cellEl = target && target.closest ? target.closest('td,th') : null;
      if (!cellEl) return;
      e.preventDefault();
      const row = cellEl.parentElement.rowIndex - 1;
      const col = cellEl.cellIndex;
      // Commit any open cell first so the menu operates on current source.
      if (activeTableCellEditor) activeTableCellEditor.commit('none');
      const fresh = scanEmbeds(view.state).tables.find((table) => table.from === spec.from) || spec;
      // A right-click on a phantom row commits it away; clamp to a real row.
      const safeRow = Math.min(row, fresh.rows.length - 1);
      openTableMenu(view, fresh, safeRow, col, e.clientX, e.clientY);
    });

    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(() => view.requestMeasure());
      this._resizeObserver.observe(root);
    }

    const reopen = pendingTableCell;
    if (reopen && reopen.table === spec.from) {
      requestAnimationFrame(() => {
        // A newer build superseded this one; it owns the queue now, so leave
        // `pendingTableCell` intact for it instead of clearing it here.
        if (!root.isConnected) return;
        if (pendingTableCell !== reopen) return;
        const targetRow = reopen.row === -1
          ? root.querySelector('thead tr')
          : root.querySelectorAll('tbody tr')[reopen.row];
        const cellEl = targetRow ? targetRow.children[reopen.col] : null;
        if (!cellEl) return;
        pendingTableCell = null;
        startTableCellEditor(view, root, spec, cellEl, reopen.row, reopen.col);
      });
    }
    return root;
  }

  destroy() {
    closeTableMenu();
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    if (this._root && activeTableCellEditor &&
        this._root.contains(activeTableCellEditor.cellEl)) {
      activeTableCellEditor = null;
      pendingTableCell = null;
    }
  }
}

const lineHeightProbe = ViewPlugin.fromClass(class {
  constructor(view) { editorLineHeight = view.defaultLineHeight || 28; }
  update(update) { editorLineHeight = update.view.defaultLineHeight || 28; }
});

function renderMathHtml(tex, displayMode) {
  try {
    return katex.renderToString(tex, {
      displayMode,
      throwOnError: false,
      strict: false,
      trust: false,
    });
  } catch (err) {
    return null;
  }
}

/**
 * Single-dollar spans on one line. Double-dollar runs are left to the block
 * detector, and escaped `\$` is skipped.
 */
function scanInlineMath(text) {
  const spans = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === '\\') { i += 2; continue; }
    if (text[i] !== '$') { i++; continue; }
    let run = 0;
    while (text[i + run] === '$') run++;
    if (run >= 2) { i += run; continue; }

    let j = i + 1;
    let closed = -1;
    while (j < text.length) {
      if (text[j] === '\\') { j += 2; continue; }
      if (text[j] === '$') {
        let closeRun = 0;
        while (text[j + closeRun] === '$') closeRun++;
        if (closeRun === 1) { closed = j; break; }
        j += closeRun;
        continue;
      }
      j++;
    }
    if (closed === -1) { i++; continue; }
    spans.push({ start: i, end: closed + 1, tex: text.slice(i + 1, closed) });
    i = closed + 1;
  }
  return spans;
}

class MathInlineWidget extends WidgetType {
  constructor(item) {
    super();
    this.item = item;
  }

  get estimatedHeight() { return 24; }

  eq(other) {
    return other instanceof MathInlineWidget &&
      this.item.tex === other.item.tex &&
      this.item.from === other.item.from &&
      this.item.to === other.item.to;
  }

  toDOM(view) {
    const el = document.createElement('span');
    const html = renderMathHtml(this.item.tex, false);
    el.className = 'cm-math-inline';
    if (!html || html.includes('katex-error')) el.classList.add('cm-math-error');
    if (html) el.innerHTML = html;
    else el.textContent = this.item.tex;
    el.title = this.item.tex;
    el.addEventListener('mousedown', (e) => e.preventDefault());
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openMathMenu(view, this.item, e.clientX, e.clientY);
    });
    el.addEventListener('click', (e) => {
      e.preventDefault();
      view.dispatch({
        selection: { anchor: Math.min(view.state.doc.length, this.item.from + 1) },
        scrollIntoView: false,
      });
      view.focus();
    });
    return el;
  }
}

/**
 * In-place TeX editor for one block equation. The card stays rendered while a
 * textarea overlays it and KaTeX re-renders the draft underneath, so editing
 * never collapses the block into raw source. Commit on Esc-click-away,
 * Cmd/Ctrl+Enter, or blur; one transaction, one undo step.
 */
function openMathEditor(view, card, formula, item) {
  if (activeMathEditor) {
    if (activeMathEditor.item.from === item.from) return;
    // Another block is being edited: let it commit, then reopen on the rebuilt
    // DOM (this card is about to be replaced).
    pendingMathOpen = item.from;
    activeMathEditor.commit();
    return;
  }

  const editor = document.createElement('div');
  editor.className = 'cm-math-editor';

  const area = document.createElement('textarea');
  area.className = 'cm-math-input';
  area.value = item.tex.replace(/^\n+|\n+$/g, '');
  area.spellcheck = false;
  area.rows = Math.max(3, Math.min(14, area.value.split('\n').length + 1));
  area.setAttribute('aria-label', 'TeX source');

  const preview = document.createElement('div');
  preview.className = 'cm-math-preview';

  editor.appendChild(area);
  editor.appendChild(preview);
  card.appendChild(editor);
  card.classList.add('is-editing');
  formula.style.display = 'none';

  const syncPreviewScroll = () => {
    preview.classList.toggle(
      'is-scrollable', preview.scrollWidth > preview.clientWidth + 2);
  };

  const updatePreview = () => {
    const html = renderMathHtml(area.value, true);
    if (!html || html.includes('katex-error')) preview.classList.add('cm-math-error');
    else preview.classList.remove('cm-math-error');
    preview.innerHTML = html || '';
    requestAnimationFrame(syncPreviewScroll);
    area.style.height = 'auto';
    area.style.height = Math.min(360, Math.max(72, area.scrollHeight)) + 'px';
  };
  updatePreview();

  let done = false;
  const closeUi = () => {
    card.classList.remove('is-editing');
    formula.style.display = '';
    if (editor.parentNode) editor.parentNode.removeChild(editor);
    activeMathEditor = null;
  };

  const commit = (focusAfter = true) => {
    if (done) return;
    done = true;
    const tex = area.value.replace(/\s+$/, '');
    closeUi();
    if (tex.trim() === item.tex.trim()) {
      if (focusAfter) focusEditorWithoutScroll(view);
      return;
    }
    // An empty draft means "cancel" rather than an empty `$$` block.
    if (!tex.trim()) {
      if (focusAfter) focusEditorWithoutScroll(view);
      return;
    }
    const text = item.singleLine ? '$$' + tex + '$$' : '$$\n' + tex + '\n$$';
    parkCaretOutside(view, item.lineFrom, item.lineTo);
    view.dispatch({
      changes: { from: item.lineFrom, to: item.lineTo, insert: text },
      userEvent: 'input.math',
    });
    if (focusAfter) focusEditorWithoutScroll(view);
  };

  const cancel = () => {
    if (done) return;
    done = true;
    closeUi();
    focusEditorWithoutScroll(view);
  };

  activeMathEditor = { item, card, commit, cancel };

  area.addEventListener('input', updatePreview);
  area.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      commit();
    }
  });
  area.addEventListener('blur', () => { if (!done) commit(false); });

  requestAnimationFrame(() => {
    if (!area.isConnected) return;
    area.focus({ preventScroll: true });
    const end = area.value.length;
    try { area.setSelectionRange(end, end); } catch (err) { /* older engines */ }
    updatePreview();
  });
}

class MathBlockWidget extends WidgetType {
  constructor(item) {
    super();
    this.item = item;
    this._resizeObserver = null;
    this._root = null;
  }

  get estimatedHeight() {
    return Math.max(72, (this.item.lineCount || 1) * 24);
  }

  eq(other) {
    return other instanceof MathBlockWidget &&
      this.item.tex === other.item.tex &&
      this.item.from === other.item.from &&
      this.item.to === other.item.to;
  }

  toDOM(view) {
    const root = document.createElement('div');
    root.className = 'cm-embed-block cm-math-block';
    this._root = root;

    const card = document.createElement('div');
    card.className = 'cm-math-card';

    const formula = document.createElement('div');
    formula.className = 'cm-math-render';
    const html = renderMathHtml(this.item.tex, true);
    if (!html || html.includes('katex-error')) formula.classList.add('cm-math-error');
    if (html) formula.innerHTML = html;
    else formula.textContent = this.item.tex;

    const copy = document.createElement('span');
    copy.className = 'cm-math-copy';
    copy.textContent = 'TEX';
    copy.title = 'Copy TeX';
    copy.addEventListener('mousedown', (e) => e.preventDefault());
    copy.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      copyToClipboard(this.item.tex.trim()).then((ok) => {
        if (!ok) return;
        copy.textContent = 'Copied';
        copy.classList.add('is-copied');
        setTimeout(() => {
          copy.textContent = 'TEX';
          copy.classList.remove('is-copied');
        }, 1200);
      });
    });

    formula.addEventListener('mousedown', (e) => e.preventDefault());
    formula.addEventListener('click', (e) => {
      e.preventDefault();
      openMathEditor(view, card, formula, this.item);
    });

    card.addEventListener('contextmenu', (e) => {
      // While the overlay is open let the textarea keep its native menu.
      if (activeMathEditor) return;
      e.preventDefault();
      openMathMenu(view, this.item, e.clientX, e.clientY);
    });

    // Wide equations scroll here rather than widening the document.
    const scroller = document.createElement('div');
    scroller.className = 'cm-math-scroll';
    scroller.appendChild(formula);
    card.appendChild(scroller);
    card.appendChild(copy);
    root.appendChild(card);

    // Only enable overflow when the formula really is wider than the card:
    // fractional metrics under centred layout could otherwise paint a
    // scrollbar under formulas that fit.
    const syncScroll = () => {
      scroller.classList.toggle(
        'is-scrollable', scroller.scrollWidth > scroller.clientWidth + 2);
    };
    requestAnimationFrame(syncScroll);
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(syncScroll).catch(() => {});
    }

    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(() => {
        syncScroll();
        view.requestMeasure();
      });
      this._resizeObserver.observe(root);
    }

    if (pendingMathOpen === this.item.from) {
      pendingMathOpen = null;
      requestAnimationFrame(() => {
        if (!root.isConnected) return;
        openMathEditor(view, card, formula, this.item);
      });
    }
    return root;
  }

  destroy() {
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    if (this._root && activeMathEditor && this._root.contains(activeMathEditor.card)) {
      activeMathEditor = null;
      pendingMathOpen = null;
    }
  }
}

/**
 * Scan the document for `> [!TYPE]` blocks, images, GFM tables and math.
 *
 * Document-wide rather than viewport-limited: the field must also know about
 * embeds just outside the viewport so their block height is reserved before
 * they scroll into view (height-map stability). Fenced code is skipped, and a
 * callout or table consumes its own lines so nested content is not rescanned.
 */
function scanEmbeds(state) {
  const doc = state.doc;
  const callouts = [];
  const images = [];
  const tables = [];
  const math = [];
  let inFence = false;

  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    const text = line.text;

    // Fenced code is verbatim: no callouts, no images.
    if (FENCE_RE.test(text)) { inFence = !inFence; continue; }
    if (inFence) continue;

    if (text.indexOf('[!') !== -1) {
      const match = CALLOUT_HEADER_RE.exec(text);
      if (match) {
        const type = match[1].toLowerCase();
        const title = (match[2] || '').trim() || capitalize(type);

        let last = line;
        const body = [];
        let k = n + 1;
        while (k <= doc.lines) {
          const next = doc.line(k);
          if (!CALLOUT_LINE_RE.test(next.text)) break;
          body.push(stripQuotePrefix(next.text));
          last = next;
          k++;
        }

        callouts.push({
          type,
          title,
          bodyText: body.join('\n'),
          lineCount: last.number - line.number + 1,
          from: line.from,
          to: last.to,
        });
        n = last.number;
        continue;   // images inside a callout body are part of the block
      }
    }

    // GFM table: a header row, a delimiter row, then contiguous pipe rows.
    if (text.indexOf('|') !== -1 && n < doc.lines) {
      const delimiter = doc.line(n + 1);
      if (delimiter.text.indexOf('|') !== -1 && TABLE_DELIM_RE.test(delimiter.text)) {
        const alignments = parseTableAlignments(delimiter.text);
        const dataRows = [];
        const lineStarts = [line.from, delimiter.from];
        let last = delimiter;
        let k = n + 2;
        while (k <= doc.lines) {
          const row = doc.line(k);
          if (row.text.indexOf('|') === -1 || row.text.trim() === '') break;
          dataRows.push({
            lineFrom: row.from,
            lineTo: row.to,
            cells: splitTableRowRanges(row.text, row.from),
          });
          lineStarts.push(row.from);
          last = row;
          k++;
        }
        tables.push({
          from: line.from,
          to: last.to,
          key: doc.sliceString(line.from, last.to),
          alignments,
          header: {
            lineFrom: line.from,
            lineTo: line.to,
            cells: splitTableRowRanges(text, line.from),
          },
          rows: dataRows,
          delimiter: {
            lineFrom: delimiter.from,
            lineTo: delimiter.to,
            cells: splitTableRowRanges(delimiter.text, delimiter.from),
          },
          delimiterLineTo: delimiter.to,
          lineStarts,
        });
        n = last.number;
        continue;
      }
    }

    // Display math: a line starting with `$$`, closed by a line ending in `$$`.
    const trimmedLine = text.trim();
    if (trimmedLine.startsWith('$$')) {
      const openIndex = text.indexOf('$$');
      let closeLine = null;
      let tex = null;
      const sameLineRest = text.slice(openIndex + 2);
      if (sameLineRest.trimEnd().endsWith('$$')) {
        closeLine = line;
        tex = text.slice(openIndex + 2, text.lastIndexOf('$$'));
      } else {
        for (let k = n + 1; k <= doc.lines; k++) {
          const candidate = doc.line(k);
          if (candidate.text.trimEnd().endsWith('$$')) {
            closeLine = candidate;
            tex = doc.sliceString(line.from + openIndex + 2, candidate.from + candidate.text.lastIndexOf('$$'));
            break;
          }
        }
      }
      if (closeLine && tex !== null) {
        math.push({
          kind: 'block',
          from: line.from,
          to: closeLine.to,
          lineFrom: line.from,
          lineTo: closeLine.to,
          lineCount: closeLine.number - line.number + 1,
          singleLine: closeLine.number === line.number,
          tex,
        });
        n = closeLine.number;
        continue;
      }
      // Unterminated `$$`: leave the text alone rather than swallowing the doc.
    }

    if (text.indexOf('$') !== -1) {
      for (const span of scanInlineMath(text)) {
        // `$...$` inside an inline-code span is literal text.
        const before = text.slice(0, span.start).replace(/\\`/g, '');
        if (((before.match(/`/g) || []).length & 1) === 1) continue;
        math.push({
          kind: 'inline',
          from: line.from + span.start,
          to: line.from + span.end,
          tex: span.tex,
        });
      }
    }

    if (text.indexOf('![') === -1) continue;

    IMAGE_RE.lastIndex = 0;
    let match;
    while ((match = IMAGE_RE.exec(text)) !== null) {
      // Escaped `!\[` is literal text, not an image.
      if (match.index > 0 && text[match.index - 1] === '\\') continue;

      // `![alt](url)` written inside an inline-code span is documentation, not
      // an image. An odd number of unescaped backticks before the match means
      // the match is inside a span that is still open.
      const before = text.slice(0, match.index).replace(/\\`/g, '');
      if (((before.match(/`/g) || []).length & 1) === 1) continue;

      const from = line.from + match.index;
      const to = from + match[0].length;

      // Alt text may carry an Obsidian size suffix: `alt|300` / `alt|300x200`.
      let alt = match[1];
      let width = null;
      let height = null;
      const pipe = alt.lastIndexOf('|');
      if (pipe !== -1) {
        const dims = /^(\d+)(?:\s*x\s*(\d+))?$/.exec(alt.slice(pipe + 1).trim());
        if (dims) {
          width = Number(dims[1]);
          height = dims[2] ? Number(dims[2]) : null;
          alt = alt.slice(0, pipe);
        }
      }

      // Target may be `<url>` or `url "title"`.
      let url = match[2].trim();
      if (url.startsWith('<') && url.endsWith('>')) {
        url = url.slice(1, -1);
      } else {
        const titled = /^(\S+)\s+["'].*["']$/.exec(url);
        if (titled) url = titled[1];
      }
      if (!url) continue;

      const aloneOnLine =
        text.slice(0, match.index).trim() === '' &&
        text.slice(match.index + match[0].length).trim() === '';

      images.push({
        url,
        alt: alt.trim(),
        width,
        height,
        from,
        to,
        block: aloneOnLine,
        lineFrom: line.from,
        lineTo: line.to,
      });
    }
  }

  // Math and images can nest in each other's source text (`![$x$](url)`,
  // `$![a](b)$`). Only one replacement may own a range, so the image wins for
  // alt text and the inner math span is dropped.
  const keptMath = math.filter((item) =>
    !images.some((image) => item.from < image.to && item.to > image.from));
  const keptImages = images.filter((image) =>
    !keptMath.some((item) => image.from < item.to && image.to > item.from));
  return { callouts, images: keptImages, tables, math: keptMath };
}

function buildEmbedDecos(state) {
  const ranges = [];
  const { callouts, images, tables, math } = scanEmbeds(state);
  const selection = state.selection.ranges;

  for (const block of callouts) {
    // "Don't emit" un-concealment: selection inside the block reveals source.
    if (rangeTouches(selection, block.from, block.to)) continue;
    ranges.push(Decoration.replace({
      widget: new CalloutBlockWidget(
        block.type, block.title, block.bodyText, block.lineCount, block.from, block.to),
      block: true,
    }).range(block.from, block.to));
  }

  for (const table of tables) {
    if (rangeTouches(selection, table.from, table.to)) continue;
    const pending = pendingTableCell;
    const uiKey = pending && pending.table === table.from
      ? pending.row + ':' + pending.col
      : '';
    ranges.push(Decoration.replace({
      widget: new TableBlockWidget(table, uiKey),
      block: true,
    }).range(table.from, table.to));
  }

  for (const item of math) {
    if (rangeTouches(selection, item.from, item.to)) continue;
    if (item.kind === 'block') {
      ranges.push(Decoration.replace({
        widget: new MathBlockWidget(item),
        block: true,
      }).range(item.lineFrom, item.lineTo));
    } else {
      ranges.push(Decoration.replace({
        widget: new MathInlineWidget(item),
      }).range(item.from, item.to));
    }
  }

  // A queued math edit whose block moved (an earlier edit changed its offset)
  // must not linger and reopen on an unrelated formula later.
  if (pendingMathOpen !== null && !math.some((item) => item.from === pendingMathOpen)) {
    pendingMathOpen = null;
  }

  for (const image of images) {
    if (rangeTouches(selection, image.from, image.to)) continue;
    const widget = new ImageWidget(
      image.url, image.alt, image.width, image.height, image.from, image.to, image.block);
    if (image.block) {
      // Block images must cover whole lines; the widget keeps the image
      // centred while the source line (including trailing spaces) is hidden.
      ranges.push(Decoration.replace({ widget, block: true })
        .range(image.lineFrom, image.lineTo));
    } else {
      ranges.push(Decoration.replace({ widget }).range(image.from, image.to));
    }
  }

  return Decoration.set(ranges, true);
}

const embedField = StateField.define({
  create: (state) => buildEmbedDecos(state),
  update(deco, tr) {
    if (!tr.docChanged && !tr.selection &&
        !tr.effects.some((effect) => effect.is(tableCellUiEffect))) {
      return deco;
    }
    return buildEmbedDecos(tr.state);
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** True when `pos` sits inside a currently rendered embed (callout or image). */
function embedCovers(state, pos) {
  const decos = state.field(embedField, false);
  if (!decos) return false;
  // Probe a one-character interval rather than [pos, pos]: a zero-length
  // query is exclusive at a range's start, so a node sitting exactly on the
  // block's first position would otherwise slip through.
  const to = Math.min(state.doc.length, pos + 1);
  let hit = false;
  decos.between(pos, to, () => { hit = true; return false; });
  return hit;
}

// ── Highlight style — theme-aware via Compartment ─────────────────────────────
const highlightCompartment = new Compartment();

function makeHighlight(isDark, accentColor) {
  const accent = accentColor || (isDark ? '#7cb8f0' : '#3a7bd5');
  const h1   = isDark ? '#f0f0f0' : '#111111';
  const h2   = isDark ? '#ebebeb' : '#1a1a1a';
  const h3   = isDark ? '#e0e0e0' : '#222222';
  const bold = isDark ? '#f0f0f0' : '#111111';
  const quot = isDark ? '#bcbcbc' : '#6b6b5c';
  const sep  = isDark ? '#444'    : '#cccccc';
  const url  = isDark ? '#555'    : '#aaaaaa';
  return syntaxHighlighting(HighlightStyle.define([
    // Heading metrics live on the heading text span, which survives token
    // concealment. Because the span keeps its font-size and line-height
    // whether the `#` marker is shown or hidden, the line box cannot change.
    { tag: t.heading1, fontSize: '2em',   lineHeight: '1.3',  fontWeight: '700', color: h1, textDecoration: 'none' },
    { tag: t.heading2, fontSize: '1.5em', lineHeight: '1.35', fontWeight: '700', color: h2, textDecoration: 'none' },
    { tag: t.heading3, fontSize: '1.2em', lineHeight: '1.4',  fontWeight: '700', color: h3, textDecoration: 'none' },
    { tag: t.strong,   fontWeight: '700', color: bold },
    { tag: t.emphasis, fontStyle: 'italic' },
    { tag: t.monospace, fontFamily: "'Cascadia Code','Fira Code','Consolas',monospace" },
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

// List markers are *marked*, never replaced. A `-` → `•` widget swap changes
// the glyph's advance width, which reflows wrapped lines and perturbs the
// height map on the active line. Keeping the original character in the flow
// and restyling it with CSS leaves the line box byte-identical.
//
// The mark is emitted on active lines too (only its colour changes): the mark
// also carries the fixed-width marker box that the hanging indent aligns to.
// Dropping it on the active line would change the advance width and shift the
// whole paragraph horizontally — the same jitter class, just triggered by the
// caret instead of by scroll.
const LIST_MARK_DECO = {
  bullet:       Decoration.mark({ class: 'cm-list-mark cm-list-mark-bullet' }),
  bulletActive: Decoration.mark({ class: 'cm-list-mark cm-list-mark-bullet cm-list-mark-active' }),
  number:       Decoration.mark({ class: 'cm-list-mark cm-list-mark-number' }),
  numberActive: Decoration.mark({ class: 'cm-list-mark cm-list-mark-number cm-list-mark-active' }),
};
const MAX_LIST_DEPTH = 4;

/**
 * Nesting depth from the syntax tree, not from the source spaces: a 4-space
 * indent, a 2-space indent and a tab all mean "one level deeper" to the parser,
 * and the parser's notion is the one that matches the rendered structure.
 */
function listItemDepth(node) {
  let depth = 0;
  for (let cur = node.parent; cur; cur = cur.parent) {
    if (cur.name === 'ListItem') depth++;
  }
  return Math.max(0, Math.min(MAX_LIST_DEPTH, depth - 1));
}

const bulletPlugin = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = this.compute(view); }
  update(update) { updateDecorations(this, update); }

  compute(view) {
    const tree = viewportTree(view);
    const doc = view.state.doc;
    /** line.from -> { lineFrom, markFrom, markTo, indentStart, depth, isTask } */
    const lines = new Map();

    forEachVisibleNode(view, tree, (node) => {
      const name = node.type.name;
      if (embedCovers(view.state, node.from)) return;
      if (name === 'TaskMarker') {
        const info = lines.get(doc.lineAt(node.from).from);
        if (info) info.isTask = true;
        return;
      }
      if (name !== 'ListMark') return;

      const line = doc.lineAt(node.from);
      if (lines.has(line.from)) return;             // first marker on the line wins

      // Indentation beyond any blockquote prefix becomes a depth class; the
      // source spaces themselves are concealed so indentation is pure CSS and
      // wrapped lines can align to a column rather than to raw spaces.
      const quoteEnd = line.from + quotePrefixLength(line.text);
      const depth = listItemDepth(node.node);
      lines.set(line.from, {
        lineFrom: line.from,
        markFrom: node.from,
        markTo: node.to,
        indentStart: quoteEnd,
        depth,
        isTask: false,
      });
    });

    const decos = [];
    for (const info of lines.values()) {
      // Line decoration is unconditional: it carries the hanging indent and is
      // identical on active and inactive lines, so the caret cannot reflow it.
      decos.push(Decoration.line({ class: `cm-list-line cm-list-depth-${info.depth}` })
        .range(info.lineFrom));

      if (info.indentStart < info.markFrom) {
        decos.push(HIDE.range(info.indentStart, info.markFrom));   // source indent
      }

      if (info.isTask) continue;                     // checkbox plugin owns the dash

      // Swallow the gap after the marker so the fixed-width marker box is the
      // only spacing before the item text.
      const gapEnd = skipSpaces(doc, info.markTo);
      if (gapEnd > info.markTo) decos.push(HIDE.range(info.markTo, gapEnd));

      const marker = doc.sliceString(info.markFrom, info.markTo);
      const isBullet = marker === '-' || marker === '*' || marker === '+';
      const active = lineIsActive(view, info.markFrom);
      const key = (isBullet ? 'bullet' : 'number') + (active ? 'Active' : '');
      decos.push(LIST_MARK_DECO[key].range(info.markFrom, info.markTo));
    }
    return Decoration.set(decos, true);
  }
}, { decorations: v => v.decorations });

// ── Checkbox widget ───────────────────────────────────────────────────────────
// The only remaining WidgetType. It is inline, fixed-size and reports
// `estimatedHeight = 0`, so CodeMirror excludes it from height estimation
// (`heightRelevant` requires an estimate >= 5px) while still measuring it.
class CheckboxWidget extends WidgetType {
  constructor(checked, from) { super(); this.checked = checked; this.from = from; }

  // `from` participates in equality: the DOM handler closes over this offset,
  // so a widget moved by an edit must be rebuilt rather than silently reused.
  eq(other) { return other.checked === this.checked && other.from === this.from; }

  get estimatedHeight() { return 0; }

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
  update(update) { updateDecorations(this, update); }

  compute(view) {
    const tree = viewportTree(view);
    const doc = view.state.doc;
    const listMarks = new Map();   // line number -> ListMark range
    const tasks = [];

    forEachVisibleNode(view, tree, (node) => {
      const name = node.type.name;
      // A rendered callout replaces these lines wholesale; decorating inside a
      // block replacement would overlap it.
      if (embedCovers(view.state, node.from)) return;
      if (name === 'ListMark') {
        listMarks.set(doc.lineAt(node.from).number, { from: node.from, to: node.to });
      } else if (name === 'TaskMarker') {
        const text = doc.sliceString(node.from, node.to);
        tasks.push({
          from: node.from,
          to: node.to,
          checked: text.toLowerCase() === '[x]',
          line: doc.lineAt(node.from).number,
        });
      }
    });

    const decos = [];
    for (const t of tasks) {
      // Active task line: emit nothing, so the raw `- [ ]` / `- [x]` source is
      // rendered and fully editable instead of hosting a checkbox widget.
      if (lineIsActive(view, t.from)) continue;
      // The dash is concealed with an empty replace (no DOM node), not a
      // display:none widget: a widget would still be a layout participant.
      const listMark = listMarks.get(t.line);
      // Conceal the dash *and* the gap after it: `- [ ]` must not leave a
      // space between the line start and the checkbox.
      if (listMark) {
        decos.push(HIDE.range(listMark.from, skipSpaces(doc, listMark.to)));
      }
      decos.push(Decoration.replace({ widget: new CheckboxWidget(t.checked, t.from) })
        .range(t.from, t.to));
    }
    return Decoration.set(decos, true);
  }
}, { decorations: v => v.decorations });

// ── Note linking — [[filename]] ───────────────────────────────────────────────
const noteLinkMark = Decoration.mark({ class: 'cm-note-link' });

const noteLinkPlugin = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = this.compute(view); }
  update(update) { updateDecorations(this, update); }

  compute(view) {
    const decos = [];
    const doc = view.state.doc;
    const re = /\[\[([^\]\n]+)\]\]/g;

    for (const { from, to } of view.visibleRanges) {
      const text = doc.sliceString(from, to);
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text)) !== null) {
        const start = from + m.index;
        const end = start + m[0].length;
        if (embedCovers(view.state, start)) continue;
        // Active line: leave the raw source visible, exactly like Obsidian's
        // per-line reveal for block-ish constructs.
        if (lineIsActive(view, start)) continue;
        decos.push(HIDE.range(start, start + 2));
        decos.push(noteLinkMark.range(start + 2, end - 2));
        decos.push(HIDE.range(end - 2, end));
      }
    }
    return Decoration.set(decos, true);
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

// ── Syntax concealment ────────────────────────────────────────────────────────
// Empty replace decorations only — no widget, no DOM node, no font-size:0.
// Block-ish constructs (headings, quotes) reveal per line; inline constructs
// reveal when the selection intersects the enclosing node, which is the same
// granularity Obsidian uses.
const INLINE_MARKS = new Set([
  'HeaderMark', 'EmphasisMark', 'StrikethroughMark',
  'LinkMark', 'URL', 'CodeMark', 'QuoteMark',
]);

/**
 * Line framing for one fenced code block, plus fence concealment.
 *
 * All framing lives on `Decoration.line` classes that are emitted in *both*
 * states — only the fence text is hidden when the block is inactive — so
 * revealing the fences cannot change any line's box.
 */
// Transient "copied" state for the language pill. Kept outside the widget so
// it survives decoration rebuilds and can expire on a timer.
let copiedBadge = { key: -1, until: 0 };

async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (err) { /* fall back to execCommand */ }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch (err) {
    return false;
  }
}

/**
 * Language pill for a fenced block. A widget rather than a CSS pseudo-element,
 * because it must receive clicks (copy the snippet). It is absolutely
 * positioned and reports `estimatedHeight = 0`, so it adds no layout at all.
 */
class LangBadgeWidget extends WidgetType {
  constructor(lang, key, contentFrom, contentTo, copied) {
    super();
    this.lang = lang;
    this.key = key;
    this.contentFrom = contentFrom;
    this.contentTo = contentTo;
    this.copied = copied;
  }

  get estimatedHeight() { return 0; }

  eq(other) {
    return other instanceof LangBadgeWidget &&
      this.lang === other.lang &&
      this.key === other.key &&
      this.contentFrom === other.contentFrom &&
      this.contentTo === other.contentTo &&
      this.copied === other.copied;
  }

  toDOM(view) {
    const el = document.createElement('span');
    el.className = this.copied ? 'cm-lang-badge is-copied' : 'cm-lang-badge';
    el.textContent = this.copied ? 'Copied' : this.lang;
    el.title = 'Copy code';
    el.setAttribute('role', 'button');

    // Never let the click move the caret or start a text selection.
    el.addEventListener('mousedown', (e) => e.preventDefault());
    el.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const code = view.state.doc.sliceString(this.contentFrom, this.contentTo)
        .replace(/\n$/, '');
      copyToClipboard(code).then((ok) => {
        if (!ok) return;
        copiedBadge = { key: this.key, until: Date.now() + 1400 };
        el.textContent = 'Copied';
        el.classList.add('is-copied');
        setTimeout(() => {
          copiedBadge = { key: -1, until: 0 };
          if (view.dom.isConnected) view.dispatch({ effects: refreshEffect.of(null) });
        }, 1400);
      });
    });
    return el;
  }

  ignoreEvent() { return true; }
}

function addCodeBlockDecorations(view, node, decos) {
  const doc = view.state.doc;
  const startLine = doc.lineAt(node.from);
  const endLine = doc.lineAt(Math.min(node.to, doc.length));
  if (endLine.number < startLine.number) return;

  const isActive = rangeTouches(view.state.selection.ranges, node.from, node.to);

  // Language lives in the tree (works for backticks, tildes and indentation).
  const infoNode = typeof node.getChild === 'function' ? node.getChild('CodeInfo') : null;
  const lang = infoNode ? doc.sliceString(infoNode.from, infoNode.to).trim().split(/\s+/)[0] : '';

  const first = node.firstChild;
  const last = node.lastChild;
  // Compare positions, not node identity: SyntaxNode getters may hand back
  // fresh wrapper objects, and an unterminated fence has only the opening mark.
  // A single-line block cannot have a separate closing fence to hide.
  const closing = last && last.name === 'CodeMark' &&
    endLine.number > startLine.number &&
    (!first || last.from > first.from) ? last : null;

  // Code body, used by the badge's copy action.
  const contentFrom = Math.min(doc.length, startLine.to + 1);
  const contentTo = closing ? closing.from : endLine.to;
  const copied = copiedBadge.key === node.from && copiedBadge.until > Date.now();

  for (let n = startLine.number; n <= endLine.number; n++) {
    const line = doc.line(n);
    if (!lineIsVisible(view, line.from, line.to)) continue;
    let cls = 'cm-codeblock-line';
    if (n === startLine.number) cls += ' cm-codeblock-begin';
    if (n === endLine.number) cls += ' cm-codeblock-end';
    decos.push(Decoration.line({ class: cls }).range(line.from));

    if (n === startLine.number && !isActive && lang) {
      decos.push(Decoration.widget({
        widget: new LangBadgeWidget(lang, node.from, contentFrom, contentTo, copied),
        side: 1,
      }).range(line.to));
    }
  }

  if (isActive) return;

  // Conceal the fence tokens themselves (not the whole line), so a fenced
  // block inside a blockquote keeps its `>` prefix.
  if (first && first.name === 'CodeMark') {
    decos.push(HIDE.range(first.from, startLine.to));
  }
  // Only hide a closing fence when one exists; an unterminated block ends on
  // its last code line, which must stay visible.
  if (closing) {
    decos.push(HIDE.range(closing.from, endLine.to));
  }
}

const activeSyntaxPlugin = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = this.compute(view); }
  update(update) { updateDecorations(this, update); }

  compute(view) {
    const tree = viewportTree(view);
    const doc = view.state.doc;
    const decos = [];
    const quotedLines = new Set();
    const codeBlocks = new Set();

    // Footnote references: `[^1]` renders as a superscript marker, and the raw
    // syntax comes back on the active line like other block-ish constructs.
    const footnoteRanges = [];
    const insideFence = (pos) => {
      let node = tree.resolveInner(pos, 1);
      while (node) {
        if (node.name === 'FencedCode') return true;
        node = node.parent;
      }
      return false;
    };
    {
      const ranges = view.visibleRanges.length
        ? view.visibleRanges
        : [{ from: 0, to: doc.length }];
      for (const range of ranges) {
        let line = doc.lineAt(range.from);
        const lastLine = doc.lineAt(Math.min(range.to, doc.length));
        while (true) {
          if (!lineIsActive(view, line.from)) {
            FOOTNOTE_REF_RE.lastIndex = 0;
            let match;
            while ((match = FOOTNOTE_REF_RE.exec(line.text)) !== null) {
              const start = line.from + match.index;
              const end = start + match[0].length;
              if (embedCovers(view.state, start)) continue;
              if (insideFence(start)) continue;
              // `[^1]` written inside an inline-code span is literal text.
              const before = line.text.slice(0, match.index).replace(/\\`/g, '');
              if (((before.match(/`/g) || []).length & 1) === 1) continue;
              footnoteRanges.push({ from: start, to: end });
              decos.push(HIDE.range(start, start + 2));
              decos.push(Decoration.mark({ class: 'cm-footnote-ref' })
                .range(start + 2, end - 1));
              decos.push(HIDE.range(end - 1, end));
            }
          }
          if (line.number >= lastLine.number) break;
          line = doc.line(line.number + 1);
        }
      }
    }

    forEachVisibleNode(view, tree, (node) => {
      const name = node.type.name;
      if (name === 'FencedCode') {
        // A block that spans two visible ranges would otherwise be visited
        // twice and emit duplicate line decorations.
        if (codeBlocks.has(node.from)) return;
        codeBlocks.add(node.from);
        // Inside a rendered callout/image the whole range is already replaced;
        // framing it again would overlap that replacement.
        if (embedCovers(view.state, node.from)) return;
        addCodeBlockDecorations(view, node.node, decos);
        return;
      }
      if (name === 'HorizontalRule') {
        if (embedCovers(view.state, node.from)) return;
        if (!lineIsActive(view, node.from)) {
          const line = doc.lineAt(node.from);
          // Line decoration + concealed marks: the line keeps its metrics and
          // the rule itself is drawn by CSS at the line's vertical centre.
          decos.push(Decoration.line({ class: 'cm-hr-line' }).range(line.from));
          decos.push(HIDE.range(line.from, line.to));
        }
        return;
      }

      if (name === 'InlineCode') {
        if (embedCovers(view.state, node.from)) return;
        if (node.to - node.from > 2 && !inlineIsActive(view, node.from, node.to)) {
          decos.push(Decoration.mark({ class: 'cm-inline-code' })
            .range(node.from + 1, node.to - 1));
        }
        return;
      }

      // Footnote references are owned by the pass above; without this the
      // generic LinkMark handling would hide the brackets a second time.
      if (footnoteRanges.some((r) => node.from >= r.from && node.to <= r.to)) return;

      if (!INLINE_MARKS.has(name)) return;
      // Inside a rendered callout the block widget owns the whole range: no
      // quote-line chrome and no marker concealment may be layered on top.
      if (embedCovers(view.state, node.from)) return;

      const parent = node.node.parent;
      const parentName = parent ? parent.name : '';

      // Fenced code fences must stay visible: they are the block's boundary,
      // not inline punctuation.
      if (name === 'CodeMark' && parentName === 'FencedCode') return;
      // An autolink's URL *is* its visible label; concealing it blanks the line.
      if (name === 'URL' && parentName === 'Autolink') return;

      if (name === 'HeaderMark') {
        const line = doc.lineAt(node.from);
        const marker = doc.sliceString(node.from, node.to).trim();
        // Never conceal the only content on the line. An empty heading must
        // keep the same height whether its `#` is shown or hidden.
        if (line.text.trim() === marker) return;
        // Hide `#` *and* the space after it, otherwise a stray leading space
        // survives concealment ("  Title" instead of "Title").
        if (!lineIsActive(view, node.from)) {
          decos.push(HIDE.range(node.from, skipSpaces(doc, node.to)));
        }
        return;
      }

      if (name === 'QuoteMark') {
        const line = doc.lineAt(node.from);
        if (!quotedLines.has(line.from)) {
          quotedLines.add(line.from);
          const lead = line.text.match(/^\s*(?:>\s*)+/);
          const depth = lead ? Math.min(3, (lead[0].match(/>/g) || []).length) : 1;
          // Line decoration carries the quote chrome (border + padding), so
          // concealing `>` never changes the line's width or metrics.
          decos.push(Decoration.line({ class: `cm-quote-line cm-quote-depth-${depth}` })
            .range(line.from));
        }
        // `>` is concealed together with the spaces after it, so the quote body
        // starts flush against the border padding instead of after a stray gap.
        if (!lineIsActive(view, node.from)) {
          decos.push(HIDE.range(node.from, skipSpaces(doc, node.to)));
        }
        return;
      }

      // Inline marks: reveal the whole enclosing construct, not just the mark.
      const scopeFrom = parent ? parent.from : node.from;
      const scopeTo = parent ? parent.to : node.to;
      if (!inlineIsActive(view, scopeFrom, scopeTo)) {
        decos.push(HIDE.range(node.from, node.to));
      }
    });

    return Decoration.set(decos, true);
  }
}, { decorations: v => v.decorations });

// ── Visual theme ──────────────────────────────────────────────────────────────
const themeCompartment = new Compartment();

function makeTheme(accentColor) {
  const sel = accentColor + '30'; // 30 = ~19% opacity in hex
  return EditorView.theme({
    '&': {
      height: '100%',
      background: 'var(--bg)',
      color: '#d4d4d4',
      fontSize: '17px',
      fontFamily: "'Merriweather', 'Georgia', 'Cambria', serif",
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': {
      fontFamily: "'Merriweather', 'Georgia', 'Cambria', serif",
      lineHeight: 'var(--fm-line-height, 1.9)',
      // CM6 scrolls `view.scrollDOM` for caret movement and `scrollIntoView`.
      // This element must therefore be the scroll container.
      overflowY: 'auto',
      overflowX: 'hidden',
      // Horizontal padding centres the 720px reading column deterministically,
      // without relying on auto margins surviving the theme cascade. The CSS
      // `max-width` on `.cm-content` stays as a second line of defence.
      padding: '64px max(40px, calc((100% - 720px) / 2)) 120px',
    },
    '.cm-content': {
      padding: '0',
      caretColor: accentColor,
      wordBreak: 'break-word',
    },
    // Line metrics belong to the line, never to a concealing element.
    '.cm-line': { padding: '0', lineHeight: 'var(--fm-line-height, 1.9)' },
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
let currentDocPath = null;

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
  if (filePath) {
    currentDocPath = filePath;
    currentFileName = filePath.split(/[\\/]/).pop();
  }
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

// ── Find & Replace ────────────────────────────────────────────────────────────
function toggleSearchPanel() {
  if (searchPanelOpen(view.state)) closeSearchPanel(view);
  else openSearchPanel(view);
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
        { key: 'Ctrl-f', run: () => { toggleSearchPanel(); return true; } },
        { key: 'Ctrl-h', run: () => { toggleSearchPanel(); return true; } },
        ...searchKeymap,
      ]),
      markdown({ base: markdownLanguage, codeLanguages: languages, extensions: [GFM], addKeymap: true }),
      search({ top: true }),
      highlightCompartment.of(makeHighlight(true)),
      lineHeightProbe,
      tableMenuDismiss,
      embedField,
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

// Freeze decoration rebuilds while the pointer is down (drag-select), then
// rebuild exactly once after the drag settles. Rebuilding on every
// `selectionSet` during a drag is the main source of scroll snapping.
view.scrollDOM.addEventListener('mousedown', e => {
  if (e.button === 0) interaction.dragging = true;
}, true);

window.addEventListener('mouseup', () => {
  if (!interaction.dragging) return;
  interaction.dragging = false;
  requestAnimationFrame(() => {
    if (!view.dom.isConnected) return;
    view.dispatch({ effects: refreshEffect.of(null) });
  });
}, true);

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

dropdown.addEventListener('click', async e => {
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (!action) return;
  dropdown.classList.add('hidden');
  switch (action) {
    case 'new':       newFile();       break;
    case 'open':      openFile();      break;
    case 'save':      saveFile();      break;
    case 'saveAs':    saveAsFile();    break;
    case 'quickOpen': showQuickOpen(); break;
    case 'find':      view.focus(); toggleSearchPanel(); break;
    case 'exportPDF': {
      const result = await window.fileAPI.exportPDF(
        view.state.doc.toString(), document.body.className);
      if (result && result.error) alert('Export failed: ' + result.error);
      break;
    }
    case 'exportHTML': {
      const result = await window.fileAPI.exportHTML(
        view.state.doc.toString(), document.body.className);
      if (result && result.error) alert('Export failed: ' + result.error);
      break;
    }
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

/** Keep the native window background in step with the theme's `--bg`. */
function syncWindowBackground() {
  const bg = getComputedStyle(document.body).getPropertyValue('--bg').trim();
  if (bg && window.windowAPI && window.windowAPI.setBackgroundColor) {
    window.windowAPI.setBackgroundColor(bg);
  }
}

function applyTheme(theme) {
  document.body.classList.remove(...THEMES);
  if (theme !== 'theme-dark') document.body.classList.add(theme);
  currentTheme = theme;
  localStorage.setItem('fm-theme', theme);
  applyAccent(currentAccent);
  syncWindowBackground();
}

// ── Zen mode ──────────────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'F11') { e.preventDefault(); document.body.classList.toggle('zen'); }
});

// Find & Replace must work from anywhere, including a focused table-cell or
// math-overlay input where CodeMirror's own keymap never sees the event.
window.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  const key = e.key.toLowerCase();
  if (key !== 'f' && key !== 'h') return;
  e.preventDefault();
  e.stopPropagation();
  view.focus();
  toggleSearchPanel();
}, true);

// ── Click-to-focus / note link ────────────────────────────────────────────────
document.getElementById('editor-wrap').addEventListener('click', e => {
  if (e.ctrlKey) { handleNoteLinkClick(e, view); return; }
  const t = e.target;
  const cls = t && t.classList;
  // Clicking the scroller's padding (below the last line) should focus the
  // editor too; that area used to belong to the scrolling wrapper.
  if (t === e.currentTarget || t === document.getElementById('editor') ||
      (cls && (cls.contains('cm-scroller') || cls.contains('cm-content')))) {
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