import assert from 'assert';
import {
  appendTableExitLine,
  resolveTableExit,
  resolveTableNavigation,
} from './src/editor/table-navigation.js';

const spec = {
  from: 0,
  to: 29,
  header: { cells: [{}, {}] },
  rows: [{}, {}],
};

assert.deepStrictEqual(resolveTableNavigation(spec, -1, 0, 'enter'), { row: 0, col: 0 });
assert.deepStrictEqual(resolveTableNavigation(spec, 0, 1, 'next'), { row: 1, col: 0 });
assert.strictEqual(resolveTableNavigation(spec, 1, 1, 'next'), 'exit-below');
assert.strictEqual(resolveTableNavigation(spec, 1, 0, 'down'), 'exit-below');
assert.strictEqual(resolveTableNavigation(spec, -1, 0, 'up'), 'exit-above');
assert.deepStrictEqual(resolveTableNavigation(spec, 1, 1, 'left'), { row: 1, col: 0 });
assert.strictEqual(resolveTableNavigation(spec, 1, 0, 'left'), null);
assert.deepStrictEqual(resolveTableNavigation(spec, -1, 0, 'enter'), { row: 0, col: 0 });

function fakeDoc(text) {
  return {
    length: text.length,
    lineAt(position) {
      const lineStart = text.lastIndexOf('\n', Math.max(0, position - 1)) + 1;
      return { from: lineStart };
    },
  };
}

const eofText = '| A | B |\n| --- | --- |\n| x | y |';
const eofDoc = fakeDoc(eofText);
const eofSpec = { from: 0, to: eofText.length };
const eofExit = resolveTableExit(eofSpec, eofDoc, 'exit-below');
const lastRowFrom = eofText.lastIndexOf('\n') + 1;
assert.deepStrictEqual(eofExit, { position: eofText.length, needsTrailingLine: true });
assert.deepStrictEqual(
  appendTableExitLine(eofDoc, [{ from: lastRowFrom, to: eofText.length, insert: '| x | z |' }], eofExit),
  [{ from: lastRowFrom, to: eofText.length, insert: '| x | z |\n' }],
);
assert.deepStrictEqual(appendTableExitLine(eofDoc, [], eofExit), [
  { from: eofText.length, to: eofText.length, insert: '\n' },
]);

const followingLineDoc = fakeDoc(eofText + '\nAfter table');
const followingLineExit = resolveTableExit(
  { from: 0, to: eofText.length },
  followingLineDoc,
  'exit-below',
);
assert.deepStrictEqual(followingLineExit, {
  position: eofText.length + 1,
  needsTrailingLine: false,
});
assert.deepStrictEqual(appendTableExitLine(followingLineDoc, [], followingLineExit), []);

console.log('✅ Table navigation and EOF exit tests passed');
