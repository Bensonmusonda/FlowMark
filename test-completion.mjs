/**
 * Tests for Phase 2 — Smart Typing + Autocomplete
 * Tests completion sources and closeBrackets configuration.
 */

import {
  calloutCompletion,
  fenceLanguageCompletion,
  emojiCompletion,
  CALLOUT_TYPES,
  FENCE_LANGUAGES,
  COMMON_EMOJIS,
} from './src/commands/completion.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${message}`);
  } else {
    failed++;
    console.error(`  ❌ ${message}`);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Create a minimal CompletionContext mock from a doc string and cursor position.
 */
function mockContext(doc, pos, explicit = false) {
  return {
    pos,
    explicit,
    state: { doc: { toString: () => doc, length: doc.length } },
    matchBefore(re) {
      // Simulate matchBefore: search backward from pos for a match
      const line = getLineAt(doc, pos);
      const lineStart = doc.lastIndexOf('\n', pos - 1) + 1;
      const textBeforeCursor = doc.slice(lineStart, pos);
      const m = textBeforeCursor.match(re);
      if (!m) return null;
      return {
        from: lineStart + m.index,
        to: pos,
        text: m[0],
      };
    },
  };
}

function getLineAt(doc, pos) {
  const lineStart = doc.lastIndexOf('\n', pos - 1) + 1;
  let lineEnd = doc.indexOf('\n', pos);
  if (lineEnd === -1) lineEnd = doc.length;
  return doc.slice(lineStart, lineEnd);
}

// ── Callout completion tests ──────────────────────────────────────────────────

console.log('\n📋 Callout Completions:');

{
  const ctx = mockContext('> [!NO', 6);
  const result = calloutCompletion(ctx);
  assert(result !== null, 'Returns results after > [!NO');
  assert(result && result.options === CALLOUT_TYPES, 'Returns all callout types');
  assert(result && result.from === 4, 'from is right after [!');
}

{
  const ctx = mockContext('> [!', 4);
  const result = calloutCompletion(ctx);
  assert(result !== null, 'Returns results after > [! (empty)');
  assert(result && result.from === 4, 'from is right after [!');
}

{
  const ctx = mockContext('some random text', 10);
  const result = calloutCompletion(ctx);
  assert(result === null, 'Returns null for non-callout context');
}

{
  const ctx = mockContext('>  [!W', 6);
  const result = calloutCompletion(ctx);
  assert(result !== null, 'Handles extra spaces after >');
}

// ── Fence language completion tests ────────────────────────────────────────────

console.log('\n🏷️  Fence Language Completions:');

{
  const ctx = mockContext('```js', 5);
  const result = fenceLanguageCompletion(ctx);
  assert(result !== null, 'Returns results after ```js');
  assert(result && result.options === FENCE_LANGUAGES, 'Returns all fence languages');
  assert(result && result.from === 3, 'from is right after ```');
}

{
  const ctx = mockContext('```', 3);
  const result = fenceLanguageCompletion(ctx);
  assert(result !== null, 'Returns results after ``` (empty)');
  assert(result && result.from === 3, 'from is right after backticks');
}

{
  const ctx = mockContext('````py', 6);
  const result = fenceLanguageCompletion(ctx);
  assert(result !== null, 'Handles 4+ backticks');
  assert(result && result.from === 4, 'from is right after 4 backticks');
}

{
  const ctx = mockContext('some text `inline`', 18);
  const result = fenceLanguageCompletion(ctx);
  assert(result === null, 'Returns null for inline code (not at line start)');
}

// ── Emoji completion tests ────────────────────────────────────────────────────

console.log('\n😄 Emoji Completions:');

{
  const ctx = mockContext('Hello :smi', 10);
  const result = emojiCompletion(ctx);
  assert(result !== null, 'Returns results after :smi');
  assert(result && result.options === COMMON_EMOJIS, 'Returns all emojis');
  assert(result && result.from === 6, 'from starts at the colon');
}

{
  const ctx = mockContext('Hello :s', 8);
  const result = emojiCompletion(ctx);
  assert(result === null, 'Returns null for < 3 chars (implicit)');
}

{
  const ctx = mockContext('Hello :s', 8, true);
  const result = emojiCompletion(ctx);
  assert(result !== null, 'Returns results for < 3 chars when explicit');
}

{
  const ctx = mockContext('Hello world', 11);
  const result = emojiCompletion(ctx);
  assert(result === null, 'Returns null when no colon');
}

// ── Data integrity tests ──────────────────────────────────────────────────────

console.log('\n📦 Data Integrity:');

assert(CALLOUT_TYPES.length >= 10, `Has ${CALLOUT_TYPES.length} callout types (>= 10)`);
assert(FENCE_LANGUAGES.length >= 30, `Has ${FENCE_LANGUAGES.length} fence languages (>= 30)`);
assert(COMMON_EMOJIS.length >= 30, `Has ${COMMON_EMOJIS.length} emojis (>= 30)`);

assert(CALLOUT_TYPES.every(c => c.label && c.detail && c.type), 'All callout types have label, detail, type');
assert(FENCE_LANGUAGES.every(c => c.label && c.detail && c.type), 'All fence languages have label, detail, type');
assert(COMMON_EMOJIS.every(c => c.label && c.apply && c.detail && c.type), 'All emojis have label, apply, detail, type');

// Emojis should start with colon
assert(COMMON_EMOJIS.every(c => c.label.startsWith(':')), 'All emoji labels start with :');

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests, ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
