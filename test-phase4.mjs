import {
  parseScalar,
  parseInlineArray,
  inferType,
  parseFrontmatter,
  stringifyFrontmatter,
  extractFrontmatter
} from './src/parser/frontmatter.js';
import { collectDocumentTags, PROPERTY_TYPES, ICONS } from './src/ui/propertiesCard.js';
import { Document, TabManager } from './src/model/document.js';

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

console.log('📋 Frontmatter Parsing & Types:');
{
  const yaml = `
title: "Deep Dive into FlowMark"
author: 'Benson'
published: true
views: 1050
created: 2026-11-02
tags:
  - markdown
  - real-time
  - editor
metadata:
  version: 1.0
  stable: true
`;
  const { data, entries } = parseFrontmatter(yaml);
  assert(data.title === 'Deep Dive into FlowMark', 'String with double quotes parsed');
  assert(data.author === 'Benson', 'String with single quotes parsed');
  assert(data.published === true, 'Boolean true parsed');
  assert(data.views === 1050, 'Integer 1050 parsed');
  assert(data.created === '2026-11-02', 'Date string parsed');
  assert(Array.isArray(data.tags) && data.tags.length === 3, 'Tags block list parsed with 3 items');
  assert(data.tags[0] === 'markdown', 'First tag item is markdown');
  assert(data.metadata && data.metadata.version === 1.0, 'Nested object parsed');
  assert(entries.find(e => e.key === 'tags').type === 'tags', 'Inferred type for tags is "tags"');
  assert(entries.find(e => e.key === 'published').type === 'boolean', 'Inferred type for published is "boolean"');
  assert(entries.find(e => e.key === 'views').type === 'number', 'Inferred type for views is "number"');
  assert(entries.find(e => e.key === 'created').type === 'date', 'Inferred type for created is "date"');
}

console.log('\n📝 Frontmatter Serialization & Modifications:');
{
  const entries = [
    { key: 'title', value: 'Original Title', type: 'text' },
    { key: 'tags', value: ['tagA', 'tagB'], type: 'tags' },
    { key: 'draft', value: false, type: 'boolean' }
  ];

  // Modify title
  entries[0].value = 'Updated Title';
  // Add tag
  entries[1].value.push('tagC');
  // Add new property
  entries.push({ key: 'rating', value: 5, type: 'number' });

  const serialized = stringifyFrontmatter(entries, true);
  assert(serialized.startsWith('---\n'), 'Serialized frontmatter starts with ---');
  assert(serialized.endsWith('\n---'), 'Serialized frontmatter ends with ---');
  assert(serialized.includes('title: Updated Title'), 'Updated title present in serialized YAML');
  assert(serialized.includes('  - tagC'), 'New tagC present in block list');
  assert(serialized.includes('rating: 5'), 'New rating number present');

  // Parse back to confirm round-trip fidelity
  const reparsed = parseFrontmatter(serialized.replace(/^---\n|\n---$/g, ''));
  assert(reparsed.data.title === 'Updated Title', 'Round-trip preserves modified title');
  assert(reparsed.data.tags.length === 3, 'Round-trip preserves 3 tags');
  assert(reparsed.data.rating === 5, 'Round-trip preserves rating number');
  assert(reparsed.data.draft === false, 'Round-trip preserves boolean false');
}

console.log('\n🔍 Document Frontmatter Extraction:');
{
  const docWithFrontmatter = `---
title: Note with metadata
tags: [alpha, beta]
---
# Main Content
Hello world!
`;
  const ext = extractFrontmatter(docWithFrontmatter);
  assert(ext.hasFrontmatter === true, 'Successfully extracted frontmatter');
  assert(ext.from === 0, 'from index is 0');
  assert(docWithFrontmatter.slice(ext.from, ext.to).trim().endsWith('---'), 'to index cleanly covers up to closing fence');
  assert(ext.data.title === 'Note with metadata', 'Frontmatter title matches');
  assert(ext.data.tags[0] === 'alpha' && ext.data.tags[1] === 'beta', 'Inline array tags extracted');

  const docWithout = `# Regular Heading
No frontmatter at all.
---
horizontal rule here.
`;
  const ext2 = extractFrontmatter(docWithout);
  assert(ext2.hasFrontmatter === false, 'Does not treat mid-doc HR as frontmatter');
}

console.log('\n🏷️  Tag Collection for Autocomplete:');
{
  const sampleDoc = `---
tags:
  - design
  - obsidian
---
# Welcome
Here is a #workflow note and another #design tip!
`;
  const tags = collectDocumentTags(sampleDoc);
  assert(tags.includes('workflow'), 'Collects inline #workflow tag');
  assert(tags.includes('design'), 'Collects inline #design tag');
  assert(!tags.includes('123'), 'Excludes pure numeric hashtags');
}

console.log('\n✏️ Document Title Typing Area & Document Model:');
{
  const doc = new Document({ name: 'MyNote.md', path: 'C:/docs/MyNote.md' });
  assert(doc.name === 'MyNote.md', 'Initial doc name is MyNote.md');

  // User edits file name in the Obsidian-style typing area
  const newTitle = 'Renamed Note';
  const hasMd = doc.name.toLowerCase().endsWith('.md');
  doc.setName(hasMd ? `${newTitle}.md` : newTitle);
  doc.markDirty(true);

  assert(doc.name === 'Renamed Note.md', 'Updated document name maintains .md extension');
  assert(doc.dirty === true, 'Document marked dirty after renaming');

  // Untitled document editing
  const untitledDoc = new Document();
  assert(untitledDoc.name.startsWith('Untitled'), 'Default untitled document has Untitled name');
  untitledDoc.setName('My Project Outline');
  assert(untitledDoc.name === 'My Project Outline', 'Untitled doc takes typed name');
}

console.log('\n⚙️ Property Type Selection & Defined Type Icons:');
{
  assert(Array.isArray(PROPERTY_TYPES) && PROPERTY_TYPES.length >= 6, 'Has at least 6 property types defined');
  const typeIds = PROPERTY_TYPES.map(t => t.id);
  assert(typeIds.includes('text'), 'Has text type');
  assert(typeIds.includes('number'), 'Has number type');
  assert(typeIds.includes('boolean'), 'Has boolean checkbox type');
  assert(typeIds.includes('date'), 'Has date type');
  assert(typeIds.includes('tags'), 'Has tags type');
  assert(typeIds.includes('list'), 'Has list type');

  PROPERTY_TYPES.forEach(t => {
    assert(Boolean(ICONS[t.id] || ICONS.tag), `Icon exists for type ${t.id}`);
  });
}

console.log(`\n${passed + failed} tests, ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
