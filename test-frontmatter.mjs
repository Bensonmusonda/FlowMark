import {
  parseScalar,
  parseInlineArray,
  inferType,
  parseFrontmatter,
  stringifyFrontmatter,
  extractFrontmatter
} from './src/parser/frontmatter.js';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    console.log(`  ✅ ${msg}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${msg}`);
    failed++;
  }
}

console.log('🧪 Frontmatter Scalar & Type Inference:');
assert(parseScalar('true') === true, 'Parses boolean true');
assert(parseScalar('false') === false, 'Parses boolean false');
assert(parseScalar('42') === 42, 'Parses integer 42');
assert(parseScalar('-3.14') === -3.14, 'Parses float -3.14');
assert(parseScalar('"hello world"') === 'hello world', 'Parses double-quoted string');
assert(parseScalar("'single quoted'") === 'single quoted', 'Parses single-quoted string');
assert(parseScalar('unquoted text') === 'unquoted text', 'Parses unquoted string');
assert(parseScalar('null') === '', 'Parses null as empty');
assert(inferType('tags', ['a']) === 'tags', 'Infers tags type for tags array');
assert(inferType('items', ['a']) === 'list', 'Infers list type for other array');
assert(inferType('published', true) === 'boolean', 'Infers boolean type');
assert(inferType('count', 10) === 'number', 'Infers number type');
assert(inferType('date', '2026-11-02') === 'date', 'Infers date type');

console.log('\n🧪 Inline & Block List Parsing:');
const inlineArr = parseInlineArray('[apple, "banana, split", cherry]');
assert(inlineArr.length === 3, 'Inline array length 3');
assert(inlineArr[0] === 'apple', 'Inline array item 0');
assert(inlineArr[1] === 'banana, split', 'Inline array item 1 with comma inside quote');
assert(inlineArr[2] === 'cherry', 'Inline array item 2');

const yamlSample = `
title: "My Note"
author: Benson
draft: false
rating: 4.8
tags:
  - note
  - ideas
  - obsidian
category:
  primary: Tech
  secondary: AI
`;

const parsed = parseFrontmatter(yamlSample);
assert(parsed.data.title === 'My Note', 'Parsed title string');
assert(parsed.data.author === 'Benson', 'Parsed author string');
assert(parsed.data.draft === false, 'Parsed draft boolean');
assert(parsed.data.rating === 4.8, 'Parsed rating number');
assert(Array.isArray(parsed.data.tags) && parsed.data.tags.length === 3, 'Parsed block list tags');
assert(parsed.data.tags[1] === 'ideas', 'Tags second item is ideas');
assert(parsed.data.category && parsed.data.category.primary === 'Tech', 'Parsed nested object category');

console.log('\n🧪 Frontmatter Stringify & Round-trip:');
const stringified = stringifyFrontmatter(parsed.entries);
assert(stringified.startsWith('---'), 'Starts with --- fence');
assert(stringified.endsWith('---'), 'Ends with --- fence');
assert(stringified.includes('title: My Note') || stringified.includes('title: "My Note"'), 'Contains title');
assert(stringified.includes('draft: false'), 'Contains boolean draft');
assert(stringified.includes('  - note'), 'Contains block list items');
assert(stringified.includes('  primary: Tech'), 'Contains nested object items');

console.log('\n🧪 Frontmatter Extraction from Full Doc:');
const fullDoc = `---
title: Extracted Note
tags: [alpha, beta]
---
# Heading 1
Doc content here.
`;

const extracted = extractFrontmatter(fullDoc);
assert(extracted.hasFrontmatter === true, 'Detects frontmatter at line 1');
assert(extracted.from === 0, 'from offset is 0');
assert(extracted.to > 0, 'to offset is positive');
assert(extracted.data.title === 'Extracted Note', 'Extracted correct title');
assert(extracted.data.tags.length === 2, 'Extracted inline array tags');

const nonFmDoc = `# Regular Markdown
No frontmatter here.
`;
const extractedNone = extractFrontmatter(nonFmDoc);
assert(extractedNone.hasFrontmatter === false, 'Returns false for doc without frontmatter');

console.log(`\n${passed + failed} tests, ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
