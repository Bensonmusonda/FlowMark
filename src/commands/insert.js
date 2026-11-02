import { EditorSelection } from '@codemirror/state';

/**
 * Selection-aware wrap or toggle.
 * If text is selected:
 *   - If already wrapped in open & close, unwrap it (toggle).
 *   - Otherwise, wrap it with open & close and keep the inner text selected.
 * If no text is selected:
 *   - Insert `open + placeholder + close` and select the placeholder so the user can type immediately.
 *
 * @param {import('@codemirror/view').EditorView} view
 * @param {{ open: string, close?: string, placeholder?: string, toggle?: boolean }} options
 */
export function wrapSelection(view, { open, close = open, placeholder = '', toggle = true }) {
  const { state } = view;
  const tr = state.changeByRange((range) => {
    const selectedText = state.sliceDoc(range.from, range.to);

    if (toggle) {
      // Case 1: The selected text itself is wrapped in open & close
      if (
        selectedText.length >= open.length + close.length &&
        selectedText.startsWith(open) &&
        selectedText.endsWith(close)
      ) {
        const inner = selectedText.slice(open.length, -close.length);
        return {
          changes: { from: range.from, to: range.to, insert: inner },
          range: EditorSelection.range(range.from, range.from + inner.length),
        };
      }

      // Case 2: The text surrounding the selection has open immediately before and close immediately after
      const before = state.sliceDoc(Math.max(0, range.from - open.length), range.from);
      const after = state.sliceDoc(range.to, range.to + close.length);
      if (before === open && after === close) {
        return {
          changes: [
            { from: range.from - open.length, to: range.from, insert: '' },
            { from: range.to, to: range.to + close.length, insert: '' },
          ],
          range: EditorSelection.range(range.from - open.length, range.to - open.length),
        };
      }
    }

    // Case 3: Text is selected -> wrap it
    if (selectedText) {
      return {
        changes: { from: range.from, to: range.to, insert: open + selectedText + close },
        range: EditorSelection.range(range.from + open.length, range.to + open.length),
      };
    }

    // Case 4: No selection -> insert template and select placeholder
    const insert = open + placeholder + close;
    const selFrom = range.from + open.length;
    const selTo = selFrom + placeholder.length;
    return {
      changes: { from: range.from, to: range.from, insert },
      range: EditorSelection.range(selFrom, selTo),
    };
  });

  view.focus();
  view.dispatch({ ...tr, userEvent: 'input.insert' });
}

/**
 * Insert or wrap a Markdown link [text](url).
 */
export function insertLink(view) {
  const { state } = view;
  const tr = state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to);
    if (!text) {
      const insert = '[link text](url)';
      return {
        changes: { from: range.from, to: range.to, insert },
        range: EditorSelection.range(range.from + 1, range.from + 10),
      };
    }
    if (/^https?:\/\//i.test(text.trim())) {
      const insert = `[title](${text.trim()})`;
      return {
        changes: { from: range.from, to: range.to, insert },
        range: EditorSelection.range(range.from + 1, range.from + 6),
      };
    }
    const insert = `[${text}](url)`;
    const urlStart = range.from + text.length + 3;
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.range(urlStart, urlStart + 3),
    };
  });
  view.focus();
  view.dispatch({ ...tr, userEvent: 'input.link' });
}

/**
 * Insert or wrap a Markdown image ![alt text](url).
 */
export function insertImage(view) {
  const { state } = view;
  const tr = state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to);
    if (!text) {
      const insert = '![alt text](url)';
      return {
        changes: { from: range.from, to: range.to, insert },
        range: EditorSelection.range(range.from + 2, range.from + 10),
      };
    }
    if (/^https?:\/\//i.test(text.trim())) {
      const insert = `![alt text](${text.trim()})`;
      return {
        changes: { from: range.from, to: range.to, insert },
        range: EditorSelection.range(range.from + 2, range.from + 10),
      };
    }
    const insert = `![${text}](url)`;
    const urlStart = range.from + text.length + 4;
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.range(urlStart, urlStart + 3),
    };
  });
  view.focus();
  view.dispatch({ ...tr, userEvent: 'input.image' });
}

/**
 * Insert or wrap a code block.
 */
export function insertCodeBlock(view) {
  const { state } = view;
  const tr = state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to);
    if (text) {
      const insert = `\n\`\`\`\n${text}\n\`\`\`\n`;
      return {
        changes: { from: range.from, to: range.to, insert },
        range: EditorSelection.range(range.from + 5, range.from + 5 + text.length),
      };
    }
    const insert = '```js\n// code\n```\n';
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.range(range.from + 3, range.from + 5),
    };
  });
  view.focus();
  view.dispatch({ ...tr, userEvent: 'input.codeblock' });
}

/**
 * Insert a Markdown table skeleton.
 */
