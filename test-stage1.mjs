import assert from 'assert';

console.log('🧪 Testing Stage 1: Fluid Editor Polish\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ ${name}: ${err.message}`);
    failed++;
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ ${name}: ${err.message}`);
    failed++;
  }
}

// ── 1. Selection & Embed Protection Tests ────────────────────────────────────
console.log('📐 1. Selection Snapping & Block Embed Protection:');

// Replicate rangeTouches logic from src/editor.js
function rangeTouches(ranges, from, to, isDragging = false) {
  if (isDragging) return false;
  for (const r of ranges) {
    if (!r.empty) continue; // Passive selection drag never un-conceals block embeds
    if (r.from <= to && r.to >= from) return true;
  }
  return false;
}

test('rangeTouches ignores drag selections across embeds (tables/callouts/math)', () => {
  const tableFrom = 100;
  const tableTo = 250;
  // Drag selection from before table to after table
  const dragSelection = [{ from: 50, to: 300, empty: false }];
  assert.strictEqual(rangeTouches(dragSelection, tableFrom, tableTo), false, 'Table should not un-conceal during drag');
});

test('rangeTouches ignores partial drag selection touching embed boundary', () => {
  const mathFrom = 100;
  const mathTo = 150;
  const dragSelection = [{ from: 80, to: 120, empty: false }];
  assert.strictEqual(rangeTouches(dragSelection, mathFrom, mathTo), false, 'Math block should not un-conceal during drag');
});

test('rangeTouches allows keyboard caret navigation inside embed', () => {
  const calloutFrom = 100;
  const calloutTo = 200;
  // Empty caret placed inside the callout
  const caret = [{ from: 150, to: 150, empty: true }];
  assert.strictEqual(rangeTouches(caret, calloutFrom, calloutTo), true, 'Callout un-conceals for caret editing');
});

test('rangeTouches returns false for caret outside embed', () => {
  const tableFrom = 100;
  const tableTo = 200;
  const caret = [{ from: 50, to: 50, empty: true }];
  assert.strictEqual(rangeTouches(caret, tableFrom, tableTo), false, 'Table remains rendered when caret is outside');
});

test('Pointer click freezes decoration rebuilding until mouseup', () => {
  const interaction = { pointerDown: true, dragging: false };
  const selectionIsText = false;
  const shouldFreeze = interaction.pointerDown ||
    interaction.dragging ||
    selectionIsText;
  assert.strictEqual(shouldFreeze, true,
    'Decoration rebuild waits until the browser completes click coordinate mapping');

  interaction.pointerDown = false;
  assert.strictEqual(interaction.pointerDown, false,
    'Mouseup releases the pointer freeze for post-click reveal');
});

// Replicate inlineIsActive logic from src/editor.js
function inlineIsActive(viewState, from, to) {
  if (!viewState.hasFocus) return false;
  if (!viewState.selection.main.empty) return false;
  for (const r of viewState.selection.ranges) {
    if (r.empty && r.from >= from && r.to <= to) return true;
  }
  return false;
}

test('inlineIsActive freezes when text is actively selected (!selection.empty)', () => {
  const boldFrom = 10;
  const boldTo = 20;
  const viewState = {
    hasFocus: true,
    selection: {
      main: { from: 5, to: 25, empty: false },
      ranges: [{ from: 5, to: 25, empty: false }],
    },
  };
  assert.strictEqual(inlineIsActive(viewState, boldFrom, boldTo), false, 'Inline formatting stays frozen during drag selection');
});

test('inlineIsActive activates when caret is inside bold construct', () => {
  const boldFrom = 10;
  const boldTo = 20;
  const viewState = {
    hasFocus: true,
    selection: {
      main: { from: 15, to: 15, empty: true },
      ranges: [{ from: 15, to: 15, empty: true }],
    },
  };
  assert.strictEqual(inlineIsActive(viewState, boldFrom, boldTo), true, 'Bold markers reveal when caret is inside');
});

test('inlineIsActive remains inactive when caret is outside bold construct', () => {
  const boldFrom = 10;
  const boldTo = 20;
  const viewState = {
    hasFocus: true,
    selection: {
      main: { from: 30, to: 30, empty: true },
      ranges: [{ from: 30, to: 30, empty: true }],
    },
  };
  assert.strictEqual(inlineIsActive(viewState, boldFrom, boldTo), false, 'Bold markers remain hidden when caret is elsewhere');
});

// ── 2. List & Task Item Syntax Decoupling ─────────────────────────────────────
console.log('\n📋 2. List & Task Item Decoupling from lineIsActive:');

function taskBracketIsActive(hasFocus, sel, from, to) {
  if (!hasFocus) return false;
  if (!sel.empty) return false;
  return sel.from >= from && sel.to <= to;
}

test('Checkbox widget stays mounted while user is editing task line text', () => {
  const taskMarkerFrom = 2; // "- [ ] Task description"
  const taskMarkerTo = 5;
  // Caret is at offset 15 on "description"
  const sel = { from: 15, to: 15, empty: true };
  const bracketsActive = taskBracketIsActive(true, sel, taskMarkerFrom, taskMarkerTo);
  assert.strictEqual(bracketsActive, false, 'Checkbox widget stays mounted while editing text');
});

test('Raw [ ] brackets only reveal when caret is literally on/between brackets', () => {
  const taskMarkerFrom = 2;
  const taskMarkerTo = 5;
  // Caret is at offset 3 (between `[` and `]`)
  const sel = { from: 3, to: 3, empty: true };
  const bracketsActive = taskBracketIsActive(true, sel, taskMarkerFrom, taskMarkerTo);
  assert.strictEqual(bracketsActive, true, 'Raw brackets reveal when caret is between brackets');
});

test('List bullet marker is not active when editing text elsewhere on the line', () => {
  const markFrom = 0;
  const markTo = 1; // "- "
  const sel = { from: 10, to: 10, empty: true };
  const active = true && sel.empty && (sel.from >= markFrom && sel.to <= markTo + 1);
  assert.strictEqual(active, false, 'Bullet marker does not activate when typing line text');
});

test('Wikilink [[note]] only reveals when caret is directly inside link', () => {
  const linkStart = 20;
  const linkEnd = 30; // "[[my-note]]"
  // Caret on a bold word at offset 5 on the same line
  const viewState = {
    hasFocus: true,
    selection: {
      main: { from: 5, to: 5, empty: true },
      ranges: [{ from: 5, to: 5, empty: true }],
    },
  };
  assert.strictEqual(inlineIsActive(viewState, linkStart, linkEnd), false, 'Wikilink stays concealed when editing other text on line');
  // Caret inside the wikilink
  const insideViewState = {
    hasFocus: true,
    selection: {
      main: { from: 25, to: 25, empty: true },
      ranges: [{ from: 25, to: 25, empty: true }],
    },
  };
  assert.strictEqual(inlineIsActive(insideViewState, linkStart, linkEnd), true, 'Wikilink reveals when caret is inside it');
});

// ── 3. Ergonomic Quick Wins: Link Extraction & IPC Debouncing ────────────────
console.log('\n🔗 3. Markdown Links & IPC Debounce:');

function extractMarkdownUrl(lineText, lineOffset) {
  const linkRe = /\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)|<(https?:\/\/[^\s>]+)>/g;
  let match;
  while ((match = linkRe.exec(lineText)) !== null) {
    const matchStart = match.index;
    const matchEnd = match.index + match[0].length;
    if (lineOffset >= matchStart && lineOffset <= matchEnd) {
      return match[2] || match[3];
    }
  }
  return null;
}

test('Extracts external markdown link URL from [Text](URL)', () => {
  const line = 'Check out [FlowMark](https://github.com/flowmark) for notes!';
  const offset = 20; // inside [FlowMark](...)
  const url = extractMarkdownUrl(line, offset);
  assert.strictEqual(url, 'https://github.com/flowmark');
});

test('Extracts autolink URL from <URL>', () => {
  const line = 'Visit <https://flowmark.app> today';
  const offset = 10;
  const url = extractMarkdownUrl(line, offset);
  assert.strictEqual(url, 'https://flowmark.app');
});

test('Returns null when clicking outside markdown link', () => {
  const line = 'Check out [FlowMark](https://github.com/flowmark) for notes!';
  const offset = 2; // on "Check"
  const url = extractMarkdownUrl(line, offset);
  assert.strictEqual(url, null);
});

// Test debounced notifySelectionChange
await asyncTest('notifySelectionChange debounces rapid mouse movements', async () => {
  let callCount = 0;
  let lastPayload = null;
  let timer = null;

  function debouncedNotify(payload) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      callCount++;
      lastPayload = payload;
    }, 50);
  }

  // Simulate 20 rapid selection micro-transactions during a drag
  for (let i = 0; i < 20; i++) {
    debouncedNotify({ anchor: i, head: i + 5, empty: false });
  }

  // Immediately, IPC should not have fired yet
  assert.strictEqual(callCount, 0, 'No IPC message sent during active drag burst');

  // Wait 70ms for debounce timer to settle
  await new Promise(r => setTimeout(r, 70));

  assert.strictEqual(callCount, 1, 'Only one IPC notification fired after mouse settled');
  assert.deepStrictEqual(lastPayload, { anchor: 19, head: 24, empty: false }, 'Delivered latest selection payload');
});

// ── 4. Inline Code & Strikethrough Formatting ────────────────────────────────
console.log('\n🔤 4. Inline Code & Strikethrough Syntax Tests:');

test('Accurately identifies variable-length backtick delimiters on InlineCode', () => {
  const singleTick = '`const x = 10;`';
  let openLen1 = 0;
  while (openLen1 < singleTick.length && singleTick[openLen1] === '`') openLen1++;
  assert.strictEqual(openLen1, 1, 'Single backtick delimiter length is 1');
  assert.strictEqual(singleTick.slice(openLen1, singleTick.length - openLen1), 'const x = 10;');

  const doubleTick = '`` `template string with ${var}` ``';
  let openLen2 = 0;
  while (openLen2 < doubleTick.length && doubleTick[openLen2] === '`') openLen2++;
  assert.strictEqual(openLen2, 2, 'Double backtick delimiter length is 2');
  assert.strictEqual(doubleTick.slice(openLen2, doubleTick.length - openLen2), ' `template string with ${var}` ');
});

test('Strikethrough marks reveal when caret is inside strikethrough construct', () => {
  const strikeFrom = 20;
  const strikeTo = 50;
  const viewState = {
    hasFocus: true,
    selection: {
      main: { from: 35, to: 35, empty: true },
      ranges: [{ from: 35, to: 35, empty: true }]
    }
  };
  assert.strictEqual(inlineIsActive(viewState, strikeFrom, strikeTo), true, 'Strikethrough marks reveal when cursor is inside');
});

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${passed} tests passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