export function insertTable(view) {
  const { state } = view;
  const pos = state.selection.main.from;
  const line = state.doc.lineAt(pos);
  const prefix = line.text.trim().length > 0 ? '\n\n' : '';
  const table = `${prefix}| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n| Item 1 | Item 2 | Item 3 |\n`;
  view.focus();
  view.dispatch({
    changes: { from: pos, to: pos, insert: table },
    selection: { anchor: pos + prefix.length + 2, head: pos + prefix.length + 10 },
    userEvent: 'input.table',
  });
}

/**
 * Insert a Callout block.
 */
export function insertCallout(view, type = 'NOTE') {
  const { state } = view;
  const tr = state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to);
    if (text) {
      const lines = text.split('\n').map((l) => `> ${l}`).join('\n');
      const insert = `> [!${type}]\n${lines}\n\n`;
      return {
        changes: { from: range.from, to: range.to, insert },
        range: EditorSelection.range(range.from, range.from + insert.length - 1),
      };
    }
    const insert = `> [!${type}]\n> Content\n\n`;
    const selFrom = range.from + `> [!${type}]\n> `.length;
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.range(selFrom, selFrom + 'Content'.length),
    };
  });
  view.focus();
  view.dispatch({ ...tr, userEvent: 'input.callout' });
}

/**
 * Insert a Math block ($$...$$).
 */
export function insertMathBlock(view) {
  const { state } = view;
  const tr = state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to);
    if (text) {
      const insert = `\n$$\n${text}\n$$\n`;
      return {
        changes: { from: range.from, to: range.to, insert },
        range: EditorSelection.range(range.from + 4, range.from + 4 + text.length),
      };
    }
    const insert = '$$\nformula\n$$\n';
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.range(range.from + 3, range.from + 10),
    };
  });
  view.focus();
  view.dispatch({ ...tr, userEvent: 'input.math' });
}

/**
 * Insert a horizontal rule (---).
 */
export function insertHorizontalRule(view) {
  const { state } = view;
  const pos = state.selection.main.from;
  const line = state.doc.lineAt(pos);
  const prefix = line.text.trim().length > 0 ? '\n\n' : '';
  const insert = `${prefix}---\n\n`;
  view.focus();
  view.dispatch({
    changes: { from: pos, to: pos, insert },
    selection: { anchor: pos + insert.length },
    userEvent: 'input.hr',
  });
}

/**
 * Toggle a line prefix across all selected lines (e.g. '> ' or '- [ ] ').
 */
export function toggleLinePrefix(view, prefix) {
  const { state } = view;
  const lineNumbers = new Set();

  for (const range of state.selection.ranges) {
    const fromLine = state.doc.lineAt(range.from).number;
    const toLine = state.doc.lineAt(range.to).number;
    for (let l = fromLine; l <= toLine; l++) lineNumbers.add(l);
  }

  const lines = Array.from(lineNumbers).map((n) => state.doc.line(n));
  const hasPrefix = (l) => l.text.startsWith(prefix);
  const allHave = lines.every(hasPrefix);

  const changes = [];
  for (const line of lines) {
    if (allHave) {
      changes.push({ from: line.from, to: line.from + prefix.length, insert: '' });
    } else if (!hasPrefix(line)) {
      changes.push({ from: line.from, to: line.from, insert: prefix });
    }
  }

  if (changes.length) {
    view.focus();
    view.dispatch({ changes, userEvent: 'input.prefix' });
  }
}

/**
 * Toggle heading level 1, 2, or 3 on selected line(s).
 */
export function toggleHeading(view, level) {
  const { state } = view;
  const targetPrefix = '#'.repeat(level) + ' ';
  const lineNumbers = new Set();

  for (const range of state.selection.ranges) {
    const fromLine = state.doc.lineAt(range.from).number;
    const toLine = state.doc.lineAt(range.to).number;
    for (let l = fromLine; l <= toLine; l++) lineNumbers.add(l);
  }

  const changes = [];
  for (const lineNum of lineNumbers) {
    const line = state.doc.line(lineNum);
    const m = line.text.match(/^(#{1,6}\s+)/);
    if (m) {
      if (m[1] === targetPrefix) {
        changes.push({ from: line.from, to: line.from + m[1].length, insert: '' });
      } else {
        changes.push({ from: line.from, to: line.from + m[1].length, insert: targetPrefix });
      }
    } else {
      changes.push({ from: line.from, to: line.from, insert: targetPrefix });
    }
  }

  if (changes.length) {
    view.focus();
    view.dispatch({ changes, userEvent: 'input.heading' });
  }
}

export default {
  wrapSelection,
  insertLink,
  insertImage,
  insertCodeBlock,
  insertTable,
  insertCallout,
  insertMathBlock,
  insertHorizontalRule,
  toggleLinePrefix,
  toggleHeading,
};
